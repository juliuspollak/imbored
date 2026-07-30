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
    emptyValue: 0,
  });
}
