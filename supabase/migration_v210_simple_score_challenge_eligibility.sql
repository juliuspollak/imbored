-- v210: Make Beat my score a social action, not a performance reward.
--
-- A saved result is shareable whenever the player has somebody eligible in
-- their circles. Typical-time, benchmark-sample and circle-best comparisons
-- remain useful result context, but no longer hide the challenge button.

begin;

create or replace function public.get_score_challenge_eligibility(target_stat_id bigint)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  source_result public.game_stats;
  benchmark public.game_time_benchmarks;
  source_score numeric;
  recipient_count integer:=0;
  supported_result boolean:=false;
begin
  select * into source_result
  from public.game_stats
  where id=target_stat_id;

  if not found or source_result.user_id is distinct from auth.uid() then
    raise exception 'Game result not found.' using errcode='42501';
  end if;

  supported_result:=source_result.game in ('hive','tango','gridly','minisudoku')
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

  -- Preserve the performance fields consumed by existing clients without
  -- making them eligibility requirements.
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

  return jsonb_build_object(
    'eligible',supported_result and recipient_count>0,
    'supported_result',supported_result,
    'recipient_count',recipient_count,
    'typical_seconds',benchmark.effective_seconds,
    'scored_seconds',source_score,
    'benchmark_ready',benchmark.clean_sample_count>=6,
    'faster_than_typical',
      benchmark.clean_sample_count>=6
      and source_score<benchmark.effective_seconds,
    'circle_best',false,
    'comparable_players',0
  );
end;
$$;

revoke all on function public.get_score_challenge_eligibility(bigint)
  from public;
grant execute on function public.get_score_challenge_eligibility(bigint)
  to authenticated;

notify pgrst,'reload schema';

commit;
