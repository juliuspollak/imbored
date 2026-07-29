import React, { useState, useEffect, useRef, useCallback } from "react";
import { withSeededRandom } from "../lib/seededRandom.js";
import { useGameTimer } from "../lib/useGameTimer.js";
import { DifficultyRatingBadge } from "../DifficultyRating.jsx";
import GameSolvedPanel from "../GameSolvedPanel.jsx";
import { ZoomIn, RotateCcw, Timer as TimerIcon, HelpCircle } from "lucide-react";
import { generateZoomQuiz, ROUNDS_PER_QUIZ, LEVELS_PER_ROUND } from "./zoom/zoomGenerator.js";
import { getTargetHistory, rememberTargets } from "./zoom/zoomHistory.js";
import FlagImage from "./geo/FlagImage.jsx";
import { useI18n } from "../lib/i18n.jsx";
import { localizeZoomValue, localizeZoomPrompt } from "./zoom/zoomLocalization.js";
import DaySelector from "../DaySelector.jsx";

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#7C3AED";
const RED = "#E5484D";
const GREEN = "#16A34A";
const CREAM = "#1B2129";

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

export default function ZoomGame({ userId, onSolved, mode = "practice", forcedDayIdx, seed, challengeDate, savedStatId, rewardResult } = {}) {
  const { t, language } = useI18n();
  const days = t("zoom.days").split(",");
  const todayIdx = (() => {
    const d = new Date().getDay();
    return d === 0 ? 6 : d - 1;
  })();
  const isChallenge = mode === "challenge";
  const [dayIdx, setDayIdx] = useState(isChallenge ? forcedDayIdx ?? todayIdx : todayIdx);

  const [steps, setSteps] = useState(null);
  const [qIdx, setQIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [solved, setSolved] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [correctLog, setCorrectLog] = useState([]); // per-step booleans, for the "rounds nailed" stat
  const [showHelp, setShowHelp] = useState(false);
  const [difficultyRating, setDifficultyRating] = useState(null);
  const stateKey = `imbored:zoom:i18n-v1:${mode}:${userId || "guest"}:${challengeDate || dayIdx}:${seed || "practice"}`;

  const newQuiz = useCallback((dIdx, forceFresh = false) => {
    if (!forceFresh) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(stateKey) || "null");
        if (saved?.steps?.length && !saved.solved) {
          setSteps(saved.steps);
          setQIdx(saved.qIdx || 0);
          setSelected(saved.selected ?? null);
          setAnswered(!!saved.answered);
          setSeconds(saved.seconds || 0);
          setRunning(true);
          setSolved(false);
          setMistakes(saved.mistakes || 0);
          setCorrectLog(saved.correctLog || []);
          setDifficultyRating(null);
          return;
        }
      } catch {}
    }
    const recentIds = isChallenge ? [] : getTargetHistory(userId);
    const gen = () => generateZoomQuiz(dIdx, recentIds);
    const qs = isChallenge && seed ? withSeededRandom(seed, gen) : gen();
    if (!isChallenge) rememberTargets(userId, [...new Set(qs.map((s) => s.countryId))]);
    setSteps(qs);
    setQIdx(0);
    setSelected(null);
    setAnswered(false);
    setSeconds(0);
    setRunning(true);
    setSolved(false);
    setMistakes(0);
    setCorrectLog([]);
    setDifficultyRating(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChallenge, seed, userId, stateKey]);

  useEffect(() => {
    newQuiz(dayIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayIdx]);

  useGameTimer(running, solved, setSeconds);

  useEffect(() => {
    if (!steps || solved) return;
    sessionStorage.setItem(stateKey, JSON.stringify({ steps, qIdx, selected, answered, seconds, mistakes, correctLog, solved }));
  }, [stateKey, steps, qIdx, selected, answered, seconds, mistakes, correctLog, solved]);

  if (!steps) {
    return (
      <div style={{ background: BG, minHeight: "100vh" }} className="flex items-center justify-center">
        <span style={{ color: INK, opacity: 0.6 }} className="text-sm">{t("common.buildingQuiz")}</span>
      </div>
    );
  }

  const step = steps[qIdx];
  const isLast = qIdx === steps.length - 1;
  const totalRounds = Math.max(...steps.map((s) => s.roundIndex)) + 1;
  const roundNumber = step.roundIndex + 1;
  const isFinalRound = step.roundIndex === totalRounds - 1;
  const shownAnswer = localizeZoomValue(step.answer, language, step);
  const shownSelected = localizeZoomValue(selected, language, step);
  const prompt = localizeZoomPrompt(step, language);

  function pick(option) {
    if (answered || solved) return;
    setSelected(option);
    setAnswered(true);
    const isCorrect = option === step.answer;
    if (!isCorrect) setMistakes((m) => m + 1);
    setCorrectLog((log) => {
      const next = [...log];
      next[qIdx] = isCorrect;
      return next;
    });
  }

  function next() {
    const roundFailed = selected !== step.answer;
    if (isLast || (roundFailed && isFinalRound)) {
      setSolved(true);
      setRunning(false);
      sessionStorage.removeItem(stateKey);
      const finalCorrectLog = [...correctLog];
      finalCorrectLog[qIdx] = selected === step.answer;
      const correctCount = finalCorrectLog.filter(Boolean).length;
      const completedRounds = Array.from({ length: totalRounds }, (_, round) => {
        const start = round * LEVELS_PER_ROUND;
        return finalCorrectLog[start] && finalCorrectLog[start + 1] && finalCorrectLog[start + 2];
      }).filter(Boolean).length;
      onSolved && onSolved({
        userId,
        game: "zoom",
        dayIndex: dayIdx,
        seconds,
        mistakes,
        hints: 0,
        correctCount,
        totalCount: steps.length,
        roundsNailed: completedRounds,
        mode,
        challengeDate: isChallenge ? challengeDate : undefined,
      });
      return;
    }
    // One wrong level fails the whole round. Do not continue revealing easier
    // levels from the same clue; move to the first level of the next round.
    setQIdx(roundFailed ? (step.roundIndex + 1) * LEVELS_PER_ROUND : qIdx + 1);
    setSelected(null);
    setAnswered(false);
  }

  function handleReset() {
    if (solved) return;
    // Restart the same set without erasing elapsed time or prior mistakes.
    // The reset itself is an additional scoring mistake.
    setQIdx(0);
    setSelected(null);
    setAnswered(false);
    setCorrectLog([]);
    setMistakes((value) => value + 1);
    setRunning(true);
  }

  const roundsNailed = Array.from({ length: totalRounds }, (_, r) => {
    const start = r * LEVELS_PER_ROUND;
    return correctLog[start] && correctLog[start + 1] && correctLog[start + 2];
  }).filter(Boolean).length;

  return (
    <div style={{ background: BG, minHeight: "100vh" }} className="flex items-start justify-center p-4 pt-[72px]">
      <style>{`
        .zoom-card { font-family: 'Inter', sans-serif; }
        @media (hover: hover) and (pointer: fine) {
          .zoom-option:not(:disabled):hover { filter: brightness(0.97); transform: translateY(-1px); }
          .zoom-icon-btn:hover { opacity: 0.85; }
          .zoom-toolbar-btn:not(:disabled):hover { transform: translateY(-1px); filter: brightness(1.03); }
          .zoom-next-btn:hover { filter: brightness(1.08); }
        }
        @media (max-width: 420px) {
          .zoom-card { padding: 16px !important; }
        }
      `}</style>

      <div
        className="zoom-card w-full max-w-md sm:max-w-lg lg:max-w-xl rounded-2xl p-5 lg:p-6 relative"
        style={{ background: PANEL, boxShadow: "0 10px 30px rgba(16,24,40,0.10)", border: "1px solid rgba(16,24,40,0.09)" }}
      >
        <button onClick={() => setShowHelp((h) => !h)} className="zoom-icon-btn absolute top-4 right-4 transition-opacity" style={{ color: INK, opacity: 0.5 }}>
          <HelpCircle size={16} />
        </button>

        <div className="text-center mb-4">
          <h1 style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: INK, letterSpacing: "-0.01em" }} className="text-4xl lg:text-5xl">
            Zoom
          </h1>
          <p style={{ color: INK, opacity: 0.45 }} className="text-xs mt-1">{t("zoom.subtitle")}</p>
        </div>

        {isChallenge ? (
          <div className="flex justify-center mb-4">
            <div className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: `${ACCENT}18`, color: ACCENT }}>
              <span className="text-xs font-semibold">{t("common.todaysChallenge")}</span>
            </div>
          </div>
        ) : (
          <DaySelector
            days={days}
            value={dayIdx}
            onChange={setDayIdx}
          />
        )}

        <div className="flex items-center justify-center gap-4 mb-3 px-1">
          <div className="flex items-center gap-1.5" style={{ color: INK, opacity: 0.7 }}>
            <TimerIcon size={14} />
            <span className="text-xs tabular-nums">{fmtTime(seconds)}</span>
          </div>
          <div style={{ color: INK, opacity: 0.7 }} className="text-xs">
            {t("zoom.round")} <span style={{ color: ACCENT, fontWeight: 600 }}>{roundNumber}</span>/{totalRounds}
          </div>
        </div>

        {/* toolbar - text labels, spread at top */}
        <div className="flex items-center justify-between gap-2 mb-3 px-1">
          {[
            { label: t("common.restart"), onClick: handleReset, disabled: solved },
          ].map(({ label, onClick, disabled }) => (
            <button
              key={label}
              onClick={onClick}
              disabled={disabled}
              aria-label={label}
              className="gloss-button flex-1 rounded-lg py-2 text-xs font-semibold transition-all"
              style={{
                background: disabled ? "rgba(16,24,40,0.06)" : undefined,
                color: disabled ? "rgba(27,33,41,0.4)" : CREAM,
                cursor: disabled ? "default" : "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {showHelp && (
          <div className="text-xs rounded-lg p-2.5 mb-3" style={{ background: "rgba(16,24,40,0.05)", color: INK, opacity: 0.75, lineHeight: 1.4 }}>
            {t("zoom.help")}
          </div>
        )}

        {!solved && (
          <>
            {/* Round dots + level breadcrumb (continent -> region -> country) */}
            <div className="flex items-center justify-center gap-1.5 mb-3">
              {Array.from({ length: totalRounds }, (_, r) => (
                <span
                  key={r}
                  className="rounded-full"
                  style={{
                    width: r === step.roundIndex ? 18 : 6,
                    height: 6,
                    borderRadius: 999,
                    background: r < step.roundIndex ? GREEN : r === step.roundIndex ? ACCENT : "rgba(16,24,40,0.12)",
                    transition: "all 160ms ease",
                  }}
                />
              ))}
            </div>
            <div className="flex items-center justify-center gap-1.5 mb-4 flex-wrap">
              {[t("zoom.stepContinent"), t("zoom.stepRegion"), t("zoom.stepCountry")].map((label, i) => {
                // Levels already passed this round reveal what the answer
                // actually was (not necessarily what was picked) — a running
                // recap so the country step doesn't require remembering the
                // continent/region cold. steps are laid out contiguously per
                // round, so the earlier levels of *this* round sit right
                // before the current one in the flat array.
                const revealed = i < step.levelIndex ? steps[qIdx - step.levelIndex + i] : null;
                const shown = revealed ? localizeZoomValue(revealed.answer, language, revealed) : label;
                return (
                  <React.Fragment key={label}>
                    {i > 0 && <span style={{ color: INK, opacity: 0.2 }} className="text-xs">→</span>}
                    <span
                      className="text-[10px] font-semibold px-2 py-1 rounded-full"
                      style={{
                        background: i === step.levelIndex ? `${ACCENT}18` : i < step.levelIndex ? "rgba(22,163,74,0.10)" : "rgba(16,24,40,0.04)",
                        color: i === step.levelIndex ? ACCENT : i < step.levelIndex ? GREEN : "rgba(27,33,41,0.35)",
                      }}
                    >
                      {shown}
                    </span>
                  </React.Fragment>
                );
              })}
            </div>

            {step.clueType === "flag" && (
              <div className="flex justify-center mb-3">
                <FlagImage countryCode={step.flagCode} countryName={step.countryName} emoji={step.flagEmoji} />
              </div>
            )}

            <p style={{ color: INK, fontWeight: 600 }} className="text-base text-center mb-4 min-h-[48px] flex items-center justify-center">
              {prompt}
            </p>

            <div className="flex flex-row gap-2.5 mb-3">
              {step.options.map((option) => {
                const isPicked = selected === option;
                const isCorrect = answered && option === step.answer;
                const isWrong = answered && isPicked && option !== step.answer;
                let background = "rgba(16,24,40,0.05)";
                let color = INK;
                let border = "1px solid rgba(16,24,40,0.10)";
                if (isCorrect) { background = "rgba(22,163,74,0.11)"; color = GREEN; border = `1px solid ${GREEN}55`; }
                if (isWrong) { background = "rgba(229,72,77,0.10)"; color = RED; border = `1px solid ${RED}55`; }
                return (
                  <button
                    key={option}
                    onClick={() => pick(option)}
                    disabled={answered}
                    className="zoom-option flex-1 rounded-xl px-3 py-4 text-sm sm:text-base font-semibold transition-all min-h-[64px] leading-snug"
                    style={{ background, color, border, cursor: answered ? "default" : "pointer" }}
                  >
                    {localizeZoomValue(option, language, step)}
                  </button>
                );
              })}
            </div>

            {answered && (
              <div className="mb-3 text-center rounded-xl px-3 py-2.5" style={{ background: selected === step.answer ? "rgba(22,163,74,0.09)" : "rgba(229,72,77,0.08)" }}>
                <div className="text-sm font-semibold" style={{ color: selected === step.answer ? GREEN : RED }}>
                  {selected === step.answer
                    ? t("zoom.correct", { answer: shownAnswer })
                    : t("zoom.incorrect", { selected: shownSelected, answer: shownAnswer })}
                </div>
                {step.levelKey === "country" && (
                  <div className="text-xs mt-1" style={{ color: INK, opacity: 0.6 }}>
                    {t("zoom.roundAnswer", { country: localizeZoomValue(step.countryName, language, { ...step, levelKey: "country" }), flag: step.flagEmoji || "" })}
                  </div>
                )}
              </div>
            )}

            {answered && (
              <button onClick={next} className="zoom-next-btn w-full rounded-lg py-2.5 text-sm font-semibold transition-all" style={{ background: ACCENT, color: "#FFFFFF" }}>
                {isLast || (selected !== step.answer && isFinalRound)
                  ? t("common.seeResults")
                  : selected !== step.answer || step.levelKey === "country"
                    ? t("zoom.nextRound")
                    : t("common.nextQuestion")}
              </button>
            )}
          </>
        )}

        <GameSolvedPanel
          solved={solved}
          difficultyRating={difficultyRating}
          icon={<ZoomIn size={32} style={{ color: ACCENT }} />}
          title={t("zoom.result", { correct: correctLog.filter(Boolean).length, total: steps.length })}
          stats={
            <>
              {fmtTime(seconds)} &middot; {t("zoom.roundsNailed", { count: roundsNailed, total: totalRounds })}
            </>
          }
          rewardResult={rewardResult}
          savedStatId={savedStatId}
          onRated={setDifficultyRating}
          showPlayAgain={!isChallenge}
          onPlayAgain={() => newQuiz(dayIdx)}
          playAgainLabel={t("zoom.playAgain")}
        />

        {solved && difficultyRating !== null && (
          <div className="flex flex-col items-center gap-3 py-4">
            <DifficultyRatingBadge value={difficultyRating} />
            {!isChallenge && (
              <button onClick={() => newQuiz(dayIdx)} className="zoom-next-btn mt-2 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors" style={{ background: ACCENT, color: "#FFFFFF" }}>
                {t("zoom.playAgain")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
