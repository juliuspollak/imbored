import { supabase } from "./supabase.js";
import { useSupabaseWatchedState, getSectionViewedAt } from "./useSupabaseWatchedState.js";

// "New since I last opened Reward Requests", not the total size of my
// history. The last-viewed timestamp lives in user_section_views so the
// cleared badge survives refreshes and sign-ins, matching useOpenFeedbackCount.
async function compute(userId) {
  const view = await getSectionViewedAt(userId, "rewardrequests");
  if (view.error) return 0;

  let query = supabase
    .from("reward_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("player_id", userId)
    .in("status", ["approved", "declined", "fulfilled"]);

  if (view.viewedAt) {
    query = query.gt("reviewed_at", view.viewedAt);
  }

  const { count, error } = await query;
  if (error) {
    console.error("Unable to load redemption update count:", error.message);
    return 0;
  }
  return count || 0;
}

export function useMyRedemptionUpdates(userId) {
  return useSupabaseWatchedState(userId, {
    compute,
    tables: [{ name: "reward_redemptions", filter: `player_id=eq.${userId}` }],
    channelName: `my-redemption-updates-${userId}`,
    seenEvent: "rewardrequests-section-seen",
    emptyValue: 0,
  });
}
