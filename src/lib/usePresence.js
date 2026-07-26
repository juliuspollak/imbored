import { useEffect, useRef } from "react";
import { supabase, supabaseReady } from "./supabase.js";
import { useAuth } from "./AuthContext.jsx";

// Presence writes are serialised. When privacy changes, the delete is queued
// after every older heartbeat and future queued writes re-check the latest
// privacy value before touching the database.
export function usePresence(game, mode, incognito = null) {
  const { user, profile } = useAuth();
  const presenceValueRef = useRef({ game, mode });
  const offlineRef = useRef(true);
  const writeQueueRef = useRef(Promise.resolve());
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
  // Unknown startup state is deliberately offline.
  const isOffline = !!isPrivate || incognito !== false;
  offlineRef.current = isOffline;

  function enqueue(task) {
    writeQueueRef.current = writeQueueRef.current
      .catch(() => undefined)
      .then(task);
    return writeQueueRef.current;
  }

  function enqueueBeat() {
    if (!supabaseReady || !userId || !canWritePresence || offlineRef.current) return;
    enqueue(async () => {
      if (offlineRef.current) return;
      const current = presenceValueRef.current;
      const { error } = await supabase.from("presence").upsert({
        user_id: userId,
        game: current.game,
        mode: current.game ? current.mode : null,
        last_seen: new Date().toISOString(),
      });
      if (error && error.code !== "42501") {
        console.warn("Unable to update presence:", error.message);
      }
    });
  }

  useEffect(() => {
    if (!supabaseReady || !userId || !hasProfile) return;

    if (isOffline) {
      // This delete runs after any request already in flight. The database
      // migration also hides incognito rows and blocks stale clients from
      // recreating them, so a failed delete cannot reveal the player.
      enqueue(async () => {
        const { error } = await supabase.from("presence").delete().eq("user_id", userId);
        if (error && error.code !== "42501") {
          console.warn("Unable to clear incognito presence:", error.message);
        }
      });
      return;
    }

    enqueueBeat();
  }, [game, mode, userId, hasProfile, canWritePresence, isOffline]);

  useEffect(() => {
    if (!supabaseReady || !userId || !hasProfile || isOffline || !canWritePresence) return;

    let cancelled = false;
    let lastActivityAt = Date.now();
    let lastBeatAt = 0;
    const beat = () => {
      if (
        cancelled ||
        offlineRef.current ||
        document.visibilityState !== "visible" ||
        Date.now() - lastActivityAt > 120000
      ) return;
      lastBeatAt = Date.now();
      enqueueBeat();
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
  }, [userId, isOffline, canWritePresence, hasProfile]);
}
