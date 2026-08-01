import React, { useState, useEffect, useRef, useCallback } from "react";
import { withSeededRandom, shuffle } from "../lib/seededRandom.js";
import { useGameTimer } from "../lib/useGameTimer.js";
import { useHintCooldown } from "../lib/useHintCooldown.js";
import HintCooldownButton from "../HintCooldownButton.jsx";
import GameSolvedPanel from "../GameSolvedPanel.jsx";
import BoardReviewToggle from "../BoardReviewToggle.jsx";
import { Eraser, CornerUpLeft, Sparkles, WandSparkles, Timer as TimerIcon, HelpCircle, Lock } from "lucide-react";
import { useI18n } from "../lib/i18n.jsx";
import DaySelector from "../DaySelector.jsx";
import Button from "../components/Button.jsx";
import { createGameAttemptSeed } from "../lib/gameAttemptSeed.js";

function SunIcon({ size = 24, className = "", style, isConflict = false, ...props }) {
  const gradientId = React.useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} style={style} aria-hidden="true" {...props}>
      <defs>
        <linearGradient id={gradientId} x1="6" y1="5" x2="18" y2="19" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFC64A" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
      </defs>
      <circle
        cx="12" cy="12" r="7.55"
        fill={`url(#${gradientId})`}
        stroke="#D97706"
        strokeWidth="1.35"
      />
    </svg>
  );
}

function ModernMoonIcon({ size = 24, className = "", style, isConflict = false, ...props }) {
  const gradientId = React.useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} style={style} aria-hidden="true" {...props}>
      <defs>
        <linearGradient id={gradientId} x1="6" y1="4" x2="18" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#67A8FF" />
          <stop offset="55%" stopColor="#3478D4" />
          <stop offset="100%" stopColor="#1855AA" />
        </linearGradient>
      </defs>
      <path
        d="M19.75 15.55A8.65 8.65 0 0 1 8.45 4.25a8.9 8.9 0 1 0 11.3 11.3Z"
        fill={`url(#${gradientId})`}
        stroke="#174A91"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------------- puzzle generation ---------------- */

const SIZE = 6;
const HALF = SIZE / 2;
const EMPTY = 0, SUN = 1, MOON = 2;

function allPositions(size) {
  const p = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) p.push([r, c]);
  return p;
}

function edgeKey(r1, c1, r2, c2) {
  if (r1 > r2 || (r1 === r2 && c1 > c2)) [r1, c1, r2, c2] = [r2, c2, r1, c1];
  return `${r1},${c1}|${r2},${c2}`;
}

function buildEdgeMap(edges) {
  const m = new Map();
  for (const e of edges) m.set(edgeKey(e.r1, e.c1, e.r2, e.c2), e.type);
  return m;
}

function generateSolution() {
  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  function countRow(r, upTo, s) {
    let n = 0;
    for (let c = 0; c < upTo; c++) if (grid[r][c] === s) n++;
    return n;
  }
  function countCol(c, upTo, s) {
    let n = 0;
    for (let r = 0; r < upTo; r++) if (grid[r][c] === s) n++;
    return n;
  }
  function backtrack(pos) {
    if (pos === SIZE * SIZE) return true;
    const r = Math.floor(pos / SIZE), c = pos % SIZE;
    for (const s of shuffle([SUN, MOON])) {
      if (c >= 2 && grid[r][c - 1] === s && grid[r][c - 2] === s) continue;
      if (r >= 2 && grid[r - 1][c] === s && grid[r - 2][c] === s) continue;
      if (countRow(r, c, s) >= HALF) continue;
      if (countCol(c, r, s) >= HALF) continue;
      grid[r][c] = s;
      if (backtrack(pos + 1)) return true;
      grid[r][c] = 0;
    }
    return false;
  }
  return backtrack(0) ? grid : null;
}

function deriveAllEdges(grid) {
  const edges = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (c + 1 < SIZE) edges.push({ r1: r, c1: c, r2: r, c2: c + 1, type: grid[r][c] === grid[r][c + 1] ? "eq" : "neq" });
      if (r + 1 < SIZE) edges.push({ r1: r, c1: c, r2: r + 1, c2: c, type: grid[r][c] === grid[r + 1][c] ? "eq" : "neq" });
    }
  }
  return edges;
}

function countSolutions(givens, edgeMap, limit) {
  const grid = givens.map((row) => row.slice());
  let count = 0;
  function edgeOk(r, c, s) {
    if (c > 0 && grid[r][c - 1] !== 0) {
      const t = edgeMap.get(edgeKey(r, c - 1, r, c));
      if (t === "eq" && grid[r][c - 1] !== s) return false;
      if (t === "neq" && grid[r][c - 1] === s) return false;
    }
    if (r > 0 && grid[r - 1][c] !== 0) {
      const t = edgeMap.get(edgeKey(r - 1, c, r, c));
      if (t === "eq" && grid[r - 1][c] !== s) return false;
      if (t === "neq" && grid[r - 1][c] === s) return false;
    }
    return true;
  }
  function countRow(r, upTo, s) {
    let n = 0;
    for (let c = 0; c < upTo; c++) if (grid[r][c] === s) n++;
    return n;
  }
  function countCol(c, upTo, s) {
    let n = 0;
    for (let r = 0; r < upTo; r++) if (grid[r][c] === s) n++;
    return n;
  }
  function backtrack(pos) {
    if (count >= limit) return;
    if (pos === SIZE * SIZE) {
      count++;
      return;
    }
    const r = Math.floor(pos / SIZE), c = pos % SIZE;
    if (grid[r][c] !== 0) {
      backtrack(pos + 1);
      return;
    }
    for (const s of [SUN, MOON]) {
      if (c >= 2 && grid[r][c - 1] === s && grid[r][c - 2] === s) continue;
      if (r >= 2 && grid[r - 1][c] === s && grid[r - 2][c] === s) continue;
      if (countRow(r, c, s) >= HALF) continue;
      if (countCol(c, r, s) >= HALF) continue;
      if (!edgeOk(r, c, s)) continue;
      grid[r][c] = s;
      backtrack(pos + 1);
      grid[r][c] = 0;
      if (count >= limit) return;
    }
  }
  backtrack(0);
  return count;
}

// Greedy invariant-preserving removal: start fully revealed (trivially unique),
// only ever commit a removal if the puzzle stays uniquely solvable afterward.
// This guarantees the result is always valid without needing a final re-check.
function generatePuzzle(givenTarget, edgeTarget, maxAttempts = 5) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const solution = generateSolution();
    if (!solution) continue;

    const allEdges = deriveAllEdges(solution);
    const candidateEdges = shuffle(allEdges).slice(0, Math.min(allEdges.length, edgeTarget * 3 + 6));
    const givens = solution.map((row) => row.slice());
    let edgeMap = buildEdgeMap(candidateEdges);

    let revealed = SIZE * SIZE;
    for (const [r, c] of shuffle(allPositions(SIZE))) {
      if (revealed <= givenTarget) break;
      const backup = givens[r][c];
      givens[r][c] = 0;
      if (countSolutions(givens, edgeMap, 2) === 1) {
        revealed--;
      } else {
        givens[r][c] = backup;
      }
    }

    let kept = candidateEdges.slice();
    for (const edge of shuffle(candidateEdges)) {
      if (kept.length <= edgeTarget) break;
      const trial = kept.filter((e) => e !== edge);
      const trialMap = buildEdgeMap(trial);
      if (countSolutions(givens, trialMap, 2) === 1) {
        kept = trial;
        edgeMap = trialMap;
      }
    }

    return { solution, givens, edges: kept, edgeMap };
  }
  return null;
}

/* ---------------- board-state helpers (operate on the player's board) ---------------- */

function getConflicts(board, edgeMap) {
  const conflicts = new Set();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c <= SIZE - 3; c++) {
      const a = board[r][c], b = board[r][c + 1], d = board[r][c + 2];
      if (a !== 0 && a === b && b === d) {
        conflicts.add(`${r}-${c}`); conflicts.add(`${r}-${c + 1}`); conflicts.add(`${r}-${c + 2}`);
      }
    }
  }
  for (let c = 0; c < SIZE; c++) {
    for (let r = 0; r <= SIZE - 3; r++) {
      const a = board[r][c], b = board[r + 1][c], d = board[r + 2][c];
      if (a !== 0 && a === b && b === d) {
        conflicts.add(`${r}-${c}`); conflicts.add(`${r + 1}-${c}`); conflicts.add(`${r + 2}-${c}`);
      }
    }
  }
  for (let r = 0; r < SIZE; r++) {
    const sunN = board[r].filter((v) => v === SUN).length;
    const moonN = board[r].filter((v) => v === MOON).length;
    if (sunN > HALF) for (let c = 0; c < SIZE; c++) if (board[r][c] === SUN) conflicts.add(`${r}-${c}`);
    if (moonN > HALF) for (let c = 0; c < SIZE; c++) if (board[r][c] === MOON) conflicts.add(`${r}-${c}`);
  }
  for (let c = 0; c < SIZE; c++) {
    let sunN = 0, moonN = 0;
    for (let r = 0; r < SIZE; r++) {
      if (board[r][c] === SUN) sunN++;
      if (board[r][c] === MOON) moonN++;
    }
    if (sunN > HALF) for (let r = 0; r < SIZE; r++) if (board[r][c] === SUN) conflicts.add(`${r}-${c}`);
    if (moonN > HALF) for (let r = 0; r < SIZE; r++) if (board[r][c] === MOON) conflicts.add(`${r}-${c}`);
  }
  for (const [key, type] of edgeMap.entries()) {
    const [a, b] = key.split("|");
    const [r1, c1] = a.split(",").map(Number);
    const [r2, c2] = b.split(",").map(Number);
    const v1 = board[r1][c1], v2 = board[r2][c2];
    if (v1 !== 0 && v2 !== 0) {
      if (type === "eq" && v1 !== v2) { conflicts.add(`${r1}-${c1}`); conflicts.add(`${r2}-${c2}`); }
      if (type === "neq" && v1 === v2) { conflicts.add(`${r1}-${c1}`); conflicts.add(`${r2}-${c2}`); }
    }
  }
  return conflicts;
}

function isLocallyValid(board, r, c, s, edgeMap) {
  for (let start = Math.max(0, c - 2); start <= Math.min(c, SIZE - 3); start++) {
    const vals = [start, start + 1, start + 2].map((cc) => (cc === c ? s : board[r][cc]));
    if (vals[0] !== 0 && vals[0] === vals[1] && vals[1] === vals[2]) return false;
  }
  for (let start = Math.max(0, r - 2); start <= Math.min(r, SIZE - 3); start++) {
    const vals = [start, start + 1, start + 2].map((rr) => (rr === r ? s : board[rr][c]));
    if (vals[0] !== 0 && vals[0] === vals[1] && vals[1] === vals[2]) return false;
  }
  let rowN = 0;
  for (let cc = 0; cc < SIZE; cc++) if (cc !== c && board[r][cc] === s) rowN++;
  if (rowN >= HALF) return false;
  let colN = 0;
  for (let rr = 0; rr < SIZE; rr++) if (rr !== r && board[rr][c] === s) colN++;
  if (colN >= HALF) return false;
  for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
    if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] === 0) continue;
    const t = edgeMap.get(edgeKey(r, c, nr, nc));
    if (!t) continue;
    if (t === "eq" && board[nr][nc] !== s) return false;
    if (t === "neq" && board[nr][nc] === s) return false;
  }
  return true;
}

function findForcedCell(board, edgeMap) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] !== 0) continue;
      const sunOk = isLocallyValid(board, r, c, SUN, edgeMap);
      const moonOk = isLocallyValid(board, r, c, MOON, edgeMap);
      if (sunOk !== moonOk) return { r, c };
    }
  }
  return null;
}

function getCompletedLines(board, solution) {
  const lines = [];
  for (let index = 0; index < SIZE; index++) {
    if (board[index].every((value, column) => value === solution[index][column])) {
      lines.push(`row-${index}`);
    }
    if (board.every((row, rowIndex) => row[index] === solution[rowIndex][index])) {
      lines.push(`col-${index}`);
    }
  }
  return lines;
}

function getFullLines(board) {
  const lines = [];
  for (let index = 0; index < SIZE; index++) {
    if (board[index].every((value) => value !== 0)) lines.push(`row-${index}`);
    if (board.every((row) => row[index] !== 0)) lines.push(`col-${index}`);
  }
  return lines;
}

function lineHasConflict(line, conflicts) {
  const [direction, rawIndex] = line.split("-");
  const index = Number(rawIndex);
  for (let offset = 0; offset < SIZE; offset++) {
    const key = direction === "row" ? `${index}-${offset}` : `${offset}-${index}`;
    if (conflicts.has(key)) return true;
  }
  return false;
}

function getRuleValidCompletedLines(board, edgeMap) {
  const conflicts = getConflicts(board, edgeMap);
  return getFullLines(board).filter((line) => !lineHasConflict(line, conflicts));
}

/* ---------------- design tokens ---------------- */

const BG = "var(--color-page-bg)";
const PANEL = "var(--color-surface)";
const CREAM = "var(--color-text-primary)";
const GOLD = "var(--color-primary)";
const RED = "#E5484D";
const TEAL = "#5FA8A3";
const SUN_COLOR = "#F2A43A";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GIVEN_TARGETS = [16, 14, 12, 10, 9, 8, 7];
const EDGE_TARGETS = [6, 5, 5, 4, 4, 3, 3];
const TANGO_GENERATOR_VERSION = "tango-v1";

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

/* ---------------- component ---------------- */

export default function TangoGame({ userId, onSolved, mode = "practice", forcedDayIdx, seed, challengeDate, hintCooldownConfig, savedStatId, rewardResult } = {}) {
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
  const [celebratingLines, setCelebratingLines] = useState([]);
  const [displayedConflicts, setDisplayedConflicts] = useState(new Set());
  const attemptSeedRef = useRef(seed || createGameAttemptSeed("tango"));
  const completedLinesRef = useRef(new Set());
  const invalidCompletedLinesRef = useRef(new Set());
  const invalidMistakeTimerRef = useRef(null);
  const skipNextInvalidMistakeRef = useRef(false);
  const celebrationTimerRef = useRef(null);
  const conflictDebounceRef = useRef(null);

  const newPuzzle = useCallback((dIdx) => {
    const gen = () => generatePuzzle(GIVEN_TARGETS[dIdx], EDGE_TARGETS[dIdx]);
    const attemptSeed = isChallenge ? (seed || attemptSeedRef.current) : createGameAttemptSeed("tango");
    attemptSeedRef.current = attemptSeed;
    const p = withSeededRandom(attemptSeed, gen);
    setPuzzle(p);
    setBoard(p.givens.map((row) => row.slice()));
    setSeconds(0);
    setRunning(true);
    setSolved(false);
    setReviewing(false);
    setMistakes(0);
    setHintsUsed(0);
    setDifficultyRating(null);
    setHintCell(null);
    setHistory([]);
    setCelebratingLines([]);
    const initialCelebratedLines = dIdx <= 1
      ? getCompletedLines(p.givens, p.solution)
      : dIdx <= 3
        ? getRuleValidCompletedLines(p.givens, p.edgeMap)
        : [];
    completedLinesRef.current = new Set(initialCelebratedLines);
    invalidCompletedLinesRef.current = new Set();
    window.clearTimeout(invalidMistakeTimerRef.current);
    window.clearTimeout(celebrationTimerRef.current);
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
    if (getConflicts(board, puzzle.edgeMap).size === 0 && !solved) {
      setSolved(true);
      setRunning(false);
      onSolved && onSolved({
        userId,
        game: "tango",
        dayIndex: dayIdx,
        seconds,
        mistakes,
        hints: hintsUsed,
        seed: attemptSeedRef.current,
        generatorVersion: TANGO_GENERATOR_VERSION,
        generatorConfig: { size: SIZE, givenTarget: GIVEN_TARGETS[dayIdx], edgeTarget: EDGE_TARGETS[dayIdx] },
        mode,
        challengeDate: isChallenge ? challengeDate : undefined,
      });
    }
  }, [board, puzzle]);

  useEffect(() => {
    if (!board || !puzzle) return undefined;
    const completed = dayIdx <= 1
      ? getCompletedLines(board, puzzle.solution)
      : dayIdx <= 3
        ? getRuleValidCompletedLines(board, puzzle.edgeMap)
        : [];
    const newlyCompleted = completed.filter((line) => !completedLinesRef.current.has(line));
    completedLinesRef.current = new Set(completed);
    if (!newlyCompleted.length) return undefined;
    setCelebratingLines(newlyCompleted);
    window.clearTimeout(celebrationTimerRef.current);
    celebrationTimerRef.current = window.setTimeout(() => setCelebratingLines([]), 900);
    return undefined;
  }, [board, puzzle, dayIdx]);

  useEffect(() => {
    if (!board || !puzzle || solved) return;
    const conflicts = getConflicts(board, puzzle.edgeMap);
    const invalidCompleted = getFullLines(board).filter((line) => lineHasConflict(line, conflicts));
    const invalidSet = new Set(invalidCompleted);
    if (skipNextInvalidMistakeRef.current) {
      skipNextInvalidMistakeRef.current = false;
      invalidCompletedLinesRef.current = invalidSet;
      window.clearTimeout(invalidMistakeTimerRef.current);
      return;
    }
    // Once a charged line becomes valid/incomplete, a later invalid completion
    // is a new mistake episode. Keep already-charged lines while they remain bad.
    invalidCompletedLinesRef.current = new Set(
      [...invalidCompletedLinesRef.current].filter((line) => invalidSet.has(line))
    );
    window.clearTimeout(invalidMistakeTimerRef.current);
    const newlyInvalid = invalidCompleted.filter((line) => !invalidCompletedLinesRef.current.has(line));
    if (newlyInvalid.length === 0) return;
    // Players need two taps to cycle sun → moon. Use the same grace period as
    // the visual conflict warning so the temporary sun is never a mistake.
    invalidMistakeTimerRef.current = window.setTimeout(() => {
      newlyInvalid.forEach((line) => invalidCompletedLinesRef.current.add(line));
      // One placement can finish both a row and a column; charge the move once.
      setMistakes((value) => value + 1);
    }, 2000);
    return () => window.clearTimeout(invalidMistakeTimerRef.current);
  }, [board, puzzle, solved]);

  useEffect(() => () => {
    window.clearTimeout(celebrationTimerRef.current);
    window.clearTimeout(invalidMistakeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!board || !puzzle) return;
    window.clearTimeout(conflictDebounceRef.current);
    const newConflicts = getConflicts(board, puzzle.edgeMap);
    
    // If no conflicts, clear immediately
    if (newConflicts.size === 0) {
      setDisplayedConflicts(new Set());
    } else {
      // If there ARE conflicts, show them after 2 seconds (allows cycling without mid-cycle errors)
      conflictDebounceRef.current = window.setTimeout(() => {
        setDisplayedConflicts(newConflicts);
      }, 2000);
    }
    return () => window.clearTimeout(conflictDebounceRef.current);
  }, [board, puzzle]);

  if (!board || !puzzle) {
    return (
      <div style={{ background: BG, minHeight: "100vh" }} className="flex items-center justify-center">
        <span style={{ color: CREAM, opacity: 0.6 }} className="text-sm">{t("common.buildingPuzzle")}</span>
      </div>
    );
  }

  const actualConflicts = getConflicts(board, puzzle.edgeMap);
  const filledCount = board.flat().filter((v) => v !== 0).length;

  function pushHistory() {
    setHistory((h) => [...h, { board: board.map((row) => row.slice()) }].slice(-50));
  }

  function performTapCycle(r, c) {
    pushHistory();
    setBoard((prev) => {
      const next = prev.map((row) => row.slice());
      next[r][c] = (next[r][c] + 1) % 3;
      return next;
    });
  }

  function handleCellClick(r, c) {
    if (solved) return;
    if (puzzle.givens[r][c] !== 0) return; // locked clue cell
    setHintCell(null);
    performTapCycle(r, c);
  }

  function handleUndo() {
    if (solved || history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    // Restoring an earlier board is not a new placement and must not create a
    // fresh delayed mistake if that earlier board already contained a conflict.
    skipNextInvalidMistakeRef.current = true;
    setBoard(last.board);
    setHintCell(null);
    setSolved(false);
    setRunning(true);
  }

  function handleReset() {
    if (solved) return;
    setBoard(puzzle.givens.map((row) => row.slice()));
    // Reset is still part of the same attempt. Keep the player's elapsed
    // time and help already used, and count abandoning the board as one
    // mistake so Reset cannot erase scoring penalties.
    setMistakes((value) => value + 1);
    setDifficultyRating(null);
    setHintCell(null);
    setHistory([]);
    const resetCelebratedLines = dayIdx <= 1
      ? getCompletedLines(puzzle.givens, puzzle.solution)
      : dayIdx <= 3
        ? getRuleValidCompletedLines(puzzle.givens, puzzle.edgeMap)
        : [];
    completedLinesRef.current = new Set(resetCelebratedLines);
    invalidCompletedLinesRef.current = new Set();
    window.clearTimeout(invalidMistakeTimerRef.current);
    // Keep the elapsed time when resetting the current puzzle.
    setSolved(false);
    setRunning(true);
  }

  function handleHint() {
    if (solved || hintCooldown.isLocked()) return;
    const applyHint = (r, c, type, countMistake = false) => {
      // A hint is guidance only. Never write the solution into the board:
      // keep an incorrect symbol in place, or leave an empty cell empty,
      // and show the expected symbol in the corner annotation below.
      setHintCell({ r, c, type, symbol: puzzle.solution[r][c] });
      setHintsUsed((value) => value + 1);
      if (countMistake) setMistakes((value) => value + 1);
      hintCooldown.startCooldown();
    };

    // First flag an incorrect symbol. If all entered symbols are correct,
    // point to a logically forced blank, then fall back to the first blank.
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] !== 0 && board[r][c] !== puzzle.solution[r][c]) {
          applyHint(r, c, "error", true);
          return;
        }
      }
    }
    // 2) a cell whose symbol is already logically forced but not filled yet
    const forced = findForcedCell(board, puzzle.edgeMap);
    if (forced) {
      applyHint(forced.r, forced.c, "forced");
      return;
    }
    // 3) nothing forced — reveal one blank cell
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === 0) {
          applyHint(r, c, "next");
          return;
        }
      }
    }
  }

  const boardGrid = (
    <div
      className="tg-board-shell relative rounded-2xl overflow-hidden -mx-5 lg:-mx-6"
      style={{
        aspectRatio: "1 / 1",
        display: "grid",
        gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
        gridTemplateRows: `repeat(${SIZE}, 1fr)`,
        background: "var(--color-surface)",
        border: "4px solid var(--color-border-strong)",
        boxShadow: "var(--shadow-card)",
        containerType: "inline-size",
        width: "auto",
      }}
    >
      {board.map((row, r) =>
        row.map((val, c) => {
          const isGiven = puzzle.givens[r][c] !== 0;
          const isConflict = displayedConflicts.has(`${r}-${c}`);
          const isHint = hintCell && hintCell.r === r && hintCell.c === c;
          const hintClass = isHint && !isConflict ? `tg-hint-${hintCell.type}` : "";
          const hintBackground = hintCell?.type === "error"
            ? "repeating-linear-gradient(135deg, var(--color-surface) 0 7px, var(--color-danger-bg) 7px 14px)"
            : hintCell?.type === "forced"
              ? "repeating-linear-gradient(135deg, var(--color-surface) 0 7px, var(--color-primary-subtle) 7px 14px)"
              : "repeating-linear-gradient(135deg, var(--color-surface) 0 7px, var(--color-warning-border) 7px 14px)";
          return (
            <button
              key={`${r}-${c}`}
              onClick={() => handleCellClick(r, c)}
              disabled={isGiven}
              className={`tg-cell relative flex items-center justify-center transition-colors duration-200 ${hintClass}`}
              style={{
                background: isHint ? hintBackground : isGiven ? "var(--color-surface-elevated)" : "var(--color-surface)",
                border: "1px solid var(--color-border-strong)",
                boxShadow: isConflict ? `inset 0 0 0 3px ${RED}` : "none",
                cursor: isGiven ? "default" : "pointer",
              }}
            >
              {val === SUN && (
                <span className="tg-symbol tg-symbol-disc tg-symbol-disc--sun"><SunIcon key={`sun-${r}-${c}`} size={Math.max(28, 50 - SIZE)} isConflict={isConflict} /></span>
              )}
              {val === MOON && (
                <span className="tg-symbol tg-symbol-disc tg-symbol-disc--moon"><ModernMoonIcon key={`moon-${r}-${c}`} size={Math.max(28, 50 - SIZE)} isConflict={isConflict} /></span>
              )}
              {/* Hints never place or replace a symbol. The striped cell
                  identifies where to look and this corner badge shows the
                  expected answer without making the move for the player. */}
              {isHint && hintCell.symbol && !solved && (
                <span
                  className="tg-hint-ghost-badge"
                  aria-label={hintCell.symbol === SUN ? "This cell should be a sun" : "This cell should be a moon"}
                  style={{
                    position: "absolute", top: 3, right: 3, width: 16, height: 16, borderRadius: "50%",
                    background: "var(--color-surface-raised)", display: "flex", alignItems: "center", justifyContent: "center",
                    border: "1px solid var(--color-border-strong)", boxShadow: "var(--shadow-control)", pointerEvents: "none",
                  }}
                >
                  {hintCell.symbol === SUN ? (
                    <SunIcon size={11} style={{ color: SUN_COLOR }} />
                  ) : (
                    <ModernMoonIcon size={10} style={{ color: "var(--color-icon-primary)" }} />
                  )}
                </span>
              )}
            </button>
          );
        })
      )}

      {puzzle.edges.map((e) => {
        const horizontal = e.r1 === e.r2;
        const cx = horizontal ? ((e.c1 + 1) / SIZE) * 100 : ((e.c1 + 0.5) / SIZE) * 100;
        const cy = horizontal ? ((e.r1 + 0.5) / SIZE) * 100 : ((e.r1 + 1) / SIZE) * 100;
        return (
          <span
            key={`edge-${e.r1}-${e.c1}-${e.r2}-${e.c2}`}
            className="tg-edge-token"
            style={{
              position: "absolute",
              left: `${cx}%`,
              top: `${cy}%`,
              transform: "translate(-50%, -50%)",
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "var(--color-surface-raised)",
              border: "1px solid var(--color-border-strong)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
              color: "var(--color-text-primary)",
              boxShadow: "var(--shadow-control)",
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            {e.type === "eq" ? "=" : "×"}
          </span>
        );
      })}

      {celebratingLines.map((line) => {
        const [direction, rawIndex] = line.split("-");
        const index = Number(rawIndex);
        const isRow = direction === "row";
        return (
          <div
            key={line}
            className="tg-line-complete absolute pointer-events-none"
            style={{
              left: isRow ? 0 : `${(index / SIZE) * 100}%`,
              top: isRow ? `${(index / SIZE) * 100}%` : 0,
              width: isRow ? "100%" : `${100 / SIZE}%`,
              height: isRow ? `${100 / SIZE}%` : "100%",
              zIndex: 4,
              border: "2px solid rgba(22,163,74,.78)",
              background: isRow
                ? "linear-gradient(90deg,rgba(22,163,74,.04),rgba(22,163,74,.22),rgba(255,255,255,.42),rgba(22,163,74,.04))"
                : "linear-gradient(180deg,rgba(22,163,74,.04),rgba(22,163,74,.22),rgba(255,255,255,.42),rgba(22,163,74,.04))",
              boxShadow: "0 0 22px rgba(22,163,74,.32), inset 0 0 18px rgba(255,255,255,.55)",
            }}
          >
            <span
              className="tg-line-spark absolute grid place-items-center rounded-full text-white font-bold"
              style={{
                left: "50%",
                top: "50%",
                width: 28,
                height: 28,
                background: "linear-gradient(145deg,#35C886,#0D9A62)",
                boxShadow: "0 5px 16px rgba(13,154,98,.38)",
              }}
            >
              ✓
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div
      className="flex items-start justify-center p-4"
      style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif", paddingTop: "var(--game-content-top)" }}
    >
      <style>{`
        .game-toolbar > * { width: 100%; min-width: 0; }
        @keyframes popIn { 0% { transform: scale(0.3); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes fadeUp { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }
        @keyframes hintPulseError { 0%, 100% { box-shadow: inset 0 0 0 3px rgba(217,105,92,1); } 50% { box-shadow: inset 0 0 0 3px rgba(217,105,92,0.25); } }
        @keyframes hintPulseForced { 0%, 100% { box-shadow: inset 0 0 0 3px rgba(95,168,163,1); } 50% { box-shadow: inset 0 0 0 3px rgba(95,168,163,0.25); } }
        @keyframes hintPulseNext { 0%, 100% { box-shadow: inset 0 0 0 3px rgba(217,174,88,1); } 50% { box-shadow: inset 0 0 0 3px rgba(217,174,88,0.25); } }
        @keyframes lineSweep { 0% { opacity: 0; transform: scale(.92); } 28% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.025); } }
        @keyframes lineSpark { 0% { opacity: 0; transform: translate(-50%,-50%) scale(.4) rotate(-20deg); } 35% { opacity: 1; transform: translate(-50%,-50%) scale(1.15) rotate(8deg); } 100% { opacity: 0; transform: translate(-50%,-50%) scale(.85) rotate(18deg); } }
        @keyframes tangoGlow { 0%, 100% { transform: translate3d(0,0,0); opacity: .55; } 50% { transform: translate3d(8px,-6px,0); opacity: .8; } }
        .tg-symbol { animation: popIn 0.22s ease-out; }
        .tg-card { animation: fadeUp 0.4s ease-out; }
        .tg-board-shell::before, .tg-board-shell::after {
          content: "";
          position: absolute;
          border-radius: 999px;
          filter: blur(1px);
          pointer-events: none;
          animation: tangoGlow 7s ease-in-out infinite;
        }
        .tg-board-shell::before { width: 42%; height: 42%; left: -12%; top: -15%; background: rgba(246,196,83,.16); }
        .tg-board-shell::after { width: 46%; height: 46%; right: -15%; bottom: -18%; background: rgba(74,111,165,.13); animation-delay: -3.5s; }
        .tg-cell::after {
          content: "";
          position: absolute;
          inset: 5px;

          border-radius: 10px;
          border: 1px solid transparent;
          transition: border-color .18s ease, background .18s ease, transform .18s ease;
          pointer-events: none;
        }
        .tg-cell { -webkit-tap-highlight-color: transparent; }
        .tg-cell:focus { outline: none; }
        .tg-symbol-disc {
          width: clamp(38px, 13cqw, 56px);
          height: clamp(38px, 13cqw, 56px);
          display: grid;
          place-items: center;
          border-radius: 999px;
          position: relative;
          z-index: 1;
        }
        .tg-symbol-disc--sun { background: transparent; filter: drop-shadow(0 2px 2px rgba(180,104,5,.14)); }
        .tg-symbol-disc--moon { background: transparent; filter: drop-shadow(0 2px 2px rgba(23,74,145,.14)); }
        .tg-cell:disabled .tg-symbol-disc { opacity: .96; }
        .tg-edge-token { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
        .tg-hint-error { animation: hintPulseError 1.1s ease-in-out infinite; }
        .tg-hint-forced { animation: hintPulseForced 1.1s ease-in-out infinite; }
        .tg-hint-next { animation: hintPulseNext 1.1s ease-in-out infinite; }
        .tg-line-complete { animation: lineSweep .85s ease-out both; }
        .tg-line-spark { animation: lineSpark .85s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .tg-symbol, .tg-card, .tg-hint-error, .tg-hint-forced, .tg-hint-next, .tg-line-complete, .tg-line-spark, .tg-board-shell::before, .tg-board-shell::after { animation: none !important; }
        }
        @media (hover: hover) and (pointer: fine) {
          .tg-cell:not(:disabled):hover::after { border-color: rgba(74,111,165,.18); transform: scale(.96); }
          .tg-cell:not(:disabled):hover { filter: brightness(1.03); }
          .tg-icon-btn:hover { opacity: 0.85; }
          .tg-play-again:hover { filter: brightness(1.08); }
          .tg-toolbar-btn:not(:disabled):hover { transform: translateY(-1px); filter: brightness(1.03); }
        }
      `}</style>

      <div
        className="tg-card w-full max-w-md sm:max-w-lg lg:max-w-xl rounded-2xl p-5 lg:p-6 relative"
        style={{ maxWidth: "var(--game-page-max-width)", background: PANEL, boxShadow: "0 10px 30px rgba(16,24,40,0.10)", border: "1px solid rgba(16,24,40,0.09)" }}
      >
        <button
          onClick={() => setShowHelp((h) => !h)}
          className="tg-icon-btn absolute top-4 right-4 transition-opacity"
          style={{ color: CREAM, opacity: 0.5 }}
        >
          <HelpCircle size={16} />
        </button>

        {/* header */}
        <div className="text-center mb-4">
          {!solved && <div
            className="mx-auto mb-2 flex items-center justify-center gap-1.5 rounded-full"
            style={{ width: 66, height: 30, background: "linear-gradient(135deg, rgba(246,196,83,.16), rgba(74,111,165,.13))", border: "1px solid rgba(16,24,40,.06)" }}
            aria-hidden="true"
          >
            <SunIcon size={14} style={{ color: SUN_COLOR }} />
            <span style={{ width: 1, height: 12, background: "rgba(27,33,41,.12)" }} />
            <ModernMoonIcon size={14} />
          </div>}
          <h1
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: CREAM, letterSpacing: "-0.01em" }}
            className="text-4xl lg:text-5xl"
          >
            Tango
          </h1>
          <p style={{ color: CREAM, opacity: 0.45 }} className="text-xs mt-1">
            balance the sun &amp; moon in every row &amp; column
          </p>
        </div>

        {/* day selector — you already picked the day you just played; it
            belongs on the next puzzle, not this result. */}
        {!solved && (isChallenge ? (
          <div className="flex justify-center mb-4">
            <div className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: `${GOLD}18`, color: GOLD }}>
              <span className="text-xs font-semibold">{t("common.todaysChallenge")}</span>
              <span className="text-[10px] opacity-80">{GIVEN_TARGETS[dayIdx]} clues</span>
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
        )}

        {/* toolbar — Undo/Reset/Hint only ever act on a puzzle still in
            progress; once solved there's nothing left for any of them to do
            (Play Again in the solved panel below replaces "New"). */}
        {!solved && (
          <div className="game-toolbar mb-3 px-1" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "var(--space-2)" }}>
            {[
              { label: t("common.undo"), onClick: handleUndo, disabled: history.length === 0 },
              { label: t("common.reset"), onClick: handleReset, disabled: false },
              { label: "New", onClick: () => newPuzzle(dayIdx), disabled: isChallenge },
              {
                label: t("common.hint"),
                onClick: handleHint,
                disabled: false,
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
          <div
            className="text-xs rounded-lg p-2.5 mb-3"
            style={{ background: "rgba(16,24,40,0.05)", color: CREAM, opacity: 0.75, lineHeight: 1.4 }}
          >
            Tap a blank cell to cycle sun → moon → blank. Every row and column needs three suns and
            three moons, and no more than two of the same symbol can sit in a row. An "=" between
            two cells means they match; a "×" means they differ. Hint flags one wrong symbol, or one
            cell that's already logically forced, or — as a last resort — just points at a blank one.
          </div>
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
          showPlayAgain={!isChallenge}
          onPlayAgain={() => newPuzzle(dayIdx)}
        />

        {solved && <BoardReviewToggle reviewing={reviewing} onToggle={() => setReviewing((value) => !value)} />}
        {(!solved || reviewing) && boardGrid}

        {!solved && (
          <p style={{ color: CREAM, opacity: 0.35 }} className="text-center text-[11px] mt-3">
            {filledCount}/{SIZE * SIZE} filled
          </p>
        )}
      </div>
    </div>
  );
}
