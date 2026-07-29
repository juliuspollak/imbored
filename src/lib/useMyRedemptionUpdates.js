import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";
import { attachRealtimeRefresh } from "./realtimeRefresh.js";

// "New since I last opened Reward Requests", not the total size of my
// history. The last-viewed timestamp lives in user_section_views so the
// cleared badge survives refreshes and sign-ins, matching useOpenFeedbackCount.
export function useMyRedemptionUpdates(userId) {
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
        .eq("section", "rewardrequests")
        .maybeSingle();

      if (cancelled) return;
      if (viewError) {
        console.error("Unable to load reward request notification state:", viewError.message);
        setCount(0);
        return;
      }

      let query = supabase
        .from("reward_redemptions")
        .select("id", { count: "exact", head: true })
        .eq("player_id", userId)
        .in("status", ["approved", "declined", "fulfilled"]);

      if (view?.viewed_at) {
        query = query.gt("reviewed_at", view.viewed_at);
      }

      const { count: unseenCount, error } = await query;

      if (cancelled) return;
      if (error) {
        console.error("Unable to load redemption update count:", error.message);
        setCount(0);
        return;
      }

      setCount(unseenCount || 0);
    }

    refresh();
    const detach = attachRealtimeRefresh({
      channelName: `my-redemption-updates-${userId}`,
      tables: [{ name: "reward_redemptions", filter: `player_id=eq.${userId}` }],
      refresh,
    });
    window.addEventListener("rewardrequests-section-seen", refresh);

    return () => {
      cancelled = true;
      detach();
      window.removeEventListener("rewardrequests-section-seen", refresh);
    };
  }, [userId]);

  return count;
}
