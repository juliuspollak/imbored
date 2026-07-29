import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";
import { attachRealtimeRefresh } from "./realtimeRefresh.js";

// "New pending circle invitations since I last opened Circles" — mirrors
// useOpenFeedbackCount's pattern, with the last-viewed timestamp in
// user_section_views so the cleared badge survives refreshes and sign-ins.
export function usePendingCircleInvitationCount(userId) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!supabaseReady || !userId) {
      setCount(0);
      return undefined;
    }

    let cancelled = false;

    async function refresh() {
      const { data: view, error: viewError } = await supabase
        .from("user_section_views")
        .select("viewed_at")
        .eq("user_id", userId)
        .eq("section", "guardiancircles")
        .maybeSingle();

      if (cancelled) return;
      if (viewError) {
        console.error("Unable to load circle invitation notification state:", viewError.message);
        setCount(0);
        return;
      }

      let query = supabase
        .from("guardian_circle_invitations")
        .select("id", { count: "exact", head: true })
        .eq("invited_user_id", userId)
        .eq("status", "pending");

      if (view?.viewed_at) {
        query = query.gt("created_at", view.viewed_at);
      }

      const { count: unseenCount, error } = await query;

      if (cancelled) return;
      if (error) {
        console.error("Unable to load pending circle invitation count:", error.message);
        setCount(0);
        return;
      }

      setCount(unseenCount || 0);
    }

    refresh();
    const detach = attachRealtimeRefresh({
      channelName: `circle-invitations-${userId}`,
      tables: [{ name: "guardian_circle_invitations", filter: `invited_user_id=eq.${userId}` }],
      refresh,
    });
    window.addEventListener("guardiancircles-section-seen", refresh);

    return () => {
      cancelled = true;
      detach();
      window.removeEventListener("guardiancircles-section-seen", refresh);
    };
  }, [userId]);

  return count;
}
