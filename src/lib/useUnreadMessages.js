import { supabase } from "./supabase.js";
import { useSupabaseWatchedState } from "./useSupabaseWatchedState.js";

const EMPTY = { total: 0, bySender: {} };

function challengeResultsConversationIsOpen() {
  if (typeof document === "undefined") return false;
  return [...document.querySelectorAll(".chat-notice")]
    .some((element) => element.textContent?.includes("Challenge results are posted here automatically"));
}

async function clearOpenChallengeResults(userId) {
  if (!challengeResultsConversationIsOpen()) return;

  const { error } = await supabase
    .from("direct_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("sender_id", userId)
    .eq("recipient_id", userId)
    .is("read_at", null);

  if (error) console.error("Unable to mark challenge results as read:", error.message);
}

async function compute(userId) {
  // Challenge results are a special self-conversation. Chat.jsx currently
  // displays a limited message window, so an unread result outside that window
  // cannot be cleared by updating only the IDs that were loaded. When that
  // conversation is visibly open, clear the whole conversation first.
  await clearOpenChallengeResults(userId);

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
