-- V120: daily team-challenge rounds and competition scoring.
--
-- Each selected challenge day is one round with one assigned game. A round can
-- only be started on that date, can only be completed once, and cannot be
-- caught up later. Competition score is deliberately separate from wallet
-- points and from the winner's configured prize:
--
--   played round = clamp(round(100 * benchmark / adjusted_seconds), 20, 150)
--   adjusted_seconds = seconds + hints * 30 + mistakes * 15
--   missed round = -100
--
-- Winner ordering: total score, rounds played, fewer hints, fewer mistakes,
-- lower adjusted time, then deterministic user id.

begin;

create table if not exists public.team_challenge_rounds (
  challenge_id bigint not null
    references public.team_weekly_challenges(id) on delete cascade,
  challenge_date date not null,
  game text not null
    check (game in ('hive','tango','gridly','minisudoku','geo','zoom')),
  round_number integer not null check (round_number between 1 and 7),
  created_at timestamptz not null default now(),
  primary key (challenge_id,challenge_date),
  unique (challenge_id,round_number)
);

create index if not exists team_challenge_rounds_game_idx
on public.team_challenge_rounds(challenge_id,game,challenge_date);

alter table public.team_challenge_rounds enable row level security;

drop policy if exists team_challenge_rounds_select on public.team_challenge_rounds;
create policy team_challenge_rounds_select
on public.team_challenge_rounds
for select
to authenticated
using (
  public.is_admin(auth.uid())
  or exists(
    select 1
    from public.team_weekly_challenges challenge
    join public.team_members member on member.team_id=challenge.team_id
    where challenge.id=team_challenge_rounds.challenge_id
      and member.user_id=auth.uid()
  )
);

revoke all on public.team_challenge_rounds from public;
grant select on public.team_challenge_rounds to authenticated;

create or replace function public.ensure_team_challenge_rounds(
  target_challenge_id bigint
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  challenge public.team_weekly_challenges;
begin
  select *
  into challenge
  from public.team_weekly_challenges
  where id=target_challenge_id;

  if not found
     or coalesce(cardinality(challenge.game_ids),0)=0
     or coalesce(cardinality(challenge.active_days),0)=0 then
    return;
  end if;

  insert into public.team_challenge_rounds(
    challenge_id,challenge_date,game,round_number
  )
  select
    challenge.id,
    challenge.week_start+(scheduled.iso_day-1),
    coalesce(
      (
        -- Preserve the game already played on an existing challenge date so
        -- installing V120 never invalidates a legitimate historical result.
        select result.game
        from public.game_stats result
        where result.team_challenge_id=challenge.id
          and result.mode='challenge'
          and result.challenge_date=challenge.week_start+(scheduled.iso_day-1)
          and result.game=any(challenge.game_ids)
        order by result.completed_at,result.id
        limit 1
      ),
      challenge.game_ids[
        ((scheduled.ordinality::integer-1)%cardinality(challenge.game_ids))+1
      ]
    ),
    scheduled.ordinality::integer
  from (
    select
      selected_day.iso_day,
      row_number() over(order by selected_day.iso_day) as ordinality
    from (
      select distinct unnest(challenge.active_days) as iso_day
    ) selected_day
    where selected_day.iso_day between 1 and 7
  ) scheduled
  on conflict(challenge_id,challenge_date) do nothing;
end;
$$;

revoke all on function public.ensure_team_challenge_rounds(bigint) from public;

create or replace function public.sync_team_challenge_rounds()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='UPDATE'
     and (
       old.week_start is distinct from new.week_start
       or old.game_ids is distinct from new.game_ids
       or old.active_days is distinct from new.active_days
     )
     and not exists(
       select 1 from public.team_challenge_starts
       where challenge_id=new.id
     )
     and not exists(
       select 1 from public.game_stats
       where team_challenge_id=new.id
     ) then
    delete from public.team_challenge_rounds
    where challenge_id=new.id;
  end if;

  perform public.ensure_team_challenge_rounds(new.id);
  return new;
end;
$$;

drop trigger if exists sync_team_challenge_rounds_trigger
on public.team_weekly_challenges;
create trigger sync_team_challenge_rounds_trigger
after insert or update
on public.team_weekly_challenges
for each row execute function public.sync_team_challenge_rounds();

do $$
declare
  challenge record;
begin
  for challenge in
    select id from public.team_weekly_challenges order by id
  loop
    perform public.ensure_team_challenge_rounds(challenge.id);
  end loop;
end;
$$;

create or replace function public.team_challenge_daily_score(
  target_game text,
  target_challenge_date date,
  elapsed_seconds integer,
  hint_count integer,
  mistake_count integer
)
returns integer
language sql
security definer
stable
set search_path=public
as $$
  select greatest(
    20,
    least(
      150,
      round(
        100
        * coalesce(
          (
            select benchmark.effective_seconds
            from public.game_time_benchmarks benchmark
            where benchmark.game=target_game
              and benchmark.mode='challenge'
              and benchmark.day_index=
                extract(isodow from target_challenge_date)::integer-1
            order by benchmark.updated_at desc nulls last
            limit 1
          ),
          100
        )
        / greatest(
          1,
          greatest(coalesce(elapsed_seconds,0),0)
          + greatest(coalesce(hint_count,0),0)*30
          + greatest(coalesce(mistake_count,0),0)*15
        )
      )::integer
    )
  )
$$;

revoke all on function public.team_challenge_daily_score(
  text,date,integer,integer,integer
) from public;

create or replace function public.start_team_challenge_game(
  target_challenge_id bigint,
  target_game text,
  target_challenge_date date
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  challenge public.team_weekly_challenges;
  assigned_round public.team_challenge_rounds;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.'
      using errcode='42501';
  end if;

  select *
  into challenge
  from public.team_weekly_challenges
  where id=target_challenge_id;

  if not found then
    raise exception 'Team challenge not found.' using errcode='22023';
  end if;
  if challenge.closed_at is not null then
    raise exception 'This team challenge is finished.' using errcode='55000';
  end if;
  if not exists(
    select 1
    from public.team_members member
    where member.team_id=challenge.team_id
      and member.user_id=auth.uid()
  ) then
    raise exception 'You are not a member of this team.' using errcode='42501';
  end if;
  if target_challenge_date is distinct from public.app_today() then
    raise exception 'Team challenge rounds can only be played on their scheduled day.'
      using errcode='22023';
  end if;

  perform public.ensure_team_challenge_rounds(challenge.id);

  select *
  into assigned_round
  from public.team_challenge_rounds
  where challenge_id=challenge.id
    and challenge_date=target_challenge_date;

  if not found then
    raise exception 'This team challenge has no round scheduled today.'
      using errcode='22023';
  end if;
  if assigned_round.game is distinct from target_game then
    raise exception 'Today''s assigned game is %.',assigned_round.game
      using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format(
        'team-challenge-round:%s:%s:%s',
        challenge.id,
        auth.uid(),
        target_challenge_date
      ),
      0
    )
  );

  if exists(
    select 1
    from public.game_stats result
    where result.team_challenge_id=challenge.id
      and result.user_id=auth.uid()
      and result.challenge_date=target_challenge_date
  ) then
    raise exception 'You already completed today''s challenge round.'
      using errcode='23505';
  end if;

  insert into public.team_challenge_starts(
    challenge_id,player_id,game,challenge_date
  )
  values(
    challenge.id,auth.uid(),assigned_round.game,target_challenge_date
  )
  on conflict do nothing;

  update public.team_weekly_challenges
  set locked_at=coalesce(locked_at,now())
  where id=challenge.id;
end;
$$;

revoke all on function public.start_team_challenge_game(bigint,text,date)
from public;
grant execute on function public.start_team_challenge_game(bigint,text,date)
to authenticated;

create or replace function public.validate_team_challenge_attempt()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  challenge public.team_weekly_challenges;
  assigned_round public.team_challenge_rounds;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.'
      using errcode='42501';
  end if;
  if new.user_id is distinct from auth.uid() then
    raise exception 'You can only save your own result.' using errcode='42501';
  end if;
  if new.mode is distinct from 'challenge'
     or new.team_challenge_id is null then
    return new;
  end if;

  select *
  into challenge
  from public.team_weekly_challenges
  where id=new.team_challenge_id;

  if not found then
    raise exception 'Team challenge not found.';
  end if;
  if challenge.closed_at is not null then
    raise exception 'This team challenge is finished.' using errcode='55000';
  end if;
  if new.team_id is distinct from challenge.team_id then
    raise exception 'Team challenge does not match the selected team.';
  end if;
  if not exists(
    select 1
    from public.team_members member
    where member.team_id=challenge.team_id
      and member.user_id=new.user_id
  ) then
    raise exception 'You are not a member of this team.';
  end if;

  perform public.ensure_team_challenge_rounds(challenge.id);

  select *
  into assigned_round
  from public.team_challenge_rounds
  where challenge_id=challenge.id
    and challenge_date=new.challenge_date;

  if not found
     or assigned_round.game is distinct from new.game then
    raise exception 'This is not the game assigned to that challenge round.';
  end if;
  if not exists(
    select 1
    from public.team_challenge_starts challenge_start
    where challenge_start.challenge_id=challenge.id
      and challenge_start.player_id=new.user_id
      and challenge_start.game=assigned_round.game
      and challenge_start.challenge_date=assigned_round.challenge_date
  ) then
    raise exception 'Start this team challenge from the challenge screen first.'
      using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format(
        'team-challenge-round:%s:%s:%s',
        challenge.id,
        new.user_id,
        new.challenge_date
      ),
      0
    )
  );

  if exists(
    select 1
    from public.game_stats result
    where result.team_challenge_id=challenge.id
      and result.user_id=new.user_id
      and result.challenge_date=new.challenge_date
      and result.id is distinct from new.id
  ) then
    raise exception 'You already completed this challenge round.'
      using errcode='23505';
  end if;

  update public.team_weekly_challenges
  set locked_at=coalesce(locked_at,now())
  where id=challenge.id;

  return new;
end;
$$;

-- V117 allowed system-generated messages to be addressed to their triggering
-- player. Repeat the constraint repair here so V120 also fixes databases where
-- that earlier migration stopped at the old self-message constraint.
alter table public.direct_messages
  drop constraint if exists direct_messages_not_to_self;
alter table public.direct_messages
  drop constraint if exists direct_messages_not_to_self_check;
alter table public.direct_messages
  add constraint direct_messages_not_to_self
  check (sender_id<>recipient_id or system_generated);

create or replace function public.finalize_team_challenge(
  target_challenge_id bigint
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  challenge public.team_weekly_challenges;
  required_rounds integer;
  member_count integer;
  finisher_count integer;
  deadline date;
  winner_id uuid;
  winner_stat_id bigint;
  winner_name text;
  team_name text;
  award_created bigint;
  existing_winner uuid;
  winning_score integer;
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

  perform public.ensure_team_challenge_rounds(challenge.id);

  select count(*),max(round_item.challenge_date)
  into required_rounds,deadline
  from public.team_challenge_rounds round_item
  where round_item.challenge_id=challenge.id;

  select count(*)
  into member_count
  from public.team_members member
  where member.team_id=challenge.team_id;

  select count(*)
  into finisher_count
  from (
    select member.user_id
    from public.team_members member
    cross join public.team_challenge_rounds round_item
    left join public.game_stats result
      on result.team_challenge_id=challenge.id
     and result.user_id=member.user_id
     and result.mode='challenge'
     and result.challenge_date=round_item.challenge_date
     and result.game=round_item.game
    where member.team_id=challenge.team_id
      and round_item.challenge_id=challenge.id
    group by member.user_id
    having count(distinct result.challenge_date)=required_rounds
  ) finishers;

  if required_rounds=0
     or (
       public.app_today()<=deadline
       and (member_count=0 or finisher_count<member_count)
     ) then
    return null;
  end if;

  with member_rounds as (
    select
      member.user_id,
      round_item.challenge_date,
      round_item.game,
      result.id as stat_id,
      result.seconds,
      result.hints,
      result.mistakes,
      result.completed_at
    from public.team_members member
    cross join public.team_challenge_rounds round_item
    left join lateral (
      select stat.*
      from public.game_stats stat
      where stat.team_challenge_id=challenge.id
        and stat.user_id=member.user_id
        and stat.mode='challenge'
        and stat.challenge_date=round_item.challenge_date
        and stat.game=round_item.game
      order by stat.completed_at,stat.id
      limit 1
    ) result on true
    where member.team_id=challenge.team_id
      and round_item.challenge_id=challenge.id
  ),
  totals as (
    select
      user_id,
      count(stat_id)::integer as rounds_played,
      sum(
        case
          when stat_id is null then -100
          else public.team_challenge_daily_score(
            game,
            challenge_date,
            seconds,
            hints,
            mistakes
          )
        end
      )::integer as challenge_score,
      sum(greatest(coalesce(hints,0),0))::integer as total_hints,
      sum(greatest(coalesce(mistakes,0),0))::integer as total_mistakes,
      sum(
        case when stat_id is null then 0 else
          greatest(coalesce(seconds,0),0)
          + greatest(coalesce(hints,0),0)*30
          + greatest(coalesce(mistakes,0),0)*15
        end
      )::bigint as adjusted_seconds,
      max(completed_at) as finished_at,
      max(stat_id) as last_stat_id
    from member_rounds
    group by user_id
  )
  select
    totals.user_id,
    totals.last_stat_id,
    totals.challenge_score
  into winner_id,winner_stat_id,winning_score
  from totals
  where totals.rounds_played>0
  order by
    totals.challenge_score desc,
    totals.rounds_played desc,
    totals.total_hints,
    totals.total_mistakes,
    totals.adjusted_seconds,
    totals.finished_at,
    totals.user_id
  limit 1;

  -- If nobody entered, close the occurrence without inventing a winner.
  if winner_id is null then
    update public.team_weekly_challenges
    set closed_at=now(),updated_at=now()
    where id=challenge.id;
    return null;
  end if;

  insert into public.team_challenge_reward_awards(
    challenge_id,player_id,points
  )
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
      'challenge_score',winning_score,
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
          '🏆 You won %s with %s challenge points and earned the %s-point winner''s prize!',
          coalesce(challenge.title,team_name,'the team challenge'),
          winning_score,
          challenge.reward_points
        )
      when member.user_id=winner_id then
        format(
          '🏆 You won %s with %s challenge points — your prize is %s.',
          coalesce(challenge.title,team_name,'the team challenge'),
          winning_score,
          challenge.reward_label
        )
      when challenge.reward_type='points' then
        format(
          '🏆 %s won %s with %s challenge points and earned the %s-point winner''s prize.',
          winner_name,
          coalesce(challenge.title,team_name,'the team challenge'),
          winning_score,
          challenge.reward_points
        )
      else
        format(
          '🏆 %s won %s with %s challenge points — prize: %s.',
          winner_name,
          coalesce(challenge.title,team_name,'the team challenge'),
          winning_score,
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
    select challenge.id,challenge.team_id,challenge.closed_at
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
      count(distinct result.challenge_date)=
        count(distinct round_item.challenge_date) as finished
    from my_challenges challenge
    join public.team_members member on member.team_id=challenge.team_id
    join public.team_challenge_rounds round_item
      on round_item.challenge_id=challenge.id
    left join public.game_stats result
      on result.user_id=member.user_id
     and result.team_challenge_id=challenge.id
     and result.mode='challenge'
     and result.challenge_date=round_item.challenge_date
     and result.game=round_item.game
    group by challenge.id,member.user_id
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
grant execute on function public.get_my_team_challenge_lifecycle()
to authenticated;

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
      count(*) filter(where totals.rounds_played>0)::integer as entry_count,
      count(*) filter(
        where totals.rounds_played=totals.required_rounds
      )::integer as finisher_count,
      coalesce(
        bool_or(
          totals.rounds_played=totals.required_rounds
        ) filter(where totals.user_id=auth.uid()),
        false
      ) as current_user_finished
    from (
      select
        member.user_id,
        count(distinct result.challenge_date)::integer as rounds_played,
        count(distinct round_item.challenge_date)::integer as required_rounds
      from public.team_members member
      cross join public.team_challenge_rounds round_item
      left join public.game_stats result
        on result.user_id=member.user_id
       and result.team_challenge_id=challenge.id
       and result.mode='challenge'
       and result.challenge_date=round_item.challenge_date
       and result.game=round_item.game
      where member.team_id=challenge.team_id
        and round_item.challenge_id=challenge.id
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

revoke all on function public.get_my_team_challenge_history(integer)
from public;
grant execute on function public.get_my_team_challenge_history(integer)
to authenticated;

-- Server-side closure does not depend on a player opening the app. Where the
-- Supabase project has pg_cron enabled, run shortly after every hour; the
-- existing on-page finalizer remains a safe fallback if pg_cron is unavailable.
create or replace function public.finalize_all_due_team_challenges()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  due_challenge record;
  finalised_count integer:=0;
begin
  for due_challenge in
    select challenge.id
    from public.team_weekly_challenges challenge
    where challenge.closed_at is null
      and public.app_today()>(
        challenge.week_start+
        (
          select max(day_number)-1
          from unnest(challenge.active_days) day_number
        )
      )
    order by challenge.id
  loop
    perform public.finalize_team_challenge(due_challenge.id);
    finalised_count:=finalised_count+1;
  end loop;

  return finalised_count;
end;
$$;

revoke all on function public.finalize_all_due_team_challenges() from public;

do $$
begin
  if exists(
    select 1
    from pg_extension
    where extname='pg_cron'
  ) then
    begin
      execute $schedule$
        select cron.schedule(
          'imbored-finalize-team-challenges',
          '17 * * * *',
          'select public.finalize_all_due_team_challenges()'
        )
      $schedule$;
    exception
      when others then
        raise notice 'Could not schedule automatic team-challenge finalisation: %',
          sqlerrm;
    end;
  end if;
end;
$$;

notify pgrst,'reload schema';
commit;
