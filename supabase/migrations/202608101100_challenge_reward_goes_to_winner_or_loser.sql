-- A real-world challenge reward can run in either direction.
--
-- "Movie ticket" is something the winner collects. "Clean the bathroom" is
-- something the loser owes. The app had no way to say which, so every prize
-- was announced as the winner's and a forfeit could not be expressed at all.
--
-- Two gaps are closed here:
--
--   1. reward_goes_to records the direction. It only applies to a real prize
--      (reward_type='prize'); a points reward always goes to the winner,
--      because handing a loser points would be a punishment and there is
--      nobody to take them from.
--
--   2. finalize_circle_challenge() now works out last place as well as first,
--      records it, and names the person who has to hand the thing over or do
--      it. Settlement still happens in the real world — the app's job is to
--      say plainly who owes what to whom, which it previously did not do at
--      all, even for stakes people had explicitly accepted.
--
-- Last place is taken from everyone who was in the challenge, not only those
-- who played. Under the current scoring a played round is worth at least 20
-- and a missed one scores nothing, so someone who skipped the week naturally
-- lands last — which is what stops "just don't play" being a way to dodge a
-- forfeit you already agreed to.

alter table public.circle_weekly_challenges
  add column if not exists reward_goes_to text not null default 'winner';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='circle_weekly_challenges_reward_goes_to_check'
  ) then
    alter table public.circle_weekly_challenges
      add constraint circle_weekly_challenges_reward_goes_to_check
      check (reward_goes_to in ('winner','loser'));
  end if;
end;
$$;

-- Who finished last, and therefore owes a forfeit. Null until the challenge
-- closes, and null when nobody took part at all.
alter table public.circle_weekly_challenges
  add column if not exists loser_id uuid references public.profiles(id) on delete set null;

-- Lowest-placed member of a challenge, using the reverse of the winner
-- ordering so first and last are decided by exactly the same rules.
create or replace function public.circle_challenge_last_place(target_challenge_id bigint)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select totals.member_id
  from public.circle_challenge_member_totals(target_challenge_id) totals
  order by
    totals.challenge_score asc,
    totals.rounds_played asc,
    totals.total_hints desc,
    totals.total_mistakes desc,
    totals.adjusted_seconds desc,
    totals.finished_at desc nulls first,
    totals.member_id desc
  limit 1;
$$;

grant execute on function public.circle_challenge_last_place(bigint) to authenticated;
CREATE OR REPLACE FUNCTION public.finalize_circle_challenge(target_challenge_id bigint) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  challenge public.circle_weekly_challenges;
  required_rounds integer;
  member_count integer;
  finisher_count integer;
  deadline date;
  winner_id uuid;
  winner_stat_id bigint;
  winner_name text;
  circle_name text;
  award_created bigint;
  existing_winner uuid;
  winning_score integer;
  loser_id uuid;
  loser_name text;
  prize_label text;
begin
  select *
  into challenge
  from public.circle_weekly_challenges
  where id=target_challenge_id
  for update;

  if not found then
    return null;
  end if;

  select award.player_id
  into existing_winner
  from public.circle_challenge_reward_awards award
  where award.challenge_id=challenge.id
  order by award.awarded_at,award.id
  limit 1;

  if challenge.closed_at is not null then
    return existing_winner;
  end if;
  if existing_winner is not null then
    update public.circle_weekly_challenges
    set closed_at=coalesce(closed_at,now()),updated_at=now()
    where id=challenge.id;
    return existing_winner;
  end if;

  perform public.ensure_circle_challenge_rounds(challenge.id);

  select count(*),max(round_item.challenge_date)
  into required_rounds,deadline
  from public.circle_challenge_rounds round_item
  where round_item.challenge_id=challenge.id;

  select count(*)
  into member_count
  from public.circle_members member
  where member.circle_id=challenge.circle_id;

  select count(*)
  into finisher_count
  from public.circle_challenge_member_totals(challenge.id) totals
  where totals.rounds_played=required_rounds;

  if required_rounds=0
     or (
       public.circle_today(challenge.circle_id)<=deadline
       and (member_count=0 or finisher_count<member_count)
     ) then
    return null;
  end if;

  select totals.member_id,totals.last_stat_id,totals.challenge_score
  into winner_id,winner_stat_id,winning_score
  from public.circle_challenge_member_totals(challenge.id) totals
  where totals.rounds_played>0
  order by
    totals.challenge_score desc,
    totals.rounds_played desc,
    totals.total_hints,
    totals.total_mistakes,
    totals.adjusted_seconds,
    totals.finished_at,
    totals.member_id
  limit 1;

  if winner_id is null then
    update public.circle_weekly_challenges
    set closed_at=now(),updated_at=now()
    where id=challenge.id;
    return null;
  end if;

  insert into public.circle_challenge_reward_awards(
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
    update public.circle_weekly_challenges
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
      'circle_id',challenge.circle_id,
      'circle_challenge_id',challenge.id,
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

  select circle.name
  into circle_name
  from public.circles circle
  where circle.id=challenge.circle_id;

  -- Last place decides a forfeit, and is worth recording either way so the
  -- circle can see how the week actually finished. A one-player challenge has
  -- no loser.
  loser_id := public.circle_challenge_last_place(challenge.id);
  if loser_id = winner_id then
    loser_id := null;
  end if;
  select coalesce(nullif(btrim(profile.name),''),'Someone')
  into loser_name
  from public.profiles profile
  where profile.id=loser_id;

  prize_label := coalesce(nullif(btrim(challenge.reward_label),''),'the prize');

  insert into public.direct_messages(
    sender_id,recipient_id,body,system_generated,activity_type,source_stat_id
  )
  select
    winner_id,
    member.user_id,
    case
      -- A real thing the loser owes. Everyone is told who settles it with
      -- whom, because the app cannot hand over a bathroom clean itself.
      when challenge.reward_type='prize' and challenge.reward_goes_to='loser' and loser_id is not null then
        case
          when member.user_id=loser_id then
            format(
              '🏆 %s won %s. You finished last, so %s is on you — sort it out between you.',
              winner_name,
              coalesce(challenge.title,circle_name,'the circle challenge'),
              prize_label
            )
          when member.user_id=winner_id then
            format(
              '🏆 You won %s. %s finished last and owes you %s — sort it out between you.',
              coalesce(challenge.title,circle_name,'the circle challenge'),
              loser_name,
              prize_label
            )
          else
            format(
              '🏆 %s won %s. %s finished last and owes %s.',
              winner_name,
              coalesce(challenge.title,circle_name,'the circle challenge'),
              loser_name,
              prize_label
            )
        end
      when member.user_id=winner_id and challenge.reward_type='points' then
        format(
          '🏆 You won %s and earned the %s-point winner''s prize!',
          coalesce(challenge.title,circle_name,'the circle challenge'),
          challenge.reward_points
        )
      when member.user_id=winner_id then
        format(
          '🏆 You won %s — your prize is %s. The circle settles this outside the app.',
          coalesce(challenge.title,circle_name,'the circle challenge'),
          prize_label
        )
      when challenge.reward_type='points' then
        format(
          '🏆 %s won %s and earned the %s-point winner''s prize.',
          winner_name,
          coalesce(challenge.title,circle_name,'the circle challenge'),
          challenge.reward_points
        )
      else
        format(
          '🏆 %s won %s — prize: %s. The circle settles this outside the app.',
          winner_name,
          coalesce(challenge.title,circle_name,'the circle challenge'),
          prize_label
        )
    end,
    true,
    'circle_challenge_winner',
    winner_stat_id
  from public.circle_members member
  where member.circle_id=challenge.circle_id
  on conflict do nothing;

  update public.circle_weekly_challenges
  set closed_at=now(),loser_id=finalize_circle_challenge.loser_id,updated_at=now()
  where id=challenge.id;

  return winner_id;
end;
$$;
-- The two listing RPCs and the setter gain the new field. Return types change,
-- so these have to be dropped rather than replaced.

DROP FUNCTION IF EXISTS public.get_my_active_circle_challenges();
CREATE FUNCTION public.get_my_active_circle_challenges() RETURNS TABLE(challenge_id bigint, circle_id bigint, circle_name text, circle_emoji text, challenge_title text, game_ids text[], active_days integer[], reward_points integer, reward_type text, reward_label text, active_today boolean, is_locked boolean, repeats_weekly boolean, series_weeks integer, occurrence_number integer, reward_goes_to text, closes_on date, stake_reward_id bigint, stake_reward_name text, stake_split_method text, stake_accepted boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.finalize_due_circle_challenges();

  return query
  select
    challenge.id,
    circle.id,
    circle.name::text,
    coalesce(circle.emoji,'⭐')::text,
    coalesce(nullif(btrim(challenge.title),''),'Weekly challenge')::text,
    challenge.game_ids,
    challenge.active_days,
    challenge.reward_points,
    challenge.reward_type,
    challenge.reward_label,
    extract(isodow from public.circle_today(circle.id))::integer=any(challenge.active_days),
    (
      challenge.locked_at is not null
      or exists(
        select 1
        from public.circle_challenge_starts challenge_start
        where challenge_start.challenge_id=challenge.id
      )
      or exists(
        select 1
        from public.game_stats result
        where result.circle_challenge_id=challenge.id
      )
    ),
    challenge.repeats_weekly,
    challenge.series_weeks,
    challenge.occurrence_number,
    challenge.reward_goes_to,
    challenge.week_start+
      (select max(day_number)-1 from unnest(challenge.active_days) day_number),
    challenge.stake_reward_id,
    stake_reward.name::text,
    challenge.stake_split_method,
    exists(
      select 1 from public.circle_challenge_stake_acceptances a
      where a.challenge_id=challenge.id and a.user_id=auth.uid()
    )
  from public.circle_members membership
  join public.circles circle on circle.id=membership.circle_id
  join public.circle_weekly_challenges challenge
    on challenge.circle_id=circle.id
   and challenge.week_start=public.circle_week_start(circle.id)
  left join public.rewards stake_reward on stake_reward.id=challenge.stake_reward_id
  where membership.user_id=auth.uid()
    and public.is_approved_user(auth.uid())
    and challenge.closed_at is null
  order by circle.name,challenge.created_at,challenge.id;
end;
$$;

DROP FUNCTION IF EXISTS public.get_my_circle_challenge_history(integer);
CREATE FUNCTION public.get_my_circle_challenge_history(history_limit_in integer DEFAULT 30) RETURNS TABLE(challenge_id bigint, circle_id bigint, circle_name text, circle_emoji text, challenge_title text, week_start date, closed_at timestamp with time zone, game_ids text[], active_days integer[], reward_points integer, reward_type text, reward_label text, winner_id uuid, winner_name text, winner_icon text, entry_count integer, finisher_count integer, current_user_finished boolean, repeats_weekly boolean, series_weeks integer, occurrence_number integer, reward_goes_to text, loser_id uuid, loser_name text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.finalize_due_circle_challenges();

  return query
  select
    challenge.id,
    circle.id,
    circle.name::text,
    coalesce(circle.emoji,'⭐')::text,
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
    challenge.occurrence_number,
    challenge.reward_goes_to,
    challenge.loser_id,
    loser.name::text
  from public.circle_members membership
  join public.circles circle on circle.id=membership.circle_id
  join public.circle_weekly_challenges challenge
    on challenge.circle_id=circle.id
  left join lateral (
    select item.player_id,item.awarded_at
    from public.circle_challenge_reward_awards item
    where item.challenge_id=challenge.id
    order by item.awarded_at,item.id
    limit 1
  ) award on true
  left join public.profiles winner on winner.id=award.player_id
  left join public.profiles loser on loser.id=challenge.loser_id
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
      from public.circle_members member
      left join public.game_stats result
        on result.user_id=member.user_id
       and result.circle_challenge_id=challenge.id
       and result.mode='challenge'
      where member.circle_id=challenge.circle_id
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

DROP FUNCTION IF EXISTS public.set_circle_weekly_challenge(bigint, text[], integer[], integer, text, text, bigint, text, boolean, integer);
CREATE FUNCTION public.set_circle_weekly_challenge(target_circle_id bigint, selected_games text[], selected_days integer[], reward_points_in integer DEFAULT 0, reward_type_in text DEFAULT 'points'::text, reward_label_in text DEFAULT NULL::text, target_challenge_id bigint DEFAULT NULL::bigint, challenge_title_in text DEFAULT NULL::text, repeat_weekly_in boolean DEFAULT NULL::boolean, duration_weeks_in integer DEFAULT NULL::integer, reward_goes_to_in text DEFAULT 'winner'::text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  current_challenge public.circle_weekly_challenges;
  result_id bigint;
  series_key bigint;
  week_offset integer;
  clean_games text[];
  clean_days integer[];
  clean_title text:=nullif(btrim(challenge_title_in),'');
  clean_reward_type text:=coalesce(nullif(btrim(reward_type_in),''),'points');
  clean_goes_to text:=case
    when coalesce(nullif(btrim(reward_type_in),''),'points')='prize'
      and btrim(coalesce(reward_goes_to_in,''))='loser'
    then 'loser' else 'winner' end;
  clean_duration integer;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not exists(
    select 1
    from public.circles
    where id=target_circle_id and created_by=auth.uid()
  ) then
    raise exception 'Only the circle owner can manage challenges.' using errcode='42501';
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
    where game in ('hive','binary','gridly','minisudoku','geo','zoom')
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
  if coalesce(reward_points_in,0) not between 0 and 50 then
    raise exception 'A circle challenge winner''s prize must be between 0 and 50 points.';
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
    from public.circle_weekly_challenges
    where id=target_challenge_id
      and circle_id=target_circle_id
      and week_start=public.circle_week_start(target_circle_id)
      and closed_at is null
    for update;

    if not found then
      raise exception 'Challenge not found.';
    end if;
    if current_challenge.locked_at is not null
       or exists(
         select 1
         from public.circle_challenge_starts
         where challenge_id=current_challenge.id
       )
       or exists(
         select 1
         from public.game_stats
         where circle_challenge_id=current_challenge.id
       ) then
      update public.circle_weekly_challenges
      set locked_at=coalesce(locked_at,now())
      where id=current_challenge.id;
      raise exception 'This challenge is already in progress and is locked.'
        using errcode='55000';
    end if;

    series_key:=coalesce(current_challenge.series_id,current_challenge.id);

    if exists(
      select 1
      from public.circle_weekly_challenges future_challenge
      where future_challenge.series_id=series_key
        and future_challenge.week_start>=public.circle_week_start(target_circle_id)
        and (
          future_challenge.locked_at is not null
          or exists(
            select 1
            from public.circle_challenge_starts future_start
            where future_start.challenge_id=future_challenge.id
          )
          or exists(
            select 1
            from public.game_stats future_result
            where future_result.circle_challenge_id=future_challenge.id
          )
        )
    ) then
      raise exception 'A scheduled week in this series has already started.'
        using errcode='55000';
    end if;

    delete from public.circle_weekly_challenges
    where series_id=series_key
      and week_start>=public.circle_week_start(target_circle_id);
  else
    series_key:=null;
  end if;

  for week_offset in 0..clean_duration-1 loop
    if (
      select count(*)
      from public.circle_weekly_challenges
      where circle_id=target_circle_id
        and week_start=public.circle_week_start(target_circle_id)+(week_offset*7)
    )>=10 then
      raise exception 'A circle can create up to 10 challenges in any week.';
    end if;

    insert into public.circle_weekly_challenges(
      circle_id,
      week_start,
      title,
      game_ids,
      active_days,
      reward_points,
      reward_type,
      reward_label,
      reward_goes_to,
      locked_at,
      created_by,
      series_id,
      repeats_weekly,
      series_weeks,
      occurrence_number,
      closed_at
    )
    values(
      target_circle_id,
      public.circle_week_start(target_circle_id)+(week_offset*7),
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
      clean_goes_to,
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
      update public.circle_weekly_challenges
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

GRANT EXECUTE ON FUNCTION public.get_my_active_circle_challenges() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_circle_challenge_history(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_circle_weekly_challenge(bigint, text[], integer[], integer, text, text, bigint, text, boolean, integer, text) TO authenticated;
