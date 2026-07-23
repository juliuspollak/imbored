import React, { useState, useEffect, useRef, useCallback } from "react";
import { withSeededRandom } from "../lib/seededRandom.js";
import { useHintCooldown } from "../lib/useHintCooldown.js";
import { rateDifficulty } from "../lib/saveStats.js";
import DifficultyRating from "../DifficultyRating.jsx";
import { Globe2, RotateCcw, Shuffle, Lightbulb, Timer as TimerIcon, HelpCircle, Lock } from "lucide-react";
import { MAP_REGIONS, CONTINENT_SHAPES, MAP_VIEWBOX, REGION_HIT_AREAS } from "./geo/geoRegions.js";
import { shuffle, generateQuiz } from "./geo/geoGenerator.js";
import { getQuestionHistory, rememberQuestions } from "./geo/geoHistory.js";
import FlagImage from "./geo/FlagImage.jsx";

/* ---------------- continents & map ---------------- */

/* ---------------- design tokens ---------------- */

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const ACCENT = "#2F6FED";
const RED = "#E5484D";
const GREEN = "#16A34A";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

/* ---------------- component ---------------- */

export default function GeoGame({ userId, onSolved, mode = "practice", forcedDayIdx, seed, challengeDate, hintCooldownConfig, savedStatId } = {}) {
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
  const timerRef = useRef(null);

  const newQuiz = useCallback((dIdx) => {
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
    hintCooldown.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChallenge, seed, userId]);

  useEffect(() => {
    newQuiz(dayIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayIdx]);

  useEffect(() => {
    if (running && !solved) {
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [running, solved]);

  if (!questions) {
    return (
      <div style={{ background: BG, minHeight: "100vh" }} className="flex items-center justify-center">
        <span style={{ color: INK, opacity: 0.6 }} className="text-sm">Building today's quiz…</span>
      </div>
    );
  }

  const q = questions[qIdx];
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
      onSolved && onSolved({ userId, game: "geo", dayIndex: dayIdx, seconds, mistakes, hints: hintsUsed, mode, challengeDate: isChallenge ? challengeDate : undefined });
      return;
    }
    setQIdx((i) => i + 1);
    setSelected(null);
    setAnswered(false);
    setEliminated([]);
  }

  function handleHint() {
    if (solved || answered || hintCooldown.locked || eliminated.length > 0) return;
    const candidates = q.mode === "choice" ? q.options : MAP_REGIONS;
    const wrongAnswers = candidates.filter((option) => option !== q.answer);
    const toEliminate = shuffle(wrongAnswers).slice(0, 2);
    setEliminated(toEliminate);
    setHintsUsed((h) => h + 1);
    hintCooldown.startCooldown();
  }

  function handleReset() {
    if (solved) return;
    newQuiz(dayIdx);
  }

  return (
    <div style={{ background: BG, minHeight: "100vh" }} className="flex items-center justify-center p-4">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        .geo-card { font-family: 'Inter', sans-serif; }
        @media (hover: hover) and (pointer: fine) {
          .geo-option:not(:disabled):hover { filter: brightness(0.97); transform: translateY(-1px); }
          .geo-day-btn:hover { filter: brightness(1.12); }
          .geo-icon-btn:hover { opacity: 0.85; }
          .geo-toolbar-btn:not(:disabled):hover { background: rgba(16,24,40,0.10) !important; }
          .geo-next-btn:hover { filter: brightness(1.08); }
          .geo-continent:not([aria-disabled="true"]):hover { filter: brightness(1.08); }
        }
        .geo-continent:focus-visible { outline: none; filter: drop-shadow(0 0 4px rgba(47,111,237,0.8)); }
        .geo-map-shell { box-shadow: inset 0 0 0 1px rgba(47,111,237,0.08); }
        @media (max-width: 420px) {
          .geo-card { padding: 16px !important; }
          .geo-map-shell { margin-left: -4px; width: calc(100% + 8px); }
        }
      `}</style>

      <div
        className="geo-card w-full max-w-sm sm:max-w-md lg:max-w-lg rounded-2xl p-5 lg:p-6 relative"
        style={{ background: PANEL, boxShadow: "0 10px 30px rgba(16,24,40,0.10)", border: "1px solid rgba(16,24,40,0.09)" }}
      >
        <button onClick={() => setShowHelp((h) => !h)} className="geo-icon-btn absolute top-4 right-4 transition-opacity" style={{ color: INK, opacity: 0.5 }}>
          <HelpCircle size={16} />
        </button>

        <div className="text-center mb-4">
          <h1 style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: INK, letterSpacing: "-0.01em" }} className="text-4xl lg:text-5xl">
            Geo
          </h1>
          <p style={{ color: INK, opacity: 0.45 }} className="text-xs mt-1">five quick questions — tap or choose</p>
        </div>

        {isChallenge ? (
          <div className="flex justify-center mb-4">
            <div className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: `${ACCENT}18`, color: ACCENT }}>
              <span className="text-xs font-semibold">Today's Challenge</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-1.5 mb-4">
            {DAYS.map((d, i) => (
              <button
                key={d}
                onClick={() => setDayIdx(i)}
                className="geo-day-btn flex items-center justify-center rounded-lg px-2.5 py-1.5 transition-colors"
                style={{ background: i === dayIdx ? ACCENT : "rgba(16,24,40,0.05)", color: i === dayIdx ? "#FFFFFF" : INK, minWidth: 38 }}
              >
                <span className="text-xs font-semibold">{d}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-center gap-4 mb-3 px-1">
          <div className="flex items-center gap-1.5" style={{ color: INK, opacity: 0.7 }}>
            <TimerIcon size={14} />
            <span className="text-xs tabular-nums">{fmtTime(seconds)}</span>
          </div>
          <div style={{ color: INK, opacity: 0.7 }} className="text-xs">
            question <span style={{ color: ACCENT, fontWeight: 600 }}>{Math.min(qIdx + 1, questions.length)}</span>/{questions.length}
          </div>

        </div>

        <div className="flex items-center justify-center gap-2 mb-4">
          {[
            { Icon: RotateCcw, label: "Restart", onClick: handleReset, disabled: solved },
            { Icon: Shuffle, label: "New", onClick: () => newQuiz(dayIdx), disabled: isChallenge },
            {
              Icon: hintCooldown.locked ? Lock : Lightbulb,
              label: hintCooldown.locked ? `${hintCooldown.remaining}s` : "Hint",
              onClick: handleHint,
              disabled: solved || answered || hintCooldown.locked || eliminated.length > 0,
            },
          ].map(({ Icon, label, onClick, disabled }) => (
            <button
              key={label}
              onClick={onClick}
              disabled={disabled}
              className="geo-toolbar-btn flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 transition-colors"
              style={{ background: "rgba(16,24,40,0.05)", color: disabled ? "rgba(27,33,41,0.28)" : INK, cursor: disabled ? "default" : "pointer" }}
            >
              <Icon size={15} />
              <span className="text-[9px]">{label}</span>
            </button>
          ))}
        </div>

        {showHelp && (
          <div className="text-xs rounded-lg p-2.5 mb-3" style={{ background: "rgba(16,24,40,0.05)", color: INK, opacity: 0.75, lineHeight: 1.4 }}>
            Five quick geography questions. Some use the map; others use four answers. On four-answer questions, the hint removes two wrong choices. On map questions, it fades two wrong continents.
          </div>
        )}

        {!solved && (
          <>
            {q.type === "flag" && (
              <div className="flex justify-center mb-3">
                <FlagImage countryCode={q.flagCode} countryName={q.countryName} emoji={q.flagEmoji} />
              </div>
            )}
            <p style={{ color: INK, fontWeight: 600 }} className="text-base text-center mb-3 min-h-[48px] flex items-center justify-center">
              {q.prompt}
            </p>

            {q.mode === "map" ? (
              <>
            <div className="relative w-full rounded-xl overflow-hidden mb-3 geo-map-shell">
              <svg
                viewBox={MAP_VIEWBOX}
                className="w-full block"
                role="group"
                aria-label="Tap the correct place on the map"
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
                      aria-label={name}
                      aria-disabled={answered || isEliminated}
                      className="geo-continent"
                      style={{ cursor: answered || isEliminated ? "default" : "pointer", transformOrigin: "center", transition: "fill 180ms ease, opacity 180ms ease, filter 140ms ease" }}
                    />
                  );
                })}
              </svg>
            </div>

            {!answered && (
              <p className="text-center text-xs mb-3" style={{ color: INK, opacity: 0.52 }}>
                Tap the correct place
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
                  let background = "rgba(16,24,40,0.05)";
                  let color = INK;
                  let border = "1px solid rgba(16,24,40,0.10)";
                  if (isCorrect) { background = "rgba(22,163,74,0.11)"; color = GREEN; border = `1px solid ${GREEN}55`; }
                  if (isWrong) { background = "rgba(229,72,77,0.10)"; color = RED; border = `1px solid ${RED}55`; }
                  return (
                    <button
                      key={option}
                      onClick={() => !isEliminated && pick(option)}
                      disabled={answered || isEliminated}
                      className="geo-option rounded-xl px-3 py-3 text-sm font-semibold transition-all min-h-[52px]"
                      style={{ background, color, border, opacity: isEliminated ? 0.22 : 1, cursor: answered || isEliminated ? "default" : "pointer" }}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            )}

            {answered && (
              <div className="mb-3 text-center rounded-xl px-3 py-2.5" style={{ background: selected === q.answer ? "rgba(22,163,74,0.09)" : "rgba(229,72,77,0.08)" }}>
                <div className="text-sm font-semibold" style={{ color: selected === q.answer ? GREEN : RED }}>
                  {selected === q.answer ? `Correct — ${q.answer}` : `${selected} — the answer is ${q.answer}`}
                </div>
              </div>
            )}

            {answered && (
              <button onClick={next} className="geo-next-btn w-full rounded-lg py-2.5 text-sm font-semibold transition-all" style={{ background: ACCENT, color: "#FFFFFF" }}>
                {isLast ? "See results" : "Next question"}
              </button>
            )}
          </>
        )}

        {solved && (
          <div className="flex flex-col items-center gap-2 py-4">
            <Globe2 size={32} style={{ color: ACCENT }} />
            <p style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600, color: INK }} className="text-2xl">
              {questions.length - mistakes}/{questions.length} correct
            </p>
            <p style={{ color: INK, opacity: 0.7 }} className="text-xs mb-1">
              {fmtTime(seconds)} &middot; {hintsUsed} hint{hintsUsed === 1 ? "" : "s"}
            </p>
            {savedStatId && <DifficultyRating onRate={(value) => rateDifficulty(savedStatId, value)} />}
            {!isChallenge && (
              <button onClick={() => newQuiz(dayIdx)} className="geo-next-btn mt-2 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors" style={{ background: ACCENT, color: "#FFFFFF" }}>
                Play again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
