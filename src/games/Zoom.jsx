import React, { useState, useEffect, useRef, useCallback } from "react";
import { withSeededRandom } from "../lib/seededRandom.js";
import { useGameTimer } from "../lib/useGameTimer.js";
import { DifficultyRatingBadge } from "../DifficultyRating.jsx";
import GameSolvedPanel from "../GameSolvedPanel.jsx";
import { Timer as TimerIcon, HelpCircle } from "lucide-react";
import { generateZoomQuiz, ROUNDS_PER_QUIZ, LEVELS_PER_ROUND } from "./zoom/zoomGenerator.js";
import { getTargetHistory, rememberTargets } from "./zoom/zoomHistory.js";
import FlagImage from "./geo/FlagImage.jsx";
import { useI18n } from "../lib/i18n.jsx";
import { localizeZoomValue, localizeZoomPrompt } from "./zoom/zoomLocalization.js";
import DaySelector from "../DaySelector.jsx";
import Page from "../components/Page.jsx";
import Card from "../components/Card.jsx";
import Button from "../components/Button.jsx";
import StatusBanner from "../components/StatusBanner.jsx";

const INK = "var(--color-text-primary)";
const ACCENT = "var(--color-primary)";
const RED = "var(--color-danger-text)";
const GREEN = "var(--color-success-text)";
const CLUE_BADGES = {
  animal: ["🐾", "zoom.clueAnimal"],
  flora: ["🌿", "zoom.cluePlant"],
  landmark: ["🏛️", "zoom.clueLandmark"],
  food: ["🍽️", "zoom.clueFood"],
  naturalFeature: ["🌋", "zoom.clueNature"],
  flag: ["🚩", "zoom.clueFlag"],
  currency: ["🪙", "zoom.clueCurrency"],
  language: ["💬", "zoom.clueLanguage"],
  capital: ["📍", "zoom.cluePlace"],
};

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
  const stateKey = `imbored:zoom:variety-v2:${mode}:${userId || "guest"}:${challengeDate || dayIdx}:${seed || "practice"}`;

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
      <Page style={{ alignItems: "center" }}>
        <span role="status" style={{ padding: "var(--space-8)", color: "var(--color-text-secondary)", fontSize: "var(--text-body-size)" }}>{t("common.buildingQuiz")}</span>
      </Page>
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
    <Page style={{ alignItems: "flex-start" }}>
      <style>{`
        @media (hover: hover) and (pointer: fine) {
          .zoom-option:not(:disabled):hover { border-color: var(--color-primary-subtle-border) !important; transform: translateY(-1px); }
        }
        .zoom-help-button:focus-visible, .zoom-option:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) {
          .zoom-option { transition: none !important; }
        }
        @media (max-width: 420px) {
          .zoom-card { padding: 16px !important; }
        }
        .zoom-answer-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .zoom-answer-grid .zoom-option {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        @media (max-width: 360px) {
          .zoom-answer-grid {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      `}</style>

      <Card className="zoom-card" style={{ position: "relative", marginTop: "var(--game-content-top)", marginBottom: "var(--space-8)", padding: "var(--space-5)" }}>
        <button type="button" onClick={() => setShowHelp((h) => !h)} aria-label={showHelp ? "Hide instructions" : "Show instructions"} aria-expanded={showHelp} className="zoom-help-button" style={{ position: "absolute", top: "var(--space-3)", right: "var(--space-3)", width: 40, height: 40, display: "grid", placeItems: "center", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-surface-elevated)", color: "var(--color-icon-subtle)", cursor: "pointer" }}>
          <HelpCircle size={16} />
        </button>

        <div className="text-center mb-4">
          <h1 style={{ margin: 0, fontSize: "var(--text-page-title-size)", lineHeight: "var(--text-page-title-line)", fontWeight: "var(--text-page-title-weight)", color: INK }}>
            Zoom
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "var(--text-body-secondary-size)" }} className="mt-1">{t("zoom.subtitle")}</p>
        </div>

        {!solved && (isChallenge ? (
          <div className="flex justify-center mb-4">
            <div className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: "var(--color-primary-subtle)", color: ACCENT, border: "1px solid var(--color-primary-subtle-border)" }}>
              <span className="text-xs font-semibold">{t("common.todaysChallenge")}</span>
            </div>
          </div>
        ) : (
          <DaySelector
            days={days}
            value={dayIdx}
            onChange={setDayIdx}
          />
        ))}

        {!solved && <div className="flex items-center justify-center gap-4 mb-3 px-1">
          <div className="flex items-center gap-1.5" style={{ color: "var(--color-text-secondary)" }}>
            <TimerIcon size={14} />
            <span className="text-xs tabular-nums">{fmtTime(seconds)}</span>
          </div>
          <div style={{ color: "var(--color-text-secondary)" }} className="text-xs">
            {t("zoom.round")} <span style={{ color: ACCENT, fontWeight: 600 }}>{roundNumber}</span>/{totalRounds}
          </div>
        </div>}

        {/* toolbar - text labels, spread at top */}
        {!solved && <div className="flex items-center justify-between gap-2 mb-3 px-1">
          {[
            { label: t("common.restart"), onClick: handleReset, disabled: solved },
          ].map(({ label, onClick, disabled }) => (
            <Button
              key={label}
              onClick={onClick}
              disabled={disabled}
              aria-label={label}
              variant="secondary"
              size="sm"
              fullWidth
            >
              {label}
            </Button>
          ))}
        </div>}
        {!solved && showHelp && (
          <StatusBanner variant="info" style={{ marginBottom: "var(--space-3)" }}>
            {t("zoom.help")}
          </StatusBanner>
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
                    background: r < step.roundIndex ? GREEN : r === step.roundIndex ? ACCENT : "var(--color-border-strong)",
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
                    {i > 0 && <span style={{ color: "var(--color-text-muted)" }} className="text-xs">→</span>}
                    <span
                      className="text-[10px] font-semibold px-2 py-1 rounded-full"
                      style={{
                        background: i === step.levelIndex ? "var(--color-primary-subtle)" : i < step.levelIndex ? "var(--color-success-bg)" : "var(--color-surface-elevated)",
                        color: i === step.levelIndex ? ACCENT : i < step.levelIndex ? GREEN : "var(--color-text-muted)",
                      }}
                    >
                      {shown}
                    </span>
                  </React.Fragment>
                );
              })}
            </div>

            <div className="flex justify-center mb-3">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{
                  color: "var(--color-text-secondary)",
                  background: "var(--color-surface-elevated)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <span aria-hidden="true">{(CLUE_BADGES[step.clueType] || CLUE_BADGES.capital)[0]}</span>
                {t((CLUE_BADGES[step.clueType] || CLUE_BADGES.capital)[1])}
              </span>
            </div>

            {step.clueType === "flag" && (
              <div className="flex justify-center mb-3">
                <FlagImage countryCode={step.flagCode} countryName={step.countryName} emoji={step.flagEmoji} />
              </div>
            )}

            <p style={{ color: INK, fontWeight: 600 }} className="text-base text-center mb-4 min-h-[48px] flex items-center justify-center">
              {prompt}
            </p>

            <div className="zoom-answer-grid gap-2.5 mb-3">
              {step.options.map((option) => {
                const isPicked = selected === option;
                const isCorrect = answered && option === step.answer;
                const isWrong = answered && isPicked && option !== step.answer;
                let background = "var(--color-surface-elevated)";
                let color = INK;
                let border = "1px solid var(--color-border)";
                if (isCorrect) { background = "var(--color-success-bg)"; color = GREEN; border = "1px solid var(--color-success-border)"; }
                if (isWrong) { background = "var(--color-danger-bg)"; color = RED; border = "1px solid var(--color-danger-solid)"; }
                return (
                  <button
                    key={option}
                    onClick={() => pick(option)}
                    disabled={answered}
                    className="zoom-option rounded-xl px-3 py-4 text-sm sm:text-base font-semibold transition-all min-h-[64px] leading-snug"
                    style={{ background, color, border, cursor: answered ? "default" : "pointer" }}
                  >
                    {localizeZoomValue(option, language, step)}
                  </button>
                );
              })}
            </div>

            {answered && (
              <div className="mb-3 text-center rounded-xl px-3 py-2.5" style={{ background: selected === step.answer ? "var(--color-success-bg)" : "var(--color-danger-bg)", border: `1px solid ${selected === step.answer ? "var(--color-success-border)" : "var(--color-danger-solid)"}` }}>
                <div className="text-sm font-semibold" style={{ color: selected === step.answer ? GREEN : RED }}>
                  {selected === step.answer
                    ? t("zoom.correct", { answer: shownAnswer })
                    : t("zoom.incorrect", { selected: shownSelected, answer: shownAnswer })}
                </div>
                {step.levelKey === "country" && (
                  <div className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                    {t("zoom.roundAnswer", { country: localizeZoomValue(step.countryName, language, { ...step, levelKey: "country" }), flag: step.flagEmoji || "" })}
                  </div>
                )}
              </div>
            )}

            {answered && (
              <Button onClick={next} fullWidth>
                {isLast || (selected !== step.answer && isFinalRound)
                  ? t("common.seeResults")
                  : selected !== step.answer || step.levelKey === "country"
                    ? t("zoom.nextRound")
                    : t("common.nextQuestion")}
              </Button>
            )}
          </>
        )}

        <GameSolvedPanel
          solved={solved}
          difficultyRating={difficultyRating}
          stats={
            <>
              {t("zoom.result", { correct: correctLog.filter(Boolean).length, total: steps.length })} &middot; {fmtTime(seconds)} &middot; {t("zoom.roundsNailed", { count: roundsNailed, total: totalRounds })}
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
              <Button onClick={() => newQuiz(dayIdx)} size="sm">
                {t("zoom.playAgain")}
              </Button>
            )}
          </div>
        )}
      </Card>
    </Page>
  );
}
