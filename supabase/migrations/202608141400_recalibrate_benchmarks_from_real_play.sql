-- Re-anchor the seeded benchmark times to how the games are actually played.
--
-- The provisional times were guesses made before there was any play to measure,
-- and they are 3-29x too slow: Gridly was seeded expecting minutes and has a
-- real median of 9 seconds. The round score is 100 * benchmark / your_time
-- capped at 150, so the cap binds at two thirds of benchmark -- and with
-- benchmarks that far out, 100% of clean Gridly results and 93% of Hive
-- results already pin the cap. Every player scores a flat 150 per round, the
-- totals come out identical, and the winner falls to the tiebreakers.
--
-- Each day keeps its existing Mon->Sun ramp; only the overall level moves, by
-- scaling every day of a game by one factor. That preserves the deliberate
-- "harder later in the week" shape instead of flattening it to a single number.
--
-- Games with too little clean data are left alone rather than re-anchored on
-- noise.

with clean as (
  select stat.game, stat.seconds, stat.user_id, stat.hints, stat.mistakes
  from public.game_stats stat
  where stat.mode = 'challenge'
    and stat.completed_at >= now() - interval '90 days'
    and stat.seconds between 5 and 3600
),
-- Preferred: flawless runs, the same standard refresh_game_time_benchmark()
-- holds measured medians to.
strict_median as (
  select game,
         percentile_cont(0.5) within group (order by seconds) as seconds,
         count(*) as samples
  from clean
  where coalesce(hints,0) = 0 and coalesce(mistakes,0) = 0
  group by game
),
-- Fallback for the quiz games. Requiring zero mistakes means a Zoom round has
-- to be 9-for-9 to count, which almost never happens -- Zoom has no strict
-- samples at all and would keep its guess forever. Hints still disqualify a
-- sample, because a hint really does shorten the clock.
relaxed_median as (
  select game,
         percentile_cont(0.5) within group (order by seconds) as seconds,
         count(*) as samples
  from clean
  where coalesce(hints,0) = 0
  group by game
),
target as (
  select
    coalesce(strict_median.game, relaxed_median.game) as game,
    case
      when coalesce(strict_median.samples,0) >= 5 then strict_median.seconds
      else relaxed_median.seconds
    end as median_seconds,
    greatest(coalesce(strict_median.samples,0), coalesce(relaxed_median.samples,0)) as samples
  from strict_median
  full join relaxed_median on relaxed_median.game = strict_median.game
),
current_level as (
  select game, avg(provisional_seconds) as mean_provisional
  from public.game_time_benchmarks
  where mode = 'challenge'
  group by game
)
update public.game_time_benchmarks benchmark
set
  provisional_seconds = greatest(5, least(3600, round(
    benchmark.provisional_seconds * target.median_seconds / current_level.mean_provisional
  )::integer)),
  -- Only rewrite the live figure where it is still the guess. A benchmark that
  -- has earned a measured median keeps it.
  effective_seconds = case
    when benchmark.observed_median_seconds is null then greatest(5, least(3600, round(
      benchmark.provisional_seconds * target.median_seconds / current_level.mean_provisional
    )::integer))
    else benchmark.effective_seconds
  end,
  -- refresh_game_time_benchmark() recomputes at most hourly and skips while
  -- the row looks fresh. Age it so the next save recomputes against real play.
  updated_at = now() - interval '1 day'
from target
join current_level on current_level.game = target.game
where benchmark.game = target.game
  and benchmark.mode = 'challenge'
  and target.samples >= 5
  and target.median_seconds is not null
  and current_level.mean_provisional > 0;
