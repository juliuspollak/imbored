import { useState, useEffect, useCallback } from "react";
import { withSeededRandom } from "../lib/seededRandom.js";
import { useGameTimer } from "../lib/useGameTimer.js";
import { useHintCooldown } from "../lib/useHintCooldown.js";
import HintCooldownButton from "../HintCooldownButton.jsx";
import { DifficultyRatingBadge } from "../DifficultyRating.jsx";
import GameSolvedPanel from "../GameSolvedPanel.jsx";
import { Globe2, Timer as TimerIcon, HelpCircle } from "lucide-react";
import { MAP_REGIONS, CONTINENT_SHAPES, MAP_VIEWBOX, REGION_HIT_AREAS } from "./geo/geoRegions.js";
import { shuffle, generateQuiz } from "./geo/geoGenerator.js";
import { getQuestionHistory, rememberQuestions } from "./geo/geoHistory.js";
import FlagImage from "./geo/FlagImage.jsx";
import { useI18n } from "../lib/i18n.jsx";
import { localizeGeoQuestion, localizeGeoValue } from "./geo/geoLocalization.js";
import DaySelector from "../DaySelector.jsx";
import Page from "../components/Page.jsx";
import Card from "../components/Card.jsx";
import Button from "../components/Button.jsx";
import StatusBanner from "../components/StatusBanner.jsx";

/* ---------------- continents & map ---------------- */

/* ---------------- design tokens ---------------- */

const INK = "var(--color-text-primary)";
const ACCENT = "var(--color-primary)";
const RED = "var(--color-danger-text)";
const GREEN = "var(--color-success-text)";
function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

/* ---------------- component ---------------- */

export default function GeoGame({ userId, onSolved, mode = "practice", forcedDayIdx, seed, challengeDate, hintCooldownConfig, savedStatId, rewardResult } = {}) {
  const { t, language } = useI18n();
  const days = t("geo.days").split(",");
  const todayIdx = (() => {
    const d = new Date().getDay();
    return d === 0 ? 6 : d - 1;
  })();
  const isChallenge = mode === "challenge";
  const [dayIdx, setDayIdx] = useState(isChallenge ? forcedDayIdx ?? todayIdx : todayIdx);
  const hintCooldownSeconds = (hintCooldownConfig?.hint_cooldown_base || 0) + (hintCooldownConfig?.hint_cooldown_per_day || 0) * dayIdx;
  const hintCooldown = useHintCooldown(hintCooldownSeconds);

  const [questions, setQuestions] = useState(null);
  const [qIdx, setQIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [eliminated, setEliminated] = useState([]); // continents faded by the map hint, this question only
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [solved, setSolved] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [difficultyRating, setDifficultyRating] = useState(null);
  const stateKey = `imbored:geo:i18n-v1:${mode}:${userId || "guest"}:${challengeDate || dayIdx}:${seed || "practice"}`;

  const newQuiz = useCallback((dIdx, forceFresh = false) => {
    if (!forceFresh) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(stateKey) || "null");
        if (saved?.questions?.length && !saved.solved) {
          setQuestions(saved.questions);
          setQIdx(saved.qIdx || 0);
          setSelected(saved.selected ?? null);
          setAnswered(!!saved.answered);
          setEliminated(saved.eliminated || []);
          setSeconds(saved.seconds || 0);
          setRunning(true);
          setSolved(false);
          setMistakes(saved.mistakes || 0);
          setHintsUsed(saved.hintsUsed || 0);
          setDifficultyRating(null);
          return;
        }
      } catch {}
    }
    // Personal/circle challenges are deterministic within their challenge, but
    // history still helps practice avoid serving the same facts immediately.
    const history = isChallenge ? [] : getQuestionHistory(userId);
    const gen = () => generateQuiz(dIdx, history);
    const qs = isChallenge && seed ? withSeededRandom(seed, gen) : gen();
    setQuestions(qs);
    if (!isChallenge) rememberQuestions(userId, qs);
    setQIdx(0);
    setSelected(null);
    setAnswered(false);
    setEliminated([]);
    setSeconds(0);
    setRunning(true);
    setSolved(false);
    setMistakes(0);
    setHintsUsed(0);
    setDifficultyRating(null);
    hintCooldown.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChallenge, seed, userId, stateKey]);

  useEffect(() => {
    newQuiz(dayIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayIdx]);

  useGameTimer(running, solved, setSeconds);

  useEffect(() => {
    if (!questions || solved) return;
    sessionStorage.setItem(stateKey, JSON.stringify({ questions, qIdx, selected, answered, eliminated, seconds, mistakes, hintsUsed, solved }));
  }, [stateKey, questions, qIdx, selected, answered, eliminated, seconds, mistakes, hintsUsed, solved]);

  if (!questions) {
    return (
      <Page style={{ alignItems: "center" }}>
        <span role="status" style={{ padding: "var(--space-8)", color: "var(--color-text-secondary)", fontSize: "var(--text-body-size)" }}>{t("common.buildingQuiz")}</span>
      </Page>
    );
  }

  const q = questions[qIdx];
  const shownAnswer = localizeGeoValue(q.answer, language, q);
  const shownSelected = localizeGeoValue(selected, language, q);
  const isLast = qIdx === questions.length - 1;

  function pick(option) {
    if (answered || solved) return;
    setSelected(option);
    setAnswered(true);
    if (option !== q.answer) setMistakes((m) => m + 1);
  }

  function next() {
    if (isLast) {
      setSolved(true);
      setRunning(false);
      sessionStorage.removeItem(stateKey);
      onSolved && onSolved({ userId, game: "geo", dayIndex: dayIdx, seconds, mistakes, hints: hintsUsed, mode, challengeDate: isChallenge ? challengeDate : undefined });
      return;
    }
    setQIdx((i) => i + 1);
    setSelected(null);
    setAnswered(false);
    setEliminated([]);
  }

  function handleHint() {
    if (solved || answered || hintCooldown.locked) return;
    const candidates = q.mode === "choice" ? q.options : MAP_REGIONS;
    const remainingWrong = candidates.filter((option) => option !== q.answer && !eliminated.includes(option));
    if (!remainingWrong.length) return;
    const toEliminate = shuffle(remainingWrong).slice(0, 1);
    setEliminated((current) => [...current, ...toEliminate]);
    setHintsUsed((h) => h + 1);
    hintCooldown.startCooldown();
  }

  function handleReset() {
    if (solved) return;
    // Restart the same quiz without erasing elapsed time, mistakes or hints.
    // The reset itself is an additional scoring mistake.
    setQIdx(0);
    setSelected(null);
    setAnswered(false);
    setEliminated([]);
    setMistakes((value) => value + 1);
    setRunning(true);
  }

  return (
    <Page style={{ alignItems: "flex-start" }}>
      <style>{`
        .geo-toolbar > * { width: 100%; min-width: 0; }
        @media (hover: hover) and (pointer: fine) {
          .geo-option:not(:disabled):hover { border-color: var(--color-primary-subtle-border) !important; transform: translateY(-1px); }
          .geo-continent:not([aria-disabled="true"]):hover { filter: brightness(1.06); }
        }
        .geo-continent { outline: none; }
        .geo-continent:focus-visible { outline: none; filter: drop-shadow(0 0 4px var(--color-primary)); }
        .geo-map-shell { border: 1px solid var(--color-border); }
        .geo-help-button:focus-visible, .geo-option:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) {
          .geo-option, .geo-continent { transition: none !important; }
        }
        @media (max-width: 420px) {
          .geo-card { padding: 16px !important; }
          .geo-map-shell { margin-left: -4px; width: calc(100% + 8px); }
        }
      `}</style>

      <Card className="geo-card" style={{ position: "relative", marginTop: 72, marginBottom: "var(--space-8)", padding: "var(--space-5)" }}>
        <button type="button" onClick={() => setShowHelp((h) => !h)} aria-label={showHelp ? "Hide instructions" : "Show instructions"} aria-expanded={showHelp} className="geo-help-button" style={{ position: "absolute", top: "var(--space-3)", right: "var(--space-3)", width: 40, height: 40, display: "grid", placeItems: "center", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-surface-elevated)", color: "var(--color-icon-subtle)", cursor: "pointer" }}>
          <HelpCircle size={16} />
        </button>

        <div className="text-center mb-4">
          <h1 style={{ margin: 0, fontSize: "var(--text-page-title-size)", lineHeight: "var(--text-page-title-line)", fontWeight: "var(--text-page-title-weight)", color: INK }}>
            Geo
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "var(--text-body-secondary-size)" }} className="mt-1">{t("geo.subtitle")}</p>
        </div>

        {isChallenge ? (
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
        )}

        <div className="flex items-center justify-center gap-4 mb-3 px-1">
          <div className="flex items-center gap-1.5" style={{ color: "var(--color-text-secondary)" }}>
            <TimerIcon size={14} />
            <span className="text-xs tabular-nums">{fmtTime(seconds)}</span>
          </div>
          <div style={{ color: "var(--color-text-secondary)" }} className="text-xs">
            {t("geo.question")} <span style={{ color: ACCENT, fontWeight: 600 }}>{Math.min(qIdx + 1, questions.length)}</span>/{questions.length}
          </div>

        </div>

        {/* toolbar - text labels, spread at top */}
        <div className="game-toolbar geo-toolbar mb-3 px-1" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-2)" }}>
          {[
            { label: t("common.restart"), onClick: handleReset, disabled: solved },
            {
              label: t("common.hint"),
              onClick: handleHint,
              disabled: solved,
              hint: true,
            },
          ].map(({ label, onClick, disabled, hint }) => hint ? (
            <HintCooldownButton
              key="hint"
              cooldown={hintCooldown}
              label={label}
              onClick={onClick}
              disabled={disabled}
            />
          ) : (
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
        </div>
        {showHelp && (
          <StatusBanner variant="info" style={{ marginBottom: "var(--space-3)" }}>
            {t("geo.help")}
          </StatusBanner>
        )}

        {!solved && (
          <>
            {q.type === "flag" && (
              <div className="flex justify-center mb-3">
                <FlagImage countryCode={q.flagCode} countryName={q.countryName} emoji={q.flagEmoji} />
              </div>
            )}
            <p style={{ color: INK, fontWeight: 600 }} className="text-base text-center mb-3 min-h-[48px] flex items-center justify-center">
              {localizeGeoQuestion(q, language)}
            </p>

            {q.mode === "map" ? (
              <>
            <div className="relative w-full rounded-xl overflow-hidden mb-3 geo-map-shell">
              <svg
                viewBox={MAP_VIEWBOX}
                className="w-full block"
                role="group"
                aria-label={t("geo.mapLabel")}
                style={{ background: "linear-gradient(180deg, #D7ECFA 0%, #EEF7FC 100%)", borderRadius: 16, touchAction: "manipulation" }}
              >
                <defs>
                  <linearGradient id="geo-land" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#B9D2E6" />
                    <stop offset="100%" stopColor="#91B5D1" />
                  </linearGradient>
                  <filter id="geo-shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#315A7A" floodOpacity="0.20" />
                  </filter>
                  <filter id="geo-active" x="-25%" y="-25%" width="150%" height="150%">
                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#163B5C" floodOpacity="0.28" />
                  </filter>
                </defs>
                <g opacity="0.20" fill="none" stroke="#6EA4C8" strokeWidth="0.7">
                  <path d="M 16 68 Q 220 50 424 68" />
                  <path d="M 16 118 Q 220 104 424 118" />
                  <path d="M 16 168 Q 220 156 424 168" />
                  <path d="M 110 22 Q 96 118 110 232" />
                  <path d="M 220 20 Q 220 118 220 234" />
                  <path d="M 330 22 Q 344 118 330 232" />
                </g>
                {Object.entries(REGION_HIT_AREAS).map(([name, area]) => {
                  const isEliminated = eliminated.includes(name);
                  return (
                    <ellipse
                      key={`hit-${name}`}
                      cx={area.cx}
                      cy={area.cy}
                      rx={area.rx}
                      ry={area.ry}
                      fill="transparent"
                      onClick={() => !answered && !isEliminated && pick(name)}
                      aria-hidden="true"
                      style={{ cursor: answered || isEliminated ? "default" : "pointer" }}
                    />
                  );
                })}
                {Object.entries(CONTINENT_SHAPES).map(([name, shape]) => {
                  const isEliminated = eliminated.includes(name);
                  const isPicked = selected === name;
                  const isCorrect = answered && name === q.answer;
                  const isWrong = answered && isPicked && name !== q.answer;
                  let fill = name === "Antarctica" ? "#DCEAF4" : "url(#geo-land)";
                  if (name === "Greenland") fill = "#C9DFEC";
                  if (name === "New Zealand") fill = "#A8C8DE";
                  if (isPicked && !answered) fill = ACCENT;
                  if (isCorrect) fill = GREEN;
                  if (isWrong) fill = RED;

                  return (
                    <path
                      key={name}
                      d={shape.d}
                      fill={fill}
                      stroke="#F8FCFF"
                      strokeWidth={name === "Antarctica" ? 2.6 : name === "New Zealand" ? 3.4 : 2.2}
                      strokeLinejoin="round"
                      filter={isPicked || isCorrect || isWrong ? "url(#geo-active)" : "url(#geo-shadow)"}
                      opacity={isEliminated ? 0.18 : 1}
                      onClick={() => !isEliminated && pick(name)}
                      onKeyDown={(event) => {
                        if (!isEliminated && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault();
                          pick(name);
                        }
                      }}
                      role="button"
                      tabIndex={answered || isEliminated ? -1 : 0}
                      aria-label={localizeGeoValue(name, language, q)}
                      aria-disabled={answered || isEliminated}
                      className="geo-continent"
                      style={{ cursor: answered || isEliminated ? "default" : "pointer", transformOrigin: "center", transition: "fill 180ms ease, opacity 180ms ease, filter 140ms ease" }}
                    />
                  );
                })}
              </svg>
            </div>

            {!answered && (
              <p className="text-center text-xs mb-3" style={{ color: "var(--color-text-secondary)" }}>
                {t("geo.tapCorrect")}
              </p>
            )}

              </>
            ) : (
              <div className="grid grid-cols-2 gap-2 mb-3">
                {q.options.map((option) => {
                  const isEliminated = eliminated.includes(option);
                  const isPicked = selected === option;
                  const isCorrect = answered && option === q.answer;
                  const isWrong = answered && isPicked && option !== q.answer;
                  let background = "var(--color-surface-elevated)";
                  let color = INK;
                  let border = "1px solid var(--color-border)";
                  if (isCorrect) { background = "var(--color-success-bg)"; color = GREEN; border = "1px solid var(--color-success-border)"; }
                  if (isWrong) { background = "var(--color-danger-bg)"; color = RED; border = "1px solid var(--color-danger-solid)"; }
                  return (
                    <button
                      key={option}
                      onClick={() => !isEliminated && pick(option)}
                      disabled={answered || isEliminated}
                      className="geo-option rounded-xl px-3 py-3 text-sm font-semibold transition-all min-h-[52px]"
                      data-state={isCorrect ? "correct" : isWrong ? "wrong" : "idle"}
                      style={{ background, color, border, opacity: isEliminated ? 0.22 : 1, cursor: answered || isEliminated ? "default" : "pointer" }}
                    >
                      {localizeGeoValue(option, language, q)}
                    </button>
                  );
                })}
              </div>
            )}

            {answered && (
              <div className="mb-3 text-center rounded-xl px-3 py-2.5" style={{ background: selected === q.answer ? "var(--color-success-bg)" : "var(--color-danger-bg)", border: `1px solid ${selected === q.answer ? "var(--color-success-border)" : "var(--color-danger-solid)"}` }}>
                <div className="text-sm font-semibold" style={{ color: selected === q.answer ? GREEN : RED }}>
                  {selected === q.answer
                    ? t("geo.correct", { answer: shownAnswer })
                    : t("geo.incorrect", { selected: shownSelected, answer: shownAnswer })}
                </div>
              </div>
            )}

            {answered && (
              <Button onClick={next} fullWidth>
                {isLast ? t("common.seeResults") : t("common.nextQuestion")}
              </Button>
            )}
          </>
        )}

        <GameSolvedPanel
          solved={solved}
          difficultyRating={difficultyRating}
          icon={<Globe2 size={32} style={{ color: ACCENT }} />}
          title={t("geo.result", { correct: questions.length - mistakes, total: questions.length })}
          stats={
            <>
              {fmtTime(seconds)} &middot; {t(hintsUsed === 1 ? "geo.hints.one" : "geo.hints.other", { count: hintsUsed })}
            </>
          }
          rewardResult={rewardResult}
          savedStatId={savedStatId}
          onRated={setDifficultyRating}
          showPlayAgain={!isChallenge}
          onPlayAgain={() => newQuiz(dayIdx)}
          playAgainLabel={t("geo.playAgain")}
        />

        {solved && difficultyRating !== null && (
          <div className="flex flex-col items-center gap-3 py-4">
            <DifficultyRatingBadge value={difficultyRating} />
            {!isChallenge && (
              <Button onClick={() => newQuiz(dayIdx)} size="sm">
                {t("geo.playAgain")}
              </Button>
            )}
          </div>
        )}
      </Card>
    </Page>
  );
}
