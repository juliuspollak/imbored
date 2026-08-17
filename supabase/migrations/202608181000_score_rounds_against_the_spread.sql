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

create or replace function public.challenge_benchmark_profile(
  target_game text,
  target_challenge_date date
) returns table(seconds numeric, log_mean numeric, log_sd numeric)
    language sql stable security definer
    set search_path to 'public'
    as $$
  select
    coalesce(nullif(benchmark.effective_seconds,0),100)::numeric,
    benchmark.log_mean,
    benchmark.log_sd
  from public.game_time_benchmarks benchmark
  where benchmark.game=target_game
    and benchmark.mode='challenge'
    and benchmark.day_index=extract(isodow from target_challenge_date)::integer-1
  order by benchmark.updated_at desc nulls last
  limit 1
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
    select seconds,log_mean,log_sd
    from public.challenge_benchmark_profile(target_game,target_challenge_date)
    union all
    select 100::numeric,null::numeric,null::numeric
    limit 1
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
