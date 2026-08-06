-- Pending schema changes. Apply once in Supabase Dashboard -> SQL Editor.
--
-- Everything here is CREATE OR REPLACE, so re-running is harmless. Extracted
-- verbatim from supabase/schemas/public.sql.
--
-- 1. can_continue_conversation / get_messageable_players /
--    get_unread_message_counts — one shared rule for "conversations I can
--    still open", so the unread badge can never outnumber the conversations
--    Chats is able to list and clear.
-- 2. admin_reset_all_stats    — global stat reset for test rounds, driven
--    from Admin -> Games -> Maintenance.
-- 3. get_my_played_score_challenges — re-applied for completeness; harmless
--    if it is already present.
-- 4. user_approval_required   — "X is waiting for approval" was delivered as a
--    chat message from the pending player, which Chats can never display, so
--    the chat badge stuck on 1 forever. Moved to Admin -> Players.
-- 5. retire_unavailable_player_messages — banning a player now retires their
--    unread messages, the way deleting an account already did.

begin;

-- ---------- 1. chats: keep existing conversations reachable ----------
-- One rule, used by both the Chats list and the unread badge, so the badge can
-- never count a notification with no conversation available to clear it.
--
-- Discovery (who Find people may offer) and continuity (whose existing
-- conversation you may reopen) are different questions. is_private,
-- is_blocked and is_approved answer the first; putting them in the where
-- clause made them answer the second too, which is what stranded the badges.

CREATE OR REPLACE FUNCTION public.can_continue_conversation(viewer_id uuid, peer_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select viewer_id is not null
    and peer_id is not null
    and (
      peer_id=viewer_id
      or (
        exists(
          select 1
          from public.profiles peer
          where peer.id=peer_id
            and peer.account_deleted_at is null
            and coalesce(peer.hidden_from_others,false)=false
        )
        and not public.is_blocked_between(viewer_id,peer_id)
      )
    );
$$;

revoke all on function public.can_continue_conversation(uuid, uuid) from public;
grant execute on function public.can_continue_conversation(uuid, uuid) to authenticated;

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
        (
          profile.is_admin=true
          or public.players_share_circle(auth.uid(),profile.id)
        )
        and coalesce(profile.is_blocked,false)=false
        and (profile.is_admin=true or coalesce(profile.is_approved,false)=true)
        and (
          coalesce(profile.is_private,false)=false
          or public.is_admin(auth.uid())
        )
      ) as can_message,
      exists(
        select 1
        from public.direct_messages message
        where (message.sender_id=auth.uid() and message.recipient_id=profile.id)
           or (message.sender_id=profile.id and message.recipient_id=auth.uid())
      ) as has_history
    from public.profiles profile
    where profile.id<>auth.uid()
      and public.can_continue_conversation(auth.uid(),profile.id)
  )
  select candidate.id,candidate.name,candidate.icon,candidate.mood,
         candidate.is_admin,candidate.can_message
  from candidate
  where candidate.can_message or candidate.has_history
  order by candidate.name
$$;

revoke all on function public.get_messageable_players() from public;
grant execute on function public.get_messageable_players() to authenticated;

-- SECURITY INVOKER on purpose: the direct_messages select policy still applies,
-- so this counts exactly what the client could read itself, narrowed to
-- conversations Chats can open.
CREATE OR REPLACE FUNCTION public.get_unread_message_counts() RETURNS TABLE(peer_id uuid, unread_count integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select message.sender_id, count(*)::integer
  from public.direct_messages message
  where message.recipient_id=auth.uid()
    and message.read_at is null
    and public.can_continue_conversation(auth.uid(),message.sender_id)
  group by message.sender_id
$$;

revoke all on function public.get_unread_message_counts() from public;
grant execute on function public.get_unread_message_counts() to authenticated;

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

-- ---------- 4. approval notices move to Admin -> Players ----------
-- The trigger announced a pending player to every admin as a direct message
-- whose sender_id was that pending player. get_messageable_players excludes
-- anyone with is_approved=false, so Chats.jsx filtered the conversation out of
-- the list while useUnreadMessages still counted the unread row: a chat badge
-- of 1 with nothing to open and no way to clear it. Admin -> Players already
-- lists everyone waiting for approval, so that is where the signal belongs.

drop trigger if exists profiles_notify_admins_of_pending_profile on public.profiles;
drop function if exists public.notify_admins_of_pending_profile();
drop index if exists public.direct_messages_pending_approval_once_idx;

-- Clears the notices that are already stuck in admins' badges.
delete from public.direct_messages where activity_type='user_approval_required';

-- ---------- 5. retire a banned player's unread messages ----------
-- Deleting an account and banning a player are both permanent, so neither may
-- leave unread notifications in someone's badge. A player blocking another
-- player is deliberately excluded: that is reversible, and the direct_messages
-- select policy already hides those rows both ways.
--
-- Marked read rather than deleted — content_reports references these rows, so
-- removing them would destroy the evidence behind a moderation report.

drop trigger if exists profiles_retire_deleted_player_messages on public.profiles;
drop function if exists public.retire_deleted_player_messages();

CREATE OR REPLACE FUNCTION public.retire_unavailable_player_messages() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if (old.account_deleted_at is null and new.account_deleted_at is not null)
     or (coalesce(old.is_blocked,false)=false and coalesce(new.is_blocked,false)=true) then
    update public.direct_messages
    set read_at=coalesce(read_at,now())
    where sender_id=new.id and read_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_retire_unavailable_player_messages on public.profiles;
create trigger profiles_retire_unavailable_player_messages
after update of account_deleted_at, is_blocked on public.profiles
for each row execute function public.retire_unavailable_player_messages();

-- Catch up anyone banned or deleted before the trigger covered it.
update public.direct_messages
set read_at=coalesce(read_at,now())
where read_at is null
  and sender_id in (
    select id from public.profiles
    where coalesce(is_blocked,false)=true or account_deleted_at is not null
  );

notify pgrst,'reload schema';

commit;
