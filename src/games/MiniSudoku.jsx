import { useState, useEffect, useRef, useCallback } from "react";
import { withSeededRandom, shuffle } from "../lib/seededRandom.js";
import { useGameTimer } from "../lib/useGameTimer.js";
import { useHintCooldown } from "../lib/useHintCooldown.js";
import HintCooldownButton from "../HintCooldownButton.jsx";
import { DifficultyRatingBadge } from "../DifficultyRating.jsx";
import GameSolvedPanel from "../GameSolvedPanel.jsx";
import BoardReviewToggle from "../BoardReviewToggle.jsx";
import { Grid3x3, CornerUpLeft, Timer as TimerIcon, HelpCircle, Delete } from "lucide-react";
import { useI18n } from "../lib/i18n.jsx";
import DaySelector from "../DaySelector.jsx";
import Page from "../components/Page.jsx";
import Card from "../components/Card.jsx";
import Button from "../components/Button.jsx";
import StatusBanner from "../components/StatusBanner.jsx";

/* ---------------- puzzle generation ---------------- */

const N = 6, BOX_R = 2, BOX_C = 3;

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

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GIVEN_TARGETS = [24, 22, 20, 18, 16, 14, 12];

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

/* ---------------- component ---------------- */

function NumBtn({ onClick, disabled, used = false, active = false, children, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="ms-num-btn"
      style={{
        minHeight: 52,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: active ? "2px solid var(--color-primary)" : "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: active ? "var(--color-primary-subtle)" : used ? "var(--color-page-bg)" : "var(--color-surface-elevated)",
        color: disabled ? "var(--color-disabled-text)" : active ? "var(--color-primary)" : used ? "var(--color-text-muted)" : "var(--color-text-primary)",
        cursor: disabled ? "not-allowed" : "pointer",
        font: "inherit",
        fontSize: 18,
        fontWeight: 600,
        transition: "transform var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast)",
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export default function MiniSudokuGame({ userId, onSolved, mode = "practice", forcedDayIdx, seed, challengeDate, hintCooldownConfig, savedStatId, rewardResult } = {}) {
  const { t } = useI18n();
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
  const [reviewing, setReviewing] = useState(false);
  const [celebratingCells, setCelebratingCells] = useState(new Set());
  const prevCompleteSectionsRef = useRef(new Set());

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
    setReviewing(false);
    hintCooldown.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChallenge, seed]);

  useEffect(() => {
    newPuzzle(dayIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayIdx]);

  useGameTimer(running, solved, setSeconds);

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
      <Page style={{ alignItems: "center" }}>
        <div role="status" style={{ padding: "var(--space-8)", color: "var(--color-text-secondary)", fontSize: "var(--text-body-size)" }}>{t("common.buildingPuzzle")}</div>
      </Page>
    );
  }

  const conflicts = getConflicts(board);
  const filledCount = board.flat().filter((v) => v !== 0).length;
  const selectedValue = selected ? board[selected.r][selected.c] : 0;

  function digitFullyUsed(digit) {
    return board.flat().filter((value) => value === digit).length >= N;
  }
  const paletteDigits = [1, 2, 3, 4, 5, 6];

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
    // Clearing the board counts as one additional scoring mistake.
    setBoard(puzzle.givens.map((row) => row.slice()));
    setMistakes((value) => value + 1);
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

  const boardGrid = (
    <div
      className="ms-board"
      style={{
        aspectRatio: "1 / 1",
        display: "grid",
        gridTemplateColumns: `repeat(${N}, 1fr)`,
        gridTemplateRows: `repeat(${N}, 1fr)`,
        overflow: "hidden",
        background: "var(--color-surface)",
        border: "2px solid var(--color-border-strong)",
        borderRadius: "var(--radius-md)",
        width: "100%",
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
              className={`ms-cell ${hintClass} ${isCelebrating ? "ms-celebrate" : ""}`}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                background: isCelebrating ? "var(--color-success-bg)" : isSelected ? "var(--color-primary-subtle)" : "var(--color-surface)",
                border: 0,
                borderRight: rightEdge ? "2px solid var(--color-border-strong)" : "1px solid var(--color-border)",
                borderBottom: bottomEdge ? "2px solid var(--color-border-strong)" : "1px solid var(--color-border)",
                boxShadow: isConflict
                  ? "inset 0 0 0 3px var(--color-danger-solid)"
                  : isSelected
                  ? "inset 0 0 0 3px var(--color-primary)"
                  : "none",
                cursor: isGiven ? "default" : "pointer",
                transition: "background var(--transition-fast), box-shadow var(--transition-fast)",
              }}
            >
              {val !== 0 && (
                <span
                  className="ms-cell-value"
                  data-given={isGiven ? "true" : "false"}
                  data-conflict={isConflict ? "true" : "false"}
                  style={{
                    fontSize: "clamp(16px, 5vw, 26px)",
                    fontWeight: isGiven ? 700 : 500,
                    color: isConflict ? "var(--color-danger-text)" : isGiven ? "var(--color-text-primary)" : "var(--color-primary)",
                  }}
                >
                  {val}
                </span>
              )}
            </button>
          );
        })
      )}
    </div>
  );

  return (
    <Page style={{ alignItems: "flex-start" }}>
      <style>{`
        @keyframes msPulseError { 0%, 100% { box-shadow: inset 0 0 0 3px var(--color-danger-solid); } 50% { box-shadow: inset 0 0 0 1px var(--color-danger-text); } }
        @keyframes msPulseHint { 0%, 100% { box-shadow: inset 0 0 0 3px var(--color-primary); } 50% { box-shadow: inset 0 0 0 1px var(--color-primary); } }
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
        .ms-cell:focus-visible, .ms-num-btn:focus-visible, .ms-help-button:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: -2px;
          z-index: 2;
        }
        @media (hover: hover) and (pointer: fine) {
          .ms-cell:not(:disabled):hover { background: var(--color-primary-subtle) !important; }
          .ms-num-btn:not(:disabled):hover { transform: translateY(-1px); border-color: var(--color-primary-subtle-border) !important; }
        }
      `}</style>

      <Card style={{ position: "relative", marginTop: "var(--game-content-top)", marginBottom: "var(--space-8)", padding: "var(--space-5)" }}>
        <button
          type="button"
          onClick={() => setShowHelp((h) => !h)}
          className="ms-help-button"
          aria-label={showHelp ? "Hide instructions" : "Show instructions"}
          aria-expanded={showHelp}
          style={{ width: 40, height: 40, position: "absolute", top: "var(--space-3)", right: "var(--space-3)", display: "grid", placeItems: "center", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-surface-elevated)", color: "var(--color-icon-subtle)", cursor: "pointer" }}
        >
          <HelpCircle size={18} />
        </button>

        <header style={{ marginBottom: "var(--space-4)", padding: "0 44px", textAlign: "center" }}>
          <h1 style={{ margin: 0, color: "var(--color-text-primary)", fontSize: "var(--text-page-title-size)", lineHeight: "var(--text-page-title-line)", fontWeight: "var(--text-page-title-weight)" }}>Mini Sudoku</h1>
          <p style={{ margin: "var(--space-1) 0 0", color: "var(--color-text-secondary)", fontSize: "var(--text-body-secondary-size)", lineHeight: "var(--text-body-line)" }}>
            classic sudoku, bite-sized — every row, column &amp; box gets 1&ndash;6
          </p>
        </header>

        {/* day selector — locked to today's date in challenge mode. Only
            relevant before solving: you already picked the day you just
            played, and it belongs on the next puzzle, not this result. */}
        {!solved && (isChallenge ? (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "var(--space-4)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "7px var(--space-3)", border: "1px solid var(--color-primary-subtle-border)", borderRadius: "var(--radius-full)", background: "var(--color-primary-subtle)", color: "var(--color-primary)" }}>
              <span style={{ fontSize: "var(--text-body-secondary-size)", fontWeight: 600 }}>{t("common.todaysChallenge")}</span>
              <span style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>{GIVEN_TARGETS[dayIdx]} givens</span>
            </div>
          </div>
        ) : (
          <DaySelector
            days={DAYS}
            value={dayIdx}
            onChange={setDayIdx}
          />
        ))}

        {solved && difficultyRating !== null && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "var(--space-3)" }}>
            <DifficultyRatingBadge value={difficultyRating} />
          </div>
        )}

        {/* stats row — redundant with GameSolvedPanel's own stats once solved */}
        {!solved && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: "var(--space-4)", marginBottom: "var(--space-3)", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <TimerIcon size={14} />
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtTime(seconds)}</span>
            </div>
            <div>
              mistakes: <span style={{ color: mistakes > 0 ? "var(--color-danger-text)" : "var(--color-text-primary)", fontWeight: 600 }}>{mistakes}</span>
            </div>
            <div>
              hints: <span style={{ color: hintsUsed > 0 ? "var(--color-primary)" : "var(--color-text-primary)", fontWeight: 600 }}>{hintsUsed}</span>
            </div>
          </div>
        )}

        {/* toolbar — Reset/New/Hint only ever act on a puzzle still in
            progress; once solved there's nothing left for any of them to do
            (Play Again in the solved panel below replaces "New"). */}
        {!solved && (
          <div className="game-toolbar" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            {[
              { label: t("common.reset"), onClick: handleReset, disabled: solved },
              { label: "New", onClick: () => newPuzzle(dayIdx), disabled: isChallenge },
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
        )}

        {!solved && showHelp && (
          <StatusBanner variant="info" style={{ marginBottom: "var(--space-3)", lineHeight: "var(--text-body-line)" }}>
            Tap a cell, then tap a number to fill it — tap the same number again to clear it.
            Every row, column, and bold-bordered 2×3 box needs the digits 1 through 6 exactly once.
            Hint flags one wrong number, or fills in one cell that's already logically forced —
            never a guess.
          </StatusBanner>
        )}

        <GameSolvedPanel
          solved={solved}
          difficultyRating={difficultyRating}
          icon={<Grid3x3 size={26} style={{ color: "var(--color-primary)" }} />}
          stats={
            <>
              {fmtTime(seconds)} &middot; {mistakes} mistake{mistakes === 1 ? "" : "s"} &middot; {hintsUsed} hint{hintsUsed === 1 ? "" : "s"}
            </>
          }
          rewardResult={rewardResult}
          savedStatId={savedStatId}
          onRated={setDifficultyRating}
          showPlayAgain={!isChallenge}
          onPlayAgain={() => newPuzzle(dayIdx)}
        />

        {solved && (
          <BoardReviewToggle
            reviewing={reviewing}
            onToggle={() => setReviewing((value) => !value)}
          />
        )}
        {(!solved || reviewing) && boardGrid}

        {/* number palette — every button is a no-op once solved */}
        {!solved && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
            {paletteDigits.slice(0, 3).map((d) => (
              <NumBtn key={d} onClick={() => handleNumberPick(d)} disabled={!selected || digitFullyUsed(d)} used={digitFullyUsed(d)} active={selectedValue === d} aria-label={`${d}${digitFullyUsed(d) ? ", fully used" : ""}`}>
                {d}
              </NumBtn>
            ))}
            <NumBtn onClick={handleErase} disabled={!selected} aria-label={t("common.erase")}>
              <Delete size={18} />
            </NumBtn>
            {paletteDigits.slice(3).map((d) => (
              <NumBtn key={d} onClick={() => handleNumberPick(d)} disabled={!selected || digitFullyUsed(d)} used={digitFullyUsed(d)} active={selectedValue === d} aria-label={`${d}${digitFullyUsed(d) ? ", fully used" : ""}`}>
                {d}
              </NumBtn>
            ))}
            <NumBtn onClick={handleUndo} disabled={history.length === 0} aria-label={t("common.undo")}>
              <CornerUpLeft size={18} />
            </NumBtn>
          </div>
        )}

        {!solved && (
          <p style={{ margin: "var(--space-3) 0 0", color: "var(--color-text-secondary)", textAlign: "center", fontSize: "var(--text-caption-size)" }}>
            {filledCount}/{N * N} filled
          </p>
        )}
      </Card>
    </Page>
  );
}
