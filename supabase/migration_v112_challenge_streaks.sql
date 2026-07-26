-- V112: Daily challenge streaks with an idempotent missed-day penalty.
-- A challenge streak advances once per Sydney calendar day when the player
-- completes at least one challenge-mode game. Missing a day breaks the streak
-- and removes up to 50 available points exactly once for that break.
begin;

alter table public.player_progress
  add column if not exists challenge_current_streak integer not null default 0,
  add column if not exists challenge_longest_streak integer not null default 0,
  add column if not exists challenge_last_completed_date date,
  add column if not exists challenge_penalty_for_date date;

create index if not exists game_stats_challenge_streak_lookup
  on public.game_stats(user_id, challenge_date desc)
  where mode = 'challenge';

create or replace function public.apply_challenge_streak_break(
  target_player_id uuid,
  missed_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.player_progress;
  penalty integer := 0;
begin
  perform public.ensure_player_progress(target_player_id);
  select * into p
  from public.player_progress
  where player_id = target_player_id
  for update;

  if p.challenge_current_streak <= 0
     or p.challenge_penalty_for_date is not distinct from missed_date then
    return 0;
  end if;

  penalty := least(50, greatest(0, p.available_points)::integer);

  update public.player_progress
  set available_points = available_points - penalty,
      challenge_current_streak = 0,
      challenge_penalty_for_date = missed_date,
      updated_at = now()
  where player_id = target_player_id;

  if penalty > 0 then
    insert into public.points_transactions(
      player_id, points, reason_code, metadata, created_by
    ) values (
      target_player_id,
      -penalty,
      'CHALLENGE_STREAK_BROKEN',
      jsonb_build_object('missed_date', missed_date, 'penalty', penalty),
      target_player_id
    );
  end if;

  return penalty;
end;
$$;

revoke all on function public.apply_challenge_streak_break(uuid,date) from public;

create or replace function public.update_challenge_streak_from_game()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    (new.completed_at at time zone 'Australia/Sydney')::date
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

drop trigger if exists game_stats_update_challenge_streak on public.game_stats;
create trigger game_stats_update_challenge_streak
after insert on public.game_stats
for each row
when (new.mode = 'challenge')
execute function public.update_challenge_streak_from_game();

create or replace function public.get_challenge_streak_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today_date date := (now() at time zone 'Australia/Sydney')::date;
  p public.player_progress;
  penalty integer := 0;
  played_today boolean := false;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  perform public.ensure_player_progress(uid);
  select * into p
  from public.player_progress
  where player_id = uid
  for update;

  if p.challenge_last_completed_date is not null
     and p.challenge_last_completed_date < today_date - 1
     and p.challenge_current_streak > 0 then
    penalty := public.apply_challenge_streak_break(uid, today_date - 1);
    select * into p
    from public.player_progress
    where player_id = uid;
  end if;

  select exists(
    select 1
    from public.game_stats gs
    where gs.user_id = uid
      and gs.mode = 'challenge'
      and coalesce(gs.challenge_date, (gs.completed_at at time zone 'Australia/Sydney')::date) = today_date
  ) into played_today;

  return jsonb_build_object(
    'streak', p.challenge_current_streak,
    'longest_streak', p.challenge_longest_streak,
    'last_completed_date', p.challenge_last_completed_date,
    'played_today', played_today,
    'penalty_points', penalty,
    'at_risk', p.challenge_current_streak > 0 and not played_today,
    'miss_penalty', 50,
    'balance', p.available_points
  );
end;
$$;

revoke all on function public.get_challenge_streak_status() from public;
grant execute on function public.get_challenge_streak_status() to authenticated;

commit;
