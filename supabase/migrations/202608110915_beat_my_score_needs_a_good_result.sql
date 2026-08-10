-- "Beat my score" was offered after any finished game, however badly it went.
--
-- The intent was never that. create_score_challenge() still refuses with
-- "Beat my score is available after a result that beats the typical time or
-- your circle" — but it delegates the decision to
-- get_score_challenge_eligibility(), and that function had been reduced to
-- "is this a supported game, and is anyone in my circles?". It still computed
-- faster_than_typical and handed it to the client, under a comment saying the
-- performance fields were kept "without making them eligibility
-- requirements". So the signal was measured, published, and ignored.
--
-- The bar is back: your result has to be faster than the community median for
-- that game and weekday before you can dare anyone to beat it.
--
-- It degrades on purpose. A benchmark needs six clean samples before it means
-- anything, and after a stats reset every benchmark starts at zero samples —
-- gating on an unproven median would silently disable the feature for days.
-- Until a benchmark is established the challenge is allowed through, and the
-- bar starts applying by itself once there is enough evidence to judge.

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
  meets_bar boolean:=false;
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
  meets_bar:=beats_typical or not benchmark_ready;

  return jsonb_build_object(
    'eligible',supported_result and recipient_count>0 and meets_bar,
    'supported_result',supported_result,
    'recipient_count',recipient_count,
    'typical_seconds',benchmark.effective_seconds,
    'scored_seconds',source_score,
    'benchmark_ready',benchmark_ready,
    'faster_than_typical',benchmark_ready and beats_typical,
    'meets_quality_bar',meets_bar,
    'circle_best',false,
    'comparable_players',0
  );
end;
$$;
