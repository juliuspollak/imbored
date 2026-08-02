-- v208: Freeze the difficulty-relative score used by a shared puzzle and only
-- offer sharing for a genuinely strong result (better than typical or best
-- among comparable results from the player's circles).

begin;

alter table public.score_challenges add column if not exists hints integer not null default 0;
alter table public.score_challenges add column if not exists mistakes integer not null default 0;
alter table public.score_challenges add column if not exists typical_seconds numeric;
alter table public.score_challenges add column if not exists scored_seconds numeric;

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
  comparable_count integer:=0;
  faster_count integer:=0;
  recipient_count integer:=0;
  faster_than_typical boolean:=false;
  circle_best boolean:=false;
begin
  select * into source_result from public.game_stats where id=target_stat_id;
  if not found or source_result.user_id is distinct from auth.uid() then
    raise exception 'Game result not found.' using errcode='42501';
  end if;

  benchmark:=public.refresh_game_time_benchmark(source_result.game,source_result.day_index,source_result.mode);
  source_score:=public.scored_game_seconds(source_result.seconds,source_result.hints,source_result.mistakes,benchmark.effective_seconds);
  faster_than_typical:=benchmark.clean_sample_count>=6 and source_score<benchmark.effective_seconds;

  with circle_players as (
    select distinct other_member.user_id
    from public.circle_members mine
    join public.circle_members other_member on other_member.circle_id=mine.circle_id
    where mine.user_id=source_result.user_id and other_member.user_id<>source_result.user_id
  ), comparable as (
    select stat.id,public.scored_game_seconds(stat.seconds,stat.hints,stat.mistakes,benchmark.effective_seconds) as score
    from public.game_stats stat join circle_players player on player.user_id=stat.user_id
    where stat.game=source_result.game and stat.day_index=source_result.day_index and stat.mode=source_result.mode
      and case when source_result.mode='challenge'
        then stat.challenge_date=source_result.challenge_date
        else (stat.completed_at at time zone 'Australia/Sydney')::date=(source_result.completed_at at time zone 'Australia/Sydney')::date
      end
  )
  select count(*)::integer,count(*) filter(where score<source_score)::integer
  into comparable_count,faster_count from comparable;
  circle_best:=comparable_count>0 and faster_count=0;

  select count(distinct other_member.user_id)::integer into recipient_count
  from public.circle_members mine
  join public.circle_members other_member on other_member.circle_id=mine.circle_id
  join public.profiles profile on profile.id=other_member.user_id
  where mine.user_id=source_result.user_id and other_member.user_id<>source_result.user_id
    and profile.account_deleted_at is null and coalesce(profile.is_blocked,false)=false
    and coalesce(profile.hidden_from_others,false)=false and coalesce(profile.is_approved,true)=true;

  return jsonb_build_object(
    'eligible',(faster_than_typical or circle_best) and recipient_count>0,
    'faster_than_typical',faster_than_typical,
    'circle_best',circle_best,
    'comparable_players',comparable_count,
    'recipient_count',recipient_count,
    'typical_seconds',benchmark.effective_seconds,
    'scored_seconds',source_score,
    'benchmark_ready',benchmark.clean_sample_count>=6
  );
end;
$$;

create or replace function public.create_score_challenge(target_stat_id bigint)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  source_result public.game_stats;
  eligibility jsonb;
  created_challenge_id bigint;
  recipients integer:=0;
  challenger_name text;
  game_label text;
begin
  select * into source_result from public.game_stats where id=target_stat_id;
  if not found or source_result.user_id is distinct from auth.uid() then raise exception 'Game result not found.' using errcode='42501'; end if;
  if source_result.game not in ('hive','tango','gridly','minisudoku') or nullif(source_result.seed,'') is null then
    raise exception 'This result cannot be challenged.' using errcode='22023';
  end if;
  eligibility:=public.get_score_challenge_eligibility(target_stat_id);
  if not coalesce((eligibility->>'eligible')::boolean,false) then
    raise exception 'Beat my score is available after a result that beats the typical time or your circle.' using errcode='22023';
  end if;

  insert into public.score_challenges(source_stat_id,challenger_id,game,seed,generator_version,generator_config,day_index,seconds,hints,mistakes,typical_seconds,scored_seconds)
  values(source_result.id,source_result.user_id,source_result.game,source_result.seed,source_result.generator_version,source_result.generator_config,
    source_result.day_index,source_result.seconds,source_result.hints,source_result.mistakes,
    (eligibility->>'typical_seconds')::numeric,(eligibility->>'scored_seconds')::numeric)
  on conflict(source_stat_id) do update set source_stat_id=excluded.source_stat_id
  returning id into created_challenge_id;

  insert into public.score_challenge_recipients(challenge_id,recipient_id)
  select distinct created_challenge_id,other_member.user_id
  from public.circle_members mine join public.circle_members other_member on other_member.circle_id=mine.circle_id
  join public.profiles profile on profile.id=other_member.user_id
  where mine.user_id=auth.uid() and other_member.user_id<>auth.uid()
    and profile.account_deleted_at is null and coalesce(profile.is_blocked,false)=false
    and coalesce(profile.hidden_from_others,false)=false and coalesce(profile.is_approved,true)=true
  on conflict do nothing;
  get diagnostics recipients=row_count;

  select coalesce(name,'A friend') into challenger_name from public.profiles where id=auth.uid();
  game_label:=case source_result.game when 'hive' then 'Hive' when 'gridly' then 'Gridly' when 'minisudoku' then 'Sudoku' else 'Tango' end;
  insert into public.direct_messages(sender_id,recipient_id,body,system_generated,activity_type,source_stat_id)
  select recipient_id,recipient_id,format('%s set a %s score of %s. Can you beat it?',challenger_name,game_label,
    (round((eligibility->>'scored_seconds')::numeric)::integer/60)::text||':'||lpad((round((eligibility->>'scored_seconds')::numeric)::integer%60)::text,2,'0')),
    true,'score_challenge',source_result.id
  from public.score_challenge_recipients where score_challenge_recipients.challenge_id=created_challenge_id
  on conflict do nothing;

  select count(*)::integer into recipients from public.score_challenge_recipients where score_challenge_recipients.challenge_id=created_challenge_id;
  return jsonb_build_object('challenge_id',created_challenge_id,'recipient_count',recipients,'already_sent',false);
end;
$$;

create or replace function public.get_score_challenge(target_source_stat_id bigint)
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object('id',c.id,'source_stat_id',c.source_stat_id,'challenger_id',c.challenger_id,
    'challenger_name',coalesce(p.name,'A friend'),'game',c.game,'seed',c.seed,'generator_version',c.generator_version,
    'generator_config',c.generator_config,'day_index',c.day_index,'seconds',c.seconds,
    'scored_seconds',coalesce(c.scored_seconds,c.seconds),'completed_stat_id',r.completed_stat_id)
  from public.score_challenges c join public.profiles p on p.id=c.challenger_id
  join public.score_challenge_recipients r on r.challenge_id=c.id and r.recipient_id=auth.uid()
  where c.source_stat_id=target_source_stat_id
$$;

create or replace function public.complete_score_challenge(target_challenge_id bigint,target_stat_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.score_challenges; result public.game_stats; player_name text; result_score numeric; outcome text;
begin
  select * into c from public.score_challenges where id=target_challenge_id;
  select * into result from public.game_stats where id=target_stat_id;
  if not found or result.user_id is distinct from auth.uid() then raise exception 'Game result not found.' using errcode='42501'; end if;
  if not exists(select 1 from public.score_challenge_recipients r where r.challenge_id=c.id and r.recipient_id=auth.uid()) then raise exception 'Score challenge not found.' using errcode='42501'; end if;
  if result.game<>c.game or result.seed<>c.seed then raise exception 'The completed puzzle does not match this challenge.' using errcode='22023'; end if;
  result_score:=public.scored_game_seconds(result.seconds,result.hints,result.mistakes,coalesce(c.typical_seconds,100));
  update public.score_challenge_recipients set completed_stat_id=result.id,completed_at=now()
    where challenge_id=c.id and recipient_id=auth.uid() and completed_stat_id is null;
  select coalesce(name,'A friend') into player_name from public.profiles where id=auth.uid();
  outcome:=format('%s scored %s against your %s in %s.',player_name,
    (round(result_score)::integer/60)::text||':'||lpad((round(result_score)::integer%60)::text,2,'0'),c.game,
    (round(coalesce(c.scored_seconds,c.seconds))::integer/60)::text||':'||lpad((round(coalesce(c.scored_seconds,c.seconds))::integer%60)::text,2,'0'));
  insert into public.direct_messages(sender_id,recipient_id,body,system_generated,activity_type,source_stat_id)
  values(c.challenger_id,c.challenger_id,outcome,true,'score_challenge_result',result.id) on conflict do nothing;
  return jsonb_build_object('beat_score',result_score<coalesce(c.scored_seconds,c.seconds),'tied_score',result_score=coalesce(c.scored_seconds,c.seconds),
    'their_seconds',coalesce(c.scored_seconds,c.seconds),'your_seconds',result_score);
end;
$$;

revoke all on function public.get_score_challenge_eligibility(bigint) from public;
revoke all on function public.create_score_challenge(bigint) from public;
revoke all on function public.get_score_challenge(bigint) from public;
revoke all on function public.complete_score_challenge(bigint,bigint) from public;
grant execute on function public.get_score_challenge_eligibility(bigint) to authenticated;
grant execute on function public.create_score_challenge(bigint) to authenticated;
grant execute on function public.get_score_challenge(bigint) to authenticated;
grant execute on function public.complete_score_challenge(bigint,bigint) to authenticated;

notify pgrst,'reload schema';
commit;
