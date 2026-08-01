import DifficultyRating, { DifficultyRatingBadge } from "./DifficultyRating.jsx";
import { rewardStatusText } from "./lib/rewardStatus.js";
import { rateDifficulty } from "./lib/saveStats.js";
import { useI18n } from "./lib/i18n.jsx";
import { useEffect, useMemo, useState } from "react";
import { CircleCheckBig, Swords } from "lucide-react";
import { supabase, supabaseReady } from "./lib/supabase.js";
import "./game-solved-panel.css";

// Shared "you solved it" panel for every puzzle game. Each game used to hand-roll
// this block with its own inline colours, which is why dark mode only ever got
// fixed for whichever game someone happened to be working on at the time (Gridly).
// One component + one stylesheet means a contrast fix here reaches every game.
//
// It also owns the bits every caller used to repeat verbatim: the
// solved-and-not-yet-rated visibility guard, and rating a puzzle (always
// `rateDifficulty(savedStatId, value)` - there was never a game-specific
// version of that call). Callers only supply what's actually game-specific:
// the icon, title/stats copy, and the reward/rating/replay data.
//
// savedStatId arrives after saveStats() finishes its round trip to Supabase
// (insert the result, then award points), which is why the rating widget
// necessarily appears a beat after the icon/title/stats - those are known
// the instant the puzzle is solved, client-side, while the rating widget
// can't render before the row it rates exists. That gap is real network
// latency, not a rendering bug; the fade-in below just makes the swap from
// spinner to widget feel intentional instead of an abrupt pop.
export default function GameSolvedPanel({
  solved,
  difficultyRating,
  icon,
  title,
  stats,
  rewardResult,
  savedStatId,
  onRated,
  completionFinished = false,
  showPlayAgain = true,
  onPlayAgain,
  playAgainLabel = "Play again",
  noPointsLabel,
  finalisingLabel = "Finalising your result…",
  resultCompletedLabel = "Result completed",
  completionSeconds = null,
  allowScoreChallenge = false,
  scoreToBeatSeconds = null,
  scoreChallengerName = null,
}) {
  const { t } = useI18n();
  const [challengeState, setChallengeState] = useState({ status:"idle", message:"" });
  useEffect(() => setChallengeState({ status:"idle",message:"" }), [savedStatId]);
  const benchmarkSeconds = Number(
    rewardResult?.time_benchmark_seconds
      ?? rewardResult?.breakdown?.benchmark_seconds
  );
  const timeComparison = useMemo(() => {
    const played = Number(completionSeconds);
    if (completionSeconds===null || !(played>=0) || !(benchmarkSeconds>0)) return null;
    const difference = Math.round(Math.abs(benchmarkSeconds-played));
    if (difference===0) return `Right on the average · ${formatTime(benchmarkSeconds)}`;
    return `${difference}s ${played<benchmarkSeconds ? "faster" : "slower"} than average · Avg ${formatTime(benchmarkSeconds)}`;
  }, [benchmarkSeconds,completionSeconds]);

  async function challengeCircles() {
    if (!supabaseReady || !savedStatId || challengeState.status==="sending") return;
    setChallengeState({ status:"sending",message:"Sending…" });
    const { data,error } = await supabase.rpc("create_score_challenge", { target_stat_id:savedStatId });
    if (error) {
      setChallengeState({ status:"error",message:error.message || "Couldn’t send the challenge." });
      return;
    }
    const count = Number(data?.recipient_count) || 0;
    setChallengeState({
      status:count>0 ? "sent" : "empty",
      message:count>0
        ? `Challenge sent to ${count} ${count===1 ? "person" : "people"} in your circles.`
        : "No eligible circle members to challenge yet.",
    });
  }
  if (!solved) return null;

  return (
    <div className="game-solved-panel">
      {icon ?? <CircleCheckBig className="game-solved-icon" size={30} aria-hidden="true" />}
      <p className="game-solved-title">{title ?? t("common.solved")}</p>
      {stats && <p className="game-solved-stats">{stats}</p>}
      {timeComparison && <p className="game-solved-comparison">{timeComparison}</p>}
      {scoreToBeatSeconds!==null && Number.isFinite(Number(scoreToBeatSeconds)) && (
        <p className={`game-solved-head-to-head ${Number(completionSeconds)<Number(scoreToBeatSeconds) ? "is-win" : ""}`}>
          {Number(completionSeconds)<Number(scoreToBeatSeconds)
            ? `You beat ${scoreChallengerName || "their"} score by ${Number(scoreToBeatSeconds)-Number(completionSeconds)}s!`
            : Number(completionSeconds)===Number(scoreToBeatSeconds)
              ? `You tied ${scoreChallengerName || "their"} score.`
              : `${scoreChallengerName || "Their"} score was ${formatTime(scoreToBeatSeconds)}.`}
        </p>
      )}
      {rewardResult && (
        <div className={`game-solved-reward${rewardResult.error ? " is-error" : ""}`}>
          {rewardStatusText(rewardResult, noPointsLabel ?? t("common.noPoints"))}
        </div>
      )}
      <div className="game-solved-rating-in" key={savedStatId ? "rated" : completionFinished ? "completed" : "pending"}>
        {difficultyRating !== null ? (
          <DifficultyRatingBadge value={difficultyRating} />
        ) : savedStatId ? (
          <DifficultyRating onRate={(value) => rateDifficulty(savedStatId, value)} onRated={onRated} />
        ) : completionFinished ? (
          <p className="game-solved-finalising-text">{resultCompletedLabel}</p>
        ) : (
          <div className="game-solved-finalising-row" role="status" aria-live="polite">
            <span className="game-solved-finalising-dot" />
            <span className="game-solved-finalising-text">{finalisingLabel}</span>
          </div>
        )}
      </div>
      {allowScoreChallenge && savedStatId && (
        <div className="game-solved-challenge-wrap">
          <button
            type="button"
            onClick={challengeCircles}
            disabled={challengeState.status==="sending" || challengeState.status==="sent"}
            className="game-solved-challenge"
          >
            <Swords size={15} aria-hidden="true" />
            {challengeState.status==="sending" ? "Sending…" : challengeState.status==="sent" ? "Challenge sent ✓" : "Beat my score"}
          </button>
          {challengeState.message && (
            <p className={`game-solved-challenge-status${challengeState.status==="error" ? " is-error" : ""}`} role="status">
              {challengeState.message}
            </p>
          )}
        </div>
      )}
      {showPlayAgain && (savedStatId || completionFinished) && (
        <button onClick={onPlayAgain} className="game-solved-play-again mt-2 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors">
          {playAgainLabel}
        </button>
      )}
    </div>
  );
}

function formatTime(value) {
  const seconds = Math.max(0,Math.round(Number(value) || 0));
  return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;
}

export { DifficultyRatingBadge };
