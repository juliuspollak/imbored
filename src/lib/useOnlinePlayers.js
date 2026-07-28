import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";
import { attachRealtimeRefresh } from "./realtimeRefresh.js";
import { filterVisibleOnlinePlayers } from "./onlinePlayers.js";

// Allow two heartbeat intervals plus normal network jitter before someone
// drops out of the online list.
const ONLINE_WINDOW_MS = 105000;

export function useOnlinePlayers() {
  const [players, setPlayers] = useState([]);

  useEffect(() => {
    if (!supabaseReady) return;
    let cancelled = false;

    async function poll() {
      const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
      const { data } = await supabase
        .from("presence")
        .select("user_id, game, mode, last_seen, profiles(name, icon, mood, is_private, hidden_from_others)")
        .gte("last_seen", cutoff);
      const visible = filterVisibleOnlinePlayers(data);
      if (!cancelled) setPlayers(visible);
    }

    poll();
    const detach = attachRealtimeRefresh({
      channelName: "online-players-public",
      tables: [],
      refresh: poll,
      fallbackMs: 60000,
    });
    return () => {
      cancelled = true;
      detach();
    };
  }, []);

  return players;
}
