import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";

// Admin feedback notifications are "new since I last opened Feedback", not the
// total size of the open queue. The last-viewed timestamp is stored in
// user_section_views so the cleared badge survives refreshes and sign-ins.
export function useOpenFeedbackCount(userId) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!supabaseReady || !userId) {
      setCount(0);
      return undefined;
    }

    let cancelled = false;

    async function poll() {
      const { data: view, error: viewError } = await supabase
        .from("user_section_views")
        .select("viewed_at")
        .eq("user_id", userId)
        .eq("section", "feedback")
        .maybeSingle();

      if (cancelled) return;
      if (viewError) {
        console.error("Unable to load feedback notification state:", viewError.message);
        setCount(0);
        return;
      }

      let query = supabase
        .from("feedback")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .is("deleted_at", null);

      // Count a newly submitted ticket or an open ticket edited after the
      // admin last visited the Feedback page.
      if (view?.viewed_at) {
        query = query.or(`created_at.gt.${view.viewed_at},updated_at.gt.${view.viewed_at}`);
      }

      const { count: unseenCount, error } = await query;

      if (cancelled) return;
      if (error) {
        console.error("Unable to load new feedback count:", error.message);
        setCount(0);
        return;
      }

      setCount(unseenCount || 0);
    }

    poll();
    const interval = window.setInterval(poll, 20000);
    window.addEventListener("feedback-section-seen", poll);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("feedback-section-seen", poll);
    };
  }, [userId]);

  return count;
}
