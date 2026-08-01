import DifficultyRating, { DifficultyRatingBadge } from "./DifficultyRating.jsx";
import { rewardStatusText } from "./lib/rewardStatus.js";
import { rateDifficulty } from "./lib/saveStats.js";
import { useI18n } from "./lib/i18n.jsx";
import { CircleCheckBig } from "lucide-react";
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
}) {
  const { t } = useI18n();
  if (!solved) return null;

  return (
    <div className="game-solved-panel">
      {icon ?? <CircleCheckBig className="game-solved-icon" size={30} aria-hidden="true" />}
      <p className="game-solved-title">{title ?? t("common.solved")}</p>
      {stats && <p className="game-solved-stats">{stats}</p>}
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
      {showPlayAgain && (savedStatId || completionFinished) && (
        <button onClick={onPlayAgain} className="game-solved-play-again mt-2 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors">
          {playAgainLabel}
        </button>
      )}
    </div>
  );
}

export { DifficultyRatingBadge };
