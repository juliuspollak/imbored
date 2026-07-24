import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";

export function useOpenFeedbackCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!supabaseReady) {
      setCount(0);
      return undefined;
    }

    let cancelled = false;

    async function poll() {
      const { count: openCount, error } = await supabase
        .from("feedback")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .is("deleted_at", null);

      if (cancelled) return;

      if (error) {
        console.error("Unable to load open feedback count:", error.message);
        setCount(0);
        return;
      }

      setCount(openCount || 0);
    }

    poll();
    const interval = window.setInterval(poll, 20000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return count;
}
