import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";

export function useCompletedFeedbackCount(userId) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!supabaseReady || !userId) return;
    let cancelled = false;
    async function poll() {
      const { count: c } = await supabase
        .from("feedback")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "closed")
        .is("user_seen_at", null);
      if (!cancelled) setCount(c || 0);
    }
    poll();
    const interval = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [userId]);

  return count;
}
