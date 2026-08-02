-- v207: One difficulty-relative performance model for points, standings and
-- score challenges. Clean benchmarks use equal-weight player medians so one
-- prolific player (or one accidental long session) cannot dominate them.

begin;

create or replace function public.scored_game_seconds(
  elapsed_seconds integer,
  hint_count integer,
  mistake_count integer,
  typical_seconds numeric
)
returns numeric
language sql
immutable
parallel safe
as $$
  select greatest(coalesce(elapsed_seconds,0),0)::numeric
    + greatest(coalesce(hint_count,0),0)::numeric
      * greatest(coalesce(typical_seconds,1),1) * 0.20
    + greatest(coalesce(mistake_count,0),0)::numeric
      * greatest(coalesce(typical_seconds,1),1) * 0.10
$$;

revoke all on function public.scored_game_seconds(integer,integer,integer,numeric) from public;
grant execute on function public.scored_game_seconds(integer,integer,integer,numeric) to authenticated;

create or replace function public.refresh_game_time_benchmark(
  target_game text,
  target_day_index integer,
  target_mode text
)
returns public.game_time_benchmarks
language plpgsql
security definer
set search_path=public
as $$
declare
  eligible_players integer:=0;
  qualifying_samples integer:=0;
  community_median numeric;
  benchmark public.game_time_benchmarks;
begin
  with clean as (
    select stat.user_id,stat.seconds,
      row_number() over(partition by stat.user_id order by stat.completed_at desc,stat.id desc) as recent_rank,
      count(*) over(partition by stat.user_id) as player_sample_count
    from public.game_stats stat
    where stat.game=target_game
      and stat.day_index=target_day_index
      and stat.mode=target_mode
      and stat.completed_at>=now()-interval '90 days'
      and stat.seconds between 5 and 3600
      and coalesce(stat.hints,0)=0
      and coalesce(stat.mistakes,0)=0
  ), player_medians as (
    select user_id,
      count(*)::integer as sample_count,
      percentile_cont(0.5) within group(order by seconds) as median_seconds
    from clean
    where player_sample_count>=2 and recent_rank<=5
    group by user_id
  )
  select count(*)::integer,
    coalesce(sum(sample_count),0)::integer,
    percentile_cont(0.5) within group(order by median_seconds)
  into eligible_players,qualifying_samples,community_median
  from player_medians;

  update public.game_time_benchmarks current_benchmark
  set observed_median_seconds=case when eligible_players>=3 then community_median else null end,
      clean_sample_count=case when eligible_players>=3 then qualifying_samples else 0 end,
      effective_seconds=case
        when eligible_players>=3 and community_median is not null then round(community_median)
        else current_benchmark.provisional_seconds
      end,
      updated_at=now()
  where current_benchmark.game=target_game
    and current_benchmark.day_index=target_day_index
    and current_benchmark.mode=target_mode
  returning * into benchmark;

  return benchmark;
end;
$$;

revoke all on function public.refresh_game_time_benchmark(text,integer,text) from public;

create or replace function public.circle_challenge_daily_score(
  target_game text,
  target_challenge_date date,
  elapsed_seconds integer,
  hint_count integer,
  mistake_count integer
)
returns integer
language sql
security definer
stable
set search_path=public
as $$
  with typical as (
    select coalesce((
      select benchmark.effective_seconds
      from public.game_time_benchmarks benchmark
      where benchmark.game=target_game
        and benchmark.mode='challenge'
        and benchmark.day_index=extract(isodow from target_challenge_date)::integer-1
      order by benchmark.updated_at desc nulls last limit 1
    ),100)::numeric as seconds
  )
  select greatest(20,least(150,round(
    100*typical.seconds/greatest(1,public.scored_game_seconds(
      elapsed_seconds,hint_count,mistake_count,typical.seconds
    ))
  )::integer))
  from typical
$$;

revoke all on function public.circle_challenge_daily_score(text,date,integer,integer,integer) from public;

-- Patch the current v165/v204 award function in place. Keeping the surrounding
-- transaction, caps and streak rules untouched makes this a focused forward
-- migration for databases where earlier versions have already run.
do $migration$
declare
  definition text;
  updated text;
begin
  select pg_get_functiondef('public.award_game_points(bigint)'::regprocedure) into definition;
  if strpos(definition,'performance_adjustment integer := 0;')>0 then return; end if;
  if strpos(definition,'day_bonus:=day_number*r.day_points_step;')=0
    or strpos(definition,'hint_points:=-(s.hints*r.hint_penalty);')=0 then
    raise exception 'award_game_points has an unexpected definition; v207 was not applied';
  end if;

  updated:=replace(definition,
    'benchmark_seconds numeric;',
    'benchmark_seconds numeric;'||chr(10)||'  scored_seconds numeric;'||chr(10)||'  performance_adjustment integer := 0;');
  updated:=replace(updated,
    'day_bonus:=day_number*r.day_points_step;',
    'day_bonus:=(array[0,1,1,2,2,3,3])[day_number+1];');
  updated:=replace(updated,
    E'  if s.game=\'zoom\' and zoom_correct<zoom_total then\n    time_points:=0;\n  elsif benchmark_seconds is not null\n    and s.seconds<=benchmark_seconds*0.8 then\n    time_points:=r.fast_time_bonus;\n  elsif benchmark_seconds is not null\n    and s.seconds<=benchmark_seconds then\n    time_points:=r.average_time_bonus;\n  elsif benchmark_seconds is not null\n    and s.seconds>benchmark_seconds*1.5 then\n    time_points:=-r.fast_time_bonus;\n  elsif benchmark_seconds is not null\n    and s.seconds>benchmark_seconds*1.2 then\n    time_points:=-r.average_time_bonus;\n  end if;\n\n  if s.hints>0 then\n    hint_points:=-(s.hints*r.hint_penalty);\n  end if;\n  if s.mistakes>0 then\n    mistake_points:=-(s.mistakes*r.mistake_penalty);\n  end if;',
    E'  scored_seconds:=public.scored_game_seconds(s.seconds,s.hints,s.mistakes,benchmark_seconds);\n  if not (s.game=\'zoom\' and zoom_correct<zoom_total) and benchmark_seconds>0 then\n    performance_adjustment:=greatest(-3,least(3,round(10*(1-scored_seconds/benchmark_seconds))::integer));\n  end if;\n  time_points:=performance_adjustment;');
  updated:=replace(updated,E'    \'time\',time_points,',E'    \'time\',time_points,\n    \'scored_seconds\',scored_seconds,\n    \'hint_penalty_seconds\',greatest(coalesce(s.hints,0),0)*benchmark_seconds*0.20,\n    \'mistake_penalty_seconds\',greatest(coalesce(s.mistakes,0),0)*benchmark_seconds*0.10,');
  updated:=replace(
    updated,
    E'\'economy_version\',\'v165\'',
    E'\'economy_version\',\'v207\''
  );
  updated:=replace(updated,E'    \'time_clean_sample_count\',benchmark.clean_sample_count\n',E'    \'time_clean_sample_count\',benchmark.clean_sample_count,\n    \'scored_seconds\',scored_seconds,\n    \'benchmark_ready\',benchmark.clean_sample_count>=6\n');
  execute updated;
end;
$migration$;

-- Final winner tie-breaks must use the same difficulty-relative penalties as
-- the live standings. Patch only the legacy fixed-time expression.
do $migration$
declare definition text; updated text;
begin
  select pg_get_functiondef('public.finalize_circle_challenge(bigint)'::regprocedure) into definition;
  updated:=regexp_replace(
    definition,
    E'greatest\\(coalesce\\(hints,\\s*0\\),\\s*0\\)\\s*\\*\\s*30',
    E'greatest(coalesce(hints,0),0)*coalesce((select b.effective_seconds from public.game_time_benchmarks b where b.game=member_rounds.game and b.day_index=extract(isodow from member_rounds.challenge_date)::integer-1 and b.mode=\'challenge\' limit 1),100)*0.20',
    'g'
  );
  updated:=regexp_replace(
    updated,
    E'greatest\\(coalesce\\(mistakes,\\s*0\\),\\s*0\\)\\s*\\*\\s*15',
    E'greatest(coalesce(mistakes,0),0)*coalesce((select b.effective_seconds from public.game_time_benchmarks b where b.game=member_rounds.game and b.day_index=extract(isodow from member_rounds.challenge_date)::integer-1 and b.mode=\'challenge\' limit 1),100)*0.10',
    'g'
  );
  if updated ~ E'greatest\\(coalesce\\(hints,\\s*0\\),\\s*0\\)\\s*\\*\\s*30'
    or updated ~ E'greatest\\(coalesce\\(mistakes,\\s*0\\),\\s*0\\)\\s*\\*\\s*15' then
    raise exception 'finalize_circle_challenge has an unexpected definition; v207 was not applied';
  end if;
  execute updated;
end;
$migration$;

do $$
declare item public.game_time_benchmarks;
begin
  for item in select * from public.game_time_benchmarks loop
    perform public.refresh_game_time_benchmark(item.game,item.day_index,item.mode);
  end loop;
end;
$$;

revoke all on function public.award_game_points(bigint) from public;
grant execute on function public.award_game_points(bigint) to authenticated;

notify pgrst,'reload schema';
commit;
