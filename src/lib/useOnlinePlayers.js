import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";

// Anyone whose last heartbeat (see usePresence) was within this window
// counts as "currently online" — a little more than the 20s heartbeat
// interval so a slightly-delayed beat doesn't flicker someone offline.
const ONLINE_WINDOW_MS = 45000;

export function useOnlinePlayers() {
  const [players, setPlayers] = useState([]);

  useEffect(() => {
    if (!supabaseReady) return;
    let cancelled = false;

    async function poll() {
      const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
      const { data } = await supabase
        .from("presence")
        .select("user_id, game, mode, last_seen, profiles(name, icon, mood, is_private)")
        .gte("last_seen", cutoff);
      // usePresence already skips writing for private profiles; a null
      // embedded profile here means RLS blocked it (a player an admin has
      // hidden from everyone else) — either way, don't show the row.
      const visible = (data || []).filter((row) => row.profiles && !row.profiles.is_private);
      if (!cancelled) setPlayers(visible);
    }

    poll();
    const interval = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return players;
}
