-- v133: reward Challenge play more than Practice and scale rewards with
-- the Monday-to-Sunday puzzle difficulty.
--
-- Defaults:
--   Challenge: 100% of the calculated award
--   Practice:   60% of the calculated award
--   Day bonus:  Monday +0, Tuesday +10, ... Sunday +60 before mode scaling

begin;

alter table public.reward_rules
  add column if not exists practice_points_percent integer not null default 60,
  add column if not exists day_points_step integer not null default 10;

alter table public.reward_rules
  drop constraint if exists reward_rules_practice_points_percent_range;
alter table public.reward_rules
  add constraint reward_rules_practice_points_percent_range
  check (practice_points_percent between 10 and 90);

alter table public.reward_rules
  drop constraint if exists reward_rules_day_points_step_range;
alter table public.reward_rules
  add constraint reward_rules_day_points_step_range
  check (day_points_step between 1 and 50);

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
  zoom_correct integer;
  zoom_total integer;
  effective_base_points integer;
  day_number integer;
  day_bonus integer := 0;
  mode_percent integer := 100;
  unscaled_points integer;
  scaled_points integer;
  mode_adjustment integer := 0;
  mode_minimum integer;
  mode_maximum integer;
  points_total integer;
  raw_points_total integer;
  limit_adjustment integer := 0;
  time_points integer := 0;
  hint_points integer := 0;
  mistake_points integer := 0;
  streak_points integer := 0;
  new_streak integer;
  old_level integer;
  new_level integer;
  today_date date;
  practice_count integer;
  breakdown jsonb;
begin
  select * into s
  from public.game_stats
  where id=target_stat_id;

  if not found or s.user_id<>auth.uid() then
    raise exception 'Game result not found';
  end if;

  select * into r
  from public.reward_rules
  where is_active=true
  order by id desc
  limit 1;

  if not found then
    raise exception 'No active reward rules';
  end if;

  perform public.ensure_player_progress(s.user_id);

  select * into p
  from public.player_progress
  where player_id=s.user_id
  for update;

  if exists(
    select 1
    from public.points_transactions
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
    from public.points_transactions pt
    join public.game_stats gs
      on gs.id=pt.game_stat_id
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

  benchmark:=public.refresh_game_time_benchmark(
    s.game,
    s.day_index,
    s.mode
  );
  benchmark_seconds:=benchmark.effective_seconds;

  zoom_total:=greatest(coalesce(s.total_count,9),1);
  zoom_correct:=least(
    zoom_total,
    greatest(coalesce(s.correct_count,zoom_total-s.mistakes),0)
  );

  effective_base_points:=r.base_points;
  if s.game='zoom' then
    effective_base_points:=round(
      r.base_points*zoom_correct::numeric/zoom_total
    );
  end if;

  -- day_index is zero-based throughout the game clients:
  -- Monday 0 through Sunday 6.
  day_number:=greatest(0,least(coalesce(s.day_index,0),6));
  day_bonus:=day_number*r.day_points_step;

  -- Failed Zoom rounds shorten the run. Only a perfect run receives a
  -- speed bonus or time penalty.
  if s.game='zoom' and zoom_correct<zoom_total then
    time_points:=0;
  elsif benchmark_seconds is not null
    and s.seconds<=benchmark_seconds*0.8 then
    time_points:=r.fast_time_bonus;
  elsif benchmark_seconds is not null
    and s.seconds<=benchmark_seconds then
    time_points:=r.average_time_bonus;
  elsif benchmark_seconds is not null
    and s.seconds>benchmark_seconds*1.5 then
    time_points:=-r.fast_time_bonus;
  elsif benchmark_seconds is not null
    and s.seconds>benchmark_seconds*1.2 then
    time_points:=-r.average_time_bonus;
  end if;

  if s.hints>0 then
    hint_points:=-(s.hints*r.hint_penalty);
  end if;
  if s.mistakes>0 then
    mistake_points:=-(s.mistakes*r.mistake_penalty);
  end if;

  today_date:=coalesce(
    s.challenge_date,
    (s.completed_at at time zone 'Australia/Sydney')::date
  );

  if p.last_completed_date is null then
    new_streak:=1;
  elsif p.last_completed_date=today_date then
    new_streak:=p.current_streak;
  elsif p.last_completed_date=today_date-1 then
    new_streak:=p.current_streak+1;
  elsif p.streak_protected_through is not null
    and p.streak_protected_through>=today_date-1 then
    new_streak:=p.current_streak+1;
  else
    new_streak:=1;
  end if;

  if p.last_completed_date is distinct from today_date
    and new_streak>0
    and new_streak%7=0 then
    streak_points:=r.streak_weekly_bonus;
  end if;

  unscaled_points:=
    effective_base_points
    + day_bonus
    + time_points
    + hint_points
    + mistake_points
    + streak_points;

  mode_percent:=case
    when s.mode='practice' then r.practice_points_percent
    else 100
  end;

  scaled_points:=round(unscaled_points*mode_percent::numeric/100);
  mode_adjustment:=scaled_points-unscaled_points;
  raw_points_total:=scaled_points;

  -- Scale the floor and ceiling too. This prevents the shared minimum or
  -- maximum from making equivalent Practice and Challenge runs pay equally.
  mode_minimum:=case
    when s.mode='practice'
      then ceil(r.minimum_points*mode_percent::numeric/100)::integer
    else r.minimum_points
  end;
  mode_maximum:=case
    when s.mode='practice'
      then floor(r.maximum_points*mode_percent::numeric/100)::integer
    else r.maximum_points
  end;

  points_total:=greatest(
    mode_minimum,
    least(mode_maximum,scaled_points)
  );
  points_total:=greatest(0,least(500,points_total));
  limit_adjustment:=points_total-raw_points_total;

  breakdown:=jsonb_build_object(
    'base',effective_base_points,
    'configured_base',r.base_points,
    'day_index',day_number,
    'day_bonus',day_bonus,
    'time',time_points,
    'correct_count',case when s.game='zoom' then zoom_correct else null end,
    'total_count',case when s.game='zoom' then zoom_total else null end,
    'rounds_nailed',case when s.game='zoom' then s.rounds_nailed else null end,
    'hints',hint_points,
    'mistakes',mistake_points,
    'weekly_streak',streak_points,
    'mode',s.mode,
    'mode_multiplier_percent',mode_percent,
    'mode_adjustment',mode_adjustment,
    'challenge',0,
    'limit_adjustment',limit_adjustment,
    'benchmark_seconds',benchmark_seconds,
    'total',points_total
  );

  old_level:=p.current_level;
  new_level:=public.points_level(p.lifetime_points+points_total);

  insert into public.points_transactions(
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

  update public.player_progress
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
