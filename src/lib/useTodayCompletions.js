import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";

function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Which games (by id) the current user has already completed today's
// challenge for — used to show a "played" badge on the home screen
// without needing to open each game to check.
export function useTodayCompletions(userId) {
  const [completed, setCompleted] = useState(new Set());

  useEffect(() => {
    if (!supabaseReady || !userId) return;
    let cancelled = false;
    supabase
      .from("game_stats")
      .select("game")
      .eq("user_id", userId)
      .eq("mode", "challenge")
      .eq("challenge_date", todayString())
      .then(({ data }) => {
        if (!cancelled) setCompleted(new Set((data || []).map((r) => r.game)));
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return completed;
}
