import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";

// Tracks the highest points_transactions.id the player has "seen" (i.e. has
// opened My Progress since receiving it). Mirrors the pattern already used
// for feedback notifications in useCompletedFeedbackCount.js — client-side
// localStorage rather than a server-side read receipt, so it's per-device
// but needs no migration.
const storageKey = (userId) => `queens-seen-transfer-id-${userId}`;

function getLastSeenId(userId) {
  if (typeof window === "undefined") return 0;
  try {
    const n = Number(window.localStorage.getItem(storageKey(userId)));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

// Exposed so callers (My Progress) can work out which received transfers are
// new *before* marking them seen, so the "New!" banner can list exactly the
// ones the player hasn't looked at yet.
export function getLastSeenTransferId(userId) {
  return getLastSeenId(userId);
}

// Call once the player has viewed their received transfers (My Progress
// does this on load). `uptoId` should be the highest transaction id shown.
export function markTransfersSeen(userId, uptoId) {
  if (!userId || typeof window === "undefined" || !uptoId) return;
  try {
    if (uptoId > getLastSeenId(userId)) {
      window.localStorage.setItem(storageKey(userId), String(uptoId));
    }
  } catch {
    // Storage full/unavailable — non-fatal, the badge just won't clear this time.
  }
  window.dispatchEvent(new CustomEvent("points-transfers-seen"));
}

// Polls for points the player has received via transfer since they last
// opened My Progress. Powers the notification badge under the account
// bubble and on the "My progress" menu item.
export function useNewTransfersCount(userId) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!supabaseReady || !userId) {
      setCount(0);
      return undefined;
    }

    let cancelled = false;

    async function poll() {
      const lastSeen = getLastSeenId(userId);
      const { data, error } = await supabase
        .from("points_transactions")
        .select("id")
        .eq("player_id", userId)
        .eq("reason_code", "TRANSFER_RECEIVED")
        .gt("id", lastSeen);

      if (cancelled) return;
      if (error) {
        console.error("Unable to load new point transfers:", error.message);
        setCount(0);
        return;
      }
      setCount(data?.length || 0);
    }

    poll();
    const interval = window.setInterval(poll, 15000);
    window.addEventListener("points-transfers-seen", poll);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("points-transfers-seen", poll);
    };
  }, [userId]);

  return count;
}
