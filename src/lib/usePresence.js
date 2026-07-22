import { useEffect } from "react";
import { supabase, supabaseReady } from "./supabase.js";
import { useAuth } from "./AuthContext.jsx";

// Call with the game id ('queens' | 'tango' | 'zip') while that game's
// screen is mounted, or null while just browsing the home page. Writes a
// heartbeat every 20s so a "currently playing" query can treat anyone seen
// in the last ~45s as online, and removes the row when the screen unmounts
// or the tab closes. A private profile writes nothing at all — not hidden
// after the fact, simply never recorded — and if privacy gets toggled on
// mid-session, any existing row is cleared immediately.
export function usePresence(game) {
  const { user, profile } = useAuth();
  const isPrivate = profile?.is_private;

  useEffect(() => {
    if (!supabaseReady || !user) return;

    if (isPrivate) {
      supabase.from("presence").delete().eq("user_id", user.id).then();
      return;
    }

    let cancelled = false;
    const beat = () => {
      if (cancelled) return;
      supabase.from("presence").upsert({ user_id: user.id, game, last_seen: new Date().toISOString() }).then();
    };

    beat();
    const interval = setInterval(beat, 20000);

    function clear() {
      supabase.from("presence").delete().eq("user_id", user.id).then();
    }
    window.addEventListener("beforeunload", clear);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("beforeunload", clear);
      clear();
    };
  }, [game, user, isPrivate]);
}
