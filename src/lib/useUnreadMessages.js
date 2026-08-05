import { supabase } from "./supabase.js";
import { useSupabaseWatchedState } from "./useSupabaseWatchedState.js";

const EMPTY = { total: 0, bySender: {} };

async function compute(userId) {
  const { data, error } = await supabase
    .from("direct_messages")
    .select("sender_id")
    .eq("recipient_id", userId)
    .is("read_at", null);

  if (error) {
    // The migration may not have been run yet. Keep the app usable and
    // avoid repeatedly surfacing a schema error in the main UI.
    return EMPTY;
  }

  const bySender = {};
  for (const row of data || []) {
    bySender[row.sender_id] = (bySender[row.sender_id] || 0) + 1;
  }
  return { total: data?.length || 0, bySender };
}

export function useUnreadMessages(userId) {
  return useSupabaseWatchedState(userId, {
    compute,
    tables: [{ name: "direct_messages" }],
    channelName: `unread-messages-${userId}`,
    seenEvent: "imbored-messages-read",
    // Mobile Safari can suspend or miss realtime UPDATE events. While the app
    // is visible, briefly re-check so a successfully read conversation cannot
    // leave a stale badge behind indefinitely.
    fallbackMs: 1500,
    emptyValue: EMPTY,
  });
}
