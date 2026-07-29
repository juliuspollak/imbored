import { supabase } from "./supabase.js";
import { useSupabaseWatchedState } from "./useSupabaseWatchedState.js";

async function compute() {
  const { count, error } = await supabase
    .from("reward_redemptions")
    .select("id", { count: "exact", head: true })
    .in("status", ["requested", "disputed"]);

  if (error) {
    console.error("Unable to load open reward request count:", error.message);
    return 0;
  }
  return count || 0;
}

// For reward managers (admin or reward steward): how many requests are
// sitting in a state that needs their attention right now.
export function useOpenRewardRequestsCount(userId) {
  return useSupabaseWatchedState(userId, {
    compute,
    tables: [{ name: "reward_redemptions" }],
    channelName: `open-reward-requests-${userId}`,
    emptyValue: 0,
  });
}
