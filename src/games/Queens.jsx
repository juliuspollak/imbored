import React, { useState, useEffect, useRef, useCallback } from "react";
import { withSeededRandom } from "../lib/seededRandom.js";
import { useHintCooldown } from "../lib/useHintCooldown.js";
import { rateDifficulty } from "../lib/saveStats.js";
import DifficultyRating, { DifficultyRatingBadge } from "../DifficultyRating.jsx";
import { Crown, Eraser, CornerUpLeft, Sparkles, WandSparkles, Timer as TimerIcon, HelpCircle, Lock } from "lucide-react";
import { useI18n } from "../lib/i18n.jsx";
import DaySelector from "../DaySelector.jsx";

/* ---------------- puzzle generation ---------------- */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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
  const queenCell = new Set(solution.map((c, r) => `${r},${c}`));
  for (let iter = 0; iter < budget && bestCount > 1; iter++) {
    const r = Math.floor(Math.random() * n), c = Math.floor(Math.random() * n);
    if (queenCell.has(`${r},${c}`)) continue; // never move a cell holding a queen
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
  const rowHasQueen = new Array(n).fill(false);
  const colHasQueen = new Array(n).fill(false);
  const regionHasQueen = {};
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] === 2) {
        rowHasQueen[r] = true;
        colHasQueen[c] = true;
        regionHasQueen[regionGrid[r][c]] = true;
      }
    }
  }
  function isCandidate(r, c) {
    if (board[r][c] !== 0) return false;
    if (rowHasQueen[r] || colHasQueen[c] || regionHasQueen[regionGrid[r][c]]) return false;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr][cc] === 2) return false;
      }
    }
    return true;
  }

  // Checked first: any cell directly ruled out by a crown already on the
  // board. These are the most obvious follow-up moves ("you placed a
  // crown, now mark what it eliminates"), so they should be offered
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
          if (sameRow || sameCol || sameRegion || adjacent) return { r: rr, c: cc, type: "cross", src: "crown-elim" };
        }
      }
    }
  }

  // naked singles: a row, column, or region with exactly one candidate left
  for (let r = 0; r < n; r++) {
    if (rowHasQueen[r]) continue;
    const cands = [];
    for (let c = 0; c < n; c++) if (isCandidate(r, c)) cands.push(c);
    if (cands.length === 1) return { r, c: cands[0], type: "queen", src: "naked" };
  }
  for (let c = 0; c < n; c++) {
    if (colHasQueen[c]) continue;
    const cands = [];
    for (let r = 0; r < n; r++) if (isCandidate(r, c)) cands.push(r);
    if (cands.length === 1) return { r: cands[0], c, type: "queen", src: "naked" };
  }
  const regionCells = {};
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) (regionCells[regionGrid[r][c]] ||= []).push([r, c]);
  }
  for (const reg in regionCells) {
    if (regionHasQueen[reg]) continue;
    const cands = regionCells[reg].filter(([r, c]) => isCandidate(r, c));
    if (cands.length === 1) return { r: cands[0][0], c: cands[0][1], type: "queen", src: "naked" };
  }

  function subsetsOfSize(arr, k) {
    const results = [];
    (function combo(start, chosen) {
      if (chosen.length === k) {
        results.push(chosen.slice());
        return;
      }
      for (let i = start; i < arr.length; i++) {
        chosen.push(arr[i]);
        combo(i + 1, chosen);
        chosen.pop();
      }
    })(0, []);
    return results;
  }

  const openRows = [];
  for (let r = 0; r < n; r++) if (!rowHasQueen[r]) openRows.push(r);
  const openCols = [];
  for (let c = 0; c < n; c++) if (!colHasQueen[c]) openCols.push(c);
  // built from actual regionGrid values (not Object.keys, which returns
  // strings — comparing those against regionGrid's numeric IDs via
  // Set.has() would silently fail every check, since unlike plain object
  // property access, Set/Map lookups require an exact type match)
  const regionIdSet = new Set();
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) regionIdSet.add(regionGrid[r][c]);

  const openRegions = [...regionIdSet].filter((reg) => !regionHasQueen[reg]);
  const unitDefs = [
    ...openRows.map((r) => ({ type: "row", id: r, cells: Array.from({ length: n }, (_, c) => [r, c]) })),
    ...openCols.map((c) => ({ type: "col", id: c, cells: Array.from({ length: n }, (_, r) => [r, c]) })),
    ...openRegions.map((reg) => ({ type: "reg", id: reg, cells: regionCells[reg] || [] })),
  ];

  // hidden/naked subsets up to size 3: if k open units collectively have
  // candidates in exactly k cells, the other candidates in those cells can
  // be eliminated. This gives harder generated boards a proper chain.
  for (let k = 2; k <= 3; k++) {
    for (const units of subsetsOfSize(unitDefs, k)) {
      const cells = new Map();
      for (const unit of units) {
        for (const [r, c] of unit.cells) {
          if (isCandidate(r, c)) cells.set(`${r},${c}`, [r, c]);
        }
      }
      if (cells.size !== k) continue;
      const unitKeys = new Set(units.map((u) => `${u.type}:${u.id}`));
      for (const [r, c] of cells.values()) {
        // find any candidate unit membership not part of the locked subset
        const memberships = [`row:${r}`, `col:${c}`, `reg:${regionGrid[r][c]}`];
        if (memberships.some((key) => !unitKeys.has(key))) {
          return { r, c, type: "cross", src: "subset" };
        }
      }
    }
  }

  return null;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SIZES = [4, 5, 6, 6, 7, 7, 8];
const REGION_COLORS = ["#E4EEFF", "#FCECCF", "#E2F4E9", "#F5E3F1", "#E9E2F7", "#FCE1DC", "#E3F2F8", "#F2EBD9"];
const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const INK = "#1B2129";
const CREAM = "#1B2129";
const GOLD = "#2F6FED";
const RED = "#D9695C";

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
  return withSeededRandom(seedKey, () => makePuzzle(n));
}

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function initialBoard(n) {
  return Array.from({ length: n }, () => Array(n).fill(0));
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

export default function Queens({ mode = "practice", seed = null, onChallengeComplete, onBack, isIncluded = true, challengeName = null, onPlayPersonalChallenge, onChooseAnotherChallenge }) {
  const { t } = useI18n();
  const isChallenge = mode === "challenge";
  const requestedDayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  const [dayIdx, setDayIdx] = useState(requestedDayIdx);
  const n = SIZES[dayIdx];
  const [puzzle, setPuzzle] = useState(() => createPuzzleForSeed(n, seed || `queens:${todayKey()}:${n}`));
  const [board, setBoard] = useState(() => initialBoard(n));
  const [history, setHistory] = useState([]);
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(true);
  const [mistakes, setMistakes] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [solved, setSolved] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [hintCell, setHintCell] = useState(null);
  const [difficultyRating, setDifficultyRating] = useState(null);
  const [savedStatId, setSavedStatId] = useState(null);
  const [rewardResult, setRewardResult] = useState(null);
  const [syncRetryTick, setSyncRetryTick] = useState(0);
  const [solvedAtMs, setSolvedAtMs] = useState(null);
  const dragRef = useRef({ active: false, mode: null, visited: new Set(), lastCell: null });
  const boardRef = useRef(null);
  const pointerActiveRef = useRef(false);
  const lastHandledPointerRef = useRef(null);
  const handleCellClickRef = useRef(null);
  const puzzleKeyRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const savedOnceRef = useRef(false);
  const statsRef = useRef({ seconds: 0, mistakes: 0, hintsUsed: 0 });
  const hintCooldown = useHintCooldown(4500);

  const boardSize = board.length;
  const queensCount = board.flat().filter((v) => v === 2).length;

  useEffect(() => {
    if (!isChallenge || isIncluded || !challengeName) return;
    setRunning(false);
  }, [challengeName, isChallenge, isIncluded]);

  useEffect(() => {
    if (!running || solved) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running, solved]);

  useEffect(() => {
    statsRef.current = { seconds, mistakes, hintsUsed };
  }, [hintsUsed, mistakes, seconds]);

  useEffect(() => {
    if (!solved || savedOnceRef.current || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    let cancelled = false;
    (async () => {
      const solvedStats = statsRef.current;
      const result = await onChallengeComplete?.({
        game: "queens",
        seconds: solvedStats.seconds,
        mistakes: solvedStats.mistakes,
        hints: solvedStats.hintsUsed,
        difficulty: dayIdx,
        seed: seed || null,
      });
      if (cancelled) return;
      if (result?.error) {
        console.error("Unable to save Queens result", result.error);
        saveInFlightRef.current = false;
        window.setTimeout(() => setSyncRetryTick((tick) => tick + 1), 1500);
        return;
      }
      savedOnceRef.current = true;
      saveInFlightRef.current = false;
      setSavedStatId(result?.stat_id ?? null);
      setRewardResult(result?.reward ?? null);
    })();
    return () => { cancelled = true; };
  }, [dayIdx, onChallengeComplete, seed, solved, syncRetryTick]);

  const newPuzzle = useCallback((size = n) => {
    puzzleKeyRef.current += 1;
    const key = seed ? `${seed}:retry:${puzzleKeyRef.current}` : `queens:${Date.now()}:${Math.random()}:${size}`;
    setPuzzle(createPuzzleForSeed(size, key));
    setBoard(initialBoard(size));
    setHistory([]);
    setSeconds(0);
    setRunning(true);
    setMistakes(0);
    setHintsUsed(0);
    setSolved(false);
    setHintCell(null);
    setDifficultyRating(null);
    setSavedStatId(null);
    setRewardResult(null);
    setSolvedAtMs(null);
    savedOnceRef.current = false;
    saveInFlightRef.current = false;
  }, [n, seed]);

  useEffect(() => {
    if (isChallenge) return;
    newPuzzle(SIZES[dayIdx]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayIdx]);

  function pushHistory(snapshot = board) {
    setHistory((h) => [...h, snapshot.map((row) => row.slice())]);
  }

  function validate(next) {
    const conflicts = new Set();
    const queenPositions = [];
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        if (next[r][c] === 2) queenPositions.push([r, c]);
      }
    }
    for (let i = 0; i < queenPositions.length; i++) {
      const [r1, c1] = queenPositions[i];
      for (let j = i + 1; j < queenPositions.length; j++) {
        const [r2, c2] = queenPositions[j];
        if (r1 === r2 || c1 === c2 || Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1 || puzzle.regionGrid[r1][c1] === puzzle.regionGrid[r2][c2]) {
          conflicts.add(`${r1}-${c1}`);
          conflicts.add(`${r2}-${c2}`);
        }
      }
    }
    return conflicts;
  }

  const conflicts = validate(board);

  function handleCellClick(r, c) {
    if (solved || pointerActiveRef.current) return;
    setRunning(true);
    pushHistory();
    setBoard((prev) => {
      const next = prev.map((row) => row.slice());
      next[r][c] = (next[r][c] + 1) % 3;
      if (next[r][c] === 2 && puzzle.solution[r] !== c) setMistakes((m) => m + 1);
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
    e.preventDefault();
    const target = e.target.closest(".qp-cell");
    if (!target) return;
    const cells = Array.from(boardRef.current.querySelectorAll(".qp-cell"));
    const idx = cells.indexOf(target);
    const r = Math.floor(idx / boardSize), c = idx % boardSize;
    pointerActiveRef.current = true;
    const initial = board[r][c];
    const mode = initial === 1 ? 0 : 1;
    dragRef.current = { active: true, mode, visited: new Set([`${r},${c}`]), lastCell: `${r},${c}` };
    pushHistory();
    setBoard((prev) => {
      const next = prev.map((row) => row.slice());
      next[r][c] = mode;
      return next;
    });
  }

  useEffect(() => {
    function onMove(e) {
      if (!dragRef.current.active || !boardRef.current) return;
      const point = e.touches ? e.touches[0] : e;
      const el = document.elementFromPoint(point.clientX, point.clientY);
      const cell = el?.closest?.(".qp-cell");
      if (!cell || !boardRef.current.contains(cell)) return;
      const cells = Array.from(boardRef.current.querySelectorAll(".qp-cell"));
      const idx = cells.indexOf(cell);
      const r = Math.floor(idx / boardSize), c = idx % boardSize;
      const key = `${r},${c}`;
      if (dragRef.current.visited.has(key)) return;
      dragRef.current.visited.add(key);
      dragRef.current.lastCell = key;
      setBoard((prev) => {
        const next = prev.map((row) => row.slice());
        next[r][c] = dragRef.current.mode;
        return next;
      });
    }
    function onUp() {
      if (dragRef.current.active) {
        dragRef.current.active = false;
        window.setTimeout(() => { pointerActiveRef.current = false; }, 0);
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
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
    setMistakes(0);
    setHintsUsed(0);
    setSeconds(0);
    setRunning(true);
    setHintCell(null);
  }

  function handleHint() {
    if (solved || hintCooldown.locked) return;
    hintCooldown.trigger();
    const wrong = [];
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        if (board[r][c] === 2 && puzzle.solution[r] !== c) wrong.push({ r, c, type: "wrong" });
        if (board[r][c] === 1 && puzzle.solution[r] === c) wrong.push({ r, c, type: "wrong" });
      }
    }
    if (wrong.length) {
      setHintCell(wrong[0]);
      setHintsUsed((h) => h + 1);
      window.setTimeout(() => setHintCell(null), 1200);
      return;
    }
    const step = findNextLogicalStepPure(board, puzzle.regionGrid, boardSize);
    if (step) {
      setHintCell(step);
      setHintsUsed((h) => h + 1);
      window.setTimeout(() => setHintCell(null), 1200);
      return;
    }
    // Safety fallback for any generated board that still defeats the logical
    // solver: reveal the next required crown rather than doing nothing.
    for (let r = 0; r < boardSize; r++) {
      const c = puzzle.solution[r];
      if (board[r][c] !== 2) {
        setHintCell({ r, c, type: "queen", src: "fallback" });
        setHintsUsed((h) => h + 1);
        window.setTimeout(() => setHintCell(null), 1200);
        return;
      }
    }
  }

  function edgeBorder(r, c, dr, dc) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) return `2px solid ${INK}`;
    return puzzle.regionGrid[r][c] !== puzzle.regionGrid[nr][nc]
      ? `2px solid ${INK}`
      : `1px solid rgba(16,24,40,0.08)`;
  }

  if (isChallenge && !isIncluded) {
    return (
      <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl p-6 text-center" style={{ background:PANEL,border:"1px solid rgba(16,24,40,.09)",boxShadow:"0 16px 38px rgba(16,24,40,.10)" }}>
          <span className="grid place-items-center rounded-2xl mx-auto mb-3" style={{ width:54,height:54,background:"rgba(47,111,237,.09)",color:GOLD }}><Lock size={23}/></span>
          <h1 className="text-xl font-bold" style={{ fontFamily:"'Fredoka',sans-serif",color:INK }}>{t("challenge.notIncluded", { game:"Queens" })}</h1>
          <p className="text-xs mt-2" style={{ color:"rgba(27,33,41,.50)" }}>{t("challenge.notIncludedBody", { team:challengeName || "This team" })}</p>
          <div className="flex flex-col gap-2 mt-5">
            <button type="button" onClick={onPlayPersonalChallenge} className="gloss-button rounded-full py-2.5 text-xs font-semibold" style={{ background:GOLD,color:"#fff" }}>{t("challenge.playMine")}</button>
            <button type="button" onClick={onChooseAnotherChallenge} className="gloss-button rounded-full py-2.5 text-xs font-semibold" style={{ background:"rgba(16,24,40,.05)",color:INK }}>{t("challenge.chooseAnother")}</button>
            {onBack && <button type="button" onClick={onBack} className="text-xs font-semibold py-2" style={{ color:"rgba(27,33,41,.55)" }}>{t("common.backHome")}</button>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="flex items-center justify-center p-4">
      <style>{`
        @keyframes qp-pop {
          0% { transform: scale(0.6); opacity: 0; }
          70% { transform: scale(1.12); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes qp-wrong {
          0%,100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        @keyframes qp-hint-pulse {
          0%,100% { box-shadow: inset 0 0 0 3px rgba(47,111,237,0.5), 0 0 0 0 rgba(47,111,237,0.3); }
          50% { box-shadow: inset 0 0 0 3px rgba(47,111,237,0.9), 0 0 0 8px rgba(47,111,237,0); }
        }
        @keyframes qp-hint-queen {
          0%,100% { box-shadow: inset 0 0 0 3px rgba(18,148,106,0.45), 0 0 0 0 rgba(18,148,106,0.28); }
          50% { box-shadow: inset 0 0 0 3px rgba(18,148,106,0.9), 0 0 0 8px rgba(18,148,106,0); }
        }
        .qp-crown { animation: qp-pop 0.22s ease-out; }
        .qp-hint-wrong { animation: qp-wrong 0.35s ease-in-out 2; }
        .qp-hint-cross { animation: qp-hint-pulse 0.7s ease-in-out infinite; z-index: 2; }
        .qp-hint-queen { animation: qp-hint-queen 0.7s ease-in-out infinite; z-index: 2; }
        .qp-card { container-type: inline-size; }
        @container (min-width: 430px) {
          .qp-cell svg { width: 30px; height: 30px; }
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
        className="qp-card w-full max-w-sm sm:max-w-md lg:max-w-lg rounded-2xl p-5 lg:p-6 relative"
        style={{ background: PANEL, boxShadow: "0 10px 30px rgba(16,24,40,0.10)", border: "1px solid rgba(16,24,40,0.09)" }}
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
            Queens
          </h1>
          <p style={{ color: CREAM, opacity: 0.45 }} className="text-xs mt-1">
            one crown per row, column &amp; region
          </p>
        </div>

        {/* day selector — locked to today's date in challenge mode */}
        {isChallenge ? (
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
            { label: "New", onClick: () => newPuzzle(n), disabled: isChallenge },
            {
              label: hintCooldown.locked ? `${hintCooldown.remaining}s` : t("common.hint"),
              onClick: handleHint,
              disabled: solved || hintCooldown.locked,
            },
          ].map(({ label, onClick, disabled }) => (
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
            Tap a cell once to mark it with ×, tap again to place a crown — or press and drag
            across cells to paint or clear × marks in one stroke. Every row, column, and colored
            region needs exactly one crown, and crowns can't touch — not even diagonally. Hint
            first shakes any cell that's wrong (a crown where none belongs, or an × on a cell that
            must hold a crown); if nothing is wrong it rings the next cell you can deduce — blue
            for an ×, green for a crown.
          </div>
        )}

        {/* board */}
        <div
          ref={boardRef}
          onMouseDown={handleMouseDown}
          className="relative w-full rounded-lg overflow-hidden select-none"
          style={{
            aspectRatio: "1 / 1",
            display: "grid",
            gridTemplateColumns: `repeat(${boardSize}, 1fr)`,
            gridTemplateRows: `repeat(${boardSize}, 1fr)`,
            touchAction: "none",
          }}
        >
          {board.map((row, r) =>
            row.map((val, c) => {
              const region = puzzle.regionGrid[r][c];
              const isConflict = conflicts.has(`${r}-${c}`);
              const isHint = hintCell && hintCell.r === r && hintCell.c === c;
              const hintClass = isHint ? `qp-hint-${hintCell.type}` : "";
              return (
                <button
                  key={`${r}-${c}`}
                  onClick={() => handleCellClick(r, c)}
                  className={`qp-cell relative flex items-center justify-center transition-colors duration-200 ${hintClass}`}
                  style={{
                    backgroundColor: REGION_COLORS[region % REGION_COLORS.length],
                    borderTop: edgeBorder(r, c, -1, 0),
                    borderBottom: edgeBorder(r, c, 1, 0),
                    borderLeft: edgeBorder(r, c, 0, -1),
                    borderRight: edgeBorder(r, c, 0, 1),
                    boxShadow: isConflict ? `inset 0 0 0 3px ${RED}` : "none",
                  }}
                >
                  {val === 2 && (
                    <Crown
                      key={`crown-${r}-${c}`}
                      className="qp-crown"
                      size={Math.max(14, 26 - boardSize)}
                      style={{ color: isConflict ? RED : INK }}
                      strokeWidth={2.25}
                    />
                  )}
                  {val === 1 && (
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "rgba(18,24,31,0.42)",
                        display: "block",
                      }}
                    />
                  )}
                </button>
              );
            })
          )}

          {solved && difficultyRating === null && (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 p-4"
              style={{
                background: "rgba(255,255,255,0.95)",
                WebkitBackdropFilter: "blur(3px)",
                backdropFilter: "blur(3px)",
                isolation: "isolate",
              }}
            >
              <Crown size={32} style={{ color: GOLD }} />
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
                    : t("common.noPoints")}
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
                  onClick={() => newPuzzle(n)}
                  className="qp-play-again mt-2 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors"
                  style={{ background: GOLD, color: "#FFFFFF" }}
                >
                  Play again
                </button>
              )}
            </div>
          )}
        </div>

        <p style={{ color: CREAM, opacity: 0.35 }} className="text-center text-[11px] mt-3">
          {queensCount}/{boardSize} crowns placed
        </p>
      </div>
    </div>
  );
}
