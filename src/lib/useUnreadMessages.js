import { supabase } from "./supabase.js";
import { useSupabaseWatchedState } from "./useSupabaseWatchedState.js";

const EMPTY = { total: 0, bySender: {} };

// The badge counts whatever get_unread_message_counts returns, and nothing
// else. That function and get_messageable_players — which decides the
// conversations Chats.jsx lists — both narrow by can_continue_conversation, so
// the badge cannot outnumber the conversations available to clear it.
//
// Reachability used to be re-derived here from a separate profiles query. It
// never filtered anything (the direct_messages select policy already excludes
// unreadable senders) while a notification from a private or banned player
// stayed counted with no conversation to open, so the badge stuck forever.
async function compute() {
  const { data, error } = await supabase.rpc("get_unread_message_counts");

  if (error) {
    console.error("Unable to load unread message counts:", error.message);
    return EMPTY;
  }

  const bySender = {};
  let total = 0;
  for (const row of data || []) {
    const count = Number(row.unread_count) || 0;
    if (!row.peer_id || count <= 0) continue;
    bySender[row.peer_id] = count;
    total += count;
  }

  return { total, bySender };
}

export function useUnreadMessages(userId) {
  return useSupabaseWatchedState(userId, {
    compute,
    // profiles is watched too: banning a player retires their unread messages,
    // and that must drop the badge without waiting for the fallback poll.
    tables: [{ name: "direct_messages" }, { name: "profiles" }],
    channelName: `unread-messages-${userId}`,
    seenEvent: "imbored-messages-read",
    // Mobile Safari can suspend or miss realtime UPDATE events. While the app
    // is visible, briefly re-check so a successfully read conversation cannot
    // leave a stale badge behind indefinitely.
    fallbackMs: 1500,
    emptyValue: EMPTY,
  });
}
