import { useEffect } from "react";
import { supabase, supabaseReady } from "./supabase.js";
import { useAuth } from "./AuthContext.jsx";

// Call with the game id ('queens' | 'tango' | 'zip' | 'minisudoku') while
// that game's screen is mounted, or null while just browsing elsewhere.
// Writes a heartbeat every 20s so a "currently playing" query can treat
// anyone seen in the last ~45s as online.
//
// Deliberately does NOT delete the row when a screen unmounts or the tab
// closes — it just stops updating. That's what makes "last seen" possible:
// the row's last_seen timestamp is left in place as a record of when they
// were last around, rather than vanishing the moment they close the tab.
// A private profile is the one exception — going private clears any
// existing row immediately, since privacy means not being tracked at all.
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

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [game, user, isPrivate]);
}
