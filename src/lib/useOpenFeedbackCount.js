import { supabase } from "./supabase.js";
import { useSupabaseWatchedState, getSectionViewedAt } from "./useSupabaseWatchedState.js";

// Admin feedback notifications are "new since I last opened Feedback", not the
// total size of the open queue. The last-viewed timestamp is stored in
// user_section_views so the cleared badge survives refreshes and sign-ins.
async function compute(userId) {
  const view = await getSectionViewedAt(userId, "feedback");
  if (view.error) return 0;

  let query = supabase
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")
    .is("deleted_at", null);

  // Count a newly submitted ticket or an open ticket edited after the
  // admin last visited the Feedback page.
  if (view.viewedAt) {
    query = query.or(`created_at.gt.${view.viewedAt},updated_at.gt.${view.viewedAt}`);
  }

  const { count, error } = await query;
  if (error) {
    console.error("Unable to load new feedback count:", error.message);
    return 0;
  }
  return count || 0;
}

export function useOpenFeedbackCount(userId) {
  return useSupabaseWatchedState(userId, {
    compute,
    tables: [{ name: "feedback" }],
    channelName: `open-feedback-${userId}`,
    seenEvent: "feedback-section-seen",
    emptyValue: 0,
  });
}
