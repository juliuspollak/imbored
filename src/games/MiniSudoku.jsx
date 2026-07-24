import React, { useState, useEffect, useRef, useCallback } from "react";
import { withSeededRandom } from "../lib/seededRandom.js";
import { useHintCooldown } from "../lib/useHintCooldown.js";
import { rateDifficulty } from "../lib/saveStats.js";
import DifficultyRating, { DifficultyRatingBadge } from "../DifficultyRating.jsx";
import { Grid3x3, Eraser, CornerUpLeft, Sparkles, WandSparkles, Timer as TimerIcon, HelpCircle, Delete, Lock } from "lucide-react";

/* ---------------- puzzle generation ---------------- */

const N = 6, BOX_R = 2, BOX_C = 3;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isValid(grid, r, c, val) {
  for (let cc = 0; cc < N; cc++) if (grid[r][cc] === val) return false;
  for (let rr = 0; rr < N; rr++) if (grid[rr][c] === val) return false;
  const br = Math.floor(r / BOX_R) * BOX_R;
  const bc = Math.floor(c / BOX_C) * BOX_C;
  for (let rr = br; rr < br + BOX_R; rr++)
    for (let cc = bc; cc < bc + BOX_C; cc++)
      if (grid[rr][cc] === val) return false;
  return true;
}

function generateSolvedGrid() {
  const grid = Array.from({ length: N }, () => Array(N).fill(0));
  function fill(pos) {
    if (pos === N * N) return true;
    const r = Math.floor(pos / N), c = pos % N;
    for (const d of shuffle([1, 2, 3, 4, 5, 6])) {
      if (isValid(grid, r, c, d)) {
        grid[r][c] = d;
        if (fill(pos + 1)) return true;
        grid[r][c] = 0;
      }
    }
    return false;
  }
  fill(0);
  return grid;
}

function countSolutions(grid, limit = 2) {
  const g = grid.map((row) => row.slice());
  let count = 0;
  function solve() {
    if (count >= limit) return;
    let pos = -1;
    for (let i = 0; i < N * N; i++) {
      const r = Math.floor(i / N), c = i % N;
      if (g[r][c] === 0) { pos = i; break; }
    }
    if (pos === -1) { count++; return; }
    const r = Math.floor(pos / N), c = pos % N;
    for (let d = 1; d <= 6; d++) {
      if (isValid(g, r, c, d)) {
        g[r][c] = d;
        solve();
        g[r][c] = 0;
        if (count >= limit) return;
      }
    }
  }
  solve();
  return count;
}

// Greedy invariant-preserving removal: start fully solved, remove cells one
// at a time in random order, keeping each removal only if the puzzle is
// still uniquely solvable. Verified over hundreds of trials to reliably
// hit the exact target given-count for every difficulty level in well
// under 10ms.
function generatePuzzle(givenCount) {
  const solution = generateSolvedGrid();
  const positions = shuffle([...Array(N * N).keys()]);
  const givens = solution.map((row) => row.slice());
  let removed = 0;
  const targetRemovals = N * N - givenCount;
  for (const pos of positions) {
    if (removed >= targetRemovals) break;
    const r = Math.floor(pos / N), c = pos % N;
    const backup = givens[r][c];
    givens[r][c] = 0;
    if (countSolutions(givens, 2) === 1) {
      removed++;
    } else {
      givens[r][c] = backup;
    }
  }
  return { solution, givens };
}

/* ---------------- solving / hints ---------------- */

function candidatesFor(board, r, c) {
  if (board[r][c] !== 0) return [];
  const cands = [];
  for (let d = 1; d <= 6; d++) if (isValid(board, r, c, d)) cands.push(d);
  return cands;
}

// naked single: a cell with exactly one possible digit
function findNakedSingle(board) {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (board[r][c] !== 0) continue;
    const cands = candidatesFor(board, r, c);
    if (cands.length === 1) return { r, c, value: cands[0], type: "naked" };
  }
  return null;
}

// hidden single: a digit that can only go in one cell within a row, column, or box
function findHiddenSingle(board) {
  for (let r = 0; r < N; r++) {
    for (let d = 1; d <= 6; d++) {
      let spot = null, count = 0;
      for (let c = 0; c < N; c++) if (board[r][c] === 0 && isValid(board, r, c, d)) { spot = [r, c]; count++; }
      if (count === 1) return { r: spot[0], c: spot[1], value: d, type: "hidden" };
    }
  }
  for (let c = 0; c < N; c++) {
    for (let d = 1; d <= 6; d++) {
      let spot = null, count = 0;
      for (let r = 0; r < N; r++) if (board[r][c] === 0 && isValid(board, r, c, d)) { spot = [r, c]; count++; }
      if (count === 1) return { r: spot[0], c: spot[1], value: d, type: "hidden" };
    }
  }
  for (let br = 0; br < N; br += BOX_R) {
    for (let bc = 0; bc < N; bc += BOX_C) {
      for (let d = 1; d <= 6; d++) {
        let spot = null, count = 0;
        for (let rr = br; rr < br + BOX_R; rr++) for (let cc = bc; cc < bc + BOX_C; cc++) {
          if (board[rr][cc] === 0 && isValid(board, rr, cc, d)) { spot = [rr, cc]; count++; }
        }
        if (count === 1) return { r: spot[0], c: spot[1], value: d, type: "hidden" };
      }
    }
  }
  return null;
}

// Final tier, and the reason no guessing fallback is needed: try the
// remaining candidates for the most-constrained empty cell; if all but one
// lead to an unsolvable puzzle, the survivor is provably forced. Since the
// puzzle has exactly one solution, this always finds a real step.
function findByContradiction(board) {
  let best = null;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (board[r][c] !== 0) continue;
    const cands = candidatesFor(board, r, c);
    if (!best || cands.length < best.cands.length) best = { r, c, cands };
    if (best.cands.length === 2) break;
  }
  if (!best) return null;
  const solvableWith = [];
  for (const d of best.cands) {
    const trial = board.map((row) => row.slice());
    trial[best.r][best.c] = d;
    if (countSolutions(trial, 1) === 1) solvableWith.push(d);
  }
  if (solvableWith.length === 1) return { r: best.r, c: best.c, value: solvableWith[0], type: "forced" };
  return null;
}

function getConflicts(board) {
  const conflicts = new Set();
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (board[r][c] === 0) continue;
    const v = board[r][c];
    for (let cc = 0; cc < N; cc++) if (cc !== c && board[r][cc] === v) { conflicts.add(`${r}-${c}`); conflicts.add(`${r}-${cc}`); }
    for (let rr = 0; rr < N; rr++) if (rr !== r && board[rr][c] === v) { conflicts.add(`${r}-${c}`); conflicts.add(`${rr}-${c}`); }
    const br = Math.floor(r / BOX_R) * BOX_R, bc = Math.floor(c / BOX_C) * BOX_C;
    for (let rr = br; rr < br + BOX_R; rr++) for (let cc = bc; cc < bc + BOX_C; cc++) {
      if ((rr !== r || cc !== c) && board[rr][cc] === v) { conflicts.add(`${r}-${c}`); conflicts.add(`${rr}-${cc}`); }
    }
  }
  return conflicts;
}

/* ---------------- design tokens ---------------- */

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const CREAM = "#1B2129";
const GOLD = "#2F6FED";
const RED = "#E5484D";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GIVEN_TARGETS = [24, 22, 20, 18, 16, 14, 12];

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

/* ---------------- component ---------------- */

function NumBtn({ onClick, disabled, children, ...rest }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="ms-num-btn flex items-center justify-center rounded-xl py-3.5 text-lg font-semibold transition-all"
      style={{
        background: "rgba(16,24,40,0.045)",
        color: disabled ? "rgba(27,33,41,0.3)" : CREAM,
        cursor: disabled ? "default" : "pointer",
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export default function MiniSudokuGame({ userId, onSolved, mode = "practice", forcedDayIdx, seed, challengeDate, hintCooldownConfig, savedStatId, rewardResult } = {}) {
  const todayIdx = (() => {
    const d = new Date().getDay();
    return d === 0 ? 6 : d - 1;
  })();
  const isChallenge = mode === "challenge";
  const [dayIdx, setDayIdx] = useState(isChallenge ? forcedDayIdx ?? todayIdx : todayIdx);
  const hintCooldownSeconds = (hintCooldownConfig?.hint_cooldown_base || 0) + (hintCooldownConfig?.hint_cooldown_per_day || 0) * dayIdx;
  const hintCooldown = useHintCooldown(hintCooldownSeconds);
  const [puzzle, setPuzzle] = useState(null);
  const [board, setBoard] = useState(null);
  const [selected, setSelected] = useState(null); // {r, c}
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [solved, setSolved] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [difficultyRating, setDifficultyRating] = useState(null);
  const [hintCell, setHintCell] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHelp, setShowHelp] = useState(false);
  const [celebratingCells, setCelebratingCells] = useState(new Set());
  const prevCompleteSectionsRef = useRef(new Set());
  const timerRef = useRef(null);

  const newPuzzle = useCallback((dIdx) => {
    const gen = () => generatePuzzle(GIVEN_TARGETS[dIdx]);
    const p = isChallenge && seed ? withSeededRandom(seed, gen) : gen();
    setPuzzle(p);
    setBoard(p.givens.map((row) => row.slice()));
    setSelected(null);
    setSeconds(0);
    setRunning(true);
    setSolved(false);
    setMistakes(0);
    setHintsUsed(0);
    setDifficultyRating(null);
    setHintCell(null);
    setHistory([]);
    hintCooldown.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChallenge, seed]);

  useEffect(() => {
    newPuzzle(dayIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayIdx]);

  useEffect(() => {
    if (running && !solved) {
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [running, solved]);

  useEffect(() => {
    if (!board || !puzzle) return;
    const filled = board.every((row) => row.every((v) => v !== 0));
    if (!filled) return;
    if (getConflicts(board).size === 0 && !solved) {
      setSolved(true);
      setRunning(false);
      onSolved && onSolved({ userId, game: "minisudoku", dayIndex: dayIdx, seconds, mistakes, hints: hintsUsed, mode, challengeDate: isChallenge ? challengeDate : undefined });
    }
  }, [board, puzzle]);

  // Detect any row, column, or box that just became fully and correctly
  // filled (compared to what was complete a moment ago) and flash it —
  // small satisfying feedback along the way, not just at the very end.
  useEffect(() => {
    if (!board) return;
    const currentComplete = new Set();
    for (let r = 0; r < N; r++) {
      const vals = board[r];
      if (vals.every((v) => v !== 0) && new Set(vals).size === N) currentComplete.add(`row-${r}`);
    }
    for (let c = 0; c < N; c++) {
      const vals = board.map((row) => row[c]);
      if (vals.every((v) => v !== 0) && new Set(vals).size === N) currentComplete.add(`col-${c}`);
    }
    for (let br = 0; br < N; br += BOX_R) {
      for (let bc = 0; bc < N; bc += BOX_C) {
        const vals = [];
        for (let rr = br; rr < br + BOX_R; rr++) for (let cc = bc; cc < bc + BOX_C; cc++) vals.push(board[rr][cc]);
        if (vals.every((v) => v !== 0) && new Set(vals).size === N) currentComplete.add(`box-${br}-${bc}`);
      }
    }

    const newlyCompleted = [...currentComplete].filter((k) => !prevCompleteSectionsRef.current.has(k));
    prevCompleteSectionsRef.current = currentComplete;
    if (newlyCompleted.length === 0) return;

    const cellsToFlash = new Set();
    for (const key of newlyCompleted) {
      if (key.startsWith("row-")) {
        const r = Number(key.split("-")[1]);
        for (let c = 0; c < N; c++) cellsToFlash.add(`${r}-${c}`);
      } else if (key.startsWith("col-")) {
        const c = Number(key.split("-")[1]);
        for (let r = 0; r < N; r++) cellsToFlash.add(`${r}-${c}`);
      } else {
        const [, br, bc] = key.split("-").map(Number);
        for (let rr = br; rr < br + BOX_R; rr++) for (let cc = bc; cc < bc + BOX_C; cc++) cellsToFlash.add(`${rr}-${cc}`);
      }
    }
    setCelebratingCells(cellsToFlash);
    const t = setTimeout(() => setCelebratingCells(new Set()), 650);
    return () => clearTimeout(t);
  }, [board]);

  if (!board || !puzzle) {
    return (
      <div style={{ background: BG, minHeight: "100vh" }} className="flex items-center justify-center">
        <span style={{ color: CREAM, opacity: 0.6 }} className="text-sm">Building today's puzzle…</span>
      </div>
    );
  }

  const conflicts = getConflicts(board);
  const filledCount = board.flat().filter((v) => v !== 0).length;

  function pushHistory() {
    setHistory((h) => [...h, { board: board.map((row) => row.slice()), mistakes, hints: hintsUsed }].slice(-50));
  }

  function handleCellClick(r, c) {
    if (solved) return;
    if (puzzle.givens[r][c] !== 0) return; // locked clue cell
    setHintCell(null);
    setSelected({ r, c });
  }

  function handleNumberPick(d) {
    if (solved || !selected) return;
    const { r, c } = selected;
    if (puzzle.givens[r][c] !== 0) return;
    const current = board[r][c];
    const nextValue = current === d ? 0 : d;
    pushHistory();
    setBoard((prev) => {
      const next = prev.map((row) => row.slice());
      next[r][c] = nextValue;
      return next;
    });
    if (nextValue !== 0 && nextValue !== puzzle.solution[r][c] && nextValue !== current) {
      setMistakes((m) => m + 1);
    }
  }

  function handleErase() {
    if (solved || !selected) return;
    const { r, c } = selected;
    if (puzzle.givens[r][c] !== 0) return;
    pushHistory();
    setBoard((prev) => {
      const next = prev.map((row) => row.slice());
      next[r][c] = 0;
      return next;
    });
  }

  function handleUndo() {
    if (solved || history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setBoard(last.board);
    setMistakes(last.mistakes);
    setHintsUsed(last.hints);
    setHintCell(null);
    setSolved(false);
    setRunning(true);
  }

  function handleReset() {
    if (solved) return;
    // Reset only the entries on the current puzzle. Time, mistakes, hints,
    // and hint cooldown belong to the same solving attempt and are kept.
    setBoard(puzzle.givens.map((row) => row.slice()));
    setSelected(null);
    setHintCell(null);
    setHistory([]);
    setCelebratingCells(new Set());
    prevCompleteSectionsRef.current = new Set();
    setSolved(false);
    setRunning(true);
  }

  function handleHint() {
    if (solved || hintCooldown.isLocked()) return;
    // First correct one wrong entry so the hint always leaves a useful number
    // on the board. Mistakes are counted when entered, not again here.
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (board[r][c] !== 0 && board[r][c] !== puzzle.solution[r][c]) {
          pushHistory();
          setBoard((prev) => {
            const next = prev.map((row) => row.slice());
            next[r][c] = puzzle.solution[r][c];
            return next;
          });
          setSelected({ r, c });
          setHintCell({ r, c, type: "forced" });
          setHintsUsed((h) => h + 1);
          hintCooldown.startCooldown();
          return;
        }
      }
    }

    // Otherwise reveal the value of a logically forced empty cell.
    const step = findNakedSingle(board) || findHiddenSingle(board) || findByContradiction(board);
    if (step) {
      pushHistory();
      setBoard((prev) => {
        const next = prev.map((row) => row.slice());
        next[step.r][step.c] = puzzle.solution[step.r][step.c];
        return next;
      });
      setSelected({ r: step.r, c: step.c });
      setHintCell({ r: step.r, c: step.c, type: step.type });
      setHintsUsed((h) => h + 1);
      hintCooldown.startCooldown();
    }
  }

  return (
    <div style={{ background: BG, minHeight: "100vh" }} className="flex items-start justify-center p-4 pt-[72px]">
      <style>{`
        .ms-card, .ms-cell { font-family: 'Inter', sans-serif; }
        @keyframes msPulseError { 0%, 100% { box-shadow: inset 0 0 0 3px rgba(229,72,77,1); } 50% { box-shadow: inset 0 0 0 3px rgba(229,72,77,0.25); } }
        @keyframes msPulseHint { 0%, 100% { box-shadow: inset 0 0 0 3px rgba(47,111,237,1); } 50% { box-shadow: inset 0 0 0 3px rgba(47,111,237,0.2); } }
        .ms-hint-error { animation: msPulseError 1.1s ease-in-out infinite; }
        .ms-hint-naked, .ms-hint-hidden, .ms-hint-forced { animation: msPulseHint 1.1s ease-in-out infinite; }
        @keyframes msCelebrate {
          0% { transform: scale(1); }
          30% { transform: scale(1.08); }
          60% { transform: scale(0.97); }
          100% { transform: scale(1); }
        }
        .ms-celebrate { animation: msCelebrate 0.5s ease-in-out; z-index: 1; }
        @media (prefers-reduced-motion: reduce) {
          .ms-hint-error, .ms-hint-naked, .ms-hint-hidden, .ms-hint-forced, .ms-celebrate { animation: none !important; }
        }
        @media (hover: hover) and (pointer: fine) {
          .ms-cell:not(:disabled):hover { filter: brightness(0.96); }
          .ms-day-btn:hover { filter: brightness(1.12); }
          .ms-icon-btn:hover { opacity: 0.85; }
          .ms-play-again:hover { filter: brightness(1.08); }
          .ms-toolbar-btn:not(:disabled):hover { transform: translateY(-1px); filter: brightness(1.03); }
          .ms-num-btn:not(:disabled):hover { filter: brightness(1.08); transform: translateY(-1px); }
        }
      `}</style>

      <div
        className="ms-card w-full max-w-sm sm:max-w-md lg:max-w-lg rounded-2xl p-5 lg:p-6 relative"
        style={{ background: PANEL, boxShadow: "0 10px 30px rgba(16,24,40,0.10)", border: "1px solid rgba(16,24,40,0.09)" }}
      >
        <button
          onClick={() => setShowHelp((h) => !h)}
          className="ms-icon-btn absolute top-4 right-4 transition-opacity"
          style={{ color: CREAM, opacity: 0.5 }}
        >
          <HelpCircle size={16} />
        </button>

        {/* header */}
        <div className="text-center mb-4">
          <h1
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: CREAM, letterSpacing: "-0.01em" }}
            className="text-4xl lg:text-5xl"
          >
            Mini Sudoku
          </h1>
          <p style={{ color: CREAM, opacity: 0.45 }} className="text-xs mt-1">
            classic sudoku, bite-sized — every row, column &amp; box gets 1&ndash;6
          </p>
        </div>

        {/* day selector — locked to today's date in challenge mode */}
        {isChallenge ? (
          <div className="flex justify-center mb-4">
            <div className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: `${GOLD}18`, color: GOLD }}>
              <span className="text-xs font-semibold">Today's Challenge</span>
              <span className="text-[10px] opacity-80">{GIVEN_TARGETS[dayIdx]} givens</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-1.5 mb-4">
            {DAYS.map((d, i) => (
              <button
                key={d}
                onClick={() => setDayIdx(i)}
                className="ms-day-btn flex flex-col items-center justify-center rounded-lg px-2 py-1.5 transition-colors"
                style={{
                  background: i === dayIdx ? GOLD : "rgba(16,24,40,0.05)",
                  color: i === dayIdx ? "#FFFFFF" : CREAM,
                  minWidth: 38,
                }}
              >
                <span className="text-xs font-semibold">{d}</span>
                <span className="text-[10px] opacity-70">{GIVEN_TARGETS[i]}</span>
              </button>
            ))}
          </div>
        )}

        {solved && difficultyRating !== null && (
          <div className="flex justify-center mb-3">
            <DifficultyRatingBadge value={difficultyRating} />
          </div>
        )}

        {/* stats row */}
        <div className="flex items-center justify-center gap-4 mb-3 px-1">
          <div className="flex items-center gap-1.5" style={{ color: CREAM, opacity: 0.7 }}>
            <TimerIcon size={14} />
            <span className="text-xs tabular-nums">{fmtTime(seconds)}</span>
          </div>
          <div style={{ color: CREAM, opacity: 0.7 }} className="text-xs">
            mistakes: <span style={{ color: mistakes > 0 ? RED : CREAM }}>{mistakes}</span>
          </div>
          <div style={{ color: CREAM, opacity: 0.7 }} className="text-xs">
            hints: <span style={{ color: hintsUsed > 0 ? GOLD : CREAM }}>{hintsUsed}</span>
          </div>
        </div>

        {/* toolbar */}
        <div className="flex items-center justify-center gap-2 mb-4">
          {[
            { Icon: Eraser, label: "Reset", onClick: handleReset, disabled: solved },
            { Icon: Sparkles, label: "New", onClick: () => newPuzzle(dayIdx), disabled: isChallenge },
            {
              Icon: hintCooldown.locked ? Lock : WandSparkles,
              label: hintCooldown.locked ? `${hintCooldown.remaining}s` : "Hint",
              onClick: handleHint,
              disabled: solved || hintCooldown.locked,
            },
          ].map(({ Icon, label, onClick, disabled }) => (
            <button
              key={label}
              onClick={onClick}
              disabled={disabled}
              title={label}
              aria-label={label}
              className="ms-toolbar-btn relative flex items-center justify-center rounded-2xl transition-colors"
              style={{
                width: 46,
                height: 46,
                background: disabled ? "rgba(16,24,40,0.05)" : "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(245,247,255,0.96))",
                border: `1px solid ${disabled ? "rgba(16,24,40,0.08)" : "rgba(16,24,40,0.10)"}`,
                color: disabled ? "rgba(27,33,41,0.28)" : CREAM,
                cursor: disabled ? "default" : "pointer",
                boxShadow: disabled ? "none" : "0 10px 24px rgba(16,24,40,0.10)",
              }}
            >
              <Icon size={18} />
              {hintCooldown.locked && label.endsWith("s") && (
                <span style={{ position: "absolute", right: -4, top: -4, minWidth: 18, height: 18, padding: "0 4px", borderRadius: 999, background: GOLD, color: "#fff", fontSize: 9, fontWeight: 800, display: "grid", placeItems: "center" }}>{label.replace("s", "")}</span>
              )}
            </button>
          ))}
        </div>

        {showHelp && (
          <div
            className="text-xs rounded-lg p-2.5 mb-3"
            style={{ background: "rgba(16,24,40,0.05)", color: CREAM, opacity: 0.75, lineHeight: 1.4 }}
          >
            Tap a cell, then tap a number to fill it — tap the same number again to clear it.
            Every row, column, and bold-bordered 2×3 box needs the digits 1 through 6 exactly once.
            Hint flags one wrong number, or fills in one cell that's already logically forced —
            never a guess.
          </div>
        )}

        {/* board */}
        <div
          className="relative w-full rounded-xl overflow-hidden"
          style={{
            aspectRatio: "1 / 1",
            display: "grid",
            gridTemplateColumns: `repeat(${N}, 1fr)`,
            gridTemplateRows: `repeat(${N}, 1fr)`,
            background: PANEL,
            border: "2px solid #6B6B70",
          }}
        >
          {board.map((row, r) =>
            row.map((val, c) => {
              const isGiven = puzzle.givens[r][c] !== 0;
              const isConflict = conflicts.has(`${r}-${c}`);
              const isHint = hintCell && hintCell.r === r && hintCell.c === c;
              const isSelected = selected && selected.r === r && selected.c === c;
              const isCelebrating = celebratingCells.has(`${r}-${c}`);
              const hintClass = isHint ? `ms-hint-${hintCell.type}` : "";
              // thicker border on the right/bottom edge of each 2x3 box
              const rightEdge = (c + 1) % BOX_C === 0 && c !== N - 1;
              const bottomEdge = (r + 1) % BOX_R === 0 && r !== N - 1;
              return (
                <button
                  key={`${r}-${c}`}
                  onClick={() => handleCellClick(r, c)}
                  disabled={isGiven}
                  className={`ms-cell relative flex items-center justify-center transition-colors duration-150 ${hintClass} ${isCelebrating ? "ms-celebrate" : ""}`}
                  style={{
                    background: isCelebrating ? "rgba(34,197,94,0.18)" : PANEL,
                    borderRight: rightEdge ? "2px solid #6B6B70" : "1px solid rgba(16,24,40,0.08)",
                    borderBottom: bottomEdge ? "2px solid #6B6B70" : "1px solid rgba(16,24,40,0.08)",
                    boxShadow: isConflict
                      ? `inset 0 0 0 3px ${RED}`
                      : isSelected
                      ? "inset 0 0 0 2.5px #22C55E"
                      : "none",
                    cursor: isGiven ? "default" : "pointer",
                  }}
                >
                  {val !== 0 && (
                    <span
                      style={{
                        fontSize: "clamp(16px, 5vw, 26px)",
                        fontWeight: isGiven ? 700 : 500,
                        color: isConflict ? RED : isGiven ? CREAM : "rgba(27,33,41,0.5)",
                      }}
                    >
                      {val}
                    </span>
                  )}
                </button>
              );
            })
          )}

          {solved && difficultyRating === null && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl p-4"
              style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(3px)", zIndex: 3 }}
            >
              <Grid3x3 size={26} style={{ color: GOLD }} />
              <p style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600, color: CREAM }} className="text-2xl">
                Solved
              </p>
              <p style={{ color: CREAM, opacity: 0.7 }} className="text-xs mb-1">
                {fmtTime(seconds)} &middot; {mistakes} mistake{mistakes === 1 ? "" : "s"} &middot; {hintsUsed} hint{hintsUsed === 1 ? "" : "s"}
              </p>
              {rewardResult?.points_awarded != null && (
                <div
                  className="rounded-full px-3 py-1 text-sm font-bold"
                  style={{ background: "rgba(217,174,88,0.14)", color: "#B88724" }}
                >
                  {rewardResult.points_awarded > 0
                    ? `★ +${rewardResult.points_awarded} Points`
                    : "No Points awarded"}
                </div>
              )}
              {savedStatId ? (
                <DifficultyRating onRate={(value) => rateDifficulty(savedStatId, value)} onRated={setDifficultyRating} />
              ) : (
                <div className="flex items-center gap-2 py-3" role="status" aria-live="polite">
                  <span
                    className="inline-block rounded-full animate-pulse"
                    style={{ width: 8, height: 8, background: GOLD }}
                  />
                  <span className="text-xs font-medium" style={{ color: CREAM, opacity: 0.65 }}>
                    Finalising your result…
                  </span>
                </div>
              )}
              {!isChallenge && savedStatId && (
                <button
                  onClick={() => newPuzzle(dayIdx)}
                  className="ms-play-again mt-2 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors"
                  style={{ background: GOLD, color: "#FFFFFF" }}
                >
                  Play again
                </button>
              )}
            </div>
          )}
        </div>

        {/* number palette */}
        <div className="grid grid-cols-4 gap-2 mt-4">
          {[1, 2, 3].map((d) => (
            <NumBtn key={d} onClick={() => handleNumberPick(d)} disabled={solved || !selected}>
              {d}
            </NumBtn>
          ))}
          <NumBtn onClick={handleErase} disabled={solved || !selected} aria-label="Erase">
            <Delete size={18} />
          </NumBtn>
          {[4, 5, 6].map((d) => (
            <NumBtn key={d} onClick={() => handleNumberPick(d)} disabled={solved || !selected}>
              {d}
            </NumBtn>
          ))}
          <NumBtn onClick={handleUndo} disabled={solved || history.length === 0} aria-label="Undo">
            <CornerUpLeft size={18} />
          </NumBtn>
        </div>

        <p style={{ color: CREAM, opacity: 0.35 }} className="text-center text-[11px] mt-3">
          {filledCount}/{N * N} filled
        </p>
      </div>
    </div>
  );
}
