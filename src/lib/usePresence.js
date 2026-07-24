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
export function usePresence(game, mode) {
  const { user, profile } = useAuth();
  const isPrivate = profile?.is_private;
  const canWritePresence =
    !!user &&
    !!profile &&
    !profile.account_deleted_at &&
    !profile.is_blocked &&
    (profile.is_admin || profile.is_approved !== false);

  useEffect(() => {
    if (!supabaseReady || !user || !profile) return;

    if (isPrivate) {
      supabase.from("presence").delete().eq("user_id", user.id).then();
      return;
    }

    // Presence writes are protected by the approved-user trigger. Do not
    // repeatedly send requests for incomplete, blocked or deleted profiles:
    // those writes are correctly rejected with 403 and can otherwise keep a
    // stale/deleted Auth session busy while the app is trying to sign it out.
    if (!canWritePresence) return;

    let cancelled = false;
    const beat = () => {
      if (cancelled) return;
      supabase
        .from("presence")
        .upsert({ user_id: user.id, game, mode: game ? mode : null, last_seen: new Date().toISOString() })
        .then(({ error }) => {
          if (error && error.code !== "42501") console.warn("Unable to update presence:", error.message);
        });
    };

    beat();
    const interval = setInterval(beat, 20000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [game, mode, user, profile, isPrivate, canWritePresence]);
}
