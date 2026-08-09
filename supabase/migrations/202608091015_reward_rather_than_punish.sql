-- Reward showing up; stop charging people for not showing up.
--
-- Three mechanics took points away rather than giving them out:
--
--   1. apply_challenge_streak_break() deducted up to 10 banked points for
--      missing a day. Missing a day already costs you the day's earnings and
--      the run at the weekly bonus — taking points you had already earned is a
--      second, retrospective charge for the same absence.
--
--   2. protect_streak() charged points to avoid (1). Once the penalty is gone
--      there is nothing left to insure against, and pay-to-not-lose is the
--      punitive pattern in its purest form. It becomes a rest day you earn by
--      having kept a streak going, free, and available once a week.
--
--   3. circle_challenge_member_totals() scored a missed round at -100, which
--      is worse than never entering the challenge at all. The standing is a
--      sum of round scores, so simply not scoring a missed round already ranks
--      a player who turned up every day above one who did not. The -100 was
--      redundant on top of that.
--
-- Streaks still reset when a day is missed. That is not a punishment: it is
-- the reward not being earned.

-- 1. Missing a day no longer costs banked points.
create or replace function public.apply_challenge_streak_break(
  target_player_id uuid,
  missed_date date
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p public.player_progress;
begin
  perform public.ensure_player_progress(target_player_id);

  select * into p
  from public.player_progress
  where player_id=target_player_id
  for update;

  if p.challenge_current_streak<=0
    or p.challenge_penalty_for_date is not distinct from missed_date then
    return 0;
  end if;

  if p.streak_protected_through is not null
    and p.streak_protected_through>=missed_date then
    -- A rest day was claimed for this exact date: bridge the gap so the streak
    -- carries on normally at the next challenge play.
    update public.player_progress
    set challenge_last_completed_date=missed_date,
        challenge_penalty_for_date=missed_date,
        updated_at=now()
    where player_id=target_player_id;
    return 0;
  end if;

  -- The streak resets, and that is the whole consequence. No points are taken.
  update public.player_progress
  set
    challenge_current_streak=0,
    challenge_penalty_for_date=missed_date,
    updated_at=now()
  where player_id=target_player_id;

  return 0;
end;
$$;

-- 2. Streak protection becomes an earned, free rest day.
create or replace function public.protect_streak() returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p public.player_progress;
  today_date date := public.player_today(auth.uid());
  missed_date date := today_date - 1;
begin
  perform public.ensure_player_progress(auth.uid());

  select * into p
  from public.player_progress
  where player_id=auth.uid()
  for update;

  if p.challenge_current_streak<=0
    or p.challenge_last_completed_date is distinct from missed_date-1 then
    raise exception 'No missed day is available to cover';
  end if;
  if p.streak_protected_through is not null
    and p.streak_protected_through>=missed_date then
    raise exception 'This day is already covered';
  end if;

  -- Earned by a full week of play.
  if p.challenge_current_streak<7 then
    raise exception 'Keep a 7 day streak going to earn a rest day';
  end if;

  -- One rest day per week. streak_protected_through already records the last
  -- one, so no extra state is needed to space them out — without this a player
  -- could alternate play-day/rest-day indefinitely and still collect the
  -- weekly streak bonus.
  if p.streak_protected_through is not null
    and p.streak_protected_through>missed_date-7 then
    raise exception 'You have already used a rest day this week';
  end if;

  update public.player_progress
  set
    streak_protected_through=missed_date,
    updated_at=now()
  where player_id=auth.uid();

  return jsonb_build_object(
    'balance',p.available_points,
    'protected_date',missed_date,
    'cost',0
  );
end;
$$;

-- The cost is retained as a column so it can be reintroduced deliberately,
-- but nothing charges it any more.
alter table public.reward_rules
  alter column streak_protection_cost set default 0;

update public.reward_rules
set streak_protection_cost = 0,
    updated_at = now()
where streak_protection_cost <> 0;

-- 3. A missed circle round scores nothing rather than costing 100.
create or replace function public.circle_challenge_member_totals(target_challenge_id bigint)
returns table(
  member_id uuid,
  challenge_score integer,
  rounds_played integer,
  rounds_total integer,
  total_hints integer,
  total_mistakes integer,
  adjusted_seconds bigint,
  finished_at timestamp with time zone,
  last_stat_id bigint,
  round_scores jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with challenge as (
    select item.id,item.circle_id
    from public.circle_weekly_challenges item
    where item.id=target_challenge_id
  ),
  member_rounds as (
    select
      member.user_id,
      round_item.challenge_date,
      round_item.game,
      round_item.round_number,
      result.id as stat_id,
      result.seconds,
      result.hints,
      result.mistakes,
      result.completed_at,
      case
        when result.id is null then null
        else public.circle_challenge_daily_score(
          round_item.game,
          round_item.challenge_date,
          result.seconds,
          result.hints,
          result.mistakes
        )
      end as round_score
    from challenge
    join public.circle_members member
      on member.circle_id=challenge.circle_id
    join public.circle_challenge_rounds round_item
      on round_item.challenge_id=challenge.id
    left join lateral (
      select stat.*
      from public.game_stats stat
      where stat.circle_challenge_id=challenge.id
        and stat.user_id=member.user_id
        and stat.mode='challenge'
        and stat.challenge_date=round_item.challenge_date
        and stat.game=round_item.game
      order by stat.completed_at,stat.id
      limit 1
    ) result on true
  )
  select
    member_rounds.user_id,
    -- A missed round scores nothing. The standing is a sum, so a player who
    -- played every round already outranks one who skipped some; -100 punished
    -- on top of that, making a missed round worse than never entering.
    sum(coalesce(member_rounds.round_score,0))::integer,
    count(member_rounds.stat_id)::integer,
    count(*)::integer,
    sum(greatest(coalesce(member_rounds.hints,0),0))::integer,
    sum(greatest(coalesce(member_rounds.mistakes,0),0))::integer,
    sum(
      case
        when member_rounds.stat_id is null then 0
        else public.scored_game_seconds(
          member_rounds.seconds,
          member_rounds.hints,
          member_rounds.mistakes,
          public.challenge_benchmark_seconds(member_rounds.game,member_rounds.challenge_date)
        )
      end
    )::bigint,
    max(member_rounds.completed_at),
    max(member_rounds.stat_id),
    jsonb_agg(
      jsonb_build_object(
        'challenge_date',member_rounds.challenge_date,
        'game',member_rounds.game,
        'score',member_rounds.round_score
      )
      order by member_rounds.round_number,member_rounds.challenge_date
    )
  from member_rounds
  group by member_rounds.user_id
$$;
