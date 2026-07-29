import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";
import { attachRealtimeRefresh } from "./realtimeRefresh.js";

// Shared shape behind every "watch a Supabase table for changes relevant to
// this user" hook: fetch once, resubscribe to realtime changes, optionally
// re-fetch on a same-tab "seen" event, and reset to emptyValue when
// disabled/signed out. `compute(userId)` does the actual query.
export function useSupabaseWatchedState(userId, { compute, tables, channelName, seenEvent, emptyValue }) {
  const [value, setValue] = useState(emptyValue);

  useEffect(() => {
    if (!supabaseReady || !userId) {
      setValue(emptyValue);
      return undefined;
    }

    let cancelled = false;

    async function refresh() {
      const result = await compute(userId);
      if (!cancelled) setValue(result);
    }

    refresh();
    const detach = attachRealtimeRefresh({ channelName, tables, refresh });
    if (seenEvent) window.addEventListener(seenEvent, refresh);

    return () => {
      cancelled = true;
      detach();
      if (seenEvent) window.removeEventListener(seenEvent, refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return value;
}

// "New since I last opened <section>" hooks share this lookup against
// user_section_views. Returns {error} on failure so callers can bail out the
// same way the inline queries used to (skip the follow-up query, count 0).
export async function getSectionViewedAt(userId, section) {
  const { data, error } = await supabase
    .from("user_section_views")
    .select("viewed_at")
    .eq("user_id", userId)
    .eq("section", section)
    .maybeSingle();

  if (error) {
    console.error(`Unable to load ${section} notification state:`, error.message);
    return { error };
  }
  return { viewedAt: data?.viewed_at };
}
