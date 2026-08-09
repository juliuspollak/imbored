-- "Reset everything" aborted with a missing-WHERE error and reset nothing.
--
-- Supabase runs with safe updates enabled, which rejects any UPDATE or DELETE
-- that has no WHERE clause. Two statements inside admin_reset_all_stats() were
-- unqualified — clearing the reward awards, and returning the time benchmarks
-- to provisional. The first one raised, the transaction rolled back, and the
-- reset silently accomplished nothing. Plain Postgres allows both, which is
-- why this survived until the button was actually pressed against Supabase.
--
-- Both now carry a genuine predicate. Neither can be optimised away into an
-- unqualified statement again:
--
--   * every award references a challenge, so filtering on that subquery still
--     clears all of them;
--   * benchmarks only need rewriting where they have drifted from provisional,
--     which is both a real filter and less work.

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
