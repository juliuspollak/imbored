-- v211: One explicit points implementation.
-- Replaces v207's text patch and v209's obsolete global-cap workaround.

begin;

drop trigger if exists reward_rules_normalise_daily_points_cap on public.reward_rules;
drop function if exists public.normalise_reward_rules_daily_points_cap();

create or replace function public.normalise_reward_rules_practice_limit()
returns trigger language plpgsql set search_path=public as $$
begin
  new.practice_daily_limit:=least(greatest(coalesce(new.practice_daily_limit,3),1),1000);
  return new;
end;
$$;

update public.reward_rules set practice_daily_limit=3;

create or replace function public.award_game_points(target_stat_id bigint)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  s public.game_stats;
  p public.player_progress;
  r public.reward_rules;
  benchmark public.game_time_benchmarks;
  benchmark_seconds numeric;
  scored_seconds numeric;
  performance_adjustment integer:=0;
  zoom_correct integer;
  zoom_total integer;
  effective_base_points integer;
  day_number integer;
  day_bonus integer:=0;
  mode_percent integer:=100;
  unscaled_game_points integer;
  scaled_game_points integer;
  mode_adjustment integer:=0;
  mode_minimum integer;
  mode_maximum integer;
  game_points integer;
  limit_adjustment integer:=0;
  streak_points integer:=0;
  points_total integer;
  old_level integer;
  new_level integer;
  award_date date:=(now() at time zone 'Australia/Sydney')::date;
  effective_challenge_date date;
  practice_count integer:=0;
  challenge_games_on_date integer:=0;
  practice_limit_reached boolean:=false;
  breakdown jsonb;
begin
  select * into s from public.game_stats where id=target_stat_id;
  if not found or s.user_id<>auth.uid() then
    raise exception 'Game result not found';
  end if;

  select * into r from public.reward_rules
  where is_active=true order by id desc limit 1;
  if not found then raise exception 'No active reward rules'; end if;

  perform public.ensure_player_progress(s.user_id);
  select * into p from public.player_progress
  where player_id=s.user_id for update;

  if exists(
    select 1 from public.points_transactions
    where game_stat_id=s.id and reason_code='GAME_COMPLETED'
  ) then
    return jsonb_build_object(
      'already_awarded',true,'points_awarded',0,
      'balance',p.available_points,'streak',p.challenge_current_streak,
      'level',p.current_level
    );
  end if;

  if s.mode='practice' then
    select count(*) into practice_count
    from public.points_transactions pt
    join public.game_stats gs on gs.id=pt.game_stat_id
    where pt.player_id=s.user_id
      and pt.reason_code='GAME_COMPLETED'
      and gs.mode='practice'
      and gs.game=s.game
      and (pt.created_at at time zone 'Australia/Sydney')::date=award_date;
    practice_limit_reached:=practice_count>=r.practice_daily_limit;
  end if;

  benchmark:=public.refresh_game_time_benchmark(s.game,s.day_index,s.mode);
  benchmark_seconds:=coalesce(nullif(benchmark.effective_seconds,0),100);
  scored_seconds:=public.scored_game_seconds(
    s.seconds,s.hints,s.mistakes,benchmark_seconds
  );

  zoom_total:=greatest(coalesce(s.total_count,9),1);
  zoom_correct:=least(zoom_total,greatest(coalesce(s.correct_count,zoom_total-s.mistakes),0));
  effective_base_points:=case when s.game='zoom'
    then round(r.base_points*zoom_correct::numeric/zoom_total)
    else r.base_points end;

  day_number:=greatest(0,least(coalesce(s.day_index,0),6));
  day_bonus:=(array[0,0,1,1,1,2,2])[day_number+1];
  if not (s.game='zoom' and zoom_correct<zoom_total) then
    performance_adjustment:=greatest(-4,least(4,round(
      10*(1-scored_seconds/benchmark_seconds)
    )::integer));
  end if;

  unscaled_game_points:=effective_base_points+day_bonus+performance_adjustment;
  mode_percent:=case when s.mode='practice' then r.practice_points_percent else 100 end;
  scaled_game_points:=round(unscaled_game_points*mode_percent::numeric/100);
  mode_adjustment:=scaled_game_points-unscaled_game_points;
  mode_minimum:=case when s.mode='practice'
    then ceil(r.minimum_points*mode_percent::numeric/100)::integer
    else r.minimum_points end;
  mode_maximum:=case when s.mode='practice'
    then floor(r.maximum_points*mode_percent::numeric/100)::integer
    else r.maximum_points end;
  game_points:=greatest(mode_minimum,least(mode_maximum,scaled_game_points));
  game_points:=greatest(0,least(50,game_points));
  limit_adjustment:=game_points-scaled_game_points;
  if practice_limit_reached then game_points:=0; end if;

  effective_challenge_date:=coalesce(
    s.challenge_date,(s.completed_at at time zone 'Australia/Sydney')::date
  );
  if s.mode='challenge'
    and p.challenge_current_streak>0
    and p.challenge_current_streak%7=0 then
    select count(*) into challenge_games_on_date
    from public.game_stats gs
    where gs.user_id=s.user_id and gs.mode='challenge'
      and coalesce(gs.challenge_date,(gs.completed_at at time zone 'Australia/Sydney')::date)
        =effective_challenge_date;
    if challenge_games_on_date=1 then streak_points:=r.streak_weekly_bonus; end if;
  end if;

  points_total:=greatest(0,least(100,game_points+streak_points));
  breakdown:=jsonb_build_object(
    'base',effective_base_points,
    'configured_base',r.base_points,
    'day_index',day_number,
    'day_bonus',day_bonus,
    'time',performance_adjustment,
    'performance_adjustment',performance_adjustment,
    'scored_seconds',scored_seconds,
    'hint_penalty_seconds',greatest(coalesce(s.hints,0),0)*benchmark_seconds*0.20,
    'mistake_penalty_seconds',greatest(coalesce(s.mistakes,0),0)*benchmark_seconds*0.10,
    'correct_count',case when s.game='zoom' then zoom_correct else null end,
    'total_count',case when s.game='zoom' then zoom_total else null end,
    'rounds_nailed',case when s.game='zoom' then s.rounds_nailed else null end,
    'weekly_streak',streak_points,
    'mode',s.mode,
    'mode_multiplier_percent',mode_percent,
    'mode_adjustment',mode_adjustment,
    'limit_adjustment',limit_adjustment,
    'uncapped_game_points',game_points,
    'daily_game_points',game_points,
    'practice_reward_number',case when s.mode='practice' then practice_count+1 else null end,
    'practice_daily_limit',r.practice_daily_limit,
    'practice_limit_reached',practice_limit_reached,
    'benchmark_seconds',benchmark_seconds,
    'total',points_total
  );

  old_level:=p.current_level;
  new_level:=public.points_level(p.lifetime_points+points_total);
  insert into public.points_transactions(
    player_id,points,reason_code,game_stat_id,metadata,created_by
  ) values(
    s.user_id,points_total,'GAME_COMPLETED',s.id,
    breakdown||jsonb_build_object(
      'benchmark_provisional_seconds',benchmark.provisional_seconds,
      'benchmark_observed_median_seconds',benchmark.observed_median_seconds,
      'benchmark_clean_sample_count',benchmark.clean_sample_count,
      'benchmark_prior_weight',20,'rule_id',r.id,'economy_version','v211'
    ),s.user_id
  );

  update public.player_progress set
    available_points=available_points+points_total,
    lifetime_points=lifetime_points+points_total,
    current_level=new_level,updated_at=now()
  where player_id=s.user_id returning * into p;

  return jsonb_build_object(
    'points_awarded',points_total,'balance',p.available_points,
    'streak',p.challenge_current_streak,'level',p.current_level,
    'level_up',new_level>old_level,'breakdown',breakdown,
    'weekly_streak_bonus',streak_points,
    'practice_limit_reached',practice_limit_reached,
    'daily_points_cap_reached',false,
    'time_benchmark_seconds',benchmark_seconds,
    'time_clean_sample_count',benchmark.clean_sample_count,
    'scored_seconds',scored_seconds
  );
end;
$$;

create or replace function public.get_my_practice_reward_usage()
returns jsonb language sql security definer set search_path=public stable as $$
  with active_rule as (
    select practice_daily_limit from public.reward_rules
    where is_active=true order by id desc limit 1
  ), rewarded as (
    select gs.game,count(*)::integer as rewarded_count,
      min(pt.created_at) as first_awarded_at,max(pt.created_at) as last_awarded_at
    from public.points_transactions pt
    join public.game_stats gs on gs.id=pt.game_stat_id
    where pt.player_id=auth.uid() and pt.reason_code='GAME_COMPLETED'
      and pt.points>0 and gs.mode='practice'
      and (pt.created_at at time zone 'Australia/Sydney')::date
        =(now() at time zone 'Australia/Sydney')::date
    group by gs.game
  )
  select jsonb_build_object(
    'date',(now() at time zone 'Australia/Sydney')::date,
    'rewarded_count',coalesce((select sum(rewarded_count) from rewarded),0),
    'daily_limit',coalesce((select practice_daily_limit from active_rule),0),
    'per_game',true,
    'by_game',coalesce((select jsonb_agg(to_jsonb(rewarded) order by game) from rewarded),'[]'::jsonb)
  )
$$;

revoke all on function public.award_game_points(bigint) from public;
grant execute on function public.award_game_points(bigint) to authenticated;
revoke all on function public.get_my_practice_reward_usage() from public;
grant execute on function public.get_my_practice_reward_usage() to authenticated;

notify pgrst,'reload schema';
commit;
