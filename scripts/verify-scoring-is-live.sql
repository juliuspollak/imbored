-- Applying a migration is not the same as it taking effect.
--
-- The scoring changes only reach players once refresh_game_time_benchmark has
-- re-run and rewritten log_mean / log_sd. Until then every round keeps scoring
-- through the old ratio fallback, silently. This checks the stored state rather
-- than the function definitions.
--
-- Read-only.

-- 1. Is the spread scoring live, and does it look sane?
select
  'benchmarks measured'                                       as check,
  count(*) filter (where log_mean is not null and log_sd > 0.01) || ' of ' || count(*) as value,
  case when count(*) filter (where log_mean is not null and log_sd > 0.01) = count(*)
       then 'ok' else 'run the refresh block' end             as verdict
from public.game_time_benchmarks
where mode = 'challenge'

union all

-- 2. After 202608181200 the spread is within-weekday, so it should be well
--    below the raw figure it replaced. Above ~0.6 suggests the refresh has not
--    re-run since that migration.
select
  'typical spread (log_sd)',
  round(avg(log_sd)::numeric, 2)::text,
  case when avg(log_sd) < 0.6 then 'ok - within-weekday'
       when avg(log_sd) is null then 'not measured yet'
       else 'still contains the weekday ramp - re-run the refresh' end
from public.game_time_benchmarks
where mode = 'challenge'

union all

-- 3. The Mon->Sun ramp must survive: Sunday should be slower than Monday.
select
  'weekday ramp preserved',
  count(*) filter (where sunday > monday) || ' of ' || count(*) || ' games',
  case when count(*) filter (where sunday > monday) = count(*)
       then 'ok' else 'per-weekday middle missing - check 202608181100' end
from (
  select game,
         max(log_mean) filter (where day_index = 0) as monday,
         max(log_mean) filter (where day_index = 6) as sunday
  from public.game_time_benchmarks
  where mode = 'challenge'
  group by game
) ramp
where monday is not null and sunday is not null

union all

-- 4. Are the puzzles actually recording work taken back yet? Null until players
--    have completed rounds on a build that includes it.
select
  'rounds recording rework',
  count(*) filter (where wasted_moves is not null) || ' of ' || count(*),
  case when count(*) filter (where wasted_moves is not null) > 0
       then 'ok' else 'no rounds played on the new build yet' end
from public.game_stats
where mode = 'challenge'
  and completed_at >= now() - interval '7 days';
