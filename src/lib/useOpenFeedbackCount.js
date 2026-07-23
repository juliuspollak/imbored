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
      const { data, error } = await supabase
        .from("feedback")
        .select("id")
        .eq("status", "open");

      if (cancelled) return;

      if (error) {
        console.error("Unable to load open feedback count:", error.message);
        setCount(0);
        return;
      }

      setCount(data?.length || 0);
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
