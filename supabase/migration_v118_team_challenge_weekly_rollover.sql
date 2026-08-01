-- V118: explicit team-challenge schedules, deadline finalisation and history.
--
-- This replaces the earlier automatic rollover draft. Existing challenges are
-- treated as one-week challenges. New challenges must explicitly choose
-- whether they run once or repeat weekly, and recurring challenges have a
-- finite 2–52 week duration.

begin;

alter table public.team_weekly_challenges
  add column if not exists series_id bigint,
  add column if not exists repeats_weekly boolean not null default false,
  add column if not exists series_weeks integer not null default 1,
  add column if not exists occurrence_number integer not null default 1,
  add column if not exists closed_at timestamp with time zone;

update public.team_weekly_challenges
set series_id=id
where series_id is null;

alter table public.team_weekly_challenges
  drop constraint if exists team_weekly_challenges_series_weeks_check;
alter table public.team_weekly_challenges
  add constraint team_weekly_challenges_series_weeks_check
  check (series_weeks between 1 and 52);

alter table public.team_weekly_challenges
  drop constraint if exists team_weekly_challenges_occurrence_number_check;
alter table public.team_weekly_challenges
  add constraint team_weekly_challenges_occurrence_number_check
  check (occurrence_number between 1 and series_weeks);

create index if not exists team_weekly_challenges_series_idx
on public.team_weekly_challenges(series_id,week_start,occurrence_number);

create index if not exists team_weekly_challenges_history_idx
on public.team_weekly_challenges(team_id,closed_at desc,week_start desc);

drop function if exists public.rollover_my_team_challenges();

-- Finalise one occurrence when either every current team member has completed
-- all configured games, or its last selected playing day has passed.
create or replace function public.finalize_team_challenge(target_challenge_id bigint)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  challenge public.team_weekly_challenges;
  required_games integer;
  member_count integer;
  finisher_count integer;
  deadline date;
  winner_id uuid;
  winner_stat_id bigint;
  winner_name text;
  team_name text;
  award_created bigint;
  existing_winner uuid;
begin
  select *
  into challenge
  from public.team_weekly_challenges
  where id=target_challenge_id
  for update;

  if not found then
    return null;
  end if;

  select award.player_id
  into existing_winner
  from public.team_challenge_reward_awards award
  where award.challenge_id=challenge.id
  order by award.awarded_at,award.id
  limit 1;

  if challenge.closed_at is not null then
    return existing_winner;
  end if;

  if existing_winner is not null then
    update public.team_weekly_challenges
    set closed_at=coalesce(closed_at,now()),updated_at=now()
    where id=challenge.id;
    return existing_winner;
  end if;

  required_games:=cardinality(challenge.game_ids);
  select challenge.week_start+(max(day_number)-1)
  into deadline
  from unnest(challenge.active_days) day_number;

  select count(*)
  into member_count
  from public.team_members
  where team_id=challenge.team_id;

  select count(*)
  into finisher_count
  from (
    select member.user_id
    from public.team_members member
    left join public.game_stats result
      on result.user_id=member.user_id
     and result.team_challenge_id=challenge.id
     and result.mode='challenge'
     and result.game=any(challenge.game_ids)
    where member.team_id=challenge.team_id
    group by member.user_id
    having count(distinct result.game)=required_games
  ) finishers;

  if required_games=0
     or (
       public.app_today()<=deadline
       and (member_count=0 or finisher_count<member_count)
     ) then
    return null;
  end if;

  -- Only a player who completed every configured game can win. Ranking uses
  -- the same adjusted-time model shown in standings: seconds + 30 per hint +
  -- 15 per mistake, then hints, mistakes and finish time as tie-breakers.
  select ranked.user_id,ranked.last_stat_id
  into winner_id,winner_stat_id
  from (
    select
      result.user_id,
      max(result.id) as last_stat_id,
      sum(
        greatest(result.seconds,0)
        + greatest(result.hints,0)*30
        + greatest(result.mistakes,0)*15
      ) as adjusted_seconds,
      sum(greatest(result.hints,0)) as total_hints,
      sum(greatest(result.mistakes,0)) as total_mistakes,
      max(result.completed_at) as finished_at
    from public.game_stats result
    where result.team_challenge_id=challenge.id
      and result.mode='challenge'
      and result.game=any(challenge.game_ids)
    group by result.user_id
    having count(distinct result.game)=required_games
    order by adjusted_seconds,total_hints,total_mistakes,finished_at,result.user_id
    limit 1
  ) ranked;

  -- A challenge with no fully completed entry still closes, but has no winner
  -- and awards no prize.
  if winner_id is null then
    update public.team_weekly_challenges
    set closed_at=now(),updated_at=now()
    where id=challenge.id;
    return null;
  end if;

  insert into public.team_challenge_reward_awards(challenge_id,player_id,points)
  values(
    challenge.id,
    winner_id,
    case when challenge.reward_type='points'
      then greatest(challenge.reward_points,0)
      else 0
    end
  )
  on conflict(challenge_id,player_id) do nothing
  returning id into award_created;

  if award_created is null then
    update public.team_weekly_challenges
    set closed_at=coalesce(closed_at,now()),updated_at=now()
    where id=challenge.id;
    return winner_id;
  end if;

  if challenge.reward_type='points' and challenge.reward_points>0 then
    perform public.ensure_player_progress(winner_id);
    update public.player_progress
    set
      available_points=available_points+challenge.reward_points,
      lifetime_points=lifetime_points+challenge.reward_points,
      current_level=public.points_level(lifetime_points+challenge.reward_points),
      updated_at=now()
    where player_id=winner_id;
  end if;

  insert into public.points_transactions(
    player_id,points,reason_code,metadata,created_by
  )
  values(
    winner_id,
    case when challenge.reward_type='points'
      then greatest(challenge.reward_points,0)
      else 0
    end,
    'TEAM_CHALLENGE_WINNER',
    jsonb_build_object(
      'team_id',challenge.team_id,
      'team_challenge_id',challenge.id,
      'week_start',challenge.week_start,
      'reward_points',case when challenge.reward_type='points'
        then greatest(challenge.reward_points,0)
        else 0
      end,
      'reward_label',case when challenge.reward_type='prize'
        then challenge.reward_label
        else null
      end
    ),
    winner_id
  );

  select coalesce(nullif(btrim(profile.name),''),'A teammate')
  into winner_name
  from public.profiles profile
  where profile.id=winner_id;

  select team.name
  into team_name
  from public.teams team
  where team.id=challenge.team_id;

  insert into public.direct_messages(
    sender_id,recipient_id,body,system_generated,activity_type,source_stat_id
  )
  select
    winner_id,
    member.user_id,
    case
      when member.user_id=winner_id and challenge.reward_type='points' then
        format(
          '🏆 You won %s and earned the %s-point winner''s prize!',
          coalesce(challenge.title,team_name,'the team challenge'),
          challenge.reward_points
        )
      when member.user_id=winner_id then
        format(
          '🏆 You won %s — your prize is %s.',
          coalesce(challenge.title,team_name,'the team challenge'),
          challenge.reward_label
        )
      when challenge.reward_type='points' then
        format(
          '🏆 %s won %s and earned the %s-point winner''s prize.',
          winner_name,
          coalesce(challenge.title,team_name,'the team challenge'),
          challenge.reward_points
        )
      else
        format(
          '🏆 %s won %s — prize: %s.',
          winner_name,
          coalesce(challenge.title,team_name,'the team challenge'),
          challenge.reward_label
        )
    end,
    true,
    'team_challenge_winner',
    winner_stat_id
  from public.team_members member
  where member.team_id=challenge.team_id
  on conflict do nothing;

  update public.team_weekly_challenges
  set closed_at=now(),updated_at=now()
  where id=challenge.id;

  return winner_id;
end;
$$;

revoke all on function public.finalize_team_challenge(bigint) from public;

create or replace function public.finalize_due_team_challenges()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  due_challenge record;
  finalised_count integer:=0;
begin
  if not public.is_approved_user(auth.uid()) then
    return 0;
  end if;

  for due_challenge in
    select distinct challenge.id
    from public.team_members membership
    join public.team_weekly_challenges challenge
      on challenge.team_id=membership.team_id
    where membership.user_id=auth.uid()
      and challenge.closed_at is null
      and public.app_today()>(
        challenge.week_start+
        (select max(day_number)-1 from unnest(challenge.active_days) day_number)
      )
  loop
    perform public.finalize_team_challenge(due_challenge.id);
    finalised_count:=finalised_count+1;
  end loop;

  return finalised_count;
end;
$$;

revoke all on function public.finalize_due_team_challenges() from public;
grant execute on function public.finalize_due_team_challenges() to authenticated;

create or replace function public.award_completed_team_challenge()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.mode='challenge' and new.team_challenge_id is not null then
    perform public.finalize_team_challenge(new.team_challenge_id);
  end if;
  return new;
end;
$$;

drop function if exists public.get_my_active_team_challenges();
create function public.get_my_active_team_challenges()
returns table(
  challenge_id bigint,
  team_id bigint,
  team_name text,
  team_emoji text,
  challenge_title text,
  game_ids text[],
  active_days integer[],
  reward_points integer,
  reward_type text,
  reward_label text,
  active_today boolean,
  is_locked boolean,
  repeats_weekly boolean,
  series_weeks integer,
  occurrence_number integer,
  closes_on date
)
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.finalize_due_team_challenges();

  return query
  select
    challenge.id,
    team.id,
    team.name::text,
    coalesce(team.emoji,'⭐')::text,
    coalesce(nullif(btrim(challenge.title),''),'Weekly challenge')::text,
    challenge.game_ids,
    challenge.active_days,
    challenge.reward_points,
    challenge.reward_type,
    challenge.reward_label,
    extract(isodow from public.app_today())::integer=any(challenge.active_days),
    (
      challenge.locked_at is not null
      or exists(
        select 1
        from public.team_challenge_starts challenge_start
        where challenge_start.challenge_id=challenge.id
      )
      or exists(
        select 1
        from public.game_stats result
        where result.team_challenge_id=challenge.id
      )
    ),
    challenge.repeats_weekly,
    challenge.series_weeks,
    challenge.occurrence_number,
    challenge.week_start+
      (select max(day_number)-1 from unnest(challenge.active_days) day_number)
  from public.team_members membership
  join public.teams team on team.id=membership.team_id
  join public.team_weekly_challenges challenge
    on challenge.team_id=team.id
   and challenge.week_start=public.current_week_start()
  where membership.user_id=auth.uid()
    and public.is_approved_user(auth.uid())
    and challenge.closed_at is null
  order by team.name,challenge.created_at,challenge.id;
end;
$$;

revoke all on function public.get_my_active_team_challenges() from public;
grant execute on function public.get_my_active_team_challenges() to authenticated;

drop function if exists public.get_my_team_challenge_lifecycle();
create function public.get_my_team_challenge_lifecycle()
returns table(
  challenge_id bigint,
  member_count integer,
  finished_count integer,
  current_user_finished boolean,
  winner_id uuid,
  winner_name text,
  winner_icon text,
  awarded_at timestamptz,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.finalize_due_team_challenges();

  return query
  with my_challenges as (
    select challenge.id,challenge.team_id,challenge.game_ids,challenge.closed_at
    from public.team_members membership
    join public.team_weekly_challenges challenge
      on challenge.team_id=membership.team_id
     and challenge.week_start=public.current_week_start()
    where membership.user_id=auth.uid()
      and public.is_approved_user(auth.uid())
  ),
  member_progress as (
    select
      challenge.id as challenge_id,
      member.user_id,
      count(distinct result.game) filter(
        where result.game=any(challenge.game_ids)
      )=cardinality(challenge.game_ids) as finished
    from my_challenges challenge
    join public.team_members member on member.team_id=challenge.team_id
    left join public.game_stats result
      on result.user_id=member.user_id
     and result.team_challenge_id=challenge.id
     and result.mode='challenge'
    group by challenge.id,challenge.game_ids,member.user_id
  )
  select
    challenge.id,
    count(progress.user_id)::integer,
    count(*) filter(where progress.finished)::integer,
    coalesce(
      bool_or(progress.finished) filter(where progress.user_id=auth.uid()),
      false
    ),
    award.player_id,
    winner.name::text,
    winner.icon::text,
    award.awarded_at,
    challenge.closed_at
  from my_challenges challenge
  join member_progress progress on progress.challenge_id=challenge.id
  left join lateral (
    select item.player_id,item.awarded_at
    from public.team_challenge_reward_awards item
    where item.challenge_id=challenge.id
    order by item.awarded_at,item.id
    limit 1
  ) award on true
  left join public.profiles winner on winner.id=award.player_id
  group by
    challenge.id,
    challenge.closed_at,
    award.player_id,
    award.awarded_at,
    winner.name,
    winner.icon
  order by challenge.id;
end;
$$;

revoke all on function public.get_my_team_challenge_lifecycle() from public;
grant execute on function public.get_my_team_challenge_lifecycle() to authenticated;

create or replace function public.get_my_team_challenge_history(
  history_limit_in integer default 30
)
returns table(
  challenge_id bigint,
  team_id bigint,
  team_name text,
  team_emoji text,
  challenge_title text,
  week_start date,
  closed_at timestamptz,
  game_ids text[],
  active_days integer[],
  reward_points integer,
  reward_type text,
  reward_label text,
  winner_id uuid,
  winner_name text,
  winner_icon text,
  entry_count integer,
  finisher_count integer,
  current_user_finished boolean,
  repeats_weekly boolean,
  series_weeks integer,
  occurrence_number integer
)
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.finalize_due_team_challenges();

  return query
  select
    challenge.id,
    team.id,
    team.name::text,
    coalesce(team.emoji,'⭐')::text,
    coalesce(nullif(btrim(challenge.title),''),'Weekly challenge')::text,
    challenge.week_start,
    challenge.closed_at,
    challenge.game_ids,
    challenge.active_days,
    challenge.reward_points,
    challenge.reward_type,
    challenge.reward_label,
    award.player_id,
    winner.name::text,
    winner.icon::text,
    coalesce(progress.entry_count,0)::integer,
    coalesce(progress.finisher_count,0)::integer,
    coalesce(progress.current_user_finished,false),
    challenge.repeats_weekly,
    challenge.series_weeks,
    challenge.occurrence_number
  from public.team_members membership
  join public.teams team on team.id=membership.team_id
  join public.team_weekly_challenges challenge
    on challenge.team_id=team.id
  left join lateral (
    select item.player_id,item.awarded_at
    from public.team_challenge_reward_awards item
    where item.challenge_id=challenge.id
    order by item.awarded_at,item.id
    limit 1
  ) award on true
  left join public.profiles winner on winner.id=award.player_id
  left join lateral (
    select
      count(*) filter(where totals.games_completed>0)::integer as entry_count,
      count(*) filter(
        where totals.games_completed=cardinality(challenge.game_ids)
      )::integer as finisher_count,
      coalesce(
        bool_or(
          totals.games_completed=cardinality(challenge.game_ids)
        ) filter(where totals.user_id=auth.uid()),
        false
      ) as current_user_finished
    from (
      select
        member.user_id,
        count(distinct result.game) filter(
          where result.game=any(challenge.game_ids)
        ) as games_completed
      from public.team_members member
      left join public.game_stats result
        on result.user_id=member.user_id
       and result.team_challenge_id=challenge.id
       and result.mode='challenge'
      where member.team_id=challenge.team_id
      group by member.user_id
    ) totals
  ) progress on true
  where membership.user_id=auth.uid()
    and public.is_approved_user(auth.uid())
    and challenge.closed_at is not null
  order by challenge.closed_at desc,challenge.week_start desc,challenge.id desc
  limit least(greatest(coalesce(history_limit_in,30),1),100);
end;
$$;

revoke all on function public.get_my_team_challenge_history(integer) from public;
grant execute on function public.get_my_team_challenge_history(integer) to authenticated;

-- Drop both the current and legacy signatures so this migration is safe to
-- rerun after a previous successful or partially applied V118 execution.
drop function if exists public.set_team_weekly_challenge(
  bigint,text[],integer[],integer,text,text,bigint,text,boolean,integer
);
drop function if exists public.set_team_weekly_challenge(
  bigint,text[],integer[],integer,text,text,bigint,text
);
create function public.set_team_weekly_challenge(
  target_team_id bigint,
  selected_games text[],
  selected_days integer[],
  reward_points_in integer default 0,
  reward_type_in text default 'points',
  reward_label_in text default null,
  target_challenge_id bigint default null,
  challenge_title_in text default null,
  repeat_weekly_in boolean default null,
  duration_weeks_in integer default null
)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  current_challenge public.team_weekly_challenges;
  result_id bigint;
  series_key bigint;
  week_offset integer;
  clean_games text[];
  clean_days integer[];
  clean_title text:=nullif(btrim(challenge_title_in),'');
  clean_reward_type text:=coalesce(nullif(btrim(reward_type_in),''),'points');
  clean_duration integer;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not exists(
    select 1
    from public.teams
    where id=target_team_id and created_by=auth.uid()
  ) then
    raise exception 'Only the team owner can manage challenges.' using errcode='42501';
  end if;
  if repeat_weekly_in is null then
    raise exception 'Choose whether this challenge runs once or repeats weekly.';
  end if;

  clean_duration:=case
    when repeat_weekly_in then coalesce(duration_weeks_in,0)
    else 1
  end;

  if repeat_weekly_in and clean_duration not between 2 and 52 then
    raise exception 'Choose a repeat duration between 2 and 52 weeks.';
  end if;

  select array_agg(game order by first_position)
  into clean_games
  from (
    select game,min(selected.ordinality) as first_position
    from unnest(selected_games) with ordinality selected(game,ordinality)
    where game in ('hive','tango','gridly','minisudoku','geo','zoom')
    group by game
  ) valid_games;

  select array_agg(distinct day order by day)
  into clean_days
  from unnest(selected_days) day
  where day between 1 and 7;

  if coalesce(cardinality(clean_games),0)=0 then
    raise exception 'Choose at least one game.';
  end if;
  if coalesce(cardinality(clean_days),0)=0 then
    raise exception 'Choose at least one playing day.';
  end if;
  if clean_title is null then
    raise exception 'Enter a challenge name.';
  end if;
  if char_length(clean_title)>60 then
    raise exception 'Challenge names can be up to 60 characters.';
  end if;
  if coalesce(reward_points_in,0) not between 0 and 500 then
    raise exception 'Reward must be between 0 and 500 points.';
  end if;
  if clean_reward_type not in ('points','prize') then
    raise exception 'Invalid reward type.';
  end if;
  if clean_reward_type='prize'
     and nullif(btrim(reward_label_in),'') is null then
    raise exception 'Enter the prize.';
  end if;

  if target_challenge_id is not null then
    select *
    into current_challenge
    from public.team_weekly_challenges
    where id=target_challenge_id
      and team_id=target_team_id
      and week_start=public.current_week_start()
      and closed_at is null
    for update;

    if not found then
      raise exception 'Challenge not found.';
    end if;
    if current_challenge.locked_at is not null
       or exists(
         select 1
         from public.team_challenge_starts
         where challenge_id=current_challenge.id
       )
       or exists(
         select 1
         from public.game_stats
         where team_challenge_id=current_challenge.id
       ) then
      update public.team_weekly_challenges
      set locked_at=coalesce(locked_at,now())
      where id=current_challenge.id;
      raise exception 'This challenge is already in progress and is locked.'
        using errcode='55000';
    end if;

    series_key:=coalesce(current_challenge.series_id,current_challenge.id);

    if exists(
      select 1
      from public.team_weekly_challenges future_challenge
      where future_challenge.series_id=series_key
        and future_challenge.week_start>=public.current_week_start()
        and (
          future_challenge.locked_at is not null
          or exists(
            select 1
            from public.team_challenge_starts future_start
            where future_start.challenge_id=future_challenge.id
          )
          or exists(
            select 1
            from public.game_stats future_result
            where future_result.team_challenge_id=future_challenge.id
          )
        )
    ) then
      raise exception 'A scheduled week in this series has already started.'
        using errcode='55000';
    end if;

    delete from public.team_weekly_challenges
    where series_id=series_key
      and week_start>=public.current_week_start();
  else
    series_key:=null;
  end if;

  for week_offset in 0..clean_duration-1 loop
    if (
      select count(*)
      from public.team_weekly_challenges
      where team_id=target_team_id
        and week_start=public.current_week_start()+(week_offset*7)
    )>=10 then
      raise exception 'A team can create up to 10 challenges in any week.';
    end if;

    insert into public.team_weekly_challenges(
      team_id,
      week_start,
      title,
      game_ids,
      active_days,
      reward_points,
      reward_type,
      reward_label,
      locked_at,
      created_by,
      series_id,
      repeats_weekly,
      series_weeks,
      occurrence_number,
      closed_at
    )
    values(
      target_team_id,
      public.current_week_start()+(week_offset*7),
      clean_title,
      clean_games,
      clean_days,
      case when clean_reward_type='points'
        then greatest(coalesce(reward_points_in,0),0)
        else 0
      end,
      clean_reward_type,
      case when clean_reward_type='prize'
        then nullif(btrim(reward_label_in),'')
        else null
      end,
      null,
      auth.uid(),
      series_key,
      repeat_weekly_in,
      clean_duration,
      week_offset+1,
      null
    )
    returning id into result_id;

    if series_key is null then
      series_key:=result_id;
      update public.team_weekly_challenges
      set series_id=series_key
      where id=result_id;
    end if;

    if week_offset=0 then
      target_challenge_id:=result_id;
    end if;
  end loop;

  return target_challenge_id;
end;
$$;

revoke all on function public.set_team_weekly_challenge(
  bigint,text[],integer[],integer,text,text,bigint,text,boolean,integer
) from public;
grant execute on function public.set_team_weekly_challenge(
  bigint,text[],integer[],integer,text,text,bigint,text,boolean,integer
) to authenticated;

notify pgrst,'reload schema';
commit;
