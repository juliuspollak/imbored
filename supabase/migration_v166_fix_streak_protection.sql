-- v166: Reconnect streak protection to the streak system that's actually live.
--
-- v112 (later superseded by v137) moved challenge-streak tracking onto new
-- columns: challenge_current_streak / challenge_last_completed_date. The
-- older protect_streak() function (from the original rewards-progression
-- migration) was never updated - it still reads/writes the original
-- current_streak / last_completed_date columns, which the active scoring
-- function (public.award_game_points, as of v137) never touches again. Those
-- columns are frozen at whatever they were the last time the old scoring
-- function ran, so a player's real, current streak state has nothing to do
-- with whether the "Protect your streak" button appeared or whether calling
-- it would succeed - it was comparing today's date to a stale, unrelated
-- value. On top of that, apply_challenge_streak_break() (the function that
-- actually breaks a streak today) never checked streak_protected_through at
-- all, so even a successful protect_streak() call wouldn't have stopped the
-- real streak from breaking anyway.
--
-- This migrates protect_streak() onto the live columns, and makes
-- apply_challenge_streak_break() respect protection by bridging the missed
-- day (advancing challenge_last_completed_date to the protected day, leaving
-- the streak count untouched) instead of breaking it, so the streak
-- continues normally the next time a challenge is played.

begin;

create or replace function public.apply_challenge_streak_break(
  target_player_id uuid,
  missed_date date
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  p public.player_progress;
  penalty integer := 0;
begin
  perform public.ensure_player_progress(target_player_id);

  select * into p
  from public.player_progress
  where player_id=target_player_id
  for update;

  if p.challenge_current_streak<=0
    or p.challenge_penalty_for_date is not distinct from missed_date then
    return 0;
  end if;

  if p.streak_protected_through is not null
    and p.streak_protected_through>=missed_date then
    -- Paid to protect this exact missed day: bridge the gap so the streak
    -- continues normally on the next challenge play, without penalising or
    -- resetting it.
    update public.player_progress
    set challenge_last_completed_date=missed_date,
        challenge_penalty_for_date=missed_date,
        updated_at=now()
    where player_id=target_player_id;
    return 0;
  end if;

  penalty:=least(10,greatest(0,p.available_points)::integer);

  update public.player_progress
  set
    available_points=available_points-penalty,
    challenge_current_streak=0,
    challenge_penalty_for_date=missed_date,
    updated_at=now()
  where player_id=target_player_id;

  if penalty>0 then
    insert into public.points_transactions(
      player_id,points,reason_code,metadata,created_by
    )
    values(
      target_player_id,
      -penalty,
      'CHALLENGE_STREAK_BROKEN',
      jsonb_build_object('missed_date',missed_date,'penalty',penalty),
      target_player_id
    );
  end if;

  return penalty;
end;
$$;

revoke all on function public.apply_challenge_streak_break(uuid,date) from public;

create or replace function public.protect_streak()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  p public.player_progress;
  r public.reward_rules;
  today_date date := (now() at time zone 'Australia/Sydney')::date;
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

revoke all on function public.protect_streak() from public;
grant execute on function public.protect_streak() to authenticated;

notify pgrst,'reload schema';

commit;
