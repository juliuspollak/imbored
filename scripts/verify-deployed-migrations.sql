-- Which migrations are actually live in this database?
--
-- Read-only. Deliberately does NOT trust supabase_migrations.schema_migrations:
-- anything pasted into the SQL editor never appears there. Each row instead
-- looks for a marker the migration itself introduced - a function argument, a
-- column, a phrase in a function body - so it reports what the database really
-- contains, however the SQL got there.
--
--   YES              the marker is present
--   NO <-- run this  that migration has not been applied
--
-- Migrations superseded by a later one are not listed: their markers were
-- overwritten, so their absence proves nothing.

with fn as (
  select p.proname, p.pronargs, pg_get_functiondef(p.oid) as src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
col as (
  select table_name, column_name
  from information_schema.columns
  where table_schema = 'public'
),
body as (
  select proname, pronargs, src from fn
),
result as (
  select '202608140930' as sort_key,
         '202608140930  daily points pay every game on accuracy' as migration,
         'award_game_points scales the base by answer_total' as marker,
         exists(select 1 from body where proname='award_game_points' and src like '%answer_total%') as applied
  union all select '202608141000',
         '202608141000  challenge reset clears the attempt clock',
         'admin_reset_personal_challenge deletes challenge_attempt_starts',
         exists(select 1 from body where proname='admin_reset_personal_challenge' and src like '%challenge_attempt_starts%')
  union all select '202608141130',
         '202608141130  points floor scales with correct answers',
         'award_game_points uses answer_share',
         exists(select 1 from body where proname='award_game_points' and src like '%answer_share%')
  union all select '202608141200',
         '202608141200  finalize_circle_challenge name clash',
         'losing_player_id replaced the shadowed loser_id',
         exists(select 1 from body where proname='finalize_circle_challenge' and src like '%losing_player_id%')
  union all select '202608141300',
         '202608141300  standings return the tiebreak keys',
         'get_circle_challenge_standings returns total_hints',
         exists(select 1 from body where proname='get_circle_challenge_standings' and src like '%total_hints%')
  union all select '202608141430',
         '202608141430  benchmarks pool across weekdays',
         'refresh_game_time_benchmark has the pooled fallback',
         exists(select 1 from body where proname='refresh_game_time_benchmark' and src like '%pooled_players%')
  union all select '202608141500',
         '202608141500  quiz games can earn a benchmark',
         'graded rounds qualify for the benchmark sample despite mistakes',
         exists(select 1 from body where proname='refresh_game_time_benchmark' and src like '%total_count,0)>0%')
  union all select '202608141600',
         '202608141600  prize challenges need agreement too',
         'start_circle_challenge_game gates reward_type = prize',
         exists(select 1 from body where proname='start_circle_challenge_game' and src like '%reward_type=''prize''%')
  union all select '202608161230',
         '202608161230  share exact puzzles',
         'get_replayable_puzzle exists',
         exists(select 1 from body where proname='get_replayable_puzzle')
  union all select '202608181000',
         '202608181000  score rounds against the spread',
         'game_time_benchmarks.log_mean and challenge_benchmark_profile exist',
         exists(select 1 from col where table_name='game_time_benchmarks' and column_name='log_mean')
         and exists(select 1 from body where proname='challenge_benchmark_profile')
  union all select '202608181100',
         '202608181100  each weekday against its own middle',
         'refresh_game_time_benchmark measures a per-weekday mean',
         exists(select 1 from body where proname='refresh_game_time_benchmark' and src like '%spread_day_count%')
  union all select '202608181200',
         '202608181200  measure the spread within the weekday',
         'refresh_game_time_benchmark centres residuals per weekday',
         exists(select 1 from body where proname='refresh_game_time_benchmark' and src like '%residual%')
  union all select '202608181300',
         '202608181300  mistakes and hints cost more',
         'effective_round_seconds charges 0.35 of the benchmark per hint',
         exists(select 1 from body where proname='effective_round_seconds' and src like '%100)*0.35%')
  union all select '202608181400',
         '202608181400  only sample the current difficulty',
         'refresh_game_time_benchmark filters on generator_config',
         exists(select 1 from body where proname='refresh_game_time_benchmark' and src like '%use_current_config%')
  union all select '202608181500',
         '202608181500  score Gridly route planning',
         'round_inefficiency exists and effective_round_seconds accepts it',
         exists(select 1 from body where proname='round_inefficiency')
         and exists(select 1 from body where proname='effective_round_seconds' and src like '%inefficiency%')
  union all select '202608181600',
         '202608181600  every puzzle records work taken back',
         'game_stats.wasted_moves exists and round_inefficiency takes 4 arguments',
         exists(select 1 from col where table_name='game_stats' and column_name='wasted_moves')
         and exists(select 1 from body where proname='round_inefficiency' and pronargs=4)
)
select
  migration,
  case when applied then 'YES' else 'NO  <-- run this' end as applied,
  marker
from result
order by sort_key;

-- ---------------------------------------------------------------------------
-- Deliberately not checked, because a later migration overwrote their marker.
-- Their absence proves nothing; the migration that replaced them is what the
-- list above tests.
--
--   202608140900  challenge score counts correct answers  -> 202608181500
--   202608141100  accuracy applies after the score cap    -> 202608181500
--   202608141330  benchmark needs two players not three   -> 202608141430
--   202608160926  raise challenge completion floor        -> 202608181500
--   202608180900  quiz mistakes are not charged twice     -> 202608181500
--
-- 202608141400 (recalibrate benchmarks from real play) is a one-off data
-- migration with no marker at all - it rewrote provisional_seconds. Nothing can
-- detect it after the fact, and re-running it is harmless.
--
-- Migrations before 202608140900 pre-date this work and are assumed applied;
-- the app would be visibly broken otherwise.
