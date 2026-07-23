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
        .select("user_id, game, mode, last_seen, profiles(name, icon, mood, is_private, hidden_from_others)")
        .gte("last_seen", cutoff);
      // For a regular player, RLS already blocks the embedded profile for
      // anyone hidden (it comes back null) or private, so `row.profiles`
      // being falsy is enough on its own. But an ADMIN's RLS lets them see
      // hidden profiles too (so admins can manage them), which means for an
      // admin `row.profiles` is NOT null for a hidden player — so this
      // widget, a casual "who's online / poke someone" feature rather than
      // an admin tool, must also explicitly filter hidden_from_others,
      // or a hidden player shows up (and becomes pokeable) for admins.
      const visible = (data || []).filter((row) => row.profiles && !row.profiles.is_private && !row.profiles.hidden_from_others);
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
