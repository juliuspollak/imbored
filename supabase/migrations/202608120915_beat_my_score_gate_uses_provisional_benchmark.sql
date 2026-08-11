-- The Beat my score quality gate was never actually on.
--
-- 202608110915 restored the rule as "beat the typical time, OR the benchmark
-- is not established yet", the second clause meant as graceful degradation
-- after a stats reset leaves every clean_sample_count at zero.
--
-- That reasoning was wrong. effective_seconds already falls back to
-- provisional_seconds when there is no observed median, so the benchmark is
-- never an unusable number and never needed a bypass. What the bypass
-- actually did was switch the gate off for every game at once, which is why a
-- four and a half minute Hive could still dare the circle.
--
-- The comparison now always runs against effective_seconds: a real community
-- median once six clean samples exist, the designed provisional baseline
-- before that. benchmark_ready is still reported so the client can say how
-- confident the number is, but it no longer decides eligibility.

create or replace function public.get_score_challenge_eligibility(target_stat_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  source_result public.game_stats;
  benchmark public.game_time_benchmarks;
  source_score numeric;
  recipient_count integer:=0;
  supported_result boolean:=false;
  benchmark_ready boolean:=false;
  beats_typical boolean:=false;
begin
  select * into source_result
  from public.game_stats
  where id=target_stat_id;

  if not found or source_result.user_id is distinct from auth.uid() then
    raise exception 'Game result not found.' using errcode='42501';
  end if;

  supported_result:=source_result.game in ('hive','binary','gridly','minisudoku')
    and nullif(source_result.seed,'') is not null;

  select count(distinct other_member.user_id)::integer
  into recipient_count
  from public.circle_members mine
  join public.circle_members other_member
    on other_member.circle_id=mine.circle_id
  join public.profiles profile
    on profile.id=other_member.user_id
  where mine.user_id=source_result.user_id
    and other_member.user_id<>source_result.user_id
    and profile.account_deleted_at is null
    and coalesce(profile.is_blocked,false)=false
    and coalesce(profile.hidden_from_others,false)=false
    and coalesce(profile.is_approved,true)=true;

  benchmark:=public.refresh_game_time_benchmark(
    source_result.game,
    source_result.day_index,
    source_result.mode
  );
  source_score:=public.scored_game_seconds(
    source_result.seconds,
    source_result.hints,
    source_result.mistakes,
    benchmark.effective_seconds
  );

  -- Hints and mistakes are already priced into source_score, so a hint-heavy
  -- win has to be that much faster on the clock to clear the bar.
  benchmark_ready:=benchmark.clean_sample_count>=6;
  beats_typical:=source_score<benchmark.effective_seconds;

  return jsonb_build_object(
    'eligible',supported_result and recipient_count>0 and beats_typical,
    'supported_result',supported_result,
    'recipient_count',recipient_count,
    'typical_seconds',benchmark.effective_seconds,
    'scored_seconds',source_score,
    'benchmark_ready',benchmark_ready,
    'faster_than_typical',beats_typical,
    'meets_quality_bar',beats_typical,
    'circle_best',false,
    'comparable_players',0
  );
end;
$$;
