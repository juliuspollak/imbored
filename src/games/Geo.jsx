import React, { useState, useEffect, useRef, useCallback } from "react";
import { withSeededRandom } from "../lib/seededRandom.js";
import { useHintCooldown } from "../lib/useHintCooldown.js";
import { rateDifficulty } from "../lib/saveStats.js";
import DifficultyRating from "../DifficultyRating.jsx";
import { Globe2, RotateCcw, Shuffle, Lightbulb, Timer as TimerIcon, HelpCircle, Lock, Check, X } from "lucide-react";

/* ---------------- continents & map ---------------- */

const CONTINENTS = ["North America", "South America", "Europe", "Africa", "Asia", "Oceania"];

// Simplified, stylized blob shapes — recognizable by position and rough
// silhouette, not cartographically precise (the same spirit as Queens'
// colored regions: clean and legible, not a literal atlas).
const CONTINENT_SHAPES = {
  "North America": { d: "M 35 25 Q 15 45 25 75 L 45 95 Q 35 125 55 145 L 85 135 Q 105 115 125 105 L 135 75 Q 145 45 125 25 Q 95 5 65 10 Z" },
  "South America": { d: "M 95 150 Q 85 165 90 195 L 100 235 Q 110 250 120 235 L 130 195 Q 135 165 120 150 Z" },
  Europe: { d: "M 225 25 Q 215 40 225 55 L 245 65 Q 265 60 270 40 Q 265 20 245 15 Z" },
  Africa: { d: "M 220 70 Q 205 95 215 135 L 230 185 Q 245 200 260 185 L 270 135 Q 275 95 260 70 Q 240 60 220 70 Z" },
  Asia: { d: "M 275 15 Q 265 35 280 55 L 295 75 Q 315 85 345 80 L 395 70 Q 425 55 415 30 Q 395 5 355 5 Q 315 0 275 15 Z" },
  Oceania: { d: "M 375 175 Q 365 190 380 205 L 405 210 Q 425 200 420 180 Q 405 165 385 170 Z" },
};
const MAP_VIEWBOX = "0 0 440 260";

/* ---------------- question bank ----------------
   Every fact below is a well-established, unambiguous one — deliberately
   avoiding genuinely contested cases (transcontinental countries like
   Russia or Turkey, animals native to multiple continents) so nothing in
   here is actually debatable. difficulty: 1 = famous/easy, 3 = obscure. */

const CITIES = [
  { name: "Paris", continent: "Europe", difficulty: 1 },
  { name: "Tokyo", continent: "Asia", difficulty: 1 },
  { name: "Cairo", continent: "Africa", difficulty: 1 },
  { name: "New York", continent: "North America", difficulty: 1 },
  { name: "Sydney", continent: "Oceania", difficulty: 1 },
  { name: "Rio de Janeiro", continent: "South America", difficulty: 1 },
  { name: "Nairobi", continent: "Africa", difficulty: 2 },
  { name: "Bangkok", continent: "Asia", difficulty: 2 },
  { name: "Toronto", continent: "North America", difficulty: 2 },
  { name: "Lima", continent: "South America", difficulty: 2 },
  { name: "Berlin", continent: "Europe", difficulty: 2 },
  { name: "Auckland", continent: "Oceania", difficulty: 2 },
  { name: "Marrakesh", continent: "Africa", difficulty: 2 },
  { name: "Ho Chi Minh City", continent: "Asia", difficulty: 2 },
  { name: "Bogotá", continent: "South America", difficulty: 2 },
  { name: "Ulaanbaatar", continent: "Asia", difficulty: 3 },
  { name: "Ouagadougou", continent: "Africa", difficulty: 3 },
  { name: "Quito", continent: "South America", difficulty: 3 },
  { name: "Wellington", continent: "Oceania", difficulty: 3 },
  { name: "Reykjavik", continent: "Europe", difficulty: 3 },
  { name: "Winnipeg", continent: "North America", difficulty: 3 },
];

const ANIMALS = [
  { name: "Kangaroo", continent: "Oceania", difficulty: 1 },
  { name: "Giant panda", continent: "Asia", difficulty: 1 },
  { name: "Lion", continent: "Africa", difficulty: 1 },
  { name: "Bald eagle", continent: "North America", difficulty: 1 },
  { name: "Jaguar", continent: "South America", difficulty: 1 },
  { name: "Koala", continent: "Oceania", difficulty: 1 },
  { name: "Giraffe", continent: "Africa", difficulty: 1 },
  { name: "Grizzly bear", continent: "North America", difficulty: 2 },
  { name: "Orangutan", continent: "Asia", difficulty: 2 },
  { name: "Llama", continent: "South America", difficulty: 2 },
  { name: "Platypus", continent: "Oceania", difficulty: 2 },
  { name: "Zebra", continent: "Africa", difficulty: 2 },
  { name: "Sloth", continent: "South America", difficulty: 2 },
  { name: "Moose", continent: "North America", difficulty: 2 },
  { name: "Iberian lynx", continent: "Europe", difficulty: 3 },
  { name: "Komodo dragon", continent: "Asia", difficulty: 3 },
  { name: "Capybara", continent: "South America", difficulty: 3 },
  { name: "Tasmanian devil", continent: "Oceania", difficulty: 3 },
  { name: "Alpine ibex", continent: "Europe", difficulty: 3 },
  { name: "Snow leopard", continent: "Asia", difficulty: 3 },
];

const LANDMARKS = [
  { name: "Eiffel Tower", continent: "Europe", difficulty: 1 },
  { name: "Great Wall of China", continent: "Asia", difficulty: 1 },
  { name: "Pyramids of Giza", continent: "Africa", difficulty: 1 },
  { name: "Statue of Liberty", continent: "North America", difficulty: 1 },
  { name: "Sydney Opera House", continent: "Oceania", difficulty: 1 },
  { name: "Machu Picchu", continent: "South America", difficulty: 1 },
  { name: "Colosseum", continent: "Europe", difficulty: 2 },
  { name: "Taj Mahal", continent: "Asia", difficulty: 2 },
  { name: "Victoria Falls", continent: "Africa", difficulty: 2 },
  { name: "Niagara Falls", continent: "North America", difficulty: 2 },
  { name: "Christ the Redeemer", continent: "South America", difficulty: 2 },
  { name: "Uluru", continent: "Oceania", difficulty: 2 },
  { name: "Stonehenge", continent: "Europe", difficulty: 3 },
  { name: "Angkor Wat", continent: "Asia", difficulty: 3 },
  { name: "Table Mountain", continent: "Africa", difficulty: 3 },
  { name: "Chichén Itzá", continent: "North America", difficulty: 3 },
  { name: "Iguazu Falls", continent: "South America", difficulty: 3 },
  { name: "Great Barrier Reef", continent: "Oceania", difficulty: 3 },
];

/* ---------------- generation ---------------- */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildOptions(correctContinent) {
  const wrong = shuffle(CONTINENTS.filter((c) => c !== correctContinent)).slice(0, 3);
  return shuffle([correctContinent, ...wrong]);
}

// Mon..Sun: difficulty ceiling ramps from "easy only" to "anything goes".
const DIFFICULTY_CEILING = [1, 1, 2, 2, 3, 3, 3];

function generateQuiz(dayIdx) {
  const ceiling = DIFFICULTY_CEILING[dayIdx];
  const pools = {
    city: CITIES.filter((q) => q.difficulty <= ceiling),
    animal: ANIMALS.filter((q) => q.difficulty <= ceiling),
    landmark: LANDMARKS.filter((q) => q.difficulty <= ceiling),
  };
  const mapContinent = shuffle(CONTINENTS)[0];
  const questions = [
    { type: "map", prompt: "Which continent is highlighted?", answer: mapContinent, options: buildOptions(mapContinent) },
  ];
  const types = shuffle(["city", "animal", "landmark", "city", "animal"]);
  const used = new Set();
  for (const type of types) {
    const pool = pools[type].filter((q) => !used.has(q.name));
    const pick = shuffle(pool)[0];
    if (!pick) continue;
    used.add(pick.name);
    const prompt =
      type === "city" ? `Which continent is ${pick.name} in?` : type === "animal" ? `Which continent is the ${pick.name} native to?` : `Which continent is the ${pick.name} in?`;
    questions.push({ type, prompt, answer: pick.continent, options: buildOptions(pick.continent) });
  }
  return questions.slice(0, 5);
}

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
  const [eliminated, setEliminated] = useState([]); // options removed by the 50/50 hint, this question only
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [solved, setSolved] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const timerRef = useRef(null);

  const newQuiz = useCallback((dIdx) => {
    const gen = () => generateQuiz(dIdx);
    const qs = isChallenge && seed ? withSeededRandom(seed, gen) : gen();
    setQuestions(qs);
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
  }, [isChallenge, seed]);

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
    const wrongOptions = q.options.filter((o) => o !== q.answer);
    const toEliminate = shuffle(wrongOptions).slice(0, 2);
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
          <p style={{ color: INK, opacity: 0.45 }} className="text-xs mt-1">five questions a day — capitals, landmarks &amp; wildlife</p>
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
          <div style={{ color: INK, opacity: 0.7 }} className="text-xs">
            missed: <span style={{ color: mistakes > 0 ? RED : INK }}>{mistakes}</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 mb-4">
          {[
            { Icon: RotateCcw, label: "Restart", onClick: handleReset, disabled: solved },
            { Icon: Shuffle, label: "New", onClick: () => newQuiz(dayIdx), disabled: isChallenge },
            {
              Icon: hintCooldown.locked ? Lock : Lightbulb,
              label: hintCooldown.locked ? `${hintCooldown.remaining}s` : "50/50",
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
            Five questions, one tap each. 50/50 removes two wrong options — it locks for a bit after use if the admin's set a cooldown.
            Missed answers don't block you from continuing, they just count against your result.
          </div>
        )}

        {!solved && (
          <>
            {q.type === "map" && (
              <div className="relative w-full rounded-xl overflow-hidden mb-4">
                <svg viewBox={MAP_VIEWBOX} className="w-full" style={{ background: "#DCE9F7", borderRadius: 12 }}>
                  {Object.entries(CONTINENT_SHAPES).map(([name, shape]) => (
                    <path key={name} d={shape.d} fill={name === q.answer ? ACCENT : "#B9CDE0"} stroke="#FFFFFF" strokeWidth={1.5} />
                  ))}
                </svg>
              </div>
            )}

            <p style={{ color: INK, fontWeight: 600 }} className="text-base text-center mb-4">
              {q.prompt}
            </p>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {q.options.map((opt) => {
                const isEliminated = eliminated.includes(opt);
                const isCorrectAnswer = opt === q.answer;
                const isPicked = opt === selected;
                let bg = PANEL, border = "1.5px solid rgba(16,24,40,0.12)", color = INK;
                if (answered && isCorrectAnswer) {
                  bg = "rgba(22,163,74,0.1)"; border = `1.5px solid ${GREEN}`; color = GREEN;
                } else if (answered && isPicked && !isCorrectAnswer) {
                  bg = "rgba(229,72,77,0.1)"; border = `1.5px solid ${RED}`; color = RED;
                }
                return (
                  <button
                    key={opt}
                    onClick={() => pick(opt)}
                    disabled={answered || isEliminated}
                    className="geo-option rounded-xl py-3 px-2 text-sm font-medium transition-all flex items-center justify-center gap-1.5"
                    style={{ background: isEliminated ? "rgba(16,24,40,0.03)" : bg, border, color: isEliminated ? "rgba(27,33,41,0.25)" : color, textDecoration: isEliminated ? "line-through" : "none" }}
                  >
                    {answered && isCorrectAnswer && <Check size={14} />}
                    {answered && isPicked && !isCorrectAnswer && <X size={14} />}
                    {opt}
                  </button>
                );
              })}
            </div>

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
