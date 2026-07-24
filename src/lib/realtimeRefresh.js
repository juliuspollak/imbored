import { supabase } from "./supabase.js";

// Realtime is the primary update path. A deliberately slow fallback covers
// temporary websocket interruptions without returning to aggressive polling.
export function attachRealtimeRefresh({
  channelName,
  tables,
  refresh,
  fallbackMs = 120000,
}) {
  const channel = tables.length > 0 ? supabase.channel(channelName) : null;
  if (channel) {
    for (const table of tables) {
      channel.on(
        "postgres_changes",
        {
          event: table.event || "*",
          schema: "public",
          table: table.name,
          ...(table.filter ? { filter: table.filter } : {}),
        },
        refresh,
      );
    }
    channel.subscribe();
  }

  const refreshWhenVisible = () => {
    if (document.visibilityState === "visible") refresh();
  };
  document.addEventListener("visibilitychange", refreshWhenVisible);
  window.addEventListener("focus", refreshWhenVisible);
  const fallback = window.setInterval(refreshWhenVisible, fallbackMs);

  return () => {
    window.clearInterval(fallback);
    document.removeEventListener("visibilitychange", refreshWhenVisible);
    window.removeEventListener("focus", refreshWhenVisible);
    if (channel) void supabase.removeChannel(channel);
  };
}
