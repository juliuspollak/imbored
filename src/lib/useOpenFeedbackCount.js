import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";

export function useOpenFeedbackCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!supabaseReady) return;
    let cancelled = false;

    async function poll() {
      const { count: c } = await supabase.from("feedback").select("id", { count: "exact", head: true }).eq("status", "open");
      if (!cancelled) setCount(c || 0);
    }

    poll();
    const interval = setInterval(poll, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return count;
}
