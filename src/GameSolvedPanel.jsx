import DifficultyRating, { DifficultyRatingBadge } from "./DifficultyRating.jsx";
import { rewardStatusText } from "./lib/rewardStatus.js";
import "./game-solved-panel.css";

// Shared "you solved it" panel for every puzzle game. Each game used to hand-roll
// this block with its own inline colours, which is why dark mode only ever got
// fixed for whichever game someone happened to be working on at the time (Zip).
// One component + one stylesheet means a contrast fix here reaches every game.
export default function GameSolvedPanel({
  variant = "overlay",
  icon,
  title,
  stats,
  rewardResult,
  savedStatId,
  onRate,
  onRated,
  completionFinished = false,
  showPlayAgain = true,
  onPlayAgain,
  playAgainLabel = "Play again",
  noPointsLabel = "No points awarded",
  finalisingLabel = "Finalising your result…",
  resultCompletedLabel = "Result completed",
}) {
  return (
    <div className={`game-solved-panel game-solved-panel--${variant}`}>
      {icon}
      <p className="game-solved-title">{title}</p>
      {stats && <p className="game-solved-stats">{stats}</p>}
      {rewardResult && (
        <div className={`game-solved-reward${rewardResult.error ? " is-error" : ""}`}>
          {rewardStatusText(rewardResult, noPointsLabel)}
        </div>
      )}
      {savedStatId ? (
        <DifficultyRating onRate={onRate} onRated={onRated} />
      ) : completionFinished ? (
        <p className="game-solved-finalising-text">{resultCompletedLabel}</p>
      ) : (
        <div className="game-solved-finalising-row" role="status" aria-live="polite">
          <span className="game-solved-finalising-dot" />
          <span className="game-solved-finalising-text">{finalisingLabel}</span>
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

export { DifficultyRatingBadge };
