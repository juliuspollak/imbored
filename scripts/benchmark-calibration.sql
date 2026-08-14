-- Read-only. Compares each challenge benchmark against how the game is
-- actually being played, so provisional_seconds can be set from evidence
-- rather than guessed.
--
-- Applies the same cleanliness filter refresh_game_time_benchmark() uses --
-- 5..3600 seconds, no hints, no mistakes -- so rows corrupted by the old
-- attempt-clock bug (which recorded hours) are excluded on the upper bound.
--
-- Read the columns as:
--   provisional   what the benchmark falls back to today
--   effective     what scoring is actually using right now
--   real_median   the median of real clean play
--   caps_at       finish under this and the round pins the 150 maximum
--   capped_pct    share of clean results that already pin it
--
-- A healthy game has real_median near effective and capped_pct well under
-- half. capped_pct near 100 means the score cannot separate anybody.

with clean as (
  select
    stat.game,
    stat.day_index,
    stat.seconds,
    stat.user_id
  from public.game_stats stat
  where stat.mode = 'challenge'
    and stat.completed_at >= now() - interval '90 days'
    and stat.seconds between 5 and 3600
    and coalesce(stat.hints, 0) = 0
    and coalesce(stat.mistakes, 0) = 0
),
per_game as (
  select
    game,
    count(*)::integer                                          as clean_results,
    count(distinct user_id)::integer                           as players,
    round(percentile_cont(0.5) within group (order by seconds))::integer as real_median,
    min(seconds)                                               as fastest,
    max(seconds)                                               as slowest
  from clean
  group by game
)
select
  benchmark.game,
  max(benchmark.provisional_seconds)                           as provisional,
  round(avg(benchmark.effective_seconds))::integer             as effective,
  per_game.real_median,
  per_game.players,
  per_game.clean_results,
  per_game.fastest,
  per_game.slowest,
  round(avg(benchmark.effective_seconds) * 2 / 3)::integer     as caps_at,
  round(100.0 * count(*) filter (
    where clean_row.seconds <= benchmark.effective_seconds * 2 / 3
  ) / nullif(count(clean_row.seconds), 0))::integer            as capped_pct
from public.game_time_benchmarks benchmark
left join per_game on per_game.game = benchmark.game
left join clean clean_row
  on clean_row.game = benchmark.game
 and clean_row.day_index = benchmark.day_index
where benchmark.mode = 'challenge'
group by benchmark.game, per_game.real_median, per_game.players,
         per_game.clean_results, per_game.fastest, per_game.slowest
order by capped_pct desc nulls last, benchmark.game;
