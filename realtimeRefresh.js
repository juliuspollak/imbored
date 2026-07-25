import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";

function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Completion badges are scoped. A personal completion must never mark the
// same game complete in Team A or Team B.
export function useTodayCompletions(userId, challengeScope = { type: "personal" }) {
  const [completed, setCompleted] = useState(new Set());

  useEffect(() => {
    if (!supabaseReady || !userId) { setCompleted(new Set()); return; }
    let cancelled = false;
    let query = supabase
      .from("game_stats")
      .select("game")
      .eq("user_id", userId)
      .eq("mode", "challenge")
      .eq("challenge_date", todayString());
    query = challengeScope?.type === "team"
      ? query.eq("team_challenge_id", challengeScope.id)
      : query.is("team_challenge_id", null);
    query.then(({ data }) => {
      if (!cancelled) setCompleted(new Set((data || []).map((r) => r.game)));
    });
    return () => { cancelled = true; };
  }, [userId, challengeScope?.type, challengeScope?.id]);

  return completed;
}
