import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";

export function useUnreadMessages(userId) {
  const [state, setState] = useState({ total: 0, bySender: {} });

  useEffect(() => {
    if (!supabaseReady || !userId) {
      setState({ total: 0, bySender: {} });
      return;
    }

    let cancelled = false;

    async function refresh() {
      const { data, error } = await supabase
        .from("direct_messages")
        .select("sender_id")
        .eq("recipient_id", userId)
        .is("read_at", null);

      if (error) {
        // The migration may not have been run yet. Keep the app usable and
        // avoid repeatedly surfacing a schema error in the main UI.
        if (!cancelled) setState({ total: 0, bySender: {} });
        return;
      }

      const bySender = {};
      for (const row of data || []) {
        bySender[row.sender_id] = (bySender[row.sender_id] || 0) + 1;
      }
      if (!cancelled) setState({ total: data?.length || 0, bySender });
    }

    refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userId]);

  return state;
}
