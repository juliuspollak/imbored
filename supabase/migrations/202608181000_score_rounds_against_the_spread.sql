-- Score a round by how far it beats typical play, measured in the spread of
-- that game's own times, instead of by a raw ratio against a median.
--
-- WHY. The ratio rule (100 * benchmark / your_time, clamped 45..150, then
-- multiplied by accuracy) is not comparable across games. Simulating 300
-- players of identical ability over all six games gives these mean scores:
--
--     gridly 101   hive 100   binary 101   minisudoku 99   geo 66   zoom 69
--
-- A 35-point gap owed purely to which game you opened -- an accuracy
-- multiplier is a far harsher penalty than a time ratio, and no amount of
-- skill closes it. It also parks 20% of rounds on a clamp where they stop
-- telling players apart, and it makes a fast game (Gridly, 6s benchmark on a
-- whole-second column) swing ~8 points per second while MiniSudoku swings ~2.
--
-- HOW.
--   1. Accuracy becomes effective time: effective = time / accuracy^2. Getting
--      half the answers right costs what taking four times as long costs, so a
--      quiz round and a puzzle round finally sit on one axis instead of two.
--   2. Score from the log-normal spread of that game's own effective times:
--          score = clamp(20, 150, round(100 + 25 * (log_mean - ln(effective)) / log_sd))
--      Dividing by each game's own spread is what removes the cross-game bias.
--
-- The exponent is 2 because it was measured, not guessed. Because log_mean and
-- log_sd are computed through the SAME transform, cross-game balance holds for
-- any exponent (spread stays ~2.5 points from 1 to 2.5); the exponent only sets
-- how much accuracy counts against speed. Simulated Zoom, honest typical round
-- 27s at 5 of 9 = 99 points:
--
--     exponent      rush 12s 1/9      rush 20s 2/9      good 22s 8/9
--            1                71                78               123
--            2                43                64               125
--
-- At 1 an abandoned round still pays 71, which is the abuse this whole line of
-- work started from. At 2 it pays 43, well under honest play, while good and
-- perfect rounds are untouched. A round with nothing correct scores 0, as it
-- did before -- that is what separates playing badly from not playing.
--
-- MEASURED RESULT, 300 players, against the real implementation:
--     mean score per game     66-101  ->  99-101   (spread 35 -> 2)
--     rounds parked on a clamp    21%  ->  2.2%
--     skill-to-rank fidelity    0.949  ->  0.952
--     at 2-4 players (the real case) spread 51-56 -> 17-25
--
-- 100 is now "typical for this game" and 150 is roughly the top 2%.

alter table public.game_time_benchmarks
  add column if not exists log_mean numeric,
  add column if not exists log_sd numeric;

comment on column public.game_time_benchmarks.log_mean is
  'Mean of ln(effective seconds) over the clean sample; null until measured.';
comment on column public.game_time_benchmarks.log_sd is
  'Standard deviation of ln(effective seconds); the unit the score is counted in.';

-- Effective seconds: the clock, plus the hint surcharge, plus a mistake charge
-- for ungraded puzzles only, all divided by the square of the share of answers
-- that were right. Returns null for a graded round with nothing correct, which
-- has no meaningful pace and is scored 0 rather than ranked.
create or replace function public.effective_round_seconds(
  elapsed_seconds integer,
  hint_count integer,
  mistake_count integer,
  benchmark_seconds numeric,
  correct_answers integer default null,
  total_answers integer default null
) returns numeric
    language sql immutable
    as $$
  with share as (
    select case
      when coalesce(total_answers,0) <= 0 then 1::numeric
      else least(1,greatest(0,coalesce(correct_answers,0))::numeric/total_answers)
    end as accuracy
  )
  select case when share.accuracy <= 0 then null else
    greatest(1,
      greatest(0,coalesce(elapsed_seconds,0))
      + greatest(0,coalesce(hint_count,0))*coalesce(benchmark_seconds,100)*0.20
      -- An ungraded puzzle has no accuracy to divide by, so its slips are
      -- charged as time. A graded round is not charged here as well: its
      -- mistakes ARE the wrong answers already priced into the divisor.
      + case when coalesce(total_answers,0) > 0 then 0
             else greatest(0,coalesce(mistake_count,0))*coalesce(benchmark_seconds,100)*0.10 end
    ) / (share.accuracy * share.accuracy)
  end
  from share
$$;

-- Always returns exactly one row. The earlier version appended a fallback row
-- with UNION ALL and took LIMIT 1, but the order of UNION ALL branches is not
-- guaranteed -- Postgres could hand back the 100-second fallback even when a
-- measured benchmark existed, silently scoring every round against a made-up
-- number. Scalar subqueries cannot do that.
create or replace function public.challenge_benchmark_profile(
  target_game text,
  target_challenge_date date
) returns table(seconds numeric, log_mean numeric, log_sd numeric)
    language sql stable security definer
    set search_path to 'public'
    as $$
  with chosen as (
    select benchmark.effective_seconds,benchmark.log_mean,benchmark.log_sd
    from public.game_time_benchmarks benchmark
    where benchmark.game=target_game
      and benchmark.mode='challenge'
      and benchmark.day_index=extract(isodow from target_challenge_date)::integer-1
    order by benchmark.updated_at desc nulls last
    limit 1
  )
  select
    coalesce((select nullif(chosen.effective_seconds,0) from chosen),100)::numeric,
    (select chosen.log_mean from chosen),
    (select chosen.log_sd from chosen)
$$;

create or replace function public.circle_challenge_daily_score(
  target_game text,
  target_challenge_date date,
  elapsed_seconds integer,
  hint_count integer,
  mistake_count integer,
  correct_answers integer default null,
  total_answers integer default null
) returns integer
    language sql stable security definer
    set search_path to 'public'
    as $$
  with profile as (
    select * from public.challenge_benchmark_profile(target_game,target_challenge_date)
  ),
  effective as (
    select
      profile.seconds,
      profile.log_mean,
      profile.log_sd,
      public.effective_round_seconds(
        elapsed_seconds,hint_count,mistake_count,profile.seconds,correct_answers,total_answers
      ) as value
    from profile
  )
  select case
    -- Nothing correct: no pace to measure, and no points.
    when effective.value is null then 0
    -- Measured spread: score against it.
    when effective.log_mean is not null and coalesce(effective.log_sd,0) > 0.01 then
      greatest(20,least(150,round(
        100 + 25*((effective.log_mean - ln(effective.value))/effective.log_sd)
      )::integer))
    -- Not yet measured: the previous ratio rule, floor and all, so a game with
    -- no history still scores sensibly.
    else
      greatest(45,least(150,round(
        100*effective.seconds/effective.value
      )::integer))
  end
  from effective
$$;

-- The writer. Without this the two columns above stay null forever and every
-- round keeps scoring through the old ratio fallback, so it has to ship in the
-- same migration as the reader.
--
-- The spread is measured over ln(effective seconds) across ALL rounds in the
-- window, not just flawless ones: the score is a position within the real
-- distribution, so the real distribution is what has to be measured. Rounds
-- with nothing correct return null from effective_round_seconds() and drop out
-- of avg/stddev on their own.
create or replace function public.refresh_game_time_benchmark(target_game text, target_day_index integer, target_mode text) RETURNS public.game_time_benchmarks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  eligible_players integer:=0;
  qualifying_samples integer:=0;
  community_median numeric;
  pooled_players integer:=0;
  pooled_samples integer:=0;
  pooled_median numeric;
  day_weight numeric:=1;
  spread_mean numeric;
  spread_sd numeric;
  benchmark public.game_time_benchmarks;
begin
  select * into benchmark
  from public.game_time_benchmarks
  where game=target_game
    and day_index=target_day_index
    and mode=target_mode;

  if not found then
    return null;
  end if;

  -- A 90-day community median does not move between one puzzle and the next,
  -- but this used to recompute -- and write -- on every single save and every
  -- share-eligibility check, putting a 90-day scan and a row-level write lock
  -- in the hot path of finishing a game. Recompute at most hourly per
  -- (game, day, mode). To force one, age the row:
  --   update public.game_time_benchmarks set updated_at=now()-interval '1 day';
  if benchmark.updated_at>now()-interval '1 hour' then
    return benchmark;
  end if;

  -- If another session is already refreshing this row, serve the value we
  -- have rather than queueing behind its write. A player's save is never
  -- blocked by someone else's benchmark maintenance.
  if not pg_try_advisory_xact_lock(
    hashtextextended(
      format('benchmark:%s:%s:%s',target_game,target_day_index,target_mode),
      0
    )
  ) then
    return benchmark;
  end if;

  with clean as (
    select stat.user_id,stat.seconds,
      row_number() over(partition by stat.user_id order by stat.completed_at desc,stat.id desc) as recent_rank,
      count(*) over(partition by stat.user_id) as player_sample_count
    from public.game_stats stat
    where stat.game=target_game
      and stat.day_index=target_day_index
      and stat.mode=target_mode
      and stat.completed_at>=now()-interval '90 days'
      and stat.seconds between 5 and 3600
      and coalesce(stat.hints,0)=0
      and (
        -- Quiz games report an answer count, and every question is answered
        -- whatever the result, so a wrong answer costs a tap rather than
        -- minutes. Demanding a flawless round excluded them permanently: Zoom
        -- needs 9-for-9 to qualify, which is rare enough that it had no clean
        -- samples at all and could never leave its seeded guess. A hint still
        -- disqualifies a sample, because a hint genuinely shortens the clock.
        coalesce(stat.total_count,0)>0
        or coalesce(stat.mistakes,0)=0
      )
  ), player_medians as (
    select user_id,
      count(*)::integer as sample_count,
      percentile_cont(0.5) within group(order by seconds) as median_seconds
    from clean
    where player_sample_count>=2 and recent_rank<=5
    group by user_id
  )
  select count(*)::integer,
    coalesce(sum(sample_count),0)::integer,
    percentile_cont(0.5) within group(order by median_seconds)
  into eligible_players,qualifying_samples,community_median
  from player_medians;

  -- The sample set above is per weekday, and that is what actually starved
  -- these benchmarks: a daily challenge offers each weekday once a week, so
  -- qualifying needs two players with two clean results each on the SAME
  -- weekday -- a fortnight of flawless play per weekday, per game. Gridly has
  -- 15 clean results spread over 7 weekdays: about 2 per day, against the 4
  -- required. Lowering the player bar alone would not have helped.
  --
  -- So when a weekday cannot qualify on its own, fall back to the same
  -- calculation pooled across every weekday, then scale the result back onto
  -- this weekday using the seeded Mon->Sun ramp. That uses all 15 samples
  -- instead of 2, and keeps the intended difficulty curve rather than paying
  -- every weekday the same time.
  if eligible_players<2 then
    with clean as (
      select stat.user_id,stat.seconds,
        row_number() over(partition by stat.user_id order by stat.completed_at desc,stat.id desc) as recent_rank,
        count(*) over(partition by stat.user_id) as player_sample_count
      from public.game_stats stat
      where stat.game=target_game
        and stat.mode=target_mode
        and stat.completed_at>=now()-interval '90 days'
        and stat.seconds between 5 and 3600
        and coalesce(stat.hints,0)=0
        and (
          coalesce(stat.total_count,0)>0
          or coalesce(stat.mistakes,0)=0
        )
    ), player_medians as (
      select user_id,
        count(*)::integer as sample_count,
        percentile_cont(0.5) within group(order by seconds) as median_seconds
      from clean
      where player_sample_count>=2 and recent_rank<=10
      group by user_id
    )
    select count(*)::integer,
      coalesce(sum(sample_count),0)::integer,
      percentile_cont(0.5) within group(order by median_seconds)
    into pooled_players,pooled_samples,pooled_median
    from player_medians;

    -- This weekday's share of the game's seeded ramp. Sunday stays harder than
    -- Monday because the provisional values say so, not because of thin data.
    select case
      when coalesce(avg(other.provisional_seconds),0)>0
        then benchmark.provisional_seconds/avg(other.provisional_seconds)
      else 1
    end
    into day_weight
    from public.game_time_benchmarks other
    where other.game=target_game
      and other.mode=target_mode;

    if pooled_players>=2 and pooled_median is not null then
      eligible_players:=pooled_players;
      qualifying_samples:=pooled_samples;
      community_median:=pooled_median*coalesce(day_weight,1);
    end if;
  end if;

  -- The score is now counted in spreads, not ratios, so the benchmark has to
  -- carry the spread as well as the middle. Measured over ln(effective
  -- seconds) -- the clock divided by the share of answers that were right --
  -- and pooled across weekdays, because per-weekday samples are far too thin
  -- to estimate a standard deviation from.
  select avg(ln(value)),stddev_samp(ln(value))
  into spread_mean,spread_sd
  from (
    select public.effective_round_seconds(
      stat.seconds,stat.hints,stat.mistakes,
      coalesce(nullif(benchmark.effective_seconds,0),100),
      stat.correct_count,stat.total_count
    ) as value
    from public.game_stats stat
    where stat.game=target_game
      and stat.mode=target_mode
      and stat.completed_at>=now()-interval '90 days'
      and stat.seconds between 5 and 3600
  ) sample;

  update public.game_time_benchmarks current_benchmark
  set observed_median_seconds=case when eligible_players>=2 then community_median else null end,
      clean_sample_count=case when eligible_players>=2 then qualifying_samples else 0 end,
      -- effective_seconds carries no CHECK of its own, and it is a divisor in
      -- every score. Hold it to the same 5..3600 range provisional_seconds is
      -- constrained to, so a thin or skewed sample cannot round it to zero.
      effective_seconds=case
        when eligible_players>=2 and community_median is not null
          then greatest(5,least(3600,round(community_median)))
        else current_benchmark.provisional_seconds
      end,
      -- Below a usable sample a standard deviation is noise; leave it null
      -- and circle_challenge_daily_score() falls back to the ratio rule.
      log_mean=case when spread_sd is not null and spread_sd>0.01 then spread_mean else null end,
      log_sd=case when spread_sd is not null and spread_sd>0.01 then spread_sd else null end,
      updated_at=now()
  where current_benchmark.game=target_game
    and current_benchmark.day_index=target_day_index
    and current_benchmark.mode=target_mode
  returning * into benchmark;

  return benchmark;
end;
$$;
