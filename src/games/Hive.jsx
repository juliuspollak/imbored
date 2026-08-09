import React, { useState, useEffect, useRef, useCallback } from "react";
import { withSeededRandom, shuffle } from "../lib/seededRandom.js";
import { useGameTimer } from "../lib/useGameTimer.js";
import { useHintCooldown } from "../lib/useHintCooldown.js";
import HintCooldownButton from "../HintCooldownButton.jsx";
import GameSolvedPanel from "../GameSolvedPanel.jsx";
import BoardReviewToggle from "../BoardReviewToggle.jsx";
import { Eraser, CornerUpLeft, Sparkles, WandSparkles, Timer as TimerIcon, HelpCircle, Lock, X } from "lucide-react";
import { useI18n } from "../lib/i18n.jsx";
import DaySelector from "../DaySelector.jsx";
import Button from "../components/Button.jsx";
import { HIVE_BRAND } from "../lib/gameBranding.jsx";
import { createGameAttemptSeed } from "../lib/gameAttemptSeed.js";
import { findCompletionForcedStep } from "../lib/hiveHintLogic.js";

/* ---------------- puzzle generation ---------------- */

function generateSolution(n) {
  const solution = new Array(n).fill(-1);
  function backtrack(row, usedCols, prevCol) {
    if (row === n) return true;
    for (const col of shuffle([...Array(n).keys()])) {
      if (usedCols.has(col)) continue;
      if (prevCol !== null && Math.abs(col - prevCol) <= 1) continue;
      usedCols.add(col);
      solution[row] = col;
      if (backtrack(row + 1, usedCols, col)) return true;
      usedCols.delete(col);
      solution[row] = -1;
    }
    return false;
  }
  return backtrack(0, new Set(), null) ? solution : null;
}

function growRegions(n, solution) {
  const grid = Array.from({ length: n }, () => Array(n).fill(-1));
  const frontiers = Array.from({ length: n }, () => []);
  for (let r = 0; r < n; r++) {
    const c = solution[r];
    grid[r][c] = r;
    frontiers[r].push([r, c]);
  }
  const sizes = new Array(n).fill(1);
  let remaining = n * n - n;
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  while (remaining > 0) {
    const active = frontiers.map((f, i) => i).filter((i) => frontiers[i].length > 0);
    if (active.length === 0) break;
    // weight toward smaller regions so shapes stay compact/blocky rather than thin snakes
    const weights = active.map((i) => 1 / (sizes[i] + 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = Math.random() * total;
    let regionId = active[active.length - 1];
    for (let i = 0; i < active.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        regionId = active[i];
        break;
      }
    }
    const frontier = frontiers[regionId];
    const idx = Math.floor(Math.random() * frontier.length);
    const [r, c] = frontier[idx];
    const opts = [];
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < n && nc >= 0 && nc < n && grid[nr][nc] === -1) opts.push([nr, nc]);
    }
    if (opts.length === 0) {
      frontier.splice(idx, 1);
      continue;
    }
    const [nr, nc] = opts[Math.floor(Math.random() * opts.length)];
    grid[nr][nc] = regionId;
    frontiers[regionId].push([nr, nc]);
    sizes[regionId]++;
    remaining--;
  }
  let guard = 0;
  while (remaining > 0 && guard < 2000) {
    guard++;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (grid[r][c] !== -1) continue;
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < n && nc >= 0 && nc < n && grid[nr][nc] !== -1) {
            grid[r][c] = grid[nr][nc];
            remaining--;
            break;
          }
        }
      }
    }
  }
  return grid;
}

function countSolutions(n, regionGrid, limit) {
  let count = 0;
  const usedCols = new Set(), usedRegions = new Set();
  function backtrack(row, prevCol) {
    if (count >= limit) return;
    if (row === n) {
      count++;
      return;
    }
    for (let col = 0; col < n; col++) {
      if (usedCols.has(col)) continue;
      if (prevCol !== null && Math.abs(col - prevCol) <= 1) continue;
      const region = regionGrid[row][col];
      if (usedRegions.has(region)) continue;
      usedCols.add(col);
      usedRegions.add(region);
      backtrack(row + 1, col);
      usedCols.delete(col);
      usedRegions.delete(region);
      if (count >= limit) return;
    }
  }
  backtrack(0, null);
  return count;
}

function regionCellsOf(grid, n, reg) {
  const out = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (grid[r][c] === reg) out.push([r, c]);
  return out;
}

function isContiguous(cells) {
  if (cells.length === 0) return false;
  const set = new Set(cells.map(([r, c]) => `${r},${c}`));
  const seen = new Set([`${cells[0][0]},${cells[0][1]}`]);
  const stack = [cells[0]];
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const k = `${r + dr},${c + dc}`;
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push([r + dr, c + dc]);
      }
    }
  }
  return seen.size === cells.length;
}

// Randomly-grown regions almost never produce a uniquely-solvable board
// above 5x5 — and an ambiguous puzzle has no deduction chain at all, which
// is exactly what forces a hint to fall back on revealing an answer. So
// rather than accepting whatever growth produced, nudge single boundary
// cells between neighbouring regions, keeping any change that doesn't
// increase the solution count, until the board is pinned to one solution.
function repairToUnique(n, solution, grid, budget = 1200) {
  let best = grid.map((row) => row.slice());
  let bestCount = countSolutions(n, best, 6);
  const beeCell = new Set(solution.map((c, r) => `${r},${c}`));
  for (let iter = 0; iter < budget && bestCount > 1; iter++) {
    const r = Math.floor(Math.random() * n), c = Math.floor(Math.random() * n);
    if (beeCell.has(`${r},${c}`)) continue; // never move a cell holding a bee
    const from = best[r][c];
    const neigh = [];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < n && nc >= 0 && nc < n && best[nr][nc] !== from) neigh.push(best[nr][nc]);
    }
    if (!neigh.length) continue;
    const trial = best.map((row) => row.slice());
    trial[r][c] = neigh[Math.floor(Math.random() * neigh.length)];
    const fromCells = regionCellsOf(trial, n, from);
    if (fromCells.length === 0 || !isContiguous(fromCells)) continue;
    if (!isContiguous(regionCellsOf(trial, n, trial[r][c]))) continue;
    const cnt = countSolutions(n, trial, 6);
    if (cnt >= 1 && cnt <= bestCount) {
      best = trial;
      bestCount = cnt;
    }
  }
  return { grid: best, count: bestCount };
}

function findNextLogicalStepPure(board, regionGrid, n) {
  const rowHasBee = new Array(n).fill(false);
  const colHasBee = new Array(n).fill(false);
  const regionHasBee = {};
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] === 2) {
        rowHasBee[r] = true;
        colHasBee[c] = true;
        regionHasBee[regionGrid[r][c]] = true;
      }
    }
  }
  function isCandidate(r, c) {
    if (board[r][c] !== 0) return false;
    if (rowHasBee[r] || colHasBee[c] || regionHasBee[regionGrid[r][c]]) return false;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr][cc] === 2) return false;
      }
    }
    return true;
  }

  // Checked first: any cell directly ruled out by a bee already on the
  // board. These are the most obvious follow-up moves ("you placed a
  // bee, now mark what it eliminates"), so they should be offered
  // before anything requiring deeper reasoning.
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] !== 2) continue;
      const region = regionGrid[r][c];
      for (let rr = 0; rr < n; rr++) {
        for (let cc = 0; cc < n; cc++) {
          if (rr === r && cc === c) continue;
          if (board[rr][cc] !== 0) continue;
          const sameRow = rr === r, sameCol = cc === c, sameRegion = regionGrid[rr][cc] === region;
          const adjacent = Math.abs(rr - r) <= 1 && Math.abs(cc - c) <= 1;
          if (sameRow || sameCol || sameRegion || adjacent) return { r: rr, c: cc, type: "cross", src: "bee-elim" };
        }
      }
    }
  }

  // naked singles: a row, column, or region with exactly one candidate left
  for (let r = 0; r < n; r++) {
    if (rowHasBee[r]) continue;
    const cands = [];
    for (let c = 0; c < n; c++) if (isCandidate(r, c)) cands.push(c);
    if (cands.length === 1) return { r, c: cands[0], type: "bee", src: "naked" };
  }
  for (let c = 0; c < n; c++) {
    if (colHasBee[c]) continue;
    const cands = [];
    for (let r = 0; r < n; r++) if (isCandidate(r, c)) cands.push(r);
    if (cands.length === 1) return { r: cands[0], c, type: "bee", src: "naked" };
  }
  const regionCells = {};
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) (regionCells[regionGrid[r][c]] ||= []).push([r, c]);
  }
  for (const reg in regionCells) {
    if (regionHasBee[reg]) continue;
    const cands = regionCells[reg].filter(([r, c]) => isCandidate(r, c));
    if (cands.length === 1) return { r: cands[0][0], c: cands[0][1], type: "bee", src: "naked" };
  }

  return null;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SIZES = [5, 5, 6, 6, 7, 7, 9];
const HIVE_GENERATOR_VERSION = "hive-v1";
const REGION_COLORS = ["#96BEFF", "#DFDFDF", "#DFA0BF", "#FF7B60", "#FFC992", "#B9B29E", "#B3DFA0", "#BBA3E2", "#E6F388"];
const DARK_REGION_COLORS = ["#29466F", "#66502B", "#285841", "#633B59", "#4C3E70", "#704039", "#285967", "#5B5337"];
const BG = "var(--color-page-bg)";
const PANEL = "var(--color-surface)";
const INK = "var(--color-text-primary)";
const BEE_INK = "#5d3a05";
const BOARD_LINE = "#000000";
const CREAM = "var(--color-text-primary)";
const GOLD = "var(--color-primary)";
const RED = "#D9695C";
const puzzleCache = new Map();

function makePuzzle(n) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const sol = generateSolution(n);
    if (!sol) continue;
    const initial = growRegions(n, sol);
    const repaired = repairToUnique(n, sol, initial);
    if (repaired.count === 1) return { solution: sol, regionGrid: repaired.grid };
  }
  // fallback (rare): return a valid puzzle even if repair budget was exhausted
  const sol = generateSolution(n);
  return { solution: sol, regionGrid: growRegions(n, sol) };
}

function createPuzzleForSeed(n, seedKey) {
  const cacheKey = `${n}:${seedKey}`;
  const memoryCached = puzzleCache.get(cacheKey);
  if (memoryCached) return memoryCached;

  const generated = withSeededRandom(seedKey, () => makePuzzle(n));
  puzzleCache.set(cacheKey, generated);
  return generated;
}

function initialBoard(n) {
  return Array.from({ length: n }, () => Array(n).fill(0));
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

export default function Hive({
  userId,
  mode = "practice",
  seed = null,
  forcedDayIdx,
  challengeDate,
  onSolved,
  savedStatId: completedStatId = null,
  rewardResult: completedReward = null,
  initialSeconds = 0,
  onChallengeComplete,
  onBack,
  isIncluded = true,
  challengeName = null,
  onPlayPersonalChallenge,
  onChooseAnotherChallenge,
  scoreToBeatSeconds = null,
  scoreChallengerName = null,
}) {
  const { t } = useI18n();
  const isChallenge = mode === "challenge";
  const requestedDayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  const [dayIdx, setDayIdx] = useState(isChallenge ? forcedDayIdx ?? requestedDayIdx : requestedDayIdx);
  const n = SIZES[dayIdx];
  const attemptSeedRef = useRef(seed || createGameAttemptSeed("hive"));
  const [puzzle, setPuzzle] = useState(() => createPuzzleForSeed(n, attemptSeedRef.current));
  const [board, setBoard] = useState(() => initialBoard(n));
  const [history, setHistory] = useState([]);
  // Seeded from the server-recorded attempt start, so leaving and re-entering
  // resumes the same clock instead of handing out a fresh one.
  const [seconds, setSeconds] = useState(initialSeconds);
  const [running, setRunning] = useState(true);
  const [mistakes, setMistakes] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [solved, setSolved] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [hintCells, setHintCells] = useState([]);
  const [difficultyRating, setDifficultyRating] = useState(null);
  const [localSavedStatId, setLocalSavedStatId] = useState(null);
  const [localRewardResult, setLocalRewardResult] = useState(null);
  const [completionFinished, setCompletionFinished] = useState(false);
  const [syncRetryTick, setSyncRetryTick] = useState(0);
  const [solvedAtMs, setSolvedAtMs] = useState(null);
  const dragRef = useRef({ active: false, mode: null, visited: new Set(), startCell: null, moved: false, isTouch: false });
  const boardRef = useRef(null);
  const pointerActiveRef = useRef(false);
  const ignoreCompatibilityClickUntilRef = useRef(0);
  const lastHandledPointerRef = useRef(null);
  const handleCellClickRef = useRef(null);
  const puzzleKeyRef = useRef(0);
  const didRunDayEffectRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const savedOnceRef = useRef(false);
  const statsRef = useRef({ seconds: 0, mistakes: 0, hintsUsed: 0 });
  const hintCooldown = useHintCooldown(5);
  const savedStatId = completedStatId ?? localSavedStatId;
  const rewardResult = completedReward ?? localRewardResult;

  const boardSize = board.length;
  const beesCount = board.flat().filter((v) => v === 2).length;

  useEffect(() => {
    if (!isChallenge || isIncluded || !challengeName) return;
    setRunning(false);
  }, [challengeName, isChallenge, isIncluded]);

  useGameTimer(running, solved, setSeconds);

  useEffect(() => {
    statsRef.current = { seconds, mistakes, hintsUsed };
  }, [hintsUsed, mistakes, seconds]);

  useEffect(() => {
    if (!solved || savedOnceRef.current || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    let cancelled = false;
    (async () => {
      const solvedStats = statsRef.current;
      const payload = {
        userId,
        game: "hive",
        dayIndex: dayIdx,
        seconds: solvedStats.seconds,
        mistakes: solvedStats.mistakes,
        hints: solvedStats.hintsUsed,
        seed: attemptSeedRef.current,
        generatorVersion: HIVE_GENERATOR_VERSION,
        generatorConfig: { size: n },
        mode,
        challengeDate:isChallenge ? challengeDate : undefined,
      };
      const legacyPayload = {
        game:"hive",
        seconds:solvedStats.seconds,
        mistakes:solvedStats.mistakes,
        hints:solvedStats.hintsUsed,
        difficulty: dayIdx,
        seed: seed || null,
      };
      if (onSolved) {
        // Unlike the legacy onChallengeComplete path below, onSolved (the
        // shared practice-mode handler in App.jsx) doesn't return anything -
        // it saves the stats and reward into the parent's own state instead.
        // Treating a resolved call as "no result" and retrying on a timer
        // re-saved the game and re-awarded points every 1.5s forever, which is
        // why this game alone could blow through the daily practice limit and
        // flicker between a stale "finalising" state and a real one.
        try {
          await onSolved(payload);
          if (cancelled) return;
          savedOnceRef.current = true;
          saveInFlightRef.current = false;
          setCompletionFinished(true);
        } catch (error) {
          console.error("Unable to save Hive result", error);
          saveInFlightRef.current = false;
          window.setTimeout(() => setSyncRetryTick((tick) => tick + 1), 1500);
        }
        return;
      }
      const result = await onChallengeComplete?.(legacyPayload);
      if (cancelled) return;
      if (result?.error) {
        console.error("Unable to save Hive result", result.error);
        saveInFlightRef.current = false;
        window.setTimeout(() => setSyncRetryTick((tick) => tick + 1), 1500);
        return;
      }
      savedOnceRef.current = true;
      saveInFlightRef.current = false;
      setLocalSavedStatId(result?.stat_id ?? null);
      setLocalRewardResult(result?.reward ?? null);
      setCompletionFinished(true);
    })();
    return () => { cancelled = true; };
  }, [challengeDate, dayIdx, isChallenge, mode, onChallengeComplete, onSolved, seed, solved, syncRetryTick, userId]);

  const newPuzzle = useCallback((size = n) => {
    puzzleKeyRef.current += 1;
    const key = isChallenge
      ? (seed || attemptSeedRef.current)
      : createGameAttemptSeed("hive");
    attemptSeedRef.current = key;
    setPuzzle(createPuzzleForSeed(size, key));
    setBoard(initialBoard(size));
    setHistory([]);
    // Resume the attempt clock rather than restarting it. In challenge mode
    // this only ever runs once, on mount; the "New" control is disabled.
    setSeconds(initialSeconds);
    setRunning(true);
    setMistakes(0);
    setHintsUsed(0);
    setSolved(false);
    setReviewing(false);
    setHintCells([]);
    setDifficultyRating(null);
    setLocalSavedStatId(null);
    setLocalRewardResult(null);
    setCompletionFinished(false);
    setSolvedAtMs(null);
    hintCooldown.reset();
    savedOnceRef.current = false;
    saveInFlightRef.current = false;
  }, [isChallenge, n, seed, initialSeconds]);

  useEffect(() => {
    if (isChallenge) return;
    // The initial state already generated today's board; do not immediately
    // repeat that expensive work after the first render.
    if (!didRunDayEffectRef.current) {
      didRunDayEffectRef.current = true;
      return;
    }
    const size = SIZES[dayIdx];
    const nextSeed = createGameAttemptSeed("hive");
    attemptSeedRef.current = nextSeed;
    setPuzzle(createPuzzleForSeed(size, nextSeed));
    setBoard(initialBoard(size));
    setHistory([]);
    setSeconds(0);
    setRunning(true);
    setMistakes(0);
    setHintsUsed(0);
    setSolved(false);
    setReviewing(false);
    setHintCells([]);
    setDifficultyRating(null);
    setLocalSavedStatId(null);
    setLocalRewardResult(null);
    setCompletionFinished(false);
    setSolvedAtMs(null);
    hintCooldown.reset();
    savedOnceRef.current = false;
    saveInFlightRef.current = false;
  }, [dayIdx, isChallenge]);

  function pushHistory(snapshot = board) {
    setHistory((h) => [...h, snapshot.map((row) => row.slice())]);
  }

  function validate(next) {
    const conflicts = new Set();
    const beePositions = [];
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        if (next[r][c] === 2) beePositions.push([r, c]);
      }
    }
    for (let i = 0; i < beePositions.length; i++) {
      const [r1, c1] = beePositions[i];
      for (let j = i + 1; j < beePositions.length; j++) {
        const [r2, c2] = beePositions[j];
        if (r1 === r2 || c1 === c2 || Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1 || puzzle.regionGrid[r1][c1] === puzzle.regionGrid[r2][c2]) {
          conflicts.add(`${r1}-${c1}`);
          conflicts.add(`${r2}-${c2}`);
        }
      }
    }
    return conflicts;
  }

  const conflicts = validate(board);

  function handleCellClick(r, c, event) {
    // Some iOS versions still emit a compatibility click even when the
    // touchstart was prevented. Touches are applied directly in onUp, so that
    // delayed click must not cycle the freshly painted × into a bee.
    if (event && event.detail !== 0 && Date.now() < ignoreCompatibilityClickUntilRef.current) return;
    if (solved || pointerActiveRef.current) return;
    setRunning(true);
    pushHistory();
    setBoard((prev) => {
      const next = prev.map((row) => row.slice());
      next[r][c] = (next[r][c] + 1) % 3;
      // Cell editing is exploratory: do not penalise a second tap that cycles
      // × to a bee. Invalid bee combinations are already shown as conflicts.
      const allCorrect = next.every((row, rr) => row[puzzle.solution[rr]] === 2) && next.flat().filter((v) => v === 2).length === boardSize;
      if (allCorrect) {
        setSolved(true);
        setRunning(false);
        setSolvedAtMs(Date.now());
      }
      return next;
    });
  }

  useEffect(() => { handleCellClickRef.current = handleCellClick; });

  function handleMouseDown(e) {
    if (solved) return;
    const isTouch = !!e.touches;
    // iOS may emit its synthetic click after touchend and after a zero-delay
    // guard has already cleared. Own touch taps ourselves so one gesture can
    // never paint an × and then cycle that same cell again into a bee.
    e.preventDefault();
    const target = e.target.closest(".qp-cell");
    if (!target) return;
    const cells = Array.from(boardRef.current.querySelectorAll(".qp-cell"));
    const idx = cells.indexOf(target);
    const r = Math.floor(idx / boardSize), c = idx % boardSize;
    pointerActiveRef.current = true;
    const initial = board[r][c];
    const mode = initial === 1 ? 0 : 1;
    dragRef.current = {
      active: true,
      mode,
      visited: new Set([`${r},${c}`]),
      startCell: { r, c },
      moved: false,
      isTouch,
    };
  }

  useEffect(() => {
    function onMove(e) {
      if (!dragRef.current.active || !boardRef.current) return;
      const point = e.touches ? e.touches[0] : e;
      const rect = boardRef.current.getBoundingClientRect();
      const cellSize = rect.width / boardSize;
      // Keep a drag attached when a finger briefly strays across the outer
      // border. Mapping coordinates to the grid avoids overlapping hit areas,
      // so stationary taps still belong to exactly one cell.
      const edgeTolerance = Math.min(10, cellSize * 0.22);
      if (
        point.clientX < rect.left - edgeTolerance
        || point.clientX > rect.right + edgeTolerance
        || point.clientY < rect.top - edgeTolerance
        || point.clientY > rect.bottom + edgeTolerance
      ) return;
      const localX = Math.min(rect.width - 0.01, Math.max(0, point.clientX - rect.left));
      const localY = Math.min(rect.height - 0.01, Math.max(0, point.clientY - rect.top));
      const r = Math.floor(localY / (rect.height / boardSize));
      const c = Math.floor(localX / cellSize);
      const key = `${r},${c}`;
      if (dragRef.current.visited.has(key)) return;
      const isFirstMove = !dragRef.current.moved;
      dragRef.current.moved = true;
      dragRef.current.visited.add(key);
      setBoard((prev) => {
        if (isFirstMove) {
          setHistory((h) => [...h, prev.map((row) => row.slice())]);
        }
        const next = prev.map((row) => row.slice());
        if (isFirstMove && dragRef.current.startCell) {
          const start = dragRef.current.startCell;
          if (next[start.r][start.c] !== 2) {
            next[start.r][start.c] = dragRef.current.mode;
          }
        }
        if (next[r][c] !== 2) {
          next[r][c] = dragRef.current.mode;
        }
        return next;
      });
    }
    function onUp(e) {
      if (dragRef.current.active) {
        const wasDrag = dragRef.current.moved;
        const wasTouch = dragRef.current.isTouch;
        const startCell = dragRef.current.startCell;
        const wasCancelled = e?.type === "touchcancel";
        dragRef.current.active = false;
        if (wasTouch) {
          // touchstart was prevented, so no compatibility click should be
          // generated. Apply a stationary tap exactly once here and defensively
          // discard any delayed compatibility click iOS still generates.
          ignoreCompatibilityClickUntilRef.current = Date.now() + 800;
          pointerActiveRef.current = false;
          if (!wasCancelled && !wasDrag && startCell) {
            handleCellClickRef.current?.(startCell.r, startCell.c);
          }
        } else if (wasDrag) {
          // Suppress the click emitted after a completed drag.
          window.setTimeout(() => { pointerActiveRef.current = false; }, 0);
        } else {
          // A stationary mouse press is a normal click.
          pointerActiveRef.current = false;
        }
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    window.addEventListener("touchcancel", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onUp);
    };
  }, [boardSize]);

  function handleUndo() {
    if (!history.length || solved) return;
    const prev = history[history.length - 1];
    setBoard(prev.map((row) => row.slice()));
    setHistory((h) => h.slice(0, -1));
  }

  function handleReset() {
    if (solved) return;
    setBoard(initialBoard(boardSize));
    setHistory([]);
    // Reset clears only the board. It remains the same timed attempt, and
    // abandoning the current board counts as one scoring mistake.
    setMistakes((value) => value + 1);
    setRunning(true);
    setHintCells([]);
  }

  function handleHint() {
    if (solved || hintCooldown.isLocked()) return;
    hintCooldown.startCooldown();
    const isCorrectHint = ({ r, c, type }) => type === "bee"
      ? puzzle.solution[r] === c
      : puzzle.solution[r] !== c;
    const showHints = (cells) => {
      const safeCells = cells.filter(isCorrectHint);
      if (!safeCells.length) return false;
      setHintCells(safeCells);
      setHintsUsed((h) => h + 1);
      window.setTimeout(() => setHintCells([]), 2200);
      return true;
    };
    const wrong = [];
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        // Use the same striped answer style as a normal suggestion. A wrong
        // × on the solution cell should preview a bee; a misplaced bee
        // should be identified as a cell that needs eliminating.
        if (board[r][c] === 2 && puzzle.solution[r] !== c) wrong.push({ r, c, type: "cross", src: "wrong" });
        if (board[r][c] === 1 && puzzle.solution[r] === c) wrong.push({ r, c, type: "bee", src: "wrong" });
      }
    }
    if (wrong.length) {
      if (showHints([wrong[0]])) return;
    }

    // A correctly placed bee rules out its row, column, region and every
    // touching cell. Highlight all still-blank eliminations together so the
    // same rule is not split across two visually different hint steps.
    for (let beeRow = 0; beeRow < boardSize; beeRow++) {
      const beeCol = puzzle.solution[beeRow];
      if (board[beeRow][beeCol] !== 2) continue;
      const beeRegion = puzzle.regionGrid[beeRow][beeCol];
      const eliminated = [];
      for (let r = 0; r < boardSize; r++) {
        for (let c = 0; c < boardSize; c++) {
          if (r === beeRow && c === beeCol || board[r][c] !== 0) continue;
          const sameRow = r === beeRow;
          const sameColumn = c === beeCol;
          const sameRegion = puzzle.regionGrid[r][c] === beeRegion;
          const touching = Math.abs(r - beeRow) <= 1 && Math.abs(c - beeCol) <= 1;
          if (sameRow || sameColumn || sameRegion || touching) {
            eliminated.push({ r, c, type: "cross", src: "bee-elimination" });
          }
        }
      }
      if (eliminated.length) {
        if (showHints(eliminated)) return;
      }
    }

    const step = findNextLogicalStepPure(board, puzzle.regionGrid, boardSize);
    if (step) {
      if (showHints([step])) return;
    }
    // If the quick human-style rules cannot advance the board, compare every
    // completion still compatible with the player's marks. Suggest a cell
    // that no completion can use before suggesting any universally forced
    // bee. This never reads or reveals puzzle.solution.
    const completionStep = findCompletionForcedStep(board, puzzle.regionGrid);
    if (completionStep) {
      showHints([completionStep]);
    }
  }

  function edgeBorder(r, c, dr, dc) {
    // Draw each shared edge once (from the lower/right cell) so widths do not
    // visually double. The board container owns the outside edge.
    if (dr > 0 || dc > 0) return "none";
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) return "none";
    return puzzle.regionGrid[r][c] !== puzzle.regionGrid[nr][nc]
      ? `2.5px solid ${BOARD_LINE}`
      : `1px solid ${BOARD_LINE}`;
  }

  if (isChallenge && !isIncluded) {
    return (
      <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl p-6 text-center" style={{ background:PANEL,border:"1px solid rgba(16,24,40,.09)",boxShadow:"0 16px 38px rgba(16,24,40,.10)" }}>
          <span className="grid place-items-center rounded-2xl mx-auto mb-3" style={{ width:54,height:54,background:"rgba(47,111,237,.09)",color:GOLD }}><Lock size={23}/></span>
          <h1 className="text-xl font-bold" style={{ fontFamily:"'Fredoka',sans-serif",color:INK }}>{t("challenge.notIncluded", { game:HIVE_BRAND.name })}</h1>
          <p className="text-xs mt-2" style={{ color:"rgba(27,33,41,.50)" }}>{t("challenge.notIncludedBody", { circle:challengeName || "This circle" })}</p>
          <div className="flex flex-col gap-2 mt-5">
            <Button type="button" onClick={onPlayPersonalChallenge} fullWidth>{t("challenge.playMine")}</Button>
            <Button type="button" onClick={onChooseAnotherChallenge} variant="secondary" fullWidth>{t("challenge.chooseAnother")}</Button>
            {onBack && <Button type="button" onClick={onBack} variant="ghost" fullWidth>{t("common.backHome")}</Button>}
          </div>
        </div>
      </div>
    );
  }

  const boardGrid = (
    <div
      ref={boardRef}
      onMouseDown={handleMouseDown}
      onTouchStart={handleMouseDown}
      className="relative rounded-lg overflow-hidden select-none -mx-5 lg:-mx-6"
      style={{
        aspectRatio: "1 / 1",
        display: "grid",
        gridTemplateColumns: `repeat(${boardSize}, 1fr)`,
        gridTemplateRows: `repeat(${boardSize}, 1fr)`,
        touchAction: "none",
        border: `2.5px solid ${BOARD_LINE}`,
        width: "auto",
      }}
    >
      {board.map((row, r) =>
        row.map((val, c) => {
          const region = puzzle.regionGrid[r][c];
          const isConflict = conflicts.has(`${r}-${c}`);
          const cellHint = hintCells.find((hint) => hint.r === r && hint.c === c);
          const isHint = !!cellHint;
          const hintClass = isHint ? `qp-hint-${cellHint.type}` : "";
          return (
            <button
              key={`${r}-${c}`}
              onClick={(event) => handleCellClick(r, c, event)}
              className={`qp-cell relative flex items-center justify-center transition-colors duration-200 ${hintClass}`}
              style={{
                "--qp-region-color": REGION_COLORS[region % REGION_COLORS.length],
                "--qp-region-dark": DARK_REGION_COLORS[region % DARK_REGION_COLORS.length],
                backgroundColor: "var(--qp-region-color)",
                borderTop: edgeBorder(r, c, -1, 0),
                borderBottom: edgeBorder(r, c, 1, 0),
                borderLeft: edgeBorder(r, c, 0, -1),
                borderRight: edgeBorder(r, c, 0, 1),
                boxShadow: isConflict ? `inset 0 0 0 3px ${RED}` : "none",
              }}
            >
              {val === 2 && (
                <HIVE_BRAND.PieceIcon
                  key={`bee-${r}-${c}`}
                  className="qp-bee"
                  size={Math.max(26, 35 - boardSize)}
                  style={{
                    color: isConflict ? RED : BEE_INK,
                  }}
                />
              )}
              {val === 1 && (
                <X
                  className="qp-cross"
                  size={Math.max(15, 23 - boardSize)}
                  strokeWidth={2.6}
                  style={{ color: "rgba(17,24,39,0.60)" }}
                />
              )}
              {isHint && cellHint.type === "bee" && val === 0 && (
                <HIVE_BRAND.PieceIcon
                  className="qp-bee"
                  size={Math.max(26, 35 - boardSize)}
                  style={{ color: "#047857", opacity: 0.82, pointerEvents: "none" }}
                />
              )}
              {isHint && cellHint.type === "bee" && val === 1 && (
                <span
                  aria-label={`This cell should contain a ${HIVE_BRAND.piece}`}
                  style={{
                    position: "absolute", top: 3, right: 3, width: 16, height: 16,
                    borderRadius: "50%", display: "grid", placeItems: "center",
                    background: "var(--color-surface-raised)", border: "1px solid var(--color-border-strong)",
                    boxShadow: "var(--shadow-control)", pointerEvents: "none", zIndex: 3,
                  }}
                >
                  <HIVE_BRAND.PieceIcon size={14} style={{ color: "#047857" }} />
                </span>
              )}
              {isHint && cellHint.type === "cross" && val === 0 && (
                <X
                  className="qp-cross"
                  aria-label="Place an X in this cell"
                  size={Math.max(18, 27 - boardSize)}
                  strokeWidth={2.8}
                  style={{ color: "#1D4ED8", opacity: 0.82, pointerEvents: "none" }}
                />
              )}
              {isHint && cellHint.type === "cross" && val === 2 && (
                <span
                  aria-label={`Replace this ${HIVE_BRAND.piece} with an X`}
                  style={{
                    position: "absolute", top: 3, right: 3, width: 18, height: 18,
                    borderRadius: "50%", display: "grid", placeItems: "center",
                    background: "#fff", color: "#1D4ED8", boxShadow: "0 1px 4px rgba(0,0,0,.24)",
                    pointerEvents: "none",
                  }}
                >
                  <X size={13} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })
      )}
    </div>
  );

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif", paddingTop: "var(--game-content-top)" }} className="flex items-start justify-center p-4">
      <style>{`
        .game-toolbar > * { width: 100%; min-width: 0; }
        @keyframes qp-pop {
          0% { transform: scale(0.6); opacity: 0; }
          70% { transform: scale(1.12); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes qp-hint-pulse {
          0%,100% { box-shadow: inset 0 0 0 3px rgba(47,111,237,0.5), 0 0 0 0 rgba(47,111,237,0.3); }
          50% { box-shadow: inset 0 0 0 3px rgba(47,111,237,0.9), 0 0 0 8px rgba(47,111,237,0); }
        }
        @keyframes qp-hint-bee {
          0%,100% { box-shadow: inset 0 0 0 3px rgba(18,148,106,0.45), 0 0 0 0 rgba(18,148,106,0.28); }
          50% { box-shadow: inset 0 0 0 3px rgba(18,148,106,0.9), 0 0 0 8px rgba(18,148,106,0); }
        }
        .qp-bee { animation: qp-pop 0.22s ease-out; }
        .qp-hint-cross { animation: qp-hint-pulse 0.7s ease-in-out infinite; z-index: 2; }
        .qp-hint-bee { animation: qp-hint-bee 0.7s ease-in-out infinite; z-index: 2; }
        .qp-hint-cross::after, .qp-hint-bee::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          background: repeating-linear-gradient(135deg, rgba(255,255,255,.58) 0 3px, rgba(47,111,237,.24) 3px 5px);
        }
        .qp-hint-bee::after {
          background: repeating-linear-gradient(135deg, rgba(255,255,255,.58) 0 3px, rgba(18,148,106,.28) 3px 5px);
        }
        .qp-cell > svg { position: relative; z-index: 2; }
        .qp-card { container-type: inline-size; }
        @container (min-width: 430px) {
          .qp-cell .qp-bee { width: 32px; height: 32px; }
          .qp-cell .qp-cross { width: 16px; height: 16px; }
        }
        @media (hover: hover) and (pointer: fine) {
          .qp-cell:hover { filter: brightness(1.15); }
          .qp-icon-btn:hover { opacity: 0.85; }
          .qp-play-again:hover { filter: brightness(1.08); }
          .qp-toolbar-btn:not(:disabled):hover {
            transform: translateY(-1px);
            filter: brightness(1.03);
          }
        }
      `}</style>

      <div
        className="qp-card w-full max-w-md sm:max-w-lg lg:max-w-xl rounded-2xl p-5 lg:p-6 relative"
        style={{ maxWidth: "var(--game-page-max-width)", background: PANEL, boxShadow: "0 10px 30px rgba(16,24,40,0.10)", border: "1px solid rgba(16,24,40,0.09)" }}
      >
        <button
          onClick={() => setShowHelp((h) => !h)}
          className="qp-icon-btn absolute top-4 right-4 transition-opacity"
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
            {HIVE_BRAND.name}
          </h1>
          <p style={{ color: CREAM, opacity: 0.45 }} className="text-xs mt-1">
            {HIVE_BRAND.tagline.toLowerCase()}
          </p>
        </div>

        {/* day selector — you already picked the day you just played; it
            belongs on the next puzzle, not this result. */}
        {!solved && (isChallenge ? (
          <div className="flex justify-center mb-4">
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-1.5"
              style={{ background: `${GOLD}18`, color: GOLD }}
            >
              <span className="text-xs font-semibold">{t("common.todaysChallenge")}</span>
              <span className="text-[10px] opacity-80">{n}×{n}</span>
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
              { label: "New", onClick: () => newPuzzle(n), disabled: isChallenge },
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
            Tap a cell once to mark it with ×, tap again to place a bee — or press and drag
            across cells to paint or clear × marks in one stroke. Every row, column, and colored
            region needs exactly one bee, and bees can't touch — not even diagonally. Hint
            first stripes any cell that's wrong (a bee where none belongs, or an × on a cell that
            must hold a bee). Otherwise it stripes the next move you can deduce — blue marks
            cells to eliminate and green previews a bee.
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
          completionFinished={completionFinished}
          completionSeconds={seconds}
          allowScoreChallenge
          scoreToBeatSeconds={scoreToBeatSeconds}
          scoreChallengerName={scoreChallengerName}
          showPlayAgain={!isChallenge}
          onPlayAgain={() => newPuzzle(n)}
        />

        {solved && <BoardReviewToggle reviewing={reviewing} onToggle={() => setReviewing((value) => !value)} />}
        {(!solved || reviewing) && boardGrid}

        {!solved && (
          <p style={{ color: CREAM, opacity: 0.35 }} className="text-center text-[11px] mt-3">
            {beesCount}/{boardSize} {HIVE_BRAND.pieces} placed
          </p>
        )}
      </div>
    </div>
  );
}
