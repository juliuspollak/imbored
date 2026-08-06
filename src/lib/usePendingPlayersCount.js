import { supabase } from "./supabase.js";
import { useSupabaseWatchedState } from "./useSupabaseWatchedState.js";

// Players waiting for approval, counted the same way AdminPlayers.jsx builds
// its "Waiting for approval" section, so the badge always matches the number
// of cards an admin finds when they get there.
//
// This replaces the old user_approval_required chat message. That notice was
// sent *from* the pending player, and a pending player is excluded from
// get_messageable_players, so the conversation never appeared in Chats while
// the unread badge still counted it — a permanently stuck chat badge.
async function compute() {
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("is_admin", false)
    .eq("is_approved", false)
    // Declining a player blocks them, which settles the decision. Without
    // this the badge would keep counting players the admin already turned
    // down, since a block leaves is_approved false.
    .eq("is_blocked", false)
    .is("account_deleted_at", null);

  if (error) {
    console.error("Unable to load pending players count:", error.message);
    return 0;
  }
  return count || 0;
}

export function usePendingPlayersCount(userId) {
  return useSupabaseWatchedState(userId, {
    compute,
    tables: [{ name: "profiles" }],
    channelName: `pending-players-${userId}`,
    emptyValue: 0,
  });
}
