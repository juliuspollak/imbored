-- Pending schema changes. Apply once in Supabase Dashboard -> SQL Editor.
--
-- Everything here is CREATE OR REPLACE, so re-running is harmless. Extracted
-- verbatim from supabase/schemas/public.sql.
--
-- 1. get_messageable_players  — chats: conversations with people you no
--    longer share a circle with were hidden while the unread badge still
--    counted them, so the badge lit up with nothing to open.
-- 2. admin_reset_all_stats    — global stat reset for test rounds, driven
--    from Admin -> Games -> Maintenance.
-- 3. get_my_played_score_challenges — re-applied for completeness; harmless
--    if it is already present.

begin;

-- ---------- 1. chats: keep existing conversations reachable ----------
-- Return type gains a column, so the old function must go first:
-- CREATE OR REPLACE cannot change a function signature.
drop function if exists public.get_messageable_players();

CREATE OR REPLACE FUNCTION public.get_messageable_players() RETURNS TABLE(id uuid, name text, icon text, mood text, is_admin boolean, can_message boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with candidate as (
    select
      profile.id,
      profile.name::text as name,
      profile.icon::text as icon,
      profile.mood::text as mood,
      profile.is_admin,
      (
        profile.is_admin=true
        or public.players_share_circle(auth.uid(),profile.id)
      ) as can_message,
      exists(
        select 1
        from public.direct_messages message
        where (message.sender_id=auth.uid() and message.recipient_id=profile.id)
           or (message.sender_id=profile.id and message.recipient_id=auth.uid())
      ) as has_history
    from public.profiles profile
    where profile.id<>auth.uid()
      and profile.account_deleted_at is null
      and coalesce(profile.is_blocked,false)=false
      and coalesce(profile.hidden_from_others,false)=false
      and (profile.is_admin=true or coalesce(profile.is_approved,false)=true)
      and (
        coalesce(profile.is_private,false)=false
        or public.is_admin(auth.uid())
      )
      and not public.is_blocked_between(auth.uid(),profile.id)
  )
  select candidate.id,candidate.name,candidate.icon,candidate.mood,
         candidate.is_admin,candidate.can_message
  from candidate
  where candidate.can_message or candidate.has_history
  order by candidate.name
$$;

revoke all on function public.get_messageable_players() from public;
grant execute on function public.get_messageable_players() to authenticated;

-- ---------- 2. global stat reset ----------
-- Refuses anyone who is not an administrator, and refuses the call outright
-- unless the exact confirmation phrase is passed. The UI types the phrase in;
-- this check is what actually makes it safe.

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
-- Granted to authenticated because PostgREST calls RPCs as the signed-in
-- role; the is_admin() check inside the function is the real gate.
grant execute on function public.admin_reset_all_stats(text, uuid, boolean) to authenticated;

-- ---------- 3. score challenge played lookup ----------

CREATE OR REPLACE FUNCTION public.get_my_played_score_challenges(source_stat_ids bigint[]) RETURNS TABLE(source_stat_id bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select challenge.source_stat_id
  from public.score_challenges challenge
  join public.score_challenge_recipients recipient
    on recipient.challenge_id=challenge.id
  where recipient.recipient_id=auth.uid()
    and recipient.completed_stat_id is not null
    and challenge.source_stat_id=any(source_stat_ids)
$$;

revoke all on function public.get_my_played_score_challenges(bigint[]) from public;
grant execute on function public.get_my_played_score_challenges(bigint[]) to authenticated;

notify pgrst,'reload schema';

commit;
