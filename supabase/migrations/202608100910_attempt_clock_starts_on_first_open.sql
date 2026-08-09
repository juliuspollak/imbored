-- Leaving a challenge mid-game and re-entering handed out a brand new clock.
--
-- The puzzle seed is deterministic (game + date), so re-entering serves the
-- identical board. A player could open a round, study it with the clock
-- discarded, press Home, come back and solve it instantly at a near-perfect
-- time. Personal challenges and score challenges recorded nothing at all;
-- circle rounds did record a start, but nothing ever read it back.
--
-- The clock now starts the first time a round is opened and keeps running.
-- Nothing is forfeited for leaving — you simply cannot rewind the stopwatch,
-- so quitting gains you nothing and an accidental exit still leaves a
-- playable, scoring attempt.
--
-- Client-reported seconds remain client-reported; this closes the in-app
-- exploit, not a forged request. The attempt key is still assembled server
-- side so it cannot be varied freely to mint fresh clocks.

create table if not exists public.challenge_attempt_starts (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.profiles(id) on delete cascade,
  attempt_key text not null,
  started_at timestamp with time zone default now() not null
);

create unique index if not exists challenge_attempt_starts_unique
  on public.challenge_attempt_starts (player_id, attempt_key);

alter table public.challenge_attempt_starts enable row level security;

drop policy if exists "players view their own attempt starts"
  on public.challenge_attempt_starts;
create policy "players view their own attempt starts"
  on public.challenge_attempt_starts
  for select to authenticated
  using (player_id = auth.uid() or public.is_admin(auth.uid()));

-- Returns when this attempt's clock started: now for a first open, or the
-- original timestamp for every re-entry after that.
create or replace function public.begin_challenge_attempt(
  target_game text,
  target_challenge_date date default null,
  target_circle_challenge_id bigint default null,
  target_score_challenge_id bigint default null
) returns timestamp with time zone
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  key text;
  existing timestamp with time zone;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if coalesce(btrim(target_game),'')='' then
    raise exception 'A game is required to start an attempt.' using errcode='22023';
  end if;

  key := case
    when target_score_challenge_id is not null
      then format('score:%s', target_score_challenge_id)
    when target_circle_challenge_id is not null
      then format('circle:%s:%s:%s', target_circle_challenge_id, target_game, target_challenge_date)
    else format('personal:%s:%s', target_game, target_challenge_date)
  end;

  insert into public.challenge_attempt_starts(player_id, attempt_key)
  values (auth.uid(), key)
  on conflict (player_id, attempt_key) do nothing;

  select item.started_at into existing
  from public.challenge_attempt_starts item
  where item.player_id=auth.uid() and item.attempt_key=key;

  return existing;
end;
$$;

grant execute on function public.begin_challenge_attempt(text, date, bigint, bigint) to authenticated;

-- A reset has to clear these too, otherwise a player mid-attempt at reset time
-- resumes the fresh economy with a clock that has been running since before
-- the wipe. Folded into the existing reset rather than added as a second
-- button an admin has to remember.
CREATE OR REPLACE FUNCTION public.admin_reset_all_stats(confirmation text, target_player uuid DEFAULT NULL::uuid, reset_benchmarks boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  removed_results integer:=0;
  removed_transactions integer:=0;
  reopened_challenges integer:=0;
  reset_players integer:=0;
  global_reset boolean:=target_player is null;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  if confirmation is distinct from 'RESET ALL STATS' then
    raise exception 'Pass the exact confirmation phrase to reset statistics.'
      using errcode='22023';
  end if;

  -- One reset at a time; concurrent runs would race the progress rebuild.
  perform pg_advisory_xact_lock(hashtextextended('admin-reset-all-stats',0));

  delete from public.points_transactions
  where global_reset or player_id=target_player;
  get diagnostics removed_transactions=row_count;

  delete from public.challenge_reset_point_credits
  where global_reset or player_id=target_player;

  -- score_challenges cascades from game_stats, but recipients of a challenge
  -- someone else created still need clearing when resetting one player.
  delete from public.score_challenge_recipients
  where global_reset or recipient_id=target_player;

  delete from public.circle_challenge_starts
  where global_reset or player_id=target_player;

  -- Stale "X won the challenge" announcements would otherwise survive the
  -- reset. Only system-generated notices are touched; real conversations stay.
  delete from public.direct_messages
  where system_generated=true
    and activity_type in (
      'circle_challenge_winner','team_challenge_winner',
      'team_challenge_completed','score_challenge','score_challenge_result'
    )
    and (global_reset or recipient_id=target_player);

  delete from public.game_stats
  where global_reset or user_id=target_player;
  get diagnostics removed_results=row_count;

  -- Otherwise a player who was mid-attempt at reset time resumes with a clock
  -- that has been running since before the wipe.
  delete from public.challenge_attempt_starts
  where global_reset or player_id=target_player;

  update public.player_progress set
    available_points=0, lifetime_points=0, current_level=1,
    current_streak=0, longest_streak=0, last_completed_date=null,
    streak_protected_through=null,
    challenge_current_streak=0, challenge_longest_streak=0,
    challenge_last_completed_date=null, challenge_penalty_for_date=null,
    updated_at=now()
  where global_reset or player_id=target_player;
  get diagnostics reset_players=row_count;

  if global_reset then
    -- Every award belongs to a challenge, so this clears the lot. Both
    -- statements in this branch carry a real predicate on purpose: Supabase
    -- runs with safe updates on, which rejects an unqualified DELETE or UPDATE
    -- outright, and that aborted the whole reset before it deleted anything.
    delete from public.circle_challenge_reward_awards
    where challenge_id in (select item.id from public.circle_weekly_challenges item);

    update public.circle_weekly_challenges
    set closed_at=null, updated_at=now()
    where closed_at is not null;
    get diagnostics reopened_challenges=row_count;

    if reset_benchmarks then
      -- Test results would otherwise stay baked into the community medians and
      -- keep skewing every score after the reset. Only rows that actually
      -- drifted from provisional need touching.
      update public.game_time_benchmarks set
        observed_median_seconds=null,
        clean_sample_count=0,
        effective_seconds=provisional_seconds,
        updated_at=now()-interval '1 day'
      where observed_median_seconds is not null
        or clean_sample_count<>0
        or effective_seconds is distinct from provisional_seconds;
    end if;
  end if;

  return jsonb_build_object(
    'scope', case when global_reset then 'all players' else 'single player' end,
    'target_player', target_player,
    'results_removed', removed_results,
    'transactions_removed', removed_transactions,
    'players_reset', reset_players,
    'challenges_reopened', reopened_challenges,
    'benchmarks_reset', global_reset and reset_benchmarks
  );
end;
$$;
