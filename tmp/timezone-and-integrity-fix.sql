-- Apply once: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Extracted verbatim from supabase/schemas/public.sql.
-- Idempotent: add-column IF NOT EXISTS + CREATE OR REPLACE throughout.

begin;

-- ---------- timezone columns (null = Australia/Sydney) ----------
alter table public.profiles add column if not exists timezone text;
alter table public.circles  add column if not exists timezone text;

-- ---------- dead + broken: referenced public.team_weekly_challenges,
-- ---------- which v181 renamed. Never called; duplicated by
-- ---------- finalize_due_circle_challenges.
drop function if exists public.finalize_all_due_team_challenges();

-- ---------- resolve_timezone ----------
CREATE OR REPLACE FUNCTION public.resolve_timezone(candidate text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
begin
  if candidate is null or btrim(candidate)='' then
    return 'Australia/Sydney';
  end if;
  -- Fixed instant, not now(), so this stays genuinely IMMUTABLE. It only has
  -- to prove the zone name resolves at all.
  perform timezone(candidate, '2000-01-01 00:00:00+00'::timestamptz);
  return candidate;
exception when others then
  return 'Australia/Sydney';
end;
$$;

-- ---------- player_today ----------
CREATE OR REPLACE FUNCTION public.player_today(uid uuid) RETURNS date
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select (timezone(
    public.resolve_timezone((select p.timezone from public.profiles p where p.id=uid)),
    now()
  ))::date
$$;

-- ---------- circle_today ----------
CREATE OR REPLACE FUNCTION public.circle_today(target_circle_id bigint) RETURNS date
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select (timezone(
    public.resolve_timezone((select c.timezone from public.circles c where c.id=target_circle_id)),
    now()
  ))::date
$$;

-- ---------- circle_week_start ----------
CREATE OR REPLACE FUNCTION public.circle_week_start(target_circle_id bigint) RETURNS date
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select (
    public.circle_today(target_circle_id)
    - (extract(isodow from public.circle_today(target_circle_id))::integer - 1)
  )::date
$$;

-- ---------- set_my_timezone ----------
CREATE OR REPLACE FUNCTION public.set_my_timezone(candidate text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.profiles
  set timezone=public.resolve_timezone(candidate)
  where id=auth.uid()
$$;

-- ---------- create_circle ----------
CREATE OR REPLACE FUNCTION public.create_circle(circle_name text, circle_emoji text DEFAULT '⭐'::text) RETURNS public.circles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare result public.circles;
begin
  if not public.is_available_player(auth.uid()) then
    raise exception 'Your account must be active and approved first.' using errcode='42501';
  end if;
  if exists(
    select 1 from public.profiles profile
    where profile.id=auth.uid() and coalesce(profile.hidden_from_others,false)
  ) then
    raise exception 'Hidden players cannot create circles.' using errcode='42501';
  end if;
  if nullif(btrim(circle_name),'') is null then
    raise exception 'Circle name is required.' using errcode='22023';
  end if;

  -- The circle's day boundary comes from whoever created it. Members abroad
  -- all play the same shared round on the same shared day.
  insert into public.circles(name,emoji,created_by,timezone)
  values(
    btrim(circle_name),
    coalesce(nullif(btrim(circle_emoji),''),'⭐'),
    auth.uid(),
    (select profile.timezone from public.profiles profile where profile.id=auth.uid())
  )
  returning * into result;

  insert into public.circle_members(circle_id,user_id,can_approve_rewards)
  values(result.id,auth.uid(),true);
  return result;
end;
$$;

-- ---------- award_game_points ----------
CREATE OR REPLACE FUNCTION public.award_game_points(target_stat_id bigint) RETURNS jsonb
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

-- ---------- get_my_practice_reward_usage ----------
CREATE OR REPLACE FUNCTION public.get_my_practice_reward_usage() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
      and (pt.created_at at time zone public.resolve_timezone(
        (select profile.timezone from public.profiles profile where profile.id=auth.uid())
      ))::date=public.player_today(auth.uid())
    group by gs.game
  )
  select jsonb_build_object(
    'date',public.player_today(auth.uid()),
    'rewarded_count',coalesce((select sum(rewarded_count) from rewarded),0),
    'daily_limit',coalesce((select practice_daily_limit from active_rule),0),
    'per_game',true,
    'by_game',coalesce((select jsonb_agg(to_jsonb(rewarded) order by game) from rewarded),'[]'::jsonb)
  )
$$;

-- ---------- get_challenge_streak_status ----------
CREATE OR REPLACE FUNCTION public.get_challenge_streak_status() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  player_zone text := public.resolve_timezone(
    (select profile.timezone from public.profiles profile where profile.id=auth.uid())
  );
  today_date date := public.player_today(uid);
  p public.player_progress;
  penalty integer := 0;
  played_today boolean := false;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode='42501';
  end if;

  perform public.ensure_player_progress(uid);

  select * into p
  from public.player_progress
  where player_id=uid
  for update;

  if p.challenge_last_completed_date is not null
    and p.challenge_last_completed_date<today_date-1
    and p.challenge_current_streak>0 then
    penalty:=public.apply_challenge_streak_break(uid,today_date-1);
    select * into p
    from public.player_progress
    where player_id=uid;
  end if;

  select exists(
    select 1
    from public.game_stats gs
    where gs.user_id=uid
      and gs.mode='challenge'
      and coalesce(
        gs.challenge_date,
        (gs.completed_at at time zone player_zone)::date
      )=today_date
  ) into played_today;

  return jsonb_build_object(
    'streak',p.challenge_current_streak,
    'longest_streak',p.challenge_longest_streak,
    'last_completed_date',p.challenge_last_completed_date,
    'played_today',played_today,
    'penalty_points',penalty,
    'at_risk',p.challenge_current_streak>0 and not played_today,
    'miss_penalty',10,
    'balance',p.available_points
  );
end;
$$;

-- ---------- protect_streak ----------
CREATE OR REPLACE FUNCTION public.protect_streak() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  p public.player_progress;
  r public.reward_rules;
  today_date date := public.player_today(auth.uid());
  missed_date date := today_date - 1;
begin
  perform public.ensure_player_progress(auth.uid());

  select * into p
  from public.player_progress
  where player_id=auth.uid()
  for update;

  select * into r
  from public.reward_rules
  where is_active=true
  order by id desc
  limit 1;

  if p.challenge_current_streak<=0
    or p.challenge_last_completed_date is distinct from missed_date-1 then
    raise exception 'No missed streak is available to protect';
  end if;
  if p.streak_protected_through is not null
    and p.streak_protected_through>=missed_date then
    raise exception 'Streak already protected';
  end if;
  if p.available_points<r.streak_protection_cost then
    raise exception 'Not enough points';
  end if;

  update public.player_progress
  set
    available_points=available_points-r.streak_protection_cost,
    streak_protected_through=missed_date,
    updated_at=now()
  where player_id=auth.uid();

  insert into public.points_transactions(
    player_id,points,reason_code,metadata,created_by
  )
  values(
    auth.uid(),
    -r.streak_protection_cost,
    'STREAK_PROTECTION',
    jsonb_build_object('protected_date',missed_date),
    auth.uid()
  );

  return jsonb_build_object(
    'balance',p.available_points-r.streak_protection_cost,
    'protected_date',missed_date
  );
end;
$$;

-- ---------- update_challenge_streak_from_game ----------
CREATE OR REPLACE FUNCTION public.update_challenge_streak_from_game() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  played_date date;
  p public.player_progress;
  next_streak integer;
begin
  if new.mode is distinct from 'challenge' then
    return new;
  end if;

  played_date := coalesce(
    new.challenge_date,
    (new.completed_at at time zone public.resolve_timezone(
      (select profile.timezone from public.profiles profile where profile.id=new.user_id)
    ))::date
  );

  perform public.ensure_player_progress(new.user_id);
  select * into p
  from public.player_progress
  where player_id = new.user_id
  for update;

  if p.challenge_last_completed_date is not null
     and p.challenge_last_completed_date < played_date - 1 then
    perform public.apply_challenge_streak_break(new.user_id, played_date - 1);
    select * into p
    from public.player_progress
    where player_id = new.user_id
    for update;
  end if;

  if p.challenge_last_completed_date = played_date then
    return new;
  elsif p.challenge_last_completed_date = played_date - 1 then
    next_streak := p.challenge_current_streak + 1;
  else
    next_streak := 1;
  end if;

  update public.player_progress
  set challenge_current_streak = next_streak,
      challenge_longest_streak = greatest(challenge_longest_streak, next_streak),
      challenge_last_completed_date = played_date,
      updated_at = now()
  where player_id = new.user_id;

  return new;
end;
$$;

-- ---------- validate_game_stat_actor ----------
CREATE OR REPLACE FUNCTION public.validate_game_stat_actor() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if new.user_id is distinct from auth.uid() then
    raise exception 'You can only save your own result.' using errcode='42501';
  end if;
  if new.circle_challenge_id is null then new.circle_id:=null; end if;

  -- seconds, hints and mistakes all arrive from the browser and drive points,
  -- benchmarks and standings. Reject the physically impossible rather than
  -- trusting the client; the bounds are deliberately wide so ordinary play is
  -- never refused.
  if new.seconds is null or new.seconds < 1 or new.seconds > 86400 then
    raise exception 'That result has an implausible time.' using errcode='22023';
  end if;
  if coalesce(new.hints,0) < 0 or coalesce(new.hints,0) > 1000
     or coalesce(new.mistakes,0) < 0 or coalesce(new.mistakes,0) > 1000 then
    raise exception 'That result has an implausible hint or mistake count.'
      using errcode='22023';
  end if;

  if new.mode='challenge' then
    -- game_stats_one_challenge_per_day is a partial unique index on
    -- (user_id, game, challenge_date). NULLs compare as distinct, so a
    -- challenge row without a date sidesteps the once-per-day rule entirely.
    if new.challenge_date is null then
      raise exception 'A challenge result must record which day it belongs to.'
        using errcode='22023';
    end if;

    -- Circle rounds are already pinned to their scheduled day by
    -- validate_circle_challenge_attempt, but the personal challenge had no
    -- date bound at all: a crafted insert could claim a week of unplayed days
    -- and the streak milestone built on them. Allow the catch-up the UI
    -- offers (any earlier day of the current week) plus a day of slack for
    -- players whose local date runs ahead of Sydney.
    if new.challenge_date < public.player_today(new.user_id) - 7
       or new.challenge_date > public.player_today(new.user_id) + 1 then
      raise exception 'Challenge results can only be saved for the current week.'
        using errcode='22023';
    end if;
  end if;

  return new;
end;
$$;

-- ---------- finalize_circle_challenge ----------
CREATE OR REPLACE FUNCTION public.finalize_circle_challenge(target_challenge_id bigint) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  challenge public.circle_weekly_challenges;
  required_rounds integer;
  member_count integer;
  finisher_count integer;
  deadline date;
  winner_id uuid;
  winner_stat_id bigint;
  winner_name text;
  circle_name text;
  award_created bigint;
  existing_winner uuid;
  winning_score integer;
begin
  select *
  into challenge
  from public.circle_weekly_challenges
  where id=target_challenge_id
  for update;

  if not found then
    return null;
  end if;

  select award.player_id
  into existing_winner
  from public.circle_challenge_reward_awards award
  where award.challenge_id=challenge.id
  order by award.awarded_at,award.id
  limit 1;

  if challenge.closed_at is not null then
    return existing_winner;
  end if;
  if existing_winner is not null then
    update public.circle_weekly_challenges
    set closed_at=coalesce(closed_at,now()),updated_at=now()
    where id=challenge.id;
    return existing_winner;
  end if;

  perform public.ensure_circle_challenge_rounds(challenge.id);

  select count(*),max(round_item.challenge_date)
  into required_rounds,deadline
  from public.circle_challenge_rounds round_item
  where round_item.challenge_id=challenge.id;

  select count(*)
  into member_count
  from public.circle_members member
  where member.circle_id=challenge.circle_id;

  select count(*)
  into finisher_count
  from public.circle_challenge_member_totals(challenge.id) totals
  where totals.rounds_played=required_rounds;

  if required_rounds=0
     or (
       public.circle_today(challenge.circle_id)<=deadline
       and (member_count=0 or finisher_count<member_count)
     ) then
    return null;
  end if;

  select totals.member_id,totals.last_stat_id,totals.challenge_score
  into winner_id,winner_stat_id,winning_score
  from public.circle_challenge_member_totals(challenge.id) totals
  where totals.rounds_played>0
  order by
    totals.challenge_score desc,
    totals.rounds_played desc,
    totals.total_hints,
    totals.total_mistakes,
    totals.adjusted_seconds,
    totals.finished_at,
    totals.member_id
  limit 1;

  if winner_id is null then
    update public.circle_weekly_challenges
    set closed_at=now(),updated_at=now()
    where id=challenge.id;
    return null;
  end if;

  insert into public.circle_challenge_reward_awards(
    challenge_id,player_id,points
  )
  values(
    challenge.id,
    winner_id,
    case when challenge.reward_type='points'
      then greatest(challenge.reward_points,0)
      else 0
    end
  )
  on conflict(challenge_id,player_id) do nothing
  returning id into award_created;

  if award_created is null then
    update public.circle_weekly_challenges
    set closed_at=coalesce(closed_at,now()),updated_at=now()
    where id=challenge.id;
    return winner_id;
  end if;

  if challenge.reward_type='points' and challenge.reward_points>0 then
    perform public.ensure_player_progress(winner_id);
    update public.player_progress
    set
      available_points=available_points+challenge.reward_points,
      lifetime_points=lifetime_points+challenge.reward_points,
      current_level=public.points_level(lifetime_points+challenge.reward_points),
      updated_at=now()
    where player_id=winner_id;
  end if;

  insert into public.points_transactions(
    player_id,points,reason_code,metadata,created_by
  )
  values(
    winner_id,
    case when challenge.reward_type='points'
      then greatest(challenge.reward_points,0)
      else 0
    end,
    'TEAM_CHALLENGE_WINNER',
    jsonb_build_object(
      'circle_id',challenge.circle_id,
      'circle_challenge_id',challenge.id,
      'week_start',challenge.week_start,
      'reward_points',case when challenge.reward_type='points'
        then greatest(challenge.reward_points,0)
        else 0
      end,
      'reward_label',case when challenge.reward_type='prize'
        then challenge.reward_label
        else null
      end
    ),
    winner_id
  );

  select coalesce(nullif(btrim(profile.name),''),'A teammate')
  into winner_name
  from public.profiles profile
  where profile.id=winner_id;

  select circle.name
  into circle_name
  from public.circles circle
  where circle.id=challenge.circle_id;

  insert into public.direct_messages(
    sender_id,recipient_id,body,system_generated,activity_type,source_stat_id
  )
  select
    winner_id,
    member.user_id,
    case
      when member.user_id=winner_id and challenge.reward_type='points' then
        format(
          '🏆 You won %s and earned the %s-point winner''s prize!',
          coalesce(challenge.title,circle_name,'the circle challenge'),
          challenge.reward_points
        )
      when member.user_id=winner_id then
        format(
          '🏆 You won %s — your prize is %s.',
          coalesce(challenge.title,circle_name,'the circle challenge'),
          challenge.reward_label
        )
      when challenge.reward_type='points' then
        format(
          '🏆 %s won %s and earned the %s-point winner''s prize.',
          winner_name,
          coalesce(challenge.title,circle_name,'the circle challenge'),
          challenge.reward_points
        )
      else
        format(
          '🏆 %s won %s — prize: %s.',
          winner_name,
          coalesce(challenge.title,circle_name,'the circle challenge'),
          challenge.reward_label
        )
    end,
    true,
    'circle_challenge_winner',
    winner_stat_id
  from public.circle_members member
  where member.circle_id=challenge.circle_id
  on conflict do nothing;

  update public.circle_weekly_challenges
  set closed_at=now(),updated_at=now()
  where id=challenge.id;

  return winner_id;
end;
$$;

-- ---------- finalize_due_circle_challenges ----------
CREATE OR REPLACE FUNCTION public.finalize_due_circle_challenges() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  due_challenge record;
  finalised_count integer:=0;
begin
  if not public.is_approved_user(auth.uid()) then
    return 0;
  end if;

  for due_challenge in
    select distinct challenge.id
    from public.circle_members membership
    join public.circle_weekly_challenges challenge
      on challenge.circle_id=membership.circle_id
    where membership.user_id=auth.uid()
      and challenge.closed_at is null
      and public.circle_today(challenge.circle_id)>(
        challenge.week_start+
        (select max(day_number)-1 from unnest(challenge.active_days) day_number)
      )
  loop
    perform public.finalize_circle_challenge(due_challenge.id);
    finalised_count:=finalised_count+1;
  end loop;

  return finalised_count;
end;
$$;

-- ---------- get_my_active_circle_challenges ----------
CREATE OR REPLACE FUNCTION public.get_my_active_circle_challenges() RETURNS TABLE(challenge_id bigint, circle_id bigint, circle_name text, circle_emoji text, challenge_title text, game_ids text[], active_days integer[], reward_points integer, reward_type text, reward_label text, active_today boolean, is_locked boolean, repeats_weekly boolean, series_weeks integer, occurrence_number integer, closes_on date, stake_reward_id bigint, stake_reward_name text, stake_split_method text, stake_accepted boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.finalize_due_circle_challenges();

  return query
  select
    challenge.id,
    circle.id,
    circle.name::text,
    coalesce(circle.emoji,'⭐')::text,
    coalesce(nullif(btrim(challenge.title),''),'Weekly challenge')::text,
    challenge.game_ids,
    challenge.active_days,
    challenge.reward_points,
    challenge.reward_type,
    challenge.reward_label,
    extract(isodow from public.circle_today(circle.id))::integer=any(challenge.active_days),
    (
      challenge.locked_at is not null
      or exists(
        select 1
        from public.circle_challenge_starts challenge_start
        where challenge_start.challenge_id=challenge.id
      )
      or exists(
        select 1
        from public.game_stats result
        where result.circle_challenge_id=challenge.id
      )
    ),
    challenge.repeats_weekly,
    challenge.series_weeks,
    challenge.occurrence_number,
    challenge.week_start+
      (select max(day_number)-1 from unnest(challenge.active_days) day_number),
    challenge.stake_reward_id,
    stake_reward.name::text,
    challenge.stake_split_method,
    exists(
      select 1 from public.circle_challenge_stake_acceptances a
      where a.challenge_id=challenge.id and a.user_id=auth.uid()
    )
  from public.circle_members membership
  join public.circles circle on circle.id=membership.circle_id
  join public.circle_weekly_challenges challenge
    on challenge.circle_id=circle.id
   and challenge.week_start=public.circle_week_start(circle.id)
  left join public.rewards stake_reward on stake_reward.id=challenge.stake_reward_id
  where membership.user_id=auth.uid()
    and public.is_approved_user(auth.uid())
    and challenge.closed_at is null
  order by circle.name,challenge.created_at,challenge.id;
end;
$$;

-- ---------- get_my_circle_challenge_lifecycle ----------
CREATE OR REPLACE FUNCTION public.get_my_circle_challenge_lifecycle() RETURNS TABLE(challenge_id bigint, member_count integer, finished_count integer, current_user_finished boolean, winner_id uuid, winner_name text, winner_icon text, awarded_at timestamp with time zone, closed_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.finalize_due_circle_challenges();

  return query
  with my_challenges as (
    select challenge.id,challenge.circle_id,challenge.game_ids,challenge.closed_at
    from public.circle_members membership
    join public.circle_weekly_challenges challenge
      on challenge.circle_id=membership.circle_id
     and challenge.week_start=public.circle_week_start(membership.circle_id)
    where membership.user_id=auth.uid()
      and public.is_approved_user(auth.uid())
  ),
  member_progress as (
    select
      challenge.id as challenge_id,
      member.user_id,
      count(distinct result.game) filter(
        where result.game=any(challenge.game_ids)
      )=cardinality(challenge.game_ids) as finished
    from my_challenges challenge
    join public.circle_members member on member.circle_id=challenge.circle_id
    left join public.game_stats result
      on result.user_id=member.user_id
     and result.circle_challenge_id=challenge.id
     and result.mode='challenge'
    group by challenge.id,challenge.game_ids,member.user_id
  )
  select
    challenge.id,
    count(progress.user_id)::integer,
    count(*) filter(where progress.finished)::integer,
    coalesce(
      bool_or(progress.finished) filter(where progress.user_id=auth.uid()),
      false
    ),
    award.player_id,
    winner.name::text,
    winner.icon::text,
    award.awarded_at,
    challenge.closed_at
  from my_challenges challenge
  join member_progress progress on progress.challenge_id=challenge.id
  left join lateral (
    select item.player_id,item.awarded_at
    from public.circle_challenge_reward_awards item
    where item.challenge_id=challenge.id
    order by item.awarded_at,item.id
    limit 1
  ) award on true
  left join public.profiles winner on winner.id=award.player_id
  group by
    challenge.id,
    challenge.closed_at,
    award.player_id,
    award.awarded_at,
    winner.name,
    winner.icon
  order by challenge.id;
end;
$$;

-- ---------- set_circle_weekly_challenge ----------
CREATE OR REPLACE FUNCTION public.set_circle_weekly_challenge(target_circle_id bigint, selected_games text[], selected_days integer[], reward_points_in integer DEFAULT 0, reward_type_in text DEFAULT 'points'::text, reward_label_in text DEFAULT NULL::text, target_challenge_id bigint DEFAULT NULL::bigint, challenge_title_in text DEFAULT NULL::text, repeat_weekly_in boolean DEFAULT NULL::boolean, duration_weeks_in integer DEFAULT NULL::integer) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  current_challenge public.circle_weekly_challenges;
  result_id bigint;
  series_key bigint;
  week_offset integer;
  clean_games text[];
  clean_days integer[];
  clean_title text:=nullif(btrim(challenge_title_in),'');
  clean_reward_type text:=coalesce(nullif(btrim(reward_type_in),''),'points');
  clean_duration integer;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not exists(
    select 1
    from public.circles
    where id=target_circle_id and created_by=auth.uid()
  ) then
    raise exception 'Only the circle owner can manage challenges.' using errcode='42501';
  end if;
  if repeat_weekly_in is null then
    raise exception 'Choose whether this challenge runs once or repeats weekly.';
  end if;

  clean_duration:=case
    when repeat_weekly_in then coalesce(duration_weeks_in,0)
    else 1
  end;

  if repeat_weekly_in and clean_duration not between 2 and 52 then
    raise exception 'Choose a repeat duration between 2 and 52 weeks.';
  end if;

  select array_agg(game order by first_position)
  into clean_games
  from (
    select game,min(selected.ordinality) as first_position
    from unnest(selected_games) with ordinality selected(game,ordinality)
    where game in ('hive','tango','gridly','minisudoku','geo','zoom')
    group by game
  ) valid_games;

  select array_agg(distinct day order by day)
  into clean_days
  from unnest(selected_days) day
  where day between 1 and 7;

  if coalesce(cardinality(clean_games),0)=0 then
    raise exception 'Choose at least one game.';
  end if;
  if coalesce(cardinality(clean_days),0)=0 then
    raise exception 'Choose at least one playing day.';
  end if;
  if clean_title is null then
    raise exception 'Enter a challenge name.';
  end if;
  if char_length(clean_title)>60 then
    raise exception 'Challenge names can be up to 60 characters.';
  end if;
  if coalesce(reward_points_in,0) not between 0 and 50 then
    raise exception 'A circle challenge winner''s prize must be between 0 and 50 points.';
  end if;
  if clean_reward_type not in ('points','prize') then
    raise exception 'Invalid reward type.';
  end if;
  if clean_reward_type='prize'
     and nullif(btrim(reward_label_in),'') is null then
    raise exception 'Enter the prize.';
  end if;

  if target_challenge_id is not null then
    select *
    into current_challenge
    from public.circle_weekly_challenges
    where id=target_challenge_id
      and circle_id=target_circle_id
      and week_start=public.circle_week_start(target_circle_id)
      and closed_at is null
    for update;

    if not found then
      raise exception 'Challenge not found.';
    end if;
    if current_challenge.locked_at is not null
       or exists(
         select 1
         from public.circle_challenge_starts
         where challenge_id=current_challenge.id
       )
       or exists(
         select 1
         from public.game_stats
         where circle_challenge_id=current_challenge.id
       ) then
      update public.circle_weekly_challenges
      set locked_at=coalesce(locked_at,now())
      where id=current_challenge.id;
      raise exception 'This challenge is already in progress and is locked.'
        using errcode='55000';
    end if;

    series_key:=coalesce(current_challenge.series_id,current_challenge.id);

    if exists(
      select 1
      from public.circle_weekly_challenges future_challenge
      where future_challenge.series_id=series_key
        and future_challenge.week_start>=public.circle_week_start(target_circle_id)
        and (
          future_challenge.locked_at is not null
          or exists(
            select 1
            from public.circle_challenge_starts future_start
            where future_start.challenge_id=future_challenge.id
          )
          or exists(
            select 1
            from public.game_stats future_result
            where future_result.circle_challenge_id=future_challenge.id
          )
        )
    ) then
      raise exception 'A scheduled week in this series has already started.'
        using errcode='55000';
    end if;

    delete from public.circle_weekly_challenges
    where series_id=series_key
      and week_start>=public.circle_week_start(target_circle_id);
  else
    series_key:=null;
  end if;

  for week_offset in 0..clean_duration-1 loop
    if (
      select count(*)
      from public.circle_weekly_challenges
      where circle_id=target_circle_id
        and week_start=public.circle_week_start(target_circle_id)+(week_offset*7)
    )>=10 then
      raise exception 'A circle can create up to 10 challenges in any week.';
    end if;

    insert into public.circle_weekly_challenges(
      circle_id,
      week_start,
      title,
      game_ids,
      active_days,
      reward_points,
      reward_type,
      reward_label,
      locked_at,
      created_by,
      series_id,
      repeats_weekly,
      series_weeks,
      occurrence_number,
      closed_at
    )
    values(
      target_circle_id,
      public.circle_week_start(target_circle_id)+(week_offset*7),
      clean_title,
      clean_games,
      clean_days,
      case when clean_reward_type='points'
        then greatest(coalesce(reward_points_in,0),0)
        else 0
      end,
      clean_reward_type,
      case when clean_reward_type='prize'
        then nullif(btrim(reward_label_in),'')
        else null
      end,
      null,
      auth.uid(),
      series_key,
      repeat_weekly_in,
      clean_duration,
      week_offset+1,
      null
    )
    returning id into result_id;

    if series_key is null then
      series_key:=result_id;
      update public.circle_weekly_challenges
      set series_id=series_key
      where id=result_id;
    end if;

    if week_offset=0 then
      target_challenge_id:=result_id;
    end if;
  end loop;

  return target_challenge_id;
end;
$$;

-- ---------- start_circle_challenge_game ----------
CREATE OR REPLACE FUNCTION public.start_circle_challenge_game(target_challenge_id bigint, target_game text, target_challenge_date date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  challenge public.circle_weekly_challenges;
  assigned_round public.circle_challenge_rounds;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.'
      using errcode='42501';
  end if;

  select *
  into challenge
  from public.circle_weekly_challenges
  where id=target_challenge_id;

  if not found then
    raise exception 'Circle challenge not found.' using errcode='22023';
  end if;
  if challenge.closed_at is not null then
    raise exception 'This circle challenge is finished.' using errcode='55000';
  end if;
  if not exists(
    select 1
    from public.circle_members member
    where member.circle_id=challenge.circle_id
      and member.user_id=auth.uid()
  ) then
    raise exception 'You are not a member of this circle.' using errcode='42501';
  end if;
  if challenge.stake_reward_id is not null and not exists(
    select 1 from public.circle_challenge_stake_acceptances a
    where a.challenge_id=challenge.id and a.user_id=auth.uid()
  ) then
    raise exception 'Accept this challenge''s stake before playing today''s round.' using errcode='42501';
  end if;
  if target_challenge_date is distinct from public.circle_today(challenge.circle_id) then
    raise exception 'Circle challenge rounds can only be played on their scheduled day.'
      using errcode='22023';
  end if;

  perform public.ensure_circle_challenge_rounds(challenge.id);

  select *
  into assigned_round
  from public.circle_challenge_rounds
  where challenge_id=challenge.id
    and challenge_date=target_challenge_date;

  if not found then
    raise exception 'This circle challenge has no round scheduled today.'
      using errcode='22023';
  end if;
  if assigned_round.game is distinct from target_game then
    raise exception 'Today''s assigned game is %.',assigned_round.game
      using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format(
        'circle-challenge-round:%s:%s:%s',
        challenge.id,
        auth.uid(),
        target_challenge_date
      ),
      0
    )
  );

  if exists(
    select 1
    from public.game_stats result
    where result.circle_challenge_id=challenge.id
      and result.user_id=auth.uid()
      and result.challenge_date=target_challenge_date
  ) then
    raise exception 'You already completed today''s challenge round.'
      using errcode='23505';
  end if;

  insert into public.circle_challenge_starts(
    challenge_id,player_id,game,challenge_date
  )
  values(
    challenge.id,auth.uid(),assigned_round.game,target_challenge_date
  )
  on conflict do nothing;

  update public.circle_weekly_challenges
  set locked_at=coalesce(locked_at,now())
  where id=challenge.id;
end;
$$;

-- ---------- reward_rules defaults realigned to the live values ----------
-- Stale defaults meant a rules row inserted without naming every column
-- silently activated a ~16x economy (base_points 100 vs 6, max 250 vs 15).
alter table public.reward_rules alter column base_points set default 6;
alter table public.reward_rules alter column no_hint_bonus set default 0;
alter table public.reward_rules alter column no_mistake_bonus set default 0;
alter table public.reward_rules alter column hint_penalty set default 2;
alter table public.reward_rules alter column mistake_penalty set default 1;
alter table public.reward_rules alter column fast_time_bonus set default 2;
alter table public.reward_rules alter column average_time_bonus set default 1;
alter table public.reward_rules alter column challenge_bonus set default 0;
alter table public.reward_rules alter column streak_daily_bonus set default 0;
alter table public.reward_rules alter column minimum_points set default 2;
alter table public.reward_rules alter column maximum_points set default 15;
alter table public.reward_rules alter column streak_protection_cost set default 20;
alter table public.reward_rules alter column streak_weekly_bonus set default 20;
alter table public.reward_rules alter column practice_points_percent set default 50;
alter table public.reward_rules alter column day_points_step set default 1;

-- ---------- grants ----------
revoke all on function public.resolve_timezone(text) from public;
revoke all on function public.player_today(uuid) from public;
revoke all on function public.circle_today(bigint) from public;
revoke all on function public.circle_week_start(bigint) from public;
revoke all on function public.set_my_timezone(text) from public;
grant execute on function public.set_my_timezone(text) to authenticated;

notify pgrst,'reload schema';

commit;
