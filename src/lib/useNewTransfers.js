import { supabase } from "./supabase.js";
import { useSupabaseWatchedState } from "./useSupabaseWatchedState.js";

async function compute(userId) {
  const { count, error } = await supabase
    .from("points_transactions")
    .select("id", { count: "exact", head: true })
    .eq("player_id", userId)
    .eq("reason_code", "TRANSFER_RECEIVED")
    .is("seen_at", null);

  if (error) {
    console.error("Unable to load new point transfers:", error.message);
    return 0;
  }
  return count || 0;
}

export function useNewTransfersCount(userId) {
  return useSupabaseWatchedState(userId, {
    compute,
    tables: [{ name: "points_transactions", filter: `player_id=eq.${userId}` }],
    channelName: `point-transfers-${userId}`,
    seenEvent: "points-transfers-seen",
    emptyValue: 0,
  });
}

export async function markTransfersSeen() {
  const result = await supabase.rpc("mark_my_transfers_seen");
  window.dispatchEvent(new CustomEvent("points-transfers-seen"));
  return result;
}
