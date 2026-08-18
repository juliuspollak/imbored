import { useState, useEffect, useCallback, useRef } from "react";
import { withSeededRandom, shuffle } from "../lib/seededRandom.js";
import { useGameTimer } from "../lib/useGameTimer.js";
import { useHintCooldown } from "../lib/useHintCooldown.js";
import HintCooldownButton from "../HintCooldownButton.jsx";
import GameSolvedPanel from "../GameSolvedPanel.jsx";
import BoardReviewToggle from "../BoardReviewToggle.jsx";
import { Grid3x3, CornerUpLeft, Timer as TimerIcon, HelpCircle, Eraser, Pencil } from "lucide-react";
import { useI18n } from "../lib/i18n.jsx";
import DaySelector from "../DaySelector.jsx";
import Page from "../components/Page.jsx";
import Card from "../components/Card.jsx";
import Button from "../components/Button.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import { createGameAttemptSeed } from "../lib/gameAttemptSeed.js";

/* ---------------- puzzle generation ---------------- */

const N = 6, BOX_R = 2, BOX_C = 3;

function emptyNotes() {
  return Array.from({ length: N }, () => Array.from({ length: N }, () => new Set()));
}

function cloneNotes(notes) {
  return notes.map((row) => row.map((cell) => new Set(cell)));
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

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GIVEN_TARGETS = [24, 22, 20, 18, 16, 14, 12];
const SUDOKU_GENERATOR_VERSION = "minisudoku-v1";

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

/* ---------------- component ---------------- */

function NumBtn({ onClick, disabled, used = false, active = false, action = false, children, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="ms-num-btn"
      style={{
        minHeight: "clamp(54px, 15vw, 68px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: active ? "2px solid var(--color-primary)" : "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: active ? "var(--color-primary-subtle)" : used ? "var(--color-page-bg)" : "var(--color-surface-elevated)",
        color: disabled ? "var(--color-disabled-text)" : active ? "var(--color-primary)" : used ? "var(--color-text-muted)" : "var(--color-text-primary)",
        cursor: disabled ? "not-allowed" : "pointer",
        font: "inherit",
        fontSize: action ? "var(--text-body-secondary-size)" : 22,
        fontWeight: 700,
        transition: "transform var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast)",
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export default function MiniSudokuGame({ userId, onSolved, mode = "practice", forcedDayIdx, seed, challengeDate, hintCooldownConfig, savedStatId, rewardResult, initialSeconds = 0, scoreToBeatSeconds = null, scoreChallengerName = null } = {}) {
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
  // Seeded from the server-recorded attempt start, so leaving and re-entering
  // resumes the same clock instead of handing out a fresh one.
  const [seconds, setSeconds] = useState(initialSeconds);
  const [running, setRunning] = useState(false);
  const [solved, setSolved] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [difficultyRating, setDifficultyRating] = useState(null);
  const [hintCell, setHintCell] = useState(null);
  const [history, setHistory] = useState([]);
  // Undos are this puzzle's version of Gridly's backtracking: work placed and
  // then taken back. Without it the clock is the only thing the score can see.
  const [undos, setUndos] = useState(0);
  const [notes, setNotes] = useState(emptyNotes);
  const [noteMode, setNoteMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const attemptSeedRef = useRef(seed || createGameAttemptSeed("minisudoku"));

  const newPuzzle = useCallback((dIdx) => {
    const gen = () => generatePuzzle(GIVEN_TARGETS[dIdx]);
    const attemptSeed = isChallenge ? (seed || attemptSeedRef.current) : createGameAttemptSeed("minisudoku");
    attemptSeedRef.current = attemptSeed;
    const p = withSeededRandom(attemptSeed, gen);
    setPuzzle(p);
    setBoard(p.givens.map((row) => row.slice()));
    setSelected(null);
    // Resume the attempt clock. In challenge mode newPuzzle only runs on
    // mount, since the "New" control is disabled.
    setSeconds(initialSeconds);
    setRunning(true);
    setSolved(false);
    setMistakes(0);
    setHintsUsed(0);
    setDifficultyRating(null);
    setHintCell(null);
    setHistory([]);
    setNotes(emptyNotes());
    setNoteMode(false);
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
      onSolved && onSolved({
        userId,
        game: "minisudoku",
        dayIndex: dayIdx,
        seconds,
        mistakes,
        hints: hintsUsed,
        seed: attemptSeedRef.current,
        generatorVersion: SUDOKU_GENERATOR_VERSION,
        generatorConfig: { size: N, boxRows: BOX_R, boxColumns: BOX_C, givenCount: GIVEN_TARGETS[dayIdx] },
        wastedMoves: undos,
        expectedMoves: N * N,
        mode,
        challengeDate: isChallenge ? challengeDate : undefined,
      });
    }
  }, [board, puzzle]);

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
    setHistory((h) => [...h, { board: board.map((row) => row.slice()), notes: cloneNotes(notes), mistakes, hints: hintsUsed }].slice(-50));
  }

  function clearPeerNote(notesGrid, r, c, digit) {
    for (let i = 0; i < N; i++) {
      notesGrid[r][i].delete(digit);
      notesGrid[i][c].delete(digit);
    }
    const boxRow = Math.floor(r / BOX_R) * BOX_R;
    const boxCol = Math.floor(c / BOX_C) * BOX_C;
    for (let rr = boxRow; rr < boxRow + BOX_R; rr++) {
      for (let cc = boxCol; cc < boxCol + BOX_C; cc++) notesGrid[rr][cc].delete(digit);
    }
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
    if (noteMode) {
      if (current !== 0) return;
      pushHistory();
      setNotes((prev) => {
        const next = cloneNotes(prev);
        if (next[r][c].has(d)) next[r][c].delete(d);
        else next[r][c].add(d);
        return next;
      });
      return;
    }
    const nextValue = current === d ? 0 : d;
    pushHistory();
    setBoard((prev) => {
      const next = prev.map((row) => row.slice());
      next[r][c] = nextValue;
      return next;
    });
    setNotes((prev) => {
      const next = cloneNotes(prev);
      next[r][c].clear();
      if (nextValue !== 0) clearPeerNote(next, r, c, nextValue);
      return next;
    });
    // A provisional number is part of solving, not a mistake. The board already
    // highlights rule conflicts, and completion still requires a valid full grid.
  }

  function handleErase() {
    if (solved || !selected) return;
    const { r, c } = selected;
    if (puzzle.givens[r][c] !== 0) return;
    pushHistory();
    if (board[r][c] === 0 && notes[r][c].size > 0) {
      setNotes((prev) => {
        const next = cloneNotes(prev);
        next[r][c].clear();
        return next;
      });
      return;
    }
    setBoard((prev) => {
      const next = prev.map((row) => row.slice());
      next[r][c] = 0;
      return next;
    });
  }

  function handleUndo() {
    if (solved || history.length === 0) return;
    const last = history[history.length - 1];
    setUndos((count) => count + 1);
    setHistory((h) => h.slice(0, -1));
    setBoard(last.board);
    setNotes(last.notes || emptyNotes());
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
    setNotes(emptyNotes());
    setMistakes((value) => value + 1);
    setSelected(null);
    setHintCell(null);
    setHistory([]);
    setSolved(false);
    setRunning(true);
  }

  function handleHint() {
    if (solved || hintCooldown.isLocked()) return;
    // First correct one wrong entry so the hint always leaves a useful number
    // on the board. Exploratory entries are not scored as mistakes.
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (board[r][c] !== 0 && board[r][c] !== puzzle.solution[r][c]) {
          pushHistory();
          setBoard((prev) => {
            const next = prev.map((row) => row.slice());
            next[r][c] = puzzle.solution[r][c];
            return next;
          });
          setNotes((prev) => {
            const next = cloneNotes(prev);
            next[r][c].clear();
            clearPeerNote(next, r, c, puzzle.solution[r][c]);
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
      setNotes((prev) => {
        const next = cloneNotes(prev);
        next[step.r][step.c].clear();
        clearPeerNote(next, step.r, step.c, puzzle.solution[step.r][step.c]);
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
          const hintClass = isHint ? `ms-hint-${hintCell.type}` : "";
          // thicker border on the right/bottom edge of each 2x3 box
          const rightEdge = (c + 1) % BOX_C === 0 && c !== N - 1;
          const bottomEdge = (r + 1) % BOX_R === 0 && r !== N - 1;
          return (
            <button
              key={`${r}-${c}`}
              onClick={() => handleCellClick(r, c)}
              disabled={isGiven}
              className={`ms-cell ${hintClass}`}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                background: isSelected ? "var(--color-primary-subtle)" : "var(--color-surface)",
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
              {val === 0 && notes[r][c].size > 0 && (
                <span
                  aria-label={`Notes ${[...notes[r][c]].sort((a, b) => a - b).join(", ")}`}
                  style={{
                    position: "absolute", inset: 3, display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(2, 1fr)",
                    color: "var(--color-text-secondary)", fontSize: "clamp(7px, 2.1vw, 11px)",
                    fontWeight: 600, lineHeight: 1, pointerEvents: "none",
                  }}
                >
                  {paletteDigits.map((digit) => <span key={digit} style={{ display: "grid", placeItems: "center" }}>{notes[r][c].has(digit) ? digit : ""}</span>)}
                </span>
              )}
            </button>
          );
        })
      )}
    </div>
  );

  return (
    <Page contentMaxWidth="var(--game-page-max-width)" style={{ alignItems: "flex-start" }}>
      <style>{`
        @keyframes msPulseError { 0%, 100% { box-shadow: inset 0 0 0 3px var(--color-danger-solid); } 50% { box-shadow: inset 0 0 0 1px var(--color-danger-text); } }
        @keyframes msPulseHint { 0%, 100% { box-shadow: inset 0 0 0 3px var(--color-primary); } 50% { box-shadow: inset 0 0 0 1px var(--color-primary); } }
        .ms-hint-error { animation: msPulseError 1.1s ease-in-out infinite; }
        .ms-hint-naked, .ms-hint-hidden, .ms-hint-forced { animation: msPulseHint 1.1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .ms-hint-error, .ms-hint-naked, .ms-hint-hidden, .ms-hint-forced { animation: none !important; }
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
        @media (max-height: 760px) {
          .ms-card {
            margin-top: calc(var(--game-content-top) - 8px) !important;
            padding: var(--space-4) !important;
          }
          .ms-header { margin-bottom: var(--space-2) !important; }
          .ms-card .day-selector,
          .ms-challenge-badge,
          .ms-stats,
          .ms-toolbar { margin-bottom: var(--space-2) !important; }
          .ms-stats { gap: var(--space-3) !important; }
          .ms-toolbar { gap: 6px !important; }
          .ms-entry-mode { margin-top: var(--space-2) !important; }
          .ms-keypad { margin-top: 6px !important; padding: 8px !important; gap: 6px !important; }
          .ms-filled { margin-top: var(--space-2) !important; }
        }
      `}</style>

      <Card className="ms-card" style={{ position: "relative", marginTop: "var(--game-content-top)", marginBottom: "var(--space-8)", padding: "var(--space-5)" }}>
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

        <header className="ms-header" style={{ marginBottom: "var(--space-4)", padding: "0 44px", textAlign: "center" }}>
          <h1 style={{ margin: 0, color: "var(--color-text-primary)", fontSize: "var(--text-page-title-size)", lineHeight: "var(--text-page-title-line)", fontWeight: "var(--text-page-title-weight)" }}>Sudoku</h1>
        </header>

        {/* day selector — locked to today's date in challenge mode. Only
            relevant before solving: you already picked the day you just
            played, and it belongs on the next puzzle, not this result. */}
        {!solved && (isChallenge ? (
          <div className="ms-challenge-badge" style={{ display: "flex", justifyContent: "center", marginBottom: "var(--space-4)" }}>
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

        {/* stats row — redundant with GameSolvedPanel's own stats once solved */}
        {!solved && (
          <div className="ms-stats" style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: "var(--space-4)", marginBottom: "var(--space-3)", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>
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
          <div className="game-toolbar ms-toolbar" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
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
            Tap a cell, then tap a number to fill it. Turn on Notes to add or remove small candidate numbers.
            Every row, column, and bold-bordered 2×3 box needs the digits 1 through 6 exactly once.
            Hint flags one wrong number, or fills in one cell that's already logically forced —
            never a guess.
          </StatusBanner>
        )}

        <GameSolvedPanel
          solved={solved}
          difficultyRating={difficultyRating}
          stats={
            <>
              {fmtTime(seconds)} &middot; {mistakes} mistake{mistakes === 1 ? "" : "s"} &middot; {hintsUsed} hint{hintsUsed === 1 ? "" : "s"}
            </>
          }
          rewardResult={rewardResult}
          savedStatId={savedStatId}
          onRated={setDifficultyRating}
          completionSeconds={seconds}
          allowScoreChallenge
          scoreToBeatSeconds={scoreToBeatSeconds}
          scoreChallengerName={scoreChallengerName}
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

        {!solved && (
          <>
            <div className="ms-entry-mode" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", marginTop: "var(--space-3)", padding: 3, border: "1px solid var(--color-border)", borderRadius: "var(--radius-full)", background: "var(--color-surface-elevated)", boxShadow: "var(--shadow-control)" }}>
              {[
                { notes:false, label:"Number", Icon:Pencil },
                { notes:true, label:"Notes", Icon:Grid3x3 },
              ].map(({ notes:notesMode, label, Icon }) => {
                const active = noteMode === notesMode;
                return (
                  <button key={label} type="button" onClick={() => setNoteMode(notesMode)} aria-pressed={active} style={{ minHeight: 42, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, border: 0, borderRadius: "var(--radius-full)", background: active ? "var(--color-primary)" : "transparent", color: active ? "#fff" : "var(--color-text-secondary)", boxShadow: active ? "var(--shadow-control)" : "none", font: "inherit", fontSize: "var(--text-body-secondary-size)", fontWeight: 700, cursor: "pointer", transition: "background var(--transition-fast), color var(--transition-fast), transform var(--transition-fast)" }}>
                    <Icon size={16} /> {label}
                  </button>
                );
              })}
            </div>

            <div className="ms-keypad" style={{ marginTop: 8, padding: 10, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", background: "var(--color-surface)", boxShadow: "var(--shadow-card)" }}>
                {paletteDigits.slice(0, 3).map((d) => (
                  <NumBtn key={d} onClick={() => handleNumberPick(d)} disabled={!selected || digitFullyUsed(d)} used={digitFullyUsed(d)} active={selectedValue === d || !!(noteMode && selected && notes[selected.r][selected.c].has(d))} aria-label={`${d}${digitFullyUsed(d) ? ", fully used" : ""}`}>
                    {d}
                  </NumBtn>
                ))}
                <NumBtn action onClick={handleUndo} disabled={history.length === 0} aria-label={t("common.undo")}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><CornerUpLeft size={18} />Undo</span>
                </NumBtn>
                {paletteDigits.slice(3).map((d) => (
                  <NumBtn key={d} onClick={() => handleNumberPick(d)} disabled={!selected || digitFullyUsed(d)} used={digitFullyUsed(d)} active={selectedValue === d || !!(noteMode && selected && notes[selected.r][selected.c].has(d))} aria-label={`${d}${digitFullyUsed(d) ? ", fully used" : ""}`}>
                    {d}
                  </NumBtn>
                ))}
                <NumBtn action onClick={handleErase} disabled={!selected} aria-label={t("common.erase")}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Eraser size={18} />Erase</span>
                </NumBtn>
            </div>

            <p className="ms-filled" style={{ margin: "var(--space-3) 0 0", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)" }}>{filledCount}/{N * N} filled</p>
          </>
        )}
      </Card>
    </Page>
  );
}
