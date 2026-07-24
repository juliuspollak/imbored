import { useEffect, useRef } from "react";
import { supabase, supabaseReady } from "./supabase.js";
import { useAuth } from "./AuthContext.jsx";

// Call with the game id ('queens' | 'tango' | 'zip' | 'minisudoku') while
// that game's screen is mounted, or null while just browsing elsewhere.
// Writes a heartbeat while the player is actually active. A visible tab with
// no interaction goes quiet after two minutes, so leaving the app open does
// not create endless database traffic or make someone look online forever.
//
// Deliberately does NOT delete the row when a screen unmounts or the tab
// closes — it just stops updating. That's what makes "last seen" possible:
// the row's last_seen timestamp is left in place as a record of when they
// were last around, rather than vanishing the moment they close the tab.
// A private profile is the one exception — going private clears any
// existing row immediately, since privacy means not being tracked at all.
export function usePresence(game, mode) {
  const { user, profile } = useAuth();
  const presenceValueRef = useRef({ game, mode });
  presenceValueRef.current = { game, mode };
  const isPrivate = profile?.is_private;
  const userId = user?.id;
  const hasProfile = !!profile;
  const canWritePresence =
    !!userId &&
    !!profile &&
    !profile.account_deleted_at &&
    !profile.is_blocked &&
    (profile.is_admin || profile.is_approved !== false);

  useEffect(() => {
    if (!supabaseReady || !userId || !hasProfile) return;

    if (isPrivate) {
      supabase.from("presence").delete().eq("user_id", userId).then();
      return;
    }

    // Presence writes are protected by the approved-user trigger. Do not
    // repeatedly send requests for incomplete, blocked or deleted profiles:
    // those writes are correctly rejected with 403 and can otherwise keep a
    // stale/deleted Auth session busy while the app is trying to sign it out.
    if (!canWritePresence) return;

    let cancelled = false;
    let lastActivityAt = Date.now();
    let lastBeatAt = 0;
    const beat = () => {
      if (
        cancelled
        || document.visibilityState !== "visible"
        || Date.now() - lastActivityAt > 120000
      ) return;
      lastBeatAt = Date.now();
      const current = presenceValueRef.current;
      supabase
        .from("presence")
        .upsert({
          user_id: userId,
          game: current.game,
          mode: current.game ? current.mode : null,
          last_seen: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (error && error.code !== "42501") console.warn("Unable to update presence:", error.message);
        });
    };
    const noteActivity = () => {
      const wasIdle = Date.now() - lastActivityAt > 120000;
      lastActivityAt = Date.now();
      if (wasIdle || Date.now() - lastBeatAt > 45000) beat();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        lastActivityAt = Date.now();
        beat();
      }
    };

    beat();
    const interval = setInterval(beat, 45000);
    document.addEventListener("pointerdown", noteActivity, { passive: true });
    document.addEventListener("keydown", noteActivity);
    document.addEventListener("touchstart", noteActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("pointerdown", noteActivity);
      document.removeEventListener("keydown", noteActivity);
      document.removeEventListener("touchstart", noteActivity);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [userId, isPrivate, canWritePresence, hasProfile]);
}
