-- Global stat reset for test rounds.
--
-- Clears results, the points ledger, progress, challenge starts and score
-- challenges. Leaves accounts, circles, reward items and configuration alone.
--
-- Unrecoverable, so it is guarded three ways: administrators only, an exact
-- confirmation phrase, and an advisory lock so two runs cannot race.

begin;

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
    delete from public.circle_challenge_reward_awards;

    update public.circle_weekly_challenges
    set closed_at=null, updated_at=now()
    where closed_at is not null;
    get diagnostics reopened_challenges=row_count;

    if reset_benchmarks then
      -- Test results would otherwise stay baked into the community medians and
      -- keep skewing every score after the reset.
      update public.game_time_benchmarks set
        observed_median_seconds=null,
        clean_sample_count=0,
        effective_seconds=provisional_seconds,
        updated_at=now()-interval '1 day';
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

revoke all on function public.admin_reset_all_stats(text, uuid, boolean) from public;
grant execute on function public.admin_reset_all_stats(text, uuid, boolean) to authenticated;

notify pgrst,'reload schema';

commit;
