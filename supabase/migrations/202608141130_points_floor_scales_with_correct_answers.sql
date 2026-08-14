-- The participation floor is now earned in proportion to correct answers.
--
-- award_game_points() scales the base by accuracy, then clamps the result up
-- to minimum_points. Flat, that floor paid a round answered entirely wrong the
-- same minimum as a clean one (2 points each, with the seeded rules), and
-- nothing constrains minimum_points to sit below base_points -- an admin
-- raising it to 8 would have paid every quiz result 8 regardless of how many
-- answers were right, silently undoing the accuracy rule altogether.
--
-- Scaling the floor by the same share keeps the guarantee for a clean round,
-- removes it entirely for a round with nothing correct, and makes the accuracy
-- scaling impossible to mask by configuration.

create or replace function public.award_game_points(target_stat_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  s public.game_stats;
  p public.player_progress;
  r public.reward_rules;
  benchmark public.game_time_benchmarks;
  benchmark_seconds numeric;
  scored_seconds numeric;
  performance_adjustment integer:=0;
  answer_correct integer;
  answer_total integer;
  answer_share numeric:=1;
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
  player_zone text;
  award_date date;
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

  -- The rewarded-Practice allowance resets at the player's own midnight, not
  -- Sydney's. Resolved once here and reused for every day comparison below.
  player_zone:=public.resolve_timezone(
    (select profile.timezone from public.profiles profile where profile.id=s.user_id)
  );
  award_date:=(timezone(player_zone,now()))::date;

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
      and (pt.created_at at time zone player_zone)::date=award_date;
    practice_limit_reached:=practice_count>=r.practice_daily_limit;
  end if;

  benchmark:=public.refresh_game_time_benchmark(s.game,s.day_index,s.mode);
  benchmark_seconds:=coalesce(nullif(benchmark.effective_seconds,0),100);
  scored_seconds:=public.scored_game_seconds(
    s.seconds,s.hints,s.mistakes,benchmark_seconds
  );

  -- Any game that reports how many answers it asked for is paid on accuracy,
  -- not just Zoom: a wrong answer costs base points, and an imperfect round
  -- earns no speed bonus, so racing through a quiz getting it wrong cannot
  -- out-earn working through it. Games that report no answer count (the
  -- solve-the-board puzzles) are unaffected and keep scoring on time alone.
  answer_total:=nullif(greatest(coalesce(s.total_count,0),0),0);
  if answer_total is null then
    effective_base_points:=r.base_points;
  else
    answer_correct:=least(answer_total,greatest(coalesce(s.correct_count,answer_total-s.mistakes),0));
    answer_share:=answer_correct::numeric/answer_total;
    effective_base_points:=round(r.base_points*answer_share);
  end if;

  day_number:=greatest(0,least(coalesce(s.day_index,0),6));
  day_bonus:=(array[0,0,1,1,1,2,2])[day_number+1];
  if answer_total is null or answer_correct=answer_total then
    performance_adjustment:=greatest(-4,least(4,round(
      10*(1-scored_seconds/benchmark_seconds)
    )::integer));
  end if;

  unscaled_game_points:=effective_base_points+day_bonus+performance_adjustment;
  mode_percent:=case when s.mode='practice' then r.practice_points_percent else 100 end;
  scaled_game_points:=round(unscaled_game_points*mode_percent::numeric/100);
  mode_adjustment:=scaled_game_points-unscaled_game_points;
  -- The guaranteed floor is earned in proportion to how much was answered
  -- correctly. Flat, it clamped a round answered entirely wrong back up to the
  -- same minimum a clean one gets, and — because nothing stops minimum_points
  -- being configured up towards base_points — a raised floor would have
  -- silently swallowed the accuracy scaling above for every quiz result.
  mode_minimum:=round((case when s.mode='practice'
    then ceil(r.minimum_points*mode_percent::numeric/100)
    else r.minimum_points end)*answer_share)::integer;
  mode_maximum:=case when s.mode='practice'
    then floor(r.maximum_points*mode_percent::numeric/100)::integer
    else r.maximum_points end;
  game_points:=greatest(mode_minimum,least(mode_maximum,scaled_game_points));
  game_points:=greatest(0,least(50,game_points));
  limit_adjustment:=game_points-scaled_game_points;
  if practice_limit_reached then game_points:=0; end if;

  effective_challenge_date:=coalesce(
    s.challenge_date,(s.completed_at at time zone player_zone)::date
  );
  if s.mode='challenge'
    and p.challenge_current_streak>0
    and p.challenge_current_streak%7=0 then
    select count(*) into challenge_games_on_date
    from public.game_stats gs
    where gs.user_id=s.user_id and gs.mode='challenge'
      and coalesce(gs.challenge_date,(gs.completed_at at time zone player_zone)::date)
        =effective_challenge_date;
    if challenge_games_on_date=1 then streak_points:=r.streak_weekly_bonus; end if;
  end if;

  -- Bound by what is actually reachable, not a flat 100. A flat ceiling
  -- silently clipped the weekly streak bonus once it grew past ~88, eating the
  -- game award on the very day the bonus was meant to celebrate.
  points_total:=greatest(0,least(50+coalesce(r.streak_weekly_bonus,0),game_points+streak_points));
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
    'correct_count',answer_correct,
    'total_count',answer_total,
    'answer_share',answer_share,
    'minimum_points',mode_minimum,
    'rounds_nailed',s.rounds_nailed,
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
