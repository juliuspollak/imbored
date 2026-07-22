import React, { useState, useEffect, useRef, useCallback } from "react";
import { usePresence } from "../lib/usePresence.js";
import { Crown, RotateCcw, Undo2, Shuffle, Lightbulb, Timer as TimerIcon, HelpCircle } from "lucide-react";

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

function generatePuzzle(n, maxAttempts = 60) {
  let fallback = null;
  for (let i = 0; i < maxAttempts; i++) {
    const solution = generateSolution(n);
    if (!solution) continue;
    const grown = growRegions(n, solution);
    if (countSolutions(n, grown, 2) === 1) return { solution, regionGrid: grown };
    const repaired = repairToUnique(n, solution, grown);
    if (repaired.count === 1) return { solution, regionGrid: repaired.grid };
    if (!fallback) fallback = { solution, regionGrid: repaired.grid };
  }
  return fallback;
}

function getConflicts(board, regionGrid, n) {
  const queens = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (board[r][c] === 2) queens.push([r, c]);
  const conflicts = new Set();
  for (let i = 0; i < queens.length; i++) {
    for (let j = i + 1; j < queens.length; j++) {
      const [r1, c1] = queens[i], [r2, c2] = queens[j];
      const sameRow = r1 === r2, sameCol = c1 === c2;
      const sameRegion = regionGrid[r1][c1] === regionGrid[r2][c2];
      const adjacent = Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1;
      if (sameRow || sameCol || sameRegion || adjacent) {
        conflicts.add(`${r1}-${c1}`);
        conflicts.add(`${r2}-${c2}`);
      }
    }
  }
  return conflicts;
}

/* ---------------- design tokens ---------------- */

// Matches the actual LinkedIn Queens palette: dusty, muted pastels rather
// than saturated candy tones — a soft peachy tan, lavender, periwinkle
// blue, sage green, terracotta, light gray, chartreuse, and taupe.
const REGION_COLORS = [
  "#F0C48A", "#A88FD1", "#7FA8E8", "#93CC8E",
  "#DE7350", "#D2CFC6", "#D6DC5E", "#A39A82", "#C79CA8",
];
const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const CREAM = "#1B2129";   // primary ink (kept name to avoid churn)
const GOLD = "#2F6FED";    // accent
const RED = "#E5484D";
const INK = "#12181F";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SIZES = [5, 5, 6, 6, 7, 7, 8];

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

/* ---------------- component ---------------- */

export default function QueensGame({ userId, onSolved } = {}) {
  const todayIdx = (() => {
    const d = new Date().getDay();
    return d === 0 ? 6 : d - 1;
  })();
  const [dayIdx, setDayIdx] = useState(todayIdx);
  const n = SIZES[dayIdx];
  usePresence("queens");

  const [puzzle, setPuzzle] = useState(null);
  const [board, setBoard] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [solved, setSolved] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintCell, setHintCell] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHelp, setShowHelp] = useState(false);
  const timerRef = useRef(null);
  const boardRef = useRef(null);
  const dragRef = useRef({ active: false, mode: null, startR: 0, startC: 0, lastR: -1, lastC: -1, moved: false });
  const suppressClickRef = useRef(false);
  const latest = useRef({});

  const newPuzzle = useCallback((size) => {
    const p = generatePuzzle(size);
    setPuzzle(p);
    setBoard(Array.from({ length: size }, () => Array(size).fill(0)));
    setSeconds(0);
    setRunning(true);
    setSolved(false);
    setMistakes(0);
    setHintsUsed(0);
    setHintCell(null);
    setHistory([]);
  }, []);

  useEffect(() => {
    newPuzzle(n);
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
    const size = board.length;
    const conflicts = getConflicts(board, puzzle.regionGrid, size);
    const count = board.flat().filter((v) => v === 2).length;
    if (count === size && conflicts.size === 0 && !solved) {
      setSolved(true);
      setRunning(false);
      onSolved && onSolved({ userId, game: "queens", dayIndex: dayIdx, seconds, mistakes, hints: hintsUsed });
    }
  }, [board, puzzle]);

  // native (non-React) touch listeners: touchmove needs { passive: false } to
  // block scrolling during a drag, which React's synthetic touch props can't
  // guarantee, and this sidesteps setPointerCapture, which some mobile
  // WebViews (incl. the one used by the iOS app) don't handle reliably.
  // Declared above the loading-state early return below so it's called on
  // every render, same as any other hook.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    function onTouchStart(e) {
      if (latest.current.solved) return;
      e.preventDefault(); // stop the browser from also firing a compatibility mousedown/click
      const t = e.touches[0];
      if (!t) return;
      const cell = cellFromPoint(t.clientX, t.clientY);
      if (cell) beginDragAt(cell.row, cell.col);
    }
    function onTouchMove(e) {
      if (!dragRef.current.active) return;
      e.preventDefault();
      const t = e.touches[0];
      if (!t) return;
      const cell = cellFromPoint(t.clientX, t.clientY);
      if (cell) continueDragAt(cell.row, cell.col);
    }
    function onTouchEnd(e) {
      if (!dragRef.current.active) return; // this gesture wasn't ours — let the click through
      e.preventDefault();
      endDrag();
    }
    function onTouchCancel() {
      cancelDrag();
    }

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [board]);

  if (!board || !puzzle) {
    return (
      <div style={{ background: BG, minHeight: "100vh" }} className="flex items-center justify-center">
        <span style={{ color: CREAM, opacity: 0.6 }} className="text-sm">Building today's puzzle…</span>
      </div>
    );
  }

  const boardSize = board.length;
  const conflicts = getConflicts(board, puzzle.regionGrid, boardSize);
  const queensCount = board.flat().filter((v) => v === 2).length;

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
    // fallback path for keyboard activation; pointer/touch taps are handled
    // in endDrag() and suppress this via suppressClickRef
    if (solved) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setHintCell(null);
    performTapCycle(r, c);
  }

  function cellFromPoint(clientX, clientY) {
    const el = boardRef.current;
    if (!el) return null;
    const size = boardSize;
    const rect = el.getBoundingClientRect();
    let col = Math.floor(((clientX - rect.left) / rect.width) * size);
    let row = Math.floor(((clientY - rect.top) / rect.height) * size);
    col = Math.min(size - 1, Math.max(0, col));
    row = Math.min(size - 1, Math.max(0, row));
    return { row, col };
  }

  function paintCell(next, r, c, mode) {
    if (next[r][c] === 2) return;
    if (mode === "add" && next[r][c] === 0) next[r][c] = 1;
    else if (mode === "remove" && next[r][c] === 1) next[r][c] = 0;
  }

  function beginDragAt(row, col) {
    if (latest.current.solved) return;
    const val = latest.current.board[row][col];
    dragRef.current = {
      active: true,
      mode: val === 0 ? "add" : val === 1 ? "remove" : "none",
      startR: row,
      startC: col,
      lastR: row,
      lastC: col,
      moved: false,
    };
    setHintCell(null);
  }

  function continueDragAt(row, col) {
    const drag = dragRef.current;
    if (!drag.active || drag.mode === "none") return;
    if (row === drag.lastR && col === drag.lastC) return;
    const firstMove = !drag.moved;
    if (firstMove) {
      latest.current.pushHistory();
      drag.moved = true;
    }
    drag.lastR = row;
    drag.lastC = col;
    setBoard((prev) => {
      const next = prev.map((r) => r.slice());
      if (firstMove) paintCell(next, drag.startR, drag.startC, drag.mode);
      paintCell(next, row, col, drag.mode);
      return next;
    });
  }

  function endDrag() {
    const drag = dragRef.current;
    if (!drag.active) return;
    drag.active = false;
    if (!drag.moved) {
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 400);
      setHintCell(null);
      latest.current.performTapCycle(drag.startR, drag.startC);
    }
  }

  function cancelDrag() {
    dragRef.current.active = false;
  }

  function handleMouseDown(e) {
    if (latest.current.solved) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (!cell) return;
    beginDragAt(cell.row, cell.col);
    function onMove(ev) {
      const c = cellFromPoint(ev.clientX, ev.clientY);
      if (c) continueDragAt(c.row, c.col);
    }
    function onUp() {
      endDrag();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleUndo() {
    if (history.length === 0) return;
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
    setBoard(Array.from({ length: boardSize }, () => Array(boardSize).fill(0)));
    setMistakes(0);
    setHintsUsed(0);
    setHintCell(null);
    setHistory([]);
    setSeconds(0);
    setSolved(false);
    setRunning(true);
  }

  // Finds the next step that's actually forced by logic. Beyond the simple
  // cases (a crown eliminates its row/col/region/neighbors; a row/col/region
  // narrowed to one open cell), this also catches a genuinely common
  // intermediate deduction: if some set of k rows can only be reached by
  // exactly k regions (no other region has a candidate cell in those rows),
  // then those regions' queens must be within those rows — eliminating
  // their candidates elsewhere, and eliminating any other region's
  // candidates inside those rows. Same logic applies to columns. Without
  // this, the hint can jump straight to revealing a queen even when there
  // was a legitimate elimination step available first.
  function findNextLogicalStep() {
    const n = boardSize;
    const regionGrid = puzzle.regionGrid;
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
            if (sameRow || sameCol || sameRegion || adjacent) return { r: rr, c: cc, type: "cross" };
          }
        }
      }
    }

    // naked singles: a row, column, or region with exactly one candidate left
    for (let r = 0; r < n; r++) {
      if (rowHasQueen[r]) continue;
      const cands = [];
      for (let c = 0; c < n; c++) if (isCandidate(r, c)) cands.push(c);
      if (cands.length === 1) return { r, c: cands[0], type: "queen" };
    }
    for (let c = 0; c < n; c++) {
      if (colHasQueen[c]) continue;
      const cands = [];
      for (let r = 0; r < n; r++) if (isCandidate(r, c)) cands.push(r);
      if (cands.length === 1) return { r: cands[0], c, type: "queen" };
    }
    const regionCells = {};
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) (regionCells[regionGrid[r][c]] ||= []).push([r, c]);
    }
    for (const reg in regionCells) {
      if (regionHasQueen[reg]) continue;
      const cands = regionCells[reg].filter(([r, c]) => isCandidate(r, c));
      if (cands.length === 1) return { r: cands[0][0], c: cands[0][1], type: "queen" };
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

    // the dual direction of the row/column check below: instead of asking
    // "do these k rows only have candidates from k regions", ask "do these
    // k regions only have candidates within k rows (or columns)". These
    // aren't equivalent — a single 2-cell region sitting entirely in one
    // column is caught here (k=1) but not by scanning column subsets, since
    // that column might still be touched by other regions elsewhere.
    for (let k = 1; k < openRegions.length; k++) {
      for (const regSet of subsetsOfSize(openRegions, k)) {
        const regSetSet = new Set(regSet);
        const rowsSpanned = new Set();
        let any = false;
        for (const reg of regSet) for (const [r, c] of regionCells[reg]) if (isCandidate(r, c)) { rowsSpanned.add(r); any = true; }
        if (any && rowsSpanned.size === k) {
          for (const r of rowsSpanned) {
            for (let c = 0; c < n; c++) {
              if (!isCandidate(r, c)) continue;
              if (!regSetSet.has(regionGrid[r][c])) return { r, c, type: "cross" };
            }
          }
        }
        const colsSpanned = new Set();
        any = false;
        for (const reg of regSet) for (const [r, c] of regionCells[reg]) if (isCandidate(r, c)) { colsSpanned.add(c); any = true; }
        if (any && colsSpanned.size === k) {
          for (const c of colsSpanned) {
            for (let r = 0; r < n; r++) {
              if (!isCandidate(r, c)) continue;
              if (!regSetSet.has(regionGrid[r][c])) return { r, c, type: "cross" };
            }
          }
        }
      }
    }

    for (let k = 2; k < openRows.length; k++) {
      for (const rowSet of subsetsOfSize(openRows, k)) {
        const rowSetSet = new Set(rowSet);
        const regionsInSet = new Set();
        for (const r of rowSet) for (let c = 0; c < n; c++) if (isCandidate(r, c)) regionsInSet.add(regionGrid[r][c]);
        if (regionsInSet.size !== k) continue;
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            if (!isCandidate(r, c)) continue;
            const regionInSet = regionsInSet.has(regionGrid[r][c]);
            const inSet = rowSetSet.has(r);
            if (regionInSet !== inSet) return { r, c, type: "cross" };
          }
        }
      }
    }
    for (let k = 2; k < openCols.length; k++) {
      for (const colSet of subsetsOfSize(openCols, k)) {
        const colSetSet = new Set(colSet);
        const regionsInSet = new Set();
        for (const c of colSet) for (let r = 0; r < n; r++) if (isCandidate(r, c)) regionsInSet.add(regionGrid[r][c]);
        if (regionsInSet.size !== k) continue;
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            if (!isCandidate(r, c)) continue;
            const regionInSet = regionsInSet.has(regionGrid[r][c]);
            const inSet = colSetSet.has(c);
            if (regionInSet !== inSet) return { r, c, type: "cross" };
          }
        }
      }
    }

    // Final tier, and the reason no guessing fallback is needed: try each
    // remaining candidate in turn and check whether the puzzle is still
    // solvable with a queen forced there. If it isn't, that cell is
    // provably an X — a real deduction the player could have reached
    // themselves ("if I put one here, everything breaks"), not a reveal.
    // Because the puzzle has exactly one solution, any candidate that
    // isn't part of it must fail this test, so a step is always available
    // until the board is finished.
    function solvableWith(testBoard) {
      const cols = new Array(n).fill(-1);
      const usedCols = new Set();
      const usedRegions = new Set();
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (testBoard[r][c] === 2) {
            cols[r] = c;
            usedCols.add(c);
            usedRegions.add(regionGrid[r][c]);
          }
        }
      }
      function place(r) {
        if (r === n) return true;
        if (cols[r] !== -1) {
          if (r > 0 && cols[r - 1] !== -1 && Math.abs(cols[r] - cols[r - 1]) <= 1) return false;
          return place(r + 1);
        }
        for (let c = 0; c < n; c++) {
          if (testBoard[r][c] === 1) continue;
          if (usedCols.has(c)) continue;
          if (usedRegions.has(regionGrid[r][c])) continue;
          if (r > 0 && cols[r - 1] !== -1 && Math.abs(c - cols[r - 1]) <= 1) continue;
          cols[r] = c;
          usedCols.add(c);
          usedRegions.add(regionGrid[r][c]);
          if (place(r + 1)) return true;
          cols[r] = -1;
          usedCols.delete(c);
          usedRegions.delete(regionGrid[r][c]);
        }
        return false;
      }
      return place(0);
    }

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!isCandidate(r, c)) continue;
        const testBoard = board.map((row) => row.slice());
        testBoard[r][c] = 2;
        if (!solvableWith(testBoard)) return { r, c, type: "cross" };
      }
    }

    return null;
  }

  function handleHint() {
    if (solved) return;
    // 1) flag anything already on the board that is wrong. Both directions
    // matter: a crown where no crown belongs, AND an x on a cell that must
    // hold a crown. Without the second check an x is never validated, so a
    // board could be flooded with x marks and every hint would still report
    // things as fine. This is the only place a mistake gets counted — not
    // every wrong tap, only a wrong tap that hint actually catches you on.
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        const isSolutionCell = puzzle.solution[r] === c;
        if (board[r][c] === 2 && !isSolutionCell) {
          setHintCell({ r, c, type: "error" });
          setHintsUsed((h) => h + 1);
          setMistakes((m) => m + 1);
          return;
        }
        if (board[r][c] === 1 && isSolutionCell) {
          setHintCell({ r, c, type: "error" });
          setHintsUsed((h) => h + 1);
          setMistakes((m) => m + 1);
          return;
        }
      }
    }
    // 2) the next step that's genuinely forced — a cross or a queen.
    // There is deliberately no guessing fallback below this: the
    // contradiction check inside always finds a real deduction.
    const step = findNextLogicalStep();
    if (step) {
      setHintCell({ r: step.r, c: step.c, type: step.type });
      setHintsUsed((h) => h + 1);
    }
  }

  function edgeBorder(r, c, dr, dc) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) return "2px solid #2B2B2E";
    return puzzle.regionGrid[r][c] === puzzle.regionGrid[nr][nc]
      ? "1px solid rgba(20,20,24,0.28)"
      : "2px solid #2B2B2E";
  }

  latest.current = { board, puzzle, solved, performTapCycle, pushHistory };

  return (
    <div
      style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }}
      className="flex items-center justify-center p-4"
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,600;1,600&family=Inter:wght@400;500;600;700&display=swap');
        @keyframes popIn { 0% { transform: scale(0.3); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes fadeUp { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }
        @keyframes hintPulseError {
          0%, 100% { box-shadow: inset 0 0 0 4px rgba(229,72,77,1); background-color: rgba(229,72,77,0.30); }
          50%      { box-shadow: inset 0 0 0 4px rgba(229,72,77,0.35); background-color: rgba(229,72,77,0.05); }
        }
        @keyframes hintShake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-2px); }
          75% { transform: translateX(2px); }
        }
        @keyframes hintPulseCross { 0%, 100% { box-shadow: inset 0 0 0 3px rgba(47,111,237,1); } 50% { box-shadow: inset 0 0 0 3px rgba(47,111,237,0.2); } }
        @keyframes hintPulseQueen { 0%, 100% { box-shadow: inset 0 0 0 3px rgba(16,140,90,1); } 50% { box-shadow: inset 0 0 0 3px rgba(16,140,90,0.2); } }
        .qp-crown { animation: popIn 0.22s ease-out; }
        .qp-card { animation: fadeUp 0.4s ease-out; }
        .qp-hint-error { animation: hintPulseError 0.9s ease-in-out infinite, hintShake 0.9s ease-in-out infinite; }
        .qp-hint-cross { animation: hintPulseCross 1.1s ease-in-out infinite; }
        .qp-hint-queen { animation: hintPulseQueen 1.1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .qp-crown, .qp-card, .qp-hint-error, .qp-hint-cross, .qp-hint-queen { animation: none !important; }
        }
        @media (hover: hover) and (pointer: fine) {
          .qp-cell:hover { filter: brightness(1.15); }
          .qp-day-btn:hover { filter: brightness(1.12); }
          .qp-icon-btn:hover { opacity: 0.85; }
          .qp-play-again:hover { filter: brightness(1.08); }
          .qp-toolbar-btn:not(:disabled):hover {
            background: rgba(16,24,40,0.10) !important;
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
            style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", fontWeight: 600, color: CREAM, letterSpacing: "-0.01em" }}
            className="text-4xl lg:text-5xl"
          >
            Queens
          </h1>
          <p style={{ color: CREAM, opacity: 0.45 }} className="text-xs mt-1">
            one crown per row, column &amp; region
          </p>
        </div>

        {/* day selector */}
        <div className="flex flex-wrap justify-center gap-1.5 mb-4">
          {DAYS.map((d, i) => (
            <button
              key={d}
              onClick={() => setDayIdx(i)}
              className="qp-day-btn flex flex-col items-center justify-center rounded-lg px-2 py-1.5 transition-colors"
              style={{
                background: i === dayIdx ? GOLD : "rgba(16,24,40,0.05)",
                color: i === dayIdx ? "#FFFFFF" : CREAM,
                minWidth: 38,
              }}
            >
              <span className="text-xs font-semibold">{d}</span>
              <span className="text-[10px] opacity-70">{SIZES[i]}×{SIZES[i]}</span>
            </button>
          ))}
        </div>

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
            { Icon: Undo2, label: "Undo", onClick: handleUndo, disabled: history.length === 0 },
            { Icon: RotateCcw, label: "Reset", onClick: handleReset, disabled: false },
            { Icon: Shuffle, label: "New", onClick: () => newPuzzle(n), disabled: false },
            { Icon: Lightbulb, label: "Hint", onClick: handleHint, disabled: solved },
          ].map(({ Icon, label, onClick, disabled }) => (
            <button
              key={label}
              onClick={onClick}
              disabled={disabled}
              className="qp-toolbar-btn flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 transition-colors"
              style={{
                background: "rgba(16,24,40,0.05)",
                color: disabled ? "rgba(27,33,41,0.28)" : CREAM,
                cursor: disabled ? "default" : "pointer",
              }}
            >
              <Icon size={15} />
              <span className="text-[9px]">{label}</span>
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
          className="relative w-full rounded-xl overflow-hidden select-none"
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

          {solved && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl"
              style={{ background: "rgba(255,255,255,0.92)", backdropFilter: "blur(3px)" }}
            >
              <Crown size={36} style={{ color: GOLD }} />
              <p style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", color: CREAM }} className="text-2xl">
                Solved
              </p>
              <p style={{ color: CREAM, opacity: 0.7 }} className="text-xs">
                {fmtTime(seconds)} &middot; {mistakes} mistake{mistakes === 1 ? "" : "s"} &middot; {hintsUsed} hint{hintsUsed === 1 ? "" : "s"}
              </p>
              <button
                onClick={() => newPuzzle(n)}
                className="qp-play-again mt-2 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors"
                style={{ background: GOLD, color: "#FFFFFF" }}
              >
                Play again
              </button>
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
