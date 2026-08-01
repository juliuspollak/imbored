-- Calibrated per-day time benchmarks v116
-- Uses a provisional human-time estimate until enough clean player results
-- exist, then progressively yields to the observed 90-day median.

create table if not exists public.game_time_benchmarks (
  game text not null,
  day_index integer not null check (day_index between 0 and 6),
  mode text not null check (mode in ('practice','challenge')),
  provisional_seconds integer not null check (provisional_seconds between 5 and 3600),
  observed_median_seconds numeric,
  clean_sample_count integer not null default 0,
  effective_seconds numeric not null,
  updated_at timestamptz not null default now(),
  primary key (game,day_index,mode)
);

-- Initial human-time priors. These are deliberately conservative and are
-- automatically diluted by real clean completions using a prior weight of 20.
with provisional(game,times) as (
  values
    ('hive',        array[75,75,100,120,160,210,300]),
    ('tango',       array[75,90,105,120,145,175,210]),
    ('gridly',      array[75,90,110,135,165,210,260]),
    ('minisudoku',  array[60,75,90,110,140,175,220]),
    ('geo',         array[35,40,45,50,55,60,65]),
    ('zoom',        array[45,60,75,90,110,130,150])
),
expanded as (
  select
    p.game,
    day_index,
    mode,
    p.times[day_index+1] as seconds
  from provisional p
  cross join generate_series(0,6) day_index
  cross join (values ('practice'),('challenge')) modes(mode)
)
insert into public.game_time_benchmarks(
  game,day_index,mode,provisional_seconds,effective_seconds
)
select game,day_index,mode,seconds,seconds
from expanded
on conflict(game,day_index,mode) do nothing;

create index if not exists game_stats_clean_benchmark_idx
  on public.game_stats(game,day_index,mode,completed_at)
  where seconds > 0 and hints = 0 and mistakes = 0;

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
  sample_count integer := 0;
  median_seconds numeric;
  benchmark public.game_time_benchmarks;
  prior_weight constant integer := 20;
begin
  select count(*),
         percentile_cont(0.5) within group(order by seconds)
  into sample_count,median_seconds
  from public.game_stats
  where game=target_game
    and day_index=target_day_index
    and mode=target_mode
    and completed_at >= now()-interval '90 days'
    and seconds between 5 and 3600
    and hints=0
    and mistakes=0;

  update public.game_time_benchmarks b
  set observed_median_seconds=median_seconds,
      clean_sample_count=sample_count,
      effective_seconds=case
        when sample_count=0 or median_seconds is null then b.provisional_seconds
        else round(
          (prior_weight*b.provisional_seconds + sample_count*median_seconds)
          /(prior_weight+sample_count)
        )
      end,
      updated_at=now()
  where b.game=target_game
    and b.day_index=target_day_index
    and b.mode=target_mode
  returning * into benchmark;

  return benchmark;
end;
$$;

-- Calibrate all seeded rows immediately from any existing clean history.
do $$
declare
  benchmark public.game_time_benchmarks;
begin
  for benchmark in select * from public.game_time_benchmarks loop
    perform public.refresh_game_time_benchmark(
      benchmark.game,benchmark.day_index,benchmark.mode
    );
  end loop;
end;
$$;

alter table public.game_time_benchmarks enable row level security;
drop policy if exists "benchmarks readable" on public.game_time_benchmarks;
create policy "benchmarks readable"
  on public.game_time_benchmarks for select
  using (auth.uid() is not null);
drop policy if exists "admins manage benchmarks" on public.game_time_benchmarks;
create policy "admins manage benchmarks"
  on public.game_time_benchmarks for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

revoke all on function public.refresh_game_time_benchmark(text,integer,text) from public;

create or replace function public.award_game_points(target_stat_id bigint)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  s game_stats;
  r reward_rules;
  p player_progress;
  benchmark game_time_benchmarks;
  benchmark_seconds numeric;
  points_total int;
  time_points int := 0;
  hint_points int := 0;
  mistake_points int := 0;
  streak_points int := 0;
  new_streak int;
  old_level int;
  new_level int;
  today_date date;
  practice_count int;
begin
  select * into s from game_stats where id=target_stat_id;
  if not found or s.user_id<>auth.uid() then raise exception 'Game result not found'; end if;

  select * into r from reward_rules where is_active=true order by id desc limit 1;
  if not found then raise exception 'No active reward rules'; end if;

  perform ensure_player_progress(s.user_id);
  select * into p from player_progress where player_id=s.user_id for update;

  if exists(
    select 1 from points_transactions
    where game_stat_id=s.id and reason_code='GAME_COMPLETED'
  ) then
    return jsonb_build_object(
      'already_awarded',true,'points_awarded',0,
      'balance',p.available_points,'streak',p.current_streak,'level',p.current_level
    );
  end if;

  if s.mode='practice' then
    select count(*) into practice_count
    from points_transactions pt
    join game_stats gs on gs.id=pt.game_stat_id
    where pt.player_id=s.user_id
      and pt.reason_code='GAME_COMPLETED'
      and gs.mode='practice'
      and (pt.created_at at time zone 'Australia/Sydney')::date
        =(now() at time zone 'Australia/Sydney')::date;
    if practice_count>=r.practice_daily_limit then
      return jsonb_build_object(
        'points_awarded',0,'daily_limit_reached',true,
        'balance',p.available_points,'streak',p.current_streak,'level',p.current_level
      );
    end if;
  end if;

  benchmark := public.refresh_game_time_benchmark(s.game,s.day_index,s.mode);
  benchmark_seconds := benchmark.effective_seconds;

  if benchmark_seconds is not null and s.seconds<=benchmark_seconds*0.8 then
    time_points := r.fast_time_bonus;
  elsif benchmark_seconds is not null and s.seconds<=benchmark_seconds then
    time_points := r.average_time_bonus;
  elsif benchmark_seconds is not null and s.seconds>benchmark_seconds*1.5 then
    time_points := -r.fast_time_bonus;
  elsif benchmark_seconds is not null and s.seconds>benchmark_seconds*1.2 then
    time_points := -r.average_time_bonus;
  end if;

  if s.hints>0 then hint_points := -(s.hints*r.hint_penalty); end if;
  if s.mistakes>0 then mistake_points := -(s.mistakes*r.mistake_penalty); end if;

  today_date := coalesce(
    s.challenge_date,(s.completed_at at time zone 'Australia/Sydney')::date
  );
  if p.last_completed_date is null then new_streak := 1;
  elsif p.last_completed_date=today_date then new_streak := p.current_streak;
  elsif p.last_completed_date=today_date-1 then new_streak := p.current_streak+1;
  elsif p.streak_protected_through is not null
    and p.streak_protected_through>=today_date-1
    then new_streak := p.current_streak+1;
  else new_streak := 1;
  end if;

  if p.last_completed_date is distinct from today_date then
    streak_points := least(new_streak*r.streak_daily_bonus,r.streak_bonus_cap);
  end if;

  points_total := r.base_points+time_points+hint_points+mistake_points+streak_points
    +case when s.mode='challenge' then r.challenge_bonus else 0 end;
  points_total := greatest(r.minimum_points,least(r.maximum_points,points_total));
  points_total := greatest(0,least(500,points_total));

  old_level := p.current_level;
  new_level := points_level(p.lifetime_points+points_total);

  insert into points_transactions(
    player_id,points,reason_code,game_stat_id,metadata,created_by
  )
  values(
    s.user_id,points_total,'GAME_COMPLETED',s.id,
    jsonb_build_object(
      'base',r.base_points,
      'time',time_points,
      'hints',hint_points,
      'mistakes',mistake_points,
      'streak',streak_points,
      'challenge',case when s.mode='challenge' then r.challenge_bonus else 0 end,
      'benchmark_seconds',benchmark_seconds,
      'benchmark_provisional_seconds',benchmark.provisional_seconds,
      'benchmark_observed_median_seconds',benchmark.observed_median_seconds,
      'benchmark_clean_sample_count',benchmark.clean_sample_count,
      'benchmark_prior_weight',20,
      'rule_id',r.id,
      'total',points_total
    ),
    s.user_id
  );

  update player_progress
  set available_points=available_points+points_total,
      lifetime_points=lifetime_points+points_total,
      current_level=new_level,
      current_streak=new_streak,
      longest_streak=greatest(longest_streak,new_streak),
      last_completed_date=greatest(coalesce(last_completed_date,today_date),today_date),
      updated_at=now()
  where player_id=s.user_id
  returning * into p;

  return jsonb_build_object(
    'points_awarded',points_total,
    'balance',p.available_points,
    'streak',p.current_streak,
    'level',p.current_level,
    'level_up',new_level>old_level,
    'time_benchmark_seconds',benchmark_seconds,
    'time_clean_sample_count',benchmark.clean_sample_count
  );
end;
$$;

grant execute on function public.award_game_points(bigint) to authenticated;
