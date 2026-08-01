import { supabase, supabaseReady } from "./supabase.js";
import { useSupabaseWatchedState } from "./useSupabaseWatchedState.js";

const storageKey = (userId) => `hive-seen-closed-feedback-${userId}`;

// Corrupted or unexpectedly-shaped localStorage data (manual edits, a future
// schema change, a partial write) shouldn't throw and break the read/write
// cycle — worst case we just forget which feedback items were already seen.
function readSeenIds(userId) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(userId)) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function markClosedFeedbackSeen(userId, ids) {
  if (!userId || typeof window === "undefined") return;
  const seen = readSeenIds(userId);
  ids.forEach((id) => seen.add(id));
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify([...seen]));
  } catch {
    // Storage full/unavailable — non-fatal, just means it may resurface next time.
  }
  window.dispatchEvent(new CustomEvent("closed-feedback-seen"));
  if (supabaseReady) {
    supabase.rpc("mark_my_feedback_seen").then(({ error }) => {
      if (error) console.error("Unable to mark completed feedback seen:", error.message);
    });
  }
}

async function compute(userId) {
  const { data, error } = await supabase
    .from("feedback")
    .select("id,user_seen_at")
    .eq("user_id", userId)
    .eq("status", "closed");

  if (error) {
    console.error("Unable to load completed feedback notifications:", error.message);
    return 0;
  }
  return (data || []).filter((item) => !item.user_seen_at).length;
}

export function useCompletedFeedbackCount(userId) {
  return useSupabaseWatchedState(userId, {
    compute,
    tables: [{ name: "feedback", filter: `user_id=eq.${userId}` }],
    channelName: `completed-feedback-${userId}`,
    seenEvent: "closed-feedback-seen",
    emptyValue: 0,
  });
}
