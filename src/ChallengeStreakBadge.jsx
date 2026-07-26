import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";

export default function ChallengeStreakBadge() {
  const [status, setStatus] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let observer;

    function detectHome() {
      const onHome = !!document.querySelector(".home-tile");
      if (!cancelled) setVisible(onHome);
    }

    async function load() {
      if (!supabaseReady) return;
      const { data: authData } = await supabase.auth.getUser();
      if (!authData?.user || cancelled) return;
      const { data, error } = await supabase.rpc("get_challenge_streak_status");
      if (!error && !cancelled) setStatus(data);
    }

    detectHome();
    observer = new MutationObserver(detectHome);
    observer.observe(document.body, { childList: true, subtree: true });
    load();

    const refresh = () => load();
    window.addEventListener("focus", refresh);
    window.addEventListener("challenge-streak-refresh", refresh);

    return () => {
      cancelled = true;
      observer?.disconnect();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("challenge-streak-refresh", refresh);
    };
  }, []);

  if (!visible || !status) return null;

  const streak = Number(status.streak || 0);
  const atRisk = Boolean(status.at_risk);
  const playedToday = Boolean(status.played_today);
  const penalty = Number(status.penalty_points || 0);

  return (
    <div className="challenge-streak-float" aria-live="polite">
      <div className={`challenge-streak-badge ${playedToday ? "is-safe" : atRisk ? "is-risk" : ""}`}>
        <span className="challenge-streak-icon" aria-hidden="true">
          <Flame size={18} fill="currentColor" />
          <span className="challenge-streak-count">{streak}</span>
        </span>
        <span className="challenge-streak-copy">
          <strong>{streak === 1 ? "1 day streak" : `${streak} day streak`}</strong>
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
      <style>{`
        .challenge-streak-float{position:fixed;left:50%;top:72px;z-index:70;transform:translateX(-50%);width:min(calc(100vw - 32px),360px);pointer-events:none}
        .challenge-streak-badge{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:18px;background:rgba(255,255,255,.94);border:1px solid rgba(16,24,40,.10);box-shadow:0 10px 30px rgba(16,24,40,.13);backdrop-filter:blur(18px);color:#1b2129}
        .challenge-streak-icon{position:relative;display:grid;place-items:center;width:38px;height:38px;flex:0 0 auto;border-radius:14px;background:linear-gradient(145deg,#ffdf89,#ff7a45);color:#9b2f16;box-shadow:inset 0 1px 0 rgba(255,255,255,.5)}
        .challenge-streak-count{position:absolute;right:-5px;bottom:-5px;display:grid;place-items:center;min-width:19px;height:19px;padding:0 4px;border-radius:999px;background:#e5484d;color:white;border:2px solid white;font-size:9px;font-weight:900}
        .challenge-streak-copy{display:flex;min-width:0;flex-direction:column;line-height:1.15}
        .challenge-streak-copy strong{font-size:12px;font-weight:800}
        .challenge-streak-copy small{margin-top:3px;font-size:10px;color:rgba(27,33,41,.55)}
        .challenge-streak-badge.is-safe .challenge-streak-count{background:#159669}
        .challenge-streak-badge.is-risk{border-color:rgba(229,72,77,.28);box-shadow:0 10px 30px rgba(229,72,77,.16)}
        @media (max-width:520px){.challenge-streak-float{top:68px}.challenge-streak-badge{padding:8px 10px}.challenge-streak-copy strong{font-size:11px}}
        @media (prefers-color-scheme:dark){
          .challenge-streak-badge{background:rgba(24,31,43,.94);border-color:rgba(255,255,255,.12);color:#f4f7fb;box-shadow:0 14px 34px rgba(0,0,0,.46)}
          .challenge-streak-copy small{color:rgba(232,238,247,.62)}
          .challenge-streak-count{border-color:#18202b}
          .challenge-streak-badge.is-risk{border-color:rgba(255,111,115,.34)}
        }
      `}</style>
    </div>
  );
}
