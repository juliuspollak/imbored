import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "./lib/i18n.jsx";

// How a score was reached used to be invisible: players saw "+9 Points" with no
// way to tell why someone else got more. Every number here already comes back
// from award_game_points in the reward payload — this only surfaces it.
function formatTime(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function signed(value) {
  const number = Number(value) || 0;
  return number > 0 ? `+${number}` : String(number);
}

export default function ScoreBreakdown({ rewardResult }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const breakdown = rewardResult?.breakdown;
  if (!breakdown) return null;

  const base = Number(breakdown.base) || 0;
  const dayBonus = Number(breakdown.day_bonus) || 0;
  const speed = Number(breakdown.performance_adjustment ?? breakdown.time) || 0;
  const streak = Number(breakdown.weekly_streak) || 0;
  const modeAdjustment = Number(breakdown.mode_adjustment) || 0;
  const modePercent = Number(breakdown.mode_multiplier_percent) || 100;
  const isPractice = breakdown.mode === "practice";
  const total = Number(breakdown.total) || 0;

  const scoredSeconds = Number(breakdown.scored_seconds);
  const benchmarkSeconds = Number(breakdown.benchmark_seconds);
  const hintSeconds = Math.round(Number(breakdown.hint_penalty_seconds) || 0);
  const mistakeSeconds = Math.round(Number(breakdown.mistake_penalty_seconds) || 0);
  const dayIndex = Number(breakdown.day_index);
  const dayName = Number.isFinite(dayIndex) && dayIndex >= 0 && dayIndex <= 6 ? t(`day.${dayIndex}`) : null;

  const rows = [
    { key: "base", label: t("score.base"), value: base },
    dayBonus !== 0 && {
      key: "day",
      label: dayName ? t("score.dayHarder", { day: dayName }) : t("score.dayBonus"),
      value: dayBonus,
    },
    speed !== 0 && { key: "speed", label: t("score.speed"), value: speed },
    isPractice && modeAdjustment !== 0 && {
      key: "practice",
      label: t("score.practiceRate", { percent: modePercent }),
      value: modeAdjustment,
    },
    streak !== 0 && { key: "streak", label: t("score.streak"), value: streak },
  ].filter(Boolean);

  const addedTime = hintSeconds > 0 && mistakeSeconds > 0
    ? t("score.addedBoth", { hints: hintSeconds, mistakes: mistakeSeconds })
    : hintSeconds > 0
      ? t("score.addedHints", { seconds: hintSeconds })
      : mistakeSeconds > 0
        ? t("score.addedMistakes", { seconds: mistakeSeconds })
        : null;

  return (
    <div className="score-breakdown">
      <button
        type="button"
        className="score-breakdown-toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="score-breakdown-detail"
      >
        {t("score.how")}
        <ChevronDown size={14} aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>

      {open && (
        <div id="score-breakdown-detail" className="score-breakdown-detail">
          {rows.map((row) => (
            <div key={row.key} className="score-breakdown-row">
              <span>{row.label}</span>
              <span className="score-breakdown-value">{signed(row.value)}</span>
            </div>
          ))}
          <div className="score-breakdown-row is-total">
            <span>{t("score.total")}</span>
            <span className="score-breakdown-value">{total}</span>
          </div>

          {Number.isFinite(scoredSeconds) && benchmarkSeconds > 0 && (
            <p className="score-breakdown-note">
              {t("score.scoredTime", {
                scored: formatTime(scoredSeconds),
                typical: formatTime(benchmarkSeconds),
              })}
              {addedTime ? ` ${addedTime} ${t("score.costTime")}` : ""}
            </p>
          )}
          <p className="score-breakdown-note">{t("score.typicalNote")}</p>
        </div>
      )}
    </div>
  );
}
