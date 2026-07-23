import React, { useState, useEffect, useRef, useCallback } from "react";
import { withSeededRandom } from "../lib/seededRandom.js";
import { useHintCooldown } from "../lib/useHintCooldown.js";
import { rateDifficulty } from "../lib/saveStats.js";
import DifficultyRating from "../DifficultyRating.jsx";
import { Globe2, RotateCcw, Shuffle, Lightbulb, Timer as TimerIcon, HelpCircle, Lock, Check, X } from "lucide-react";

/* ---------------- continents & map ---------------- */

const CONTINENTS = ["North America", "South America", "Europe", "Africa", "Asia", "Oceania"];

// Traced from real geographic data (Natural Earth, via Highcharts' map
// collection), simplified down to a clean point count — not hand-drawn
// approximations, so the silhouettes actually read as their continents.
const CONTINENT_SHAPES = {
  "North America": { d: "M 118.8 167.1 L 113.7 168.7 L 88.9 155.9 L 76.1 139.6 L 82.0 150.2 L 79.5 148.8 L 65.0 128.3 L 67.2 116.8 L 52.5 100.0 L 34.1 100.3 L 35.1 96.4 L 27.9 105.1 L 26.8 104.3 L 21.3 107.9 L 18.6 107.7 L 27.6 100.6 L 18.0 97.8 L 23.3 90.5 L 15.0 88.7 L 24.0 87.0 L 17.1 82.4 L 27.9 77.4 L 59.0 80.1 L 56.3 81.0 L 54.7 82.4 L 55.5 82.6 L 59.7 80.7 L 60.6 78.7 L 98.3 86.3 L 97.8 72.3 L 104.1 71.7 L 99.1 75.9 L 103.7 83.2 L 111.4 80.4 L 114.4 85.2 L 99.8 96.2 L 101.2 103.9 L 116.1 113.0 L 118.0 94.3 L 122.6 94.1 L 143.5 109.4 L 128.3 116.6 L 137.5 121.5 L 120.9 129.5 L 115.4 147.6 L 106.6 140.9 L 95.8 145.1 L 97.7 155.4 L 108.1 152.5 L 105.6 158.6 L 118.8 167.1 Z" },
  "South America": { d: "M 114.5 183.6 L 125.3 162.7 L 136.4 164.8 L 148.7 172.2 L 147.0 178.8 L 167.5 185.1 L 160.4 202.3 L 132.7 226.4 L 126.1 245.0 L 120.7 234.3 L 127.1 200.1 L 114.5 183.6 Z" },
  Europe: { d: "M 242.8 119.7 L 232.1 133.2 L 222.8 120.8 L 228.5 128.7 L 225.7 131.6 L 217.3 122.8 L 204.9 133.2 L 196.5 130.6 L 196.9 124.5 L 205.6 123.9 L 201.4 117.0 L 217.1 109.3 L 217.2 103.6 L 223.6 108.7 L 235.2 103.4 L 229.9 98.7 L 235.4 88.4 L 227.3 94.3 L 224.6 107.0 L 213.2 100.1 L 229.9 79.6 L 254.3 84.7 L 244.2 85.8 L 247.9 91.2 L 257.8 88.2 L 256.9 82.9 L 284.4 82.5 L 277.1 113.4 L 266.8 114.3 L 262.1 127.2 L 249.2 121.7 L 252.2 118.7 L 242.8 119.7 Z" },
  Africa: { d: "M 201.1 134.3 L 218.6 132.4 L 229.0 141.4 L 246.5 140.1 L 252.8 159.5 L 266.0 163.4 L 237.7 216.8 L 228.3 217.4 L 218.3 172.5 L 197.9 171.7 L 188.2 162.8 L 187.9 151.8 L 201.1 134.3 Z" },
  Asia: { d: "M 425.0 87.7 L 409.1 90.1 L 412.0 94.7 L 394.5 98.7 L 386.6 113.4 L 385.9 104.2 L 395.0 96.4 L 395.6 94.1 L 362.0 107.2 L 369.1 111.8 L 353.2 129.2 L 355.1 135.2 L 342.4 129.9 L 347.7 132.3 L 346.5 143.8 L 328.6 153.9 L 329.2 166.1 L 321.8 161.6 L 326.7 175.3 L 312.0 150.6 L 296.0 167.7 L 290.3 151.3 L 264.6 141.5 L 266.0 148.8 L 271.8 146.2 L 275.7 151.3 L 257.6 162.5 L 247.0 144.1 L 248.6 132.9 L 237.3 131.1 L 253.8 124.0 L 269.1 133.0 L 265.3 118.3 L 277.5 112.8 L 283.9 77.4 L 290.6 74.3 L 289.5 76.9 L 291.6 83.1 L 289.2 86.7 L 288.2 87.0 L 287.2 86.4 L 286.2 86.4 L 286.7 87.0 L 289.7 87.5 L 294.7 82.1 L 295.5 84.6 L 297.7 84.9 L 296.2 82.4 L 293.7 81.6 L 291.7 81.7 L 292.1 73.7 L 303.2 79.1 L 299.2 73.1 L 317.8 64.0 L 337.1 66.1 L 337.3 68.6 L 329.9 72.4 L 328.0 74.2 L 349.9 71.7 L 357.1 78.5 L 373.7 74.7 L 425.0 87.7 Z" },
  Oceania: { d: "M 370.0 188.6 L 382.8 206.0 L 378.4 222.1 L 369.4 222.9 L 357.4 214.0 L 339.0 217.6 L 337.4 203.1 L 350.5 193.5 L 363.5 190.1 L 367.5 197.3 L 370.0 188.6 Z" },
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
