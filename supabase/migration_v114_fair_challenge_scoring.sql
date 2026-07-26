-- Fair challenge scoring v114
-- Slow solves now reduce the normal game award, and a clean board is the
-- baseline rather than a separate bonus. Challenge standings use their own
-- adjusted-time calculation in the client and never alter account points.

update public.reward_rules
set no_hint_bonus = 0,
    no_mistake_bonus = 0,
    updated_at = now()
where is_active = true;

create or replace function public.award_game_points(target_stat_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s game_stats;
  r reward_rules;
  p player_progress;
  avg_seconds numeric;
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
  select * into s from game_stats where id = target_stat_id;
  if not found or s.user_id <> auth.uid() then raise exception 'Game result not found'; end if;

  select * into r from reward_rules where is_active = true order by id desc limit 1;
  if not found then raise exception 'No active reward rules'; end if;

  perform ensure_player_progress(s.user_id);
  select * into p from player_progress where player_id = s.user_id for update;

  if exists(select 1 from points_transactions where game_stat_id = s.id and reason_code = 'GAME_COMPLETED') then
    return jsonb_build_object('already_awarded', true, 'points_awarded', 0, 'balance', p.available_points,
      'streak', p.current_streak, 'level', p.current_level);
  end if;

  if s.mode = 'practice' then
    select count(*) into practice_count from points_transactions pt
      join game_stats gs on gs.id = pt.game_stat_id
      where pt.player_id = s.user_id and pt.reason_code = 'GAME_COMPLETED'
        and gs.mode = 'practice' and (pt.created_at at time zone 'Australia/Sydney')::date = (now() at time zone 'Australia/Sydney')::date;
    if practice_count >= r.practice_daily_limit then
      return jsonb_build_object('points_awarded', 0, 'daily_limit_reached', true, 'balance', p.available_points,
        'streak', p.current_streak, 'level', p.current_level);
    end if;
  end if;

  select avg(seconds) into avg_seconds from game_stats
    where game = s.game and mode = s.mode and id <> s.id and seconds > 0;

  if avg_seconds is not null and s.seconds <= avg_seconds * 0.8 then
    time_points := r.fast_time_bonus;
  elsif avg_seconds is not null and s.seconds <= avg_seconds then
    time_points := r.average_time_bonus;
  elsif avg_seconds is not null and s.seconds > avg_seconds * 1.5 then
    time_points := -r.fast_time_bonus;
  elsif avg_seconds is not null and s.seconds > avg_seconds * 1.2 then
    time_points := -r.average_time_bonus;
  end if;

  -- A clean solve is the baseline. Only actual help and mistakes adjust it.
  if s.hints > 0 then hint_points := -(s.hints * r.hint_penalty); end if;
  if s.mistakes > 0 then mistake_points := -(s.mistakes * r.mistake_penalty); end if;

  today_date := coalesce(s.challenge_date, (s.completed_at at time zone 'Australia/Sydney')::date);
  if p.last_completed_date is null then new_streak := 1;
  elsif p.last_completed_date = today_date then new_streak := p.current_streak;
  elsif p.last_completed_date = today_date - 1 then new_streak := p.current_streak + 1;
  elsif p.streak_protected_through is not null and p.streak_protected_through >= today_date - 1 then new_streak := p.current_streak + 1;
  else new_streak := 1;
  end if;

  if p.last_completed_date is distinct from today_date then
    streak_points := least(new_streak * r.streak_daily_bonus, r.streak_bonus_cap);
  end if;

  points_total := r.base_points + time_points + hint_points + mistake_points + streak_points
    + case when s.mode = 'challenge' then r.challenge_bonus else 0 end;
  points_total := greatest(r.minimum_points, least(r.maximum_points, points_total));
  points_total := greatest(0, least(500, points_total));

  old_level := p.current_level;
  new_level := points_level(p.lifetime_points + points_total);

  insert into points_transactions(player_id, points, reason_code, game_stat_id, metadata, created_by)
  values (s.user_id, points_total, 'GAME_COMPLETED', s.id,
    jsonb_build_object('base', r.base_points, 'time', time_points, 'hints', hint_points,
      'mistakes', mistake_points, 'streak', streak_points,
      'challenge', case when s.mode='challenge' then r.challenge_bonus else 0 end,
      'average_seconds', avg_seconds, 'rule_id', r.id, 'total', points_total), s.user_id);

  update player_progress set
    available_points = available_points + points_total,
    lifetime_points = lifetime_points + points_total,
    current_level = new_level,
    current_streak = new_streak,
    longest_streak = greatest(longest_streak, new_streak),
    last_completed_date = greatest(coalesce(last_completed_date, today_date), today_date),
    updated_at = now()
  where player_id = s.user_id
  returning * into p;

  return jsonb_build_object('points_awarded', points_total, 'balance', p.available_points,
    'streak', p.current_streak, 'level', p.current_level, 'level_up', new_level > old_level);
end;
$$;

grant execute on function public.award_game_points(bigint) to authenticated;
