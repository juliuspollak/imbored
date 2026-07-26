-- v122: record Zoom outcome quality and award points for what was
-- actually solved. Skipped levels are no longer displayed as correct, and a
-- shortened failed run cannot receive a speed bonus.

begin;

alter table public.game_stats
  add column if not exists correct_count integer,
  add column if not exists total_count integer,
  add column if not exists rounds_nailed integer;

alter table public.game_stats
  drop constraint if exists game_stats_correct_count_nonnegative;
alter table public.game_stats
  add constraint game_stats_correct_count_nonnegative
  check (correct_count is null or correct_count >= 0);

alter table public.game_stats
  drop constraint if exists game_stats_total_count_positive;
alter table public.game_stats
  add constraint game_stats_total_count_positive
  check (total_count is null or total_count > 0);

alter table public.game_stats
  drop constraint if exists game_stats_correct_within_total;
alter table public.game_stats
  add constraint game_stats_correct_within_total
  check (
    correct_count is null
    or total_count is null
    or correct_count <= total_count
  );

alter table public.game_stats
  drop constraint if exists game_stats_rounds_nailed_nonnegative;
alter table public.game_stats
  add constraint game_stats_rounds_nailed_nonnegative
  check (rounds_nailed is null or rounds_nailed >= 0);

create or replace function public.award_game_points(target_stat_id bigint)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  s game_stats;
  p player_progress;
  r reward_rules;
  benchmark game_time_benchmarks;
  benchmark_seconds numeric;
  zoom_correct int;
  zoom_total int;
  effective_base_points int;
  points_total int;
  raw_points_total int;
  limit_adjustment int := 0;
  time_points int := 0;
  hint_points int := 0;
  mistake_points int := 0;
  streak_points int := 0;
  new_streak int;
  old_level int;
  new_level int;
  today_date date;
  practice_count int;
  breakdown jsonb;
begin
  select * into s from game_stats where id=target_stat_id;
  if not found or s.user_id<>auth.uid() then
    raise exception 'Game result not found';
  end if;

  select * into r
  from reward_rules
  where is_active=true
  order by id desc
  limit 1;
  if not found then raise exception 'No active reward rules'; end if;

  perform ensure_player_progress(s.user_id);
  select * into p
  from player_progress
  where player_id=s.user_id
  for update;

  if exists(
    select 1
    from points_transactions
    where game_stat_id=s.id
      and reason_code='GAME_COMPLETED'
  ) then
    return jsonb_build_object(
      'already_awarded',true,
      'points_awarded',0,
      'balance',p.available_points,
      'streak',p.current_streak,
      'level',p.current_level
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
        'points_awarded',0,
        'daily_limit_reached',true,
        'balance',p.available_points,
        'streak',p.current_streak,
        'level',p.current_level
      );
    end if;
  end if;

  benchmark := public.refresh_game_time_benchmark(
    s.game,
    s.day_index,
    s.mode
  );
  benchmark_seconds := benchmark.effective_seconds;

  zoom_total := greatest(coalesce(s.total_count,9),1);
  zoom_correct := least(
    zoom_total,
    greatest(coalesce(s.correct_count,zoom_total-s.mistakes),0)
  );
  effective_base_points := r.base_points;
  if s.game='zoom' then
    effective_base_points := round(
      r.base_points * zoom_correct::numeric / zoom_total
    );
  end if;

  -- A failed Zoom round skips unanswered levels and shortens the timer.
  -- Only a perfect run is eligible for a speed bonus or time penalty.
  if s.game='zoom' and zoom_correct<zoom_total then
    time_points := 0;
  elsif benchmark_seconds is not null
    and s.seconds<=benchmark_seconds*0.8 then
    time_points := r.fast_time_bonus;
  elsif benchmark_seconds is not null
    and s.seconds<=benchmark_seconds then
    time_points := r.average_time_bonus;
  elsif benchmark_seconds is not null
    and s.seconds>benchmark_seconds*1.5 then
    time_points := -r.fast_time_bonus;
  elsif benchmark_seconds is not null
    and s.seconds>benchmark_seconds*1.2 then
    time_points := -r.average_time_bonus;
  end if;

  if s.hints>0 then
    hint_points := -(s.hints*r.hint_penalty);
  end if;
  if s.mistakes>0 then
    mistake_points := -(s.mistakes*r.mistake_penalty);
  end if;

  today_date := coalesce(
    s.challenge_date,
    (s.completed_at at time zone 'Australia/Sydney')::date
  );
  if p.last_completed_date is null then
    new_streak := 1;
  elsif p.last_completed_date=today_date then
    new_streak := p.current_streak;
  elsif p.last_completed_date=today_date-1 then
    new_streak := p.current_streak+1;
  elsif p.streak_protected_through is not null
    and p.streak_protected_through>=today_date-1 then
    new_streak := p.current_streak+1;
  else
    new_streak := 1;
  end if;

  -- The first completed game on streak days 7, 14, 21, ... receives one
  -- fixed weekly milestone reward. Other streak days receive no point bonus.
  if p.last_completed_date is distinct from today_date
    and new_streak>0
    and new_streak%7=0 then
    streak_points := r.streak_weekly_bonus;
  end if;

  points_total :=
    effective_base_points
    + time_points
    + hint_points
    + mistake_points
    + streak_points;
  raw_points_total := points_total;
  points_total := greatest(
    r.minimum_points,
    least(r.maximum_points,points_total)
  );
  points_total := greatest(0,least(500,points_total));
  limit_adjustment := points_total-raw_points_total;

  breakdown := jsonb_build_object(
    'base',effective_base_points,
    'configured_base',r.base_points,
    'time',time_points,
    'correct_count',case when s.game='zoom' then zoom_correct else null end,
    'total_count',case when s.game='zoom' then zoom_total else null end,
    'rounds_nailed',case when s.game='zoom' then s.rounds_nailed else null end,
    'hints',hint_points,
    'mistakes',mistake_points,
    'weekly_streak',streak_points,
    'challenge',0,
    'limit_adjustment',limit_adjustment,
    'benchmark_seconds',benchmark_seconds,
    'total',points_total
  );

  old_level := p.current_level;
  new_level := points_level(p.lifetime_points+points_total);

  insert into points_transactions(
    player_id,
    points,
    reason_code,
    game_stat_id,
    metadata,
    created_by
  )
  values(
    s.user_id,
    points_total,
    'GAME_COMPLETED',
    s.id,
    breakdown || jsonb_build_object(
      'benchmark_provisional_seconds',benchmark.provisional_seconds,
      'benchmark_observed_median_seconds',benchmark.observed_median_seconds,
      'benchmark_clean_sample_count',benchmark.clean_sample_count,
      'benchmark_prior_weight',20,
      'rule_id',r.id
    ),
    s.user_id
  );

  update player_progress
  set available_points=available_points+points_total,
      lifetime_points=lifetime_points+points_total,
      current_level=new_level,
      current_streak=new_streak,
      longest_streak=greatest(longest_streak,new_streak),
      last_completed_date=greatest(
        coalesce(last_completed_date,today_date),
        today_date
      ),
      updated_at=now()
  where player_id=s.user_id
  returning * into p;

  return jsonb_build_object(
    'points_awarded',points_total,
    'balance',p.available_points,
    'streak',p.current_streak,
    'level',p.current_level,
    'level_up',new_level>old_level,
    'breakdown',breakdown,
    'weekly_streak_bonus',streak_points,
    'time_benchmark_seconds',benchmark_seconds,
    'time_clean_sample_count',benchmark.clean_sample_count
  );
end;
$$;

grant execute on function public.award_game_points(bigint) to authenticated;

notify pgrst,'reload schema';
commit;
