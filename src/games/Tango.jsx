import React, { useState, useEffect, useRef, useCallback } from "react";
import { withSeededRandom } from "../lib/seededRandom.js";
import { useHintCooldown } from "../lib/useHintCooldown.js";
import HintCooldownButton from "../HintCooldownButton.jsx";
import { rateDifficulty } from "../lib/saveStats.js";
import { DifficultyRatingBadge } from "../DifficultyRating.jsx";
import GameSolvedPanel from "../GameSolvedPanel.jsx";
import { Eraser, CornerUpLeft, Sparkles, WandSparkles, Timer as TimerIcon, HelpCircle, Lock } from "lucide-react";
import { useI18n } from "../lib/i18n.jsx";
import DaySelector from "../DaySelector.jsx";

function SunIcon({ size = 24, className = "", style, isConflict = false, ...props }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} style={style} aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="tango-sun-face" x1="6" y1="5" x2="18" y2="19" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFC64A" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
      </defs>
      <circle
        cx="12" cy="12" r="7.55"
        fill={isConflict ? "#E5484D" : "url(#tango-sun-face)"}
        stroke={isConflict ? "#C9363B" : "#D97706"}
        strokeWidth="1.35"
      />
    </svg>
  );
}

function ModernMoonIcon({ size = 24, className = "", style, isConflict = false, ...props }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} style={style} aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="tango-moon-face" x1="6" y1="4" x2="18" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#67A8FF" />
          <stop offset="55%" stopColor="#3478D4" />
          <stop offset="100%" stopColor="#1855AA" />
        </linearGradient>
      </defs>
      <path
        d="M19.75 15.55A8.65 8.65 0 0 1 8.45 4.25a8.9 8.9 0 1 0 11.3 11.3Z"
        fill={isConflict ? "#E5484D" : "url(#tango-moon-face)"}
        stroke={isConflict ? "#C9363B" : "#174A91"}
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

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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

/* ---------------- design tokens ---------------- */

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const CREAM = "#1B2129";
const GOLD = "#2F6FED";
const RED = "#E5484D";
const TEAL = "#5FA8A3";
const SUN_COLOR = "#F2A43A";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GIVEN_TARGETS = [16, 14, 12, 10, 9, 8, 7];
const EDGE_TARGETS = [6, 5, 5, 4, 4, 3, 3];

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
  const [celebratingLines, setCelebratingLines] = useState([]);
  const [displayedConflicts, setDisplayedConflicts] = useState(new Set());
  const timerRef = useRef(null);
  const completedLinesRef = useRef(new Set());
  const celebrationTimerRef = useRef(null);
  const conflictDebounceRef = useRef(null);

  const newPuzzle = useCallback((dIdx) => {
    const gen = () => generatePuzzle(GIVEN_TARGETS[dIdx], EDGE_TARGETS[dIdx]);
    const p = isChallenge && seed ? withSeededRandom(seed, gen) : gen();
    setPuzzle(p);
    setBoard(p.givens.map((row) => row.slice()));
    setSeconds(0);
    setRunning(true);
    setSolved(false);
    setMistakes(0);
    setHintsUsed(0);
    setDifficultyRating(null);
    setHintCell(null);
    setHistory([]);
    setCelebratingLines([]);
    completedLinesRef.current = new Set(getCompletedLines(p.givens, p.solution));
    window.clearTimeout(celebrationTimerRef.current);
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
    if (getConflicts(board, puzzle.edgeMap).size === 0 && !solved) {
      setSolved(true);
      setRunning(false);
      onSolved && onSolved({ userId, game: "tango", dayIndex: dayIdx, seconds, mistakes, hints: hintsUsed, mode, challengeDate: isChallenge ? challengeDate : undefined });
    }
  }, [board, puzzle]);

  useEffect(() => {
    if (!board || !puzzle) return undefined;
    const completed = getCompletedLines(board, puzzle.solution);
    const newlyCompleted = completed.filter((line) => !completedLinesRef.current.has(line));
    completedLinesRef.current = new Set(completed);
    if (!newlyCompleted.length) return undefined;
    setCelebratingLines(newlyCompleted);
    window.clearTimeout(celebrationTimerRef.current);
    celebrationTimerRef.current = window.setTimeout(() => setCelebratingLines([]), 900);
    return undefined;
  }, [board, puzzle]);

  useEffect(() => () => window.clearTimeout(celebrationTimerRef.current), []);

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
    setHistory((h) => [...h, { board: board.map((row) => row.slice()), mistakes, hints: hintsUsed }].slice(-50));
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
    setBoard(last.board);
    setMistakes(last.mistakes);
    setHintsUsed(last.hints);
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
    // Keep the elapsed time when resetting the current puzzle.
    setSolved(false);
    setRunning(true);
  }

  function handleHint() {
    if (solved || hintCooldown.isLocked()) return;
    const applyHint = (r, c, type, countMistake = false) => {
      pushHistory();
      setBoard((previous) => {
        const next = previous.map((row) => row.slice());
        next[r][c] = puzzle.solution[r][c];
        return next;
      });
      setHintCell({ r, c, type, symbol: puzzle.solution[r][c] });
      setHintsUsed((value) => value + 1);
      if (countMistake) setMistakes((value) => value + 1);
      hintCooldown.startCooldown();
    };

    // A hint now performs a visible, useful action: it corrects the first
    // wrong symbol, otherwise fills a forced cell, and finally reveals one
    // blank cell. Previously it only drew a faint preview, which could be
    // imperceptible on iOS and looked as though the button did nothing.
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

  return (
    <div
      style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }}
      className="flex items-start justify-center p-4 pt-[72px]"
    >
      <style>{`
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
        .tg-cell:not(:disabled):hover::after { border-color: rgba(74,111,165,.18); background: rgba(255,255,255,.4); transform: scale(.96); }
        .tg-symbol-disc {
          width: clamp(31px, 10cqw, 46px);
          height: clamp(31px, 10cqw, 46px);
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
          .tg-cell:not(:disabled):hover { filter: brightness(1.03); }
          .tg-icon-btn:hover { opacity: 0.85; }
          .tg-play-again:hover { filter: brightness(1.08); }
          .tg-toolbar-btn:not(:disabled):hover { transform: translateY(-1px); filter: brightness(1.03); }
        }
      `}</style>

      <div
        className="tg-card w-full max-w-sm sm:max-w-md lg:max-w-lg rounded-2xl p-5 lg:p-6 relative"
        style={{ background: PANEL, boxShadow: "0 10px 30px rgba(16,24,40,0.10)", border: "1px solid rgba(16,24,40,0.09)" }}
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
          <div
            className="mx-auto mb-2 flex items-center justify-center gap-1.5 rounded-full"
            style={{ width: 66, height: 30, background: "linear-gradient(135deg, rgba(246,196,83,.16), rgba(74,111,165,.13))", border: "1px solid rgba(16,24,40,.06)" }}
            aria-hidden="true"
          >
            <SunIcon size={14} style={{ color: SUN_COLOR }} />
            <span style={{ width: 1, height: 12, background: "rgba(27,33,41,.12)" }} />
            <ModernMoonIcon size={14} />
          </div>
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

        {/* day selector — locked to today's date in challenge mode */}
        {isChallenge ? (
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

        {/* toolbar - text labels, spread at top */}
        <div className="game-toolbar flex items-center justify-between gap-2 mb-3 px-1">
          {[
            { label: t("common.undo"), onClick: handleUndo, disabled: solved || history.length === 0 },
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

        {/* board */}
        <div
          className="tg-board-shell relative w-full rounded-2xl overflow-hidden"
          style={{
            aspectRatio: "1 / 1",
            display: "grid",
            gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
            gridTemplateRows: `repeat(${SIZE}, 1fr)`,
            background: "linear-gradient(145deg, #FBFCFE 0%, #F2F5F9 100%)",
            border: "6px solid rgba(255,255,255,.92)",
            boxShadow: "0 16px 34px rgba(16,24,40,.13), 0 2px 8px rgba(16,24,40,.08), inset 0 0 0 1px rgba(16,24,40,.08)",
            containerType: "inline-size",
          }}
        >
          {board.map((row, r) =>
            row.map((val, c) => {
              const isGiven = puzzle.givens[r][c] !== 0;
              const isConflict = displayedConflicts.has(`${r}-${c}`);
              const isHint = hintCell && hintCell.r === r && hintCell.c === c;
              const hintClass = isHint && !isConflict ? `tg-hint-${hintCell.type}` : "";
              return (
                <button
                  key={`${r}-${c}`}
                  onClick={() => handleCellClick(r, c)}
                  disabled={isGiven}
                  className={`tg-cell relative flex items-center justify-center transition-colors duration-200 ${hintClass}`}
                  style={{
                    background: isGiven ? "rgba(120,113,100,.075)" : "rgba(255,255,255,.22)",
                    border: "1px solid rgba(27,33,41,0.14)",
                    boxShadow: isConflict ? `inset 0 0 0 3px ${RED}` : "none",
                    cursor: isGiven ? "default" : "pointer",
                  }}
                >
                  {val === SUN && (
                    <span className="tg-symbol tg-symbol-disc tg-symbol-disc--sun"><SunIcon key={`sun-${r}-${c}`} size={Math.max(25, 35 - SIZE)} isConflict={isConflict} /></span>
                  )}
                  {val === MOON && (
                    <span className="tg-symbol tg-symbol-disc tg-symbol-disc--moon"><ModernMoonIcon key={`moon-${r}-${c}`} size={Math.max(25, 35 - SIZE)} isConflict={isConflict} /></span>
                  )}
                  {/* The pulsing border alone doesn't say what belongs here —
                      show a faint preview of the actual symbol. For an empty
                      hinted cell it sits centred like a real placement; for a
                      wrong existing symbol (val !== EMPTY) it sits as a small
                      corner badge instead, so it doesn't visually collide
                      with the (still-visible, still red) wrong symbol. */}
                  {isHint && hintCell.symbol && !solved && (
                    val === EMPTY ? (
                      <span className="tg-hint-ghost" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                        {hintCell.symbol === SUN ? (
                          <SunIcon size={Math.max(22, 32 - SIZE)} style={{ color: SUN_COLOR, opacity: 0.4 }} />
                        ) : (
                          <ModernMoonIcon size={Math.max(24, 34 - SIZE)} style={{ opacity: 0.42 }} />
                        )}
                      </span>
                    ) : (
                      <span
                        className="tg-hint-ghost-badge"
                        style={{
                          position: "absolute", top: 2, right: 2, width: 14, height: 14, borderRadius: "50%",
                          background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center",
                          boxShadow: "0 1px 3px rgba(16,24,40,0.35)", pointerEvents: "none",
                        }}
                      >
                        {hintCell.symbol === SUN ? (
                          <SunIcon size={10} style={{ color: SUN_COLOR }} />
                        ) : (
                          <ModernMoonIcon size={9} style={{ color: "#40557D" }} />
                        )}
                      </span>
                    )
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
                  background: "rgba(255,255,255,.92)",
                  border: `1px solid rgba(16,24,40,0.14)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  color: CREAM,
                  boxShadow: "0 3px 9px rgba(16,24,40,.14)",
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

          {solved && difficultyRating === null && (
            <GameSolvedPanel
              icon={
                <div className="flex items-center gap-1">
                  <SunIcon size={27} style={{ color: SUN_COLOR }} />
                  <ModernMoonIcon size={26} style={{ color: "#40557D" }} />
                </div>
              }
              title="Solved"
              stats={
                <>
                  {fmtTime(seconds)} &middot; {mistakes} mistake{mistakes === 1 ? "" : "s"} &middot; {hintsUsed} hint{hintsUsed === 1 ? "" : "s"}
                </>
              }
              rewardResult={rewardResult?.points_awarded != null ? rewardResult : null}
              savedStatId={savedStatId}
              onRate={(value) => rateDifficulty(savedStatId, value)}
              onRated={setDifficultyRating}
              showPlayAgain={!isChallenge}
              onPlayAgain={() => newPuzzle(dayIdx)}
              noPointsLabel={t("common.noPoints")}
            />
          )}
        </div>

        <p style={{ color: CREAM, opacity: 0.35 }} className="text-center text-[11px] mt-3">
          {filledCount}/{SIZE * SIZE} filled
        </p>
      </div>
    </div>
  );
}
