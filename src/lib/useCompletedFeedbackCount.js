import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";

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
        .eq("status", "closed")
        .is("user_seen_at", null);

      if (cancelled) return;

      if (error) {
        console.error("Unable to load completed feedback notifications:", error.message);
        setCount(0);
        return;
      }

      setCount(data?.length || 0);
    }

    poll();
    const interval = window.setInterval(poll, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [userId]);

  return count;
}
