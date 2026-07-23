import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";

const storageKey = (userId) => `queens-seen-closed-feedback-${userId}`;

// Corrupted or unexpectedly-shaped localStorage data (manual edits, a future
// schema change, a partial write) shouldn't throw and break the read/write
// cycle — worst case we just forget which feedback items were already seen.
function readSeenIds(userId) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(userId)) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function markClosedFeedbackSeen(userId, ids) {
  if (!userId || typeof window === "undefined") return;
  const seen = readSeenIds(userId);
  ids.forEach((id) => seen.add(id));
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify([...seen]));
  } catch {
    // Storage full/unavailable — non-fatal, just means it may resurface next time.
  }
  window.dispatchEvent(new CustomEvent("closed-feedback-seen"));
}

export function useCompletedFeedbackCount(userId) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!supabaseReady || !userId) {
      setCount(0);
      return undefined;
    }

    let cancelled = false;

    async function poll() {
      const { data, error } = await supabase
        .from("feedback")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "closed");

      if (cancelled) return;
      if (error) {
        console.error("Unable to load completed feedback notifications:", error.message);
        setCount(0);
        return;
      }

      const seen = readSeenIds(userId);
      setCount((data || []).filter((item) => !seen.has(item.id)).length);
    }

    poll();
    const interval = window.setInterval(poll, 15000);
    window.addEventListener("closed-feedback-seen", poll);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("closed-feedback-seen", poll);
    };
  }, [userId]);

  return count;
}
