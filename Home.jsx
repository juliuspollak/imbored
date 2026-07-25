import { supabase } from "./supabase.js";

let lastPageActivityAt = Date.now();
let activityListenersReady = false;

function ensureActivityListeners() {
  if (activityListenersReady || typeof document === "undefined") return;
  activityListenersReady = true;
  const noteActivity = () => { lastPageActivityAt = Date.now(); };
  document.addEventListener("pointerdown", noteActivity, { passive: true });
  document.addEventListener("keydown", noteActivity);
  document.addEventListener("touchstart", noteActivity, { passive: true });
}

// Realtime is the primary update path. A deliberately slow fallback covers
// temporary websocket interruptions without returning to aggressive polling.
export function attachRealtimeRefresh({
  channelName,
  tables,
  refresh,
  fallbackMs = 120000,
  visibleRefreshAgeMs = 30000,
}) {
  ensureActivityListeners();
  let lastRefreshAt = Date.now();
  const requestRefresh = () => {
    lastRefreshAt = Date.now();
    return refresh();
  };
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
        requestRefresh,
      );
    }
    channel.subscribe();
  }

  const refreshWhenVisible = (force = false) => {
    if (
      document.visibilityState === "visible"
      && Date.now() - lastRefreshAt >= visibleRefreshAgeMs
      && (force || Date.now() - lastPageActivityAt <= 120000)
    ) {
      requestRefresh();
    }
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      lastPageActivityAt = Date.now();
      refreshWhenVisible(true);
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  const fallback = window.setInterval(() => refreshWhenVisible(false), fallbackMs);

  return () => {
    window.clearInterval(fallback);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (channel) void supabase.removeChannel(channel);
  };
}
