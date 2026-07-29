import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";
import { attachRealtimeRefresh } from "./realtimeRefresh.js";

// For reward managers (admin or reward steward): how many requests are
// sitting in a state that needs their attention right now.
export function useOpenRewardRequestsCount(userId) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!supabaseReady || !userId) {
      setCount(0);
      return undefined;
    }

    let cancelled = false;

    async function refresh() {
      const { count: openCount, error } = await supabase
        .from("reward_redemptions")
        .select("id", { count: "exact", head: true })
        .in("status", ["requested", "disputed"]);

      if (cancelled) return;
      if (error) {
        console.error("Unable to load open reward request count:", error.message);
        setCount(0);
        return;
      }

      setCount(openCount || 0);
    }

    refresh();
    const detach = attachRealtimeRefresh({
      channelName: `open-reward-requests-${userId}`,
      tables: [{ name: "reward_redemptions" }],
      refresh,
    });

    return () => {
      cancelled = true;
      detach();
    };
  }, [userId]);

  return count;
}
