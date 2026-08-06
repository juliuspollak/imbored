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
    return EMPTY;
  }

  const unreadRows = data || [];
  const otherSenderIds = [...new Set(
    unreadRows
      .map((row) => row.sender_id)
      .filter((senderId) => senderId && senderId !== userId)
  )];

  // The chats screen can only display conversations whose sender profile is
  // still readable. Previously an unread row from a deleted, blocked or hidden
  // account was counted here but filtered out of Chats.jsx, creating a badge
  // that the player had no conversation available to open and clear.
  let reachableSenders = new Set([userId]);
  if (otherSenderIds.length > 0) {
    const { data: visibleProfiles, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .in("id", otherSenderIds);

    if (profileError) {
      // Do not hide legitimate notifications if profile lookup temporarily
      // fails. The next watched refresh will try again.
      reachableSenders = new Set([userId, ...otherSenderIds]);
    } else {
      reachableSenders = new Set([userId, ...(visibleProfiles || []).map((profile) => profile.id)]);
    }
  }

  const bySender = {};
  for (const row of unreadRows) {
    if (!reachableSenders.has(row.sender_id)) continue;
    bySender[row.sender_id] = (bySender[row.sender_id] || 0) + 1;
  }

  return {
    total: Object.values(bySender).reduce((sum, count) => sum + count, 0),
    bySender,
  };
}

export function useUnreadMessages(userId) {
  return useSupabaseWatchedState(userId, {
    compute,
    tables: [{ name: "direct_messages" }, { name: "profiles" }],
    channelName: `unread-messages-${userId}`,
    seenEvent: "imbored-messages-read",
    fallbackMs: 1500,
    emptyValue: EMPTY,
  });
}
