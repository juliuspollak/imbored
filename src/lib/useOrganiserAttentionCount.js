import { supabase } from "./supabase.js";
import { useSupabaseWatchedState } from "./useSupabaseWatchedState.js";

async function compute() {
  const { data, error } = await supabase.rpc("get_organiser_attention_count");
  if (error) {
    console.error("Unable to load organiser attention count:", error.message);
    return 0;
  }
  return data || 0;
}

// New ideas awaiting a decision, plus active rewards with a cancellation
// request waiting on the organiser - the two things get_organiser_new_ideas
// and get_organiser_active_rewards actually need a tap on.
export function useOrganiserAttentionCount(userId) {
  return useSupabaseWatchedState(userId, {
    compute,
    tables: [{ name: "rewards" }, { name: "reward_redemptions" }],
    channelName: `organiser-attention-${userId}`,
    // Realtime is eventually consistent and can arrive after the organiser
    // page has already refreshed following a same-tab action. The page emits
    // this event after its write so the menu badge is recalculated at once.
    seenEvent: "organiser-attention-changed",
    // null distinguishes "not loaded yet" from a real zero. AccountBadge uses
    // that distinction to avoid overwriting a persisted acknowledgement while
    // the first count request is still in flight after a page refresh.
    emptyValue: null,
  });
}
