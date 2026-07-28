import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";

export default function ChallengeStreakBadge() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!supabaseReady) return;
      const { data: authData } = await supabase.auth.getUser();
      if (!authData?.user || cancelled) return;
      const { data, error } = await supabase.rpc("get_challenge_streak_status");
      if (!error && !cancelled) setStatus(data);
    }

    load();
    const refresh = () => load();
    window.addEventListener("focus", refresh);
    window.addEventListener("challenge-streak-refresh", refresh);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("challenge-streak-refresh", refresh);
    };
  }, []);

  if (!status) return null;

  const streak = Number(status.streak || 0);
  const atRisk = Boolean(status.at_risk);
  const playedToday = Boolean(status.played_today);
  const penalty = Number(status.penalty_points || 0);

  // The streak number itself is already shown next to the points pill; this
  // badge only needs to add the status context the pill has no room for.
  return (
    <div className={`challenge-streak-badge ${playedToday ? "is-safe" : atRisk ? "is-risk" : ""}`} aria-live="polite">
      <span className="challenge-streak-icon" aria-hidden="true">
        <Flame size={18} fill="currentColor" />
      </span>
      <span className="challenge-streak-copy">
        <small>
          {penalty > 0
            ? `${penalty} points lost — start again today`
            : playedToday
              ? "Safe for today"
              : streak > 0
                ? "Play a challenge today or lose 50 points"
                : "Complete a challenge to start"}
        </small>
      </span>
    </div>
  );
}
