-- A slower player could re-dare a board someone had already claimed.
--
-- "Beat my score" was only ever measured against the community median for the
-- game and weekday. Nothing looked at challenges already standing on the same
-- puzzle, so one player could post a Gridly seed at 6s and a second player
-- could post the identical seed at 13s. Recipients then saw the same board
-- twice with two targets, the weaker of which was already beaten.
--
-- A dare on a board someone has already claimed now has to actually beat
-- them. The community median still applies as the floor, so both must hold:
-- faster than typical, and faster than anyone who has challenged this exact
-- puzzle before you.
--
-- Comparison is on scored_seconds, not raw seconds, because that is the
-- number recipients are asked to beat and it already prices in hints and
-- mistakes.

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
  seed_best numeric;
  beats_seed_best boolean:=true;
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

  -- The best time anyone has already dared the circle with on this exact
  -- board. Your own earlier challenge counts too: re-posting a worse run of a
  -- puzzle you already challenged on is the same nonsense.
  select min(coalesce(existing.scored_seconds, existing.seconds))
  into seed_best
  from public.score_challenges existing
  where existing.game=source_result.game
    and existing.seed=source_result.seed
    and existing.day_index=source_result.day_index
    and existing.source_stat_id<>target_stat_id;

  if seed_best is not null then
    beats_seed_best:=source_score<seed_best;
  end if;

  return jsonb_build_object(
    'eligible',supported_result and recipient_count>0 and beats_typical and beats_seed_best,
    'supported_result',supported_result,
    'recipient_count',recipient_count,
    'typical_seconds',benchmark.effective_seconds,
    'scored_seconds',source_score,
    'benchmark_ready',benchmark_ready,
    'faster_than_typical',beats_typical,
    'meets_quality_bar',beats_typical,
    'seed_best_seconds',seed_best,
    'beats_seed_best',beats_seed_best,
    'circle_best',false,
    'comparable_players',0
  );
end;
$$;
