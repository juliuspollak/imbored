import React, { useState, useEffect, useRef, useCallback } from "react";
import { withSeededRandom } from "../lib/seededRandom.js";
import { useHintCooldown } from "../lib/useHintCooldown.js";
import { rateDifficulty } from "../lib/saveStats.js";
import DifficultyRating, { DifficultyRatingBadge } from "../DifficultyRating.jsx";
import { Eraser, CornerUpLeft, Sparkles, WandSparkles, Timer as TimerIcon, HelpCircle, Flag, Lock } from "lucide-react";

/* ---------------- puzzle generation ---------------- */

const SIZE = 6; // constant across all days — difficulty comes from checkpoints/walls/hazards, not grid size

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function chooseBlackHoles(n, count) {
  const all = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) all.push([r, c]);
  return shuffle(all).slice(0, count);
}

function chooseTunnels(n, pairCount, blockedSet) {
  const available = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!blockedSet.has(`${r},${c}`)) available.push([r, c]);
    }
  }
  const shuffled = shuffle(available);
  const pairs = [];
  const used = new Set();
  for (let i = 0; i < pairCount; i++) {
    const a = shuffled.find((cell) => !used.has(`${cell[0]},${cell[1]}`));
    if (!a) break;
    const b = shuffled.find((cell) => !used.has(`${cell[0]},${cell[1]}`) && (Math.abs(cell[0] - a[0]) + Math.abs(cell[1] - a[1]) >= 3));
    if (!b) break;
    used.add(`${a[0]},${a[1]}`); used.add(`${b[0]},${b[1]}`);
    pairs.push({ a, b, label: String.fromCharCode(65 + i) });
  }
  return pairs;
}

function buildTunnelMap(tunnels) {
  const m = new Map();
  for (const t of tunnels) {
    m.set(`${t.a[0]},${t.a[1]}`, t.b);
    m.set(`${t.b[0]},${t.b[1]}`, t.a);
  }
  return m;
}

// A Hamiltonian path over the grid, aware of black holes (excluded cells,
// pre-marked as permanently "visited" so they're never chosen) and tunnels
// (each tunnel cell gets its paired cell as an extra neighbor alongside its
// normal 4 orthogonal ones, so the path can legitimately warp through it).
function generateHamiltonianPath(n, blockedSet, tunnelMap, maxAttempts = 40) {
  const totalCells = n * n - blockedSet.size;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const visited = Array.from({ length: n }, () => Array(n).fill(false));
    for (const key of blockedSet) {
      const [r, c] = key.split(",").map(Number);
      visited[r][c] = true;
    }
    const path = [];
    let steps = 0;
    const stepBudget = totalCells * 100;
    // Once the path steps onto a tunnel cell (arriving fresh, not via its
    // own jump), the ONLY next move offered is the jump to its partner.
    // Treating it as merely one option among several — as an earlier
    // version did — meant the search would frequently just walk to the
    // paired cell normally instead, leaving the tunnel present on the
    // board but never actually used by the solution.
    function neighborsOf(r, c) {
      const tp = tunnelMap.get(`${r},${c}`);
      if (tp && !visited[tp[0]][tp[1]]) return [tp];
      const result = [];
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < n && nc >= 0 && nc < n && !visited[nr][nc]) result.push([nr, nc]);
      }
      return result;
    }
    function backtrack(r, c) {
      steps++;
      if (steps > stepBudget) return false;
      if (path.length === totalCells) return true;
      let candidates = shuffle(neighborsOf(r, c));
      candidates.sort((a, b) => neighborsOf(a[0], a[1]).length - neighborsOf(b[0], b[1]).length);
      for (const [nr, nc] of candidates) {
        visited[nr][nc] = true;
        path.push([nr, nc]);
        if (backtrack(nr, nc)) return true;
        visited[nr][nc] = false;
        path.pop();
      }
      return false;
    }
    let sr, sc, tries = 0;
    do {
      sr = Math.floor(Math.random() * n);
      sc = Math.floor(Math.random() * n);
      tries++;
    } while (blockedSet.has(`${sr},${sc}`) && tries < 200);
    if (blockedSet.has(`${sr},${sc}`)) continue;
    visited[sr][sc] = true;
    path.push([sr, sc]);
    if (backtrack(sr, sc)) return path;
  }
  return null;
}

function chooseCheckpoints(path, totalCheckpoints) {
  const last = path.length - 1;
  const positions = new Set([0, last]);
  const need = totalCheckpoints - 2;
  if (need > 0) {
    const segments = need + 1;
    for (let i = 1; i <= need; i++) {
      const base = Math.round((i * last) / segments);
      const jitter = Math.round((Math.random() - 0.5) * (last / segments) * 0.6);
      let pos = Math.min(last - 1, Math.max(1, base + jitter));
      while (positions.has(pos) && pos < last - 1) pos++;
      positions.add(pos);
    }
  }
  const sorted = [...positions].sort((a, b) => a - b);
  return sorted.map((pos, i) => ({ pos, num: i + 1, r: path[pos][0], c: path[pos][1] }));
}

function edgeKey(r1, c1, r2, c2) {
  if (r1 > r2 || (r1 === r2 && c1 > c2)) [r1, c1, r2, c2] = [r2, c2, r1, c1];
  return `${r1},${c1}|${r2},${c2}`;
}

// Walls only ever go on physical orthogonal edges the path doesn't use, and
// never touch a black hole cell (there's nothing to block there).
function chooseWalls(path, n, wallCount, blockedSet) {
  const pathEdges = new Set();
  for (let i = 0; i < path.length - 1; i++) {
    const [r1, c1] = path[i], [r2, c2] = path[i + 1];
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1) pathEdges.add(edgeKey(r1, c1, r2, c2));
  }
  const candidates = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (blockedSet.has(`${r},${c}`)) continue;
      if (c + 1 < n && !blockedSet.has(`${r},${c + 1}`)) {
        const k = edgeKey(r, c, r, c + 1);
        if (!pathEdges.has(k)) candidates.push({ r1: r, c1: c, r2: r, c2: c + 1 });
      }
      if (r + 1 < n && !blockedSet.has(`${r + 1},${c}`)) {
        const k = edgeKey(r, c, r + 1, c);
        if (!pathEdges.has(k)) candidates.push({ r1: r, c1: c, r2: r + 1, c2: c });
      }
    }
  }
  return shuffle(candidates).slice(0, Math.min(wallCount, candidates.length));
}

function generatePuzzle(n, checkpointCount, wallCount, blackHoleCount, tunnelPairCount, maxAttempts = 15) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const blocked = chooseBlackHoles(n, blackHoleCount);
    const blockedSet = new Set(blocked.map(([r, c]) => `${r},${c}`));
    const tunnels = chooseTunnels(n, tunnelPairCount, blockedSet);
    const tunnelMap = buildTunnelMap(tunnels);
    const path = generateHamiltonianPath(n, blockedSet, tunnelMap);
    if (!path) continue;
    const checkpoints = chooseCheckpoints(path, checkpointCount);
    const numberGrid = Array.from({ length: n }, () => Array(n).fill(0));
    for (const cp of checkpoints) numberGrid[cp.r][cp.c] = cp.num;
    const walls = chooseWalls(path, n, wallCount, blockedSet);
    const wallSet = new Set(walls.map((w) => edgeKey(w.r1, w.c1, w.r2, w.c2)));
    return { path, checkpoints, numberGrid, maxNum: checkpoints.length, walls, wallSet, blocked, blockedSet, tunnels, tunnelMap };
  }
  return null;
}

/* ---------------- pure interaction logic ---------------- */

function isAdjacent(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
}

function isBlocked(wallSet, r1, c1, r2, c2) {
  return wallSet.has(edgeKey(r1, c1, r2, c2));
}

function canStepTo(r1, c1, r2, c2, wallSet, tunnelMap) {
  if (isAdjacent(r1, c1, r2, c2)) return !isBlocked(wallSet, r1, c1, r2, c2);
  const partner = tunnelMap.get(`${r1},${c1}`);
  if (partner && partner[0] === r2 && partner[1] === c2) return true;
  return false;
}

function hasOrderConflict(path, numberGrid) {
  let seenMax = 0;
  for (const [r, c] of path) {
    const num = numberGrid[r][c];
    if (num !== 0) {
      if (num !== seenMax + 1) return true;
      seenMax = num;
    }
  }
  return false;
}

// ONE rule for extending/blocking, but rollback behaves differently depending
// on context. A discrete tap is deliberate — clicking any earlier cell on
// your path (checkpoint or not) rolls back to exactly there, which is how
// you correct a mistake made several cells back. But during active drag
// movement, samples fire many times a second and incidental jitter can land
// on some random earlier cell — rolling back arbitrarily far in that case
// would wipe out progress you didn't mean to lose, so movement is
// restricted to only retracting one step (the immediate predecessor).
function processStep(prevPath, r, c, wallSet, numberGrid, tunnelMap, blockedSet, restrictRollback) {
  if (blockedSet.has(`${r},${c}`)) return prevPath;
  const last = prevPath[prevPath.length - 1];
  if (last[0] === r && last[1] === c) return prevPath;
  const idx = prevPath.findIndex(([pr, pc]) => pr === r && pc === c);
  if (idx !== -1) {
    if (restrictRollback) {
      const isImmediatePredecessor = idx === prevPath.length - 2;
      if (isImmediatePredecessor) return prevPath.slice(0, idx + 1);
      return prevPath;
    }
    return prevPath.slice(0, idx + 1);
  }
  if (canStepTo(last[0], last[1], r, c, wallSet, tunnelMap)) {
    return [...prevPath, [r, c]];
  }
  return prevPath;
}

/* ---------------- design tokens ---------------- */

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const CREAM = "#1B2129";
const GOLD = "#2F6FED";
const RED = "#E5484D";
const ZIP_GREEN = "#12946A";
const WALL_COLOR = "#E5484D";
const TUNNEL_COLORS = ["#6D5BD0", "#2878B5", "#B7791F", "#B24C7C"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CHECKPOINT_COUNTS = [7, 6, 5, 5, 4, 4, 3];
const WALL_COUNTS = [0, 1, 2, 3, 4, 5, 6];
const BLACKHOLE_COUNTS = [0, 0, 1, 1, 2, 2, 3];
const TUNNEL_PAIR_COUNTS = [0, 0, 0, 0, 1, 1, 2];

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function rgba(hex, alpha) {
  const value = hex.replace("#", "");
  const size = value.length === 3 ? 1 : 2;
  const expand = (part) => size === 1 ? part + part : part;
  const r = parseInt(expand(value.slice(0, size)), 16);
  const g = parseInt(expand(value.slice(size, size * 2)), 16);
  const b = parseInt(expand(value.slice(size * 2, size * 3)), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function rainbowStepColor(index, total) {
  const stops = ["#FF6B6B", "#F6C85F", "#62C370", "#4D96FF", "#9B5DE5"];
  if (total <= 1) return stops[2];
  const scaled = (index / Math.max(total - 1, 1)) * (stops.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(stops.length - 1, lower + 1);
  return stops[scaled - lower < 0.5 ? lower : upper];
}

/* ---------------- component ---------------- */

export default function ZipGame({ userId, onSolved, mode = "practice", forcedDayIdx, seed, challengeDate, hintCooldownConfig, savedStatId, rewardResult } = {}) {
  const todayIdx = (() => {
    const d = new Date().getDay();
    return d === 0 ? 6 : d - 1;
  })();
  const isChallenge = mode === "challenge";
  const [dayIdx, setDayIdx] = useState(isChallenge ? forcedDayIdx ?? todayIdx : todayIdx);
  const hintCooldownSeconds = (hintCooldownConfig?.hint_cooldown_base || 0) + (hintCooldownConfig?.hint_cooldown_per_day || 0) * dayIdx;
  const hintCooldown = useHintCooldown(hintCooldownSeconds);
  const zipPathStyle = hintCooldownConfig?.zip_path_style === "rainbow" ? "rainbow" : "solid";
  const [puzzle, setPuzzle] = useState(null);
  const [path, setPath] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [solved, setSolved] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [difficultyRating, setDifficultyRating] = useState(null);
  const [hintCell, setHintCell] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHelp, setShowHelp] = useState(false);
  const timerRef = useRef(null);
  const boardRef = useRef(null);
  const dragRef = useRef({ active: false, historyPushed: false, lastKey: null, startCell: null, moved: false });
  const suppressClickRef = useRef(false);
  const latest = useRef({});

  const newPuzzle = useCallback((dIdx) => {
    const gen = () => generatePuzzle(SIZE, CHECKPOINT_COUNTS[dIdx], WALL_COUNTS[dIdx], BLACKHOLE_COUNTS[dIdx], TUNNEL_PAIR_COUNTS[dIdx]);
    const p = isChallenge && seed ? withSeededRandom(seed, gen) : gen();
    setPuzzle(p);
    setPath(p ? [p.path[0]] : null);
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
    if (!puzzle || !path) return;
    const totalVisitable = puzzle.numberGrid.length * puzzle.numberGrid.length - puzzle.blocked.length;
    const [lastR, lastC] = path[path.length - 1];
    const lastIsMaxCheckpoint = puzzle.numberGrid[lastR][lastC] === puzzle.maxNum;
    if (path.length === totalVisitable && lastIsMaxCheckpoint && !hasOrderConflict(path, puzzle.numberGrid) && !solved) {
      setSolved(true);
      setRunning(false);
      onSolved && onSolved({ userId, game: "zip", dayIndex: dayIdx, seconds, mistakes, hints: hintsUsed, mode, challengeDate: isChallenge ? challengeDate : undefined });
    }
  }, [path, puzzle]);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    function cellFromPoint(clientX, clientY) {
      const p = latest.current.puzzle;
      if (!p) return null;
      const size = p.numberGrid.length;
      const rect = el.getBoundingClientRect();
      let col = Math.floor(((clientX - rect.left) / rect.width) * size);
      let row = Math.floor(((clientY - rect.top) / rect.height) * size);
      col = Math.min(size - 1, Math.max(0, col));
      row = Math.min(size - 1, Math.max(0, row));
      return { row, col };
    }

    function onTouchStart(e) {
      if (latest.current.solved) return;
      e.preventDefault();
      const t = e.touches[0];
      if (!t) return;
      const cell = cellFromPoint(t.clientX, t.clientY);
      if (!cell) return;
      dragRef.current = { active: true, historyPushed: false, lastKey: null, startCell: cell, moved: false };
    }
    function onTouchMove(e) {
      if (!dragRef.current.active) return;
      e.preventDefault();
      const t = e.touches[0];
      if (!t) return;
      const cell = cellFromPoint(t.clientX, t.clientY);
      if (cell) {
        dragRef.current.moved = true;
        latest.current.processDragPoint(cell.row, cell.col, false);
      }
    }
    function onTouchEnd(e) {
      if (!dragRef.current.active) return;
      e.preventDefault();
      if (!dragRef.current.moved) {
        latest.current.processDragPoint(dragRef.current.startCell.row, dragRef.current.startCell.col, true);
      }
      dragRef.current.active = false;
    }
    function onTouchCancel() {
      dragRef.current.active = false;
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
  }, [puzzle]);

  if (!puzzle || !path) {
    return (
      <div style={{ background: BG, minHeight: "100vh" }} className="flex items-center justify-center">
        <span style={{ color: CREAM, opacity: 0.6 }} className="text-sm">Building today's puzzle…</span>
      </div>
    );
  }

  const boardSize = puzzle.numberGrid.length;
  const totalVisitable = boardSize * boardSize - puzzle.blocked.length;
  const orderConflict = hasOrderConflict(path, puzzle.numberGrid);
  const visited = new Set(path.map(([r, c]) => `${r}-${c}`));
  const visitedIndex = new Map(path.map(([r, c], idx) => [`${r}-${c}`, idx]));
  const [curR, curC] = path[path.length - 1];

  function visitedCellBg(key) {
    if (!visited.has(key)) return "transparent";
    if (orderConflict) return "rgba(229,72,77,0.14)";
    if (zipPathStyle === "rainbow") {
      return rgba(rainbowStepColor(visitedIndex.get(key) || 0, path.length), 0.20);
    }
    return rgba(ZIP_GREEN, 0.20);
  }

  function visitedDotBg(key) {
    if (orderConflict) return RED;
    if (zipPathStyle === "rainbow") return rainbowStepColor(visitedIndex.get(key) || 0, path.length);
    return ZIP_GREEN;
  }

  const tunnelInfo = new Map();
  puzzle.tunnels.forEach((t, i) => {
    const color = TUNNEL_COLORS[i % TUNNEL_COLORS.length];
    tunnelInfo.set(`${t.a[0]},${t.a[1]}`, { label: t.label, color });
    tunnelInfo.set(`${t.b[0]},${t.b[1]}`, { label: t.label, color });
  });

  const pathSegments = [];
  let currentSeg = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const [pr, pc] = path[i - 1], [r, c] = path[i];
    if (isAdjacent(pr, pc, r, c)) {
      currentSeg.push(path[i]);
    } else {
      pathSegments.push(currentSeg);
      currentSeg = [path[i]];
    }
  }
  pathSegments.push(currentSeg);

  const lastMove = path.length > 1 ? [path[path.length - 2], path[path.length - 1]] : null;
  const lastMoveIsTunnel = lastMove
    ? !isAdjacent(lastMove[0][0], lastMove[0][1], lastMove[1][0], lastMove[1][1])
    : false;

  function pushHistory() {
    setHistory((h) =>
      [...h, { path: latest.current.path.map((p) => p.slice()), mistakes: latest.current.mistakes, hints: latest.current.hintsUsed }].slice(-100)
    );
  }

  function applyStep(r, c, restrictRollback) {
    if (latest.current.solved) return;
    setPath((prev) => {
      const p = latest.current.puzzle;
      return processStep(prev, r, c, p.wallSet, p.numberGrid, p.tunnelMap, p.blockedSet, restrictRollback);
    });
  }

  function processDragPoint(row, col, isTap) {
    const key = `${row}-${col}`;
    if (dragRef.current.lastKey === key) return;
    dragRef.current.lastKey = key;
    if (!dragRef.current.historyPushed) {
      pushHistory();
      dragRef.current.historyPushed = true;
    }
    setHintCell(null);
    applyStep(row, col, !isTap);
  }

  function handleCellClick(r, c) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (solved) return;
    pushHistory();
    setHintCell(null);
    applyStep(r, c, false); // a genuine click/tap always allows full rollback
  }

  function cellFromPointMouse(clientX, clientY) {
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

  function handleMouseDown(e) {
    if (solved) return;
    e.preventDefault();
    const cell = cellFromPointMouse(e.clientX, e.clientY);
    if (!cell) return;
    dragRef.current = { active: true, historyPushed: false, lastKey: null, startCell: cell, moved: false };
    function onMove(ev) {
      const c = cellFromPointMouse(ev.clientX, ev.clientY);
      if (c) {
        dragRef.current.moved = true;
        processDragPoint(c.row, c.col, false);
      }
    }
    function onUp() {
      if (!dragRef.current.moved) {
        processDragPoint(dragRef.current.startCell.row, dragRef.current.startCell.col, true);
      }
      dragRef.current.active = false;
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 400);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleUndo() {
    if (solved || history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setPath(last.path);
    setMistakes(last.mistakes);
    setHintsUsed(last.hints);
    setHintCell(null);
    setSolved(false);
    setRunning(true);
  }

  function handleReset() {
    if (solved) return;
    setPath([puzzle.path[0]]);
    setMistakes(0);
    setHintsUsed(0);
    setDifficultyRating(null);
    setHintCell(null);
    setHistory([]);
    setSeconds(0);
    setSolved(false);
    setRunning(true);
  }

  function handleHint() {
    if (solved || hintCooldown.isLocked()) return;
    let matchLen = 0;
    while (
      matchLen < path.length &&
      matchLen < puzzle.path.length &&
      path[matchLen][0] === puzzle.path[matchLen][0] &&
      path[matchLen][1] === puzzle.path[matchLen][1]
    ) {
      matchLen++;
    }
    if (matchLen < path.length) {
      // the path has quietly drifted off the true solution somewhere before
      // the end — point back to the last cell that was still correct rather
      // than trusting a lookup based on wherever the player currently is
      const [lr, lc] = path[matchLen - 1];
      setHintCell({ r: lr, c: lc, type: "error" });
      setHintsUsed((h) => h + 1);
      hintCooldown.startCooldown();
      return;
    }
    if (matchLen < puzzle.path.length) {
      const [nr, nc] = puzzle.path[matchLen];
      setHintCell({ r: nr, c: nc, type: "next" });
      setHintsUsed((h) => h + 1);
      hintCooldown.startCooldown();
    }
  }

  latest.current = { path, puzzle, solved, mistakes, hintsUsed, processDragPoint };

  return (
    <div
      style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }}
      className="flex items-start justify-center p-4 pt-[72px]"
    >
      <style>{`
        @keyframes popIn { 0% { transform: scale(0.3); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes fadeUp { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }
        @keyframes hintPulseError { 0%, 100% { box-shadow: inset 0 0 0 3px rgba(217,105,92,1); } 50% { box-shadow: inset 0 0 0 3px rgba(217,105,92,0.25); } }
        @keyframes hintPulseNext { 0%, 100% { box-shadow: inset 0 0 0 3px rgba(217,174,88,1); } 50% { box-shadow: inset 0 0 0 3px rgba(217,174,88,0.25); } }
        .zp-dot { animation: popIn 0.18s ease-out; }
        @keyframes tunnelWarp {
          0% { opacity: 0; transform: scale(0.22); }
          18% { opacity: 0.95; transform: scale(0.92); }
          55% { opacity: 0.72; transform: scale(1.75); }
          100% { opacity: 0; transform: scale(2.9); }
        }
        .zp-warp { animation: tunnelWarp .9s cubic-bezier(.16,.84,.32,1) both; transform-origin: center; }
        .zp-warp-secondary { animation-delay: .12s; opacity: 0; }
        .zp-card { animation: fadeUp 0.4s ease-out; }
        .zp-hint-error { animation: hintPulseError 1.1s ease-in-out infinite; }
        .zp-hint-next { animation: hintPulseNext 1.1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .zp-dot, .zp-card, .zp-hint-error, .zp-hint-next, .zp-warp, .zp-warp-secondary { animation: none !important; }
        }
        @media (hover: hover) and (pointer: fine) {
          .zp-cell:hover { filter: brightness(1.25); }
          .zp-day-btn:hover { filter: brightness(1.12); }
          .zp-icon-btn:hover { opacity: 0.85; }
          .zp-play-again:hover { filter: brightness(1.08); }
          .zp-toolbar-btn:not(:disabled):hover { transform: translateY(-1px); filter: brightness(1.03); }
        }
      `}</style>

      <div
        className="zp-card w-full max-w-sm sm:max-w-md lg:max-w-lg rounded-2xl p-5 lg:p-6 relative"
        style={{ background: PANEL, boxShadow: "0 10px 30px rgba(16,24,40,0.10)", border: "1px solid rgba(16,24,40,0.09)" }}
      >
        <button
          onClick={() => setShowHelp((h) => !h)}
          className="zp-icon-btn absolute top-4 right-4 transition-opacity"
          style={{ color: CREAM, opacity: 0.5 }}
        >
          <HelpCircle size={16} />
        </button>

        <div className="text-center mb-4">
          <h1
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700, color: CREAM, letterSpacing: "-0.01em" }}
            className="text-4xl lg:text-5xl"
          >
            Zip
          </h1>
          <p style={{ color: CREAM, opacity: 0.45 }} className="text-xs mt-1">
            trace one path through every cell, in order
          </p>
        </div>

        {isChallenge ? (
          <div className="flex justify-center mb-4">
            <div className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: `${GOLD}18`, color: GOLD }}>
              <span className="text-xs font-semibold">Today's Challenge</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-1.5 mb-4">
            {DAYS.map((d, i) => (
              <button
                key={d}
                onClick={() => setDayIdx(i)}
                className="zp-day-btn flex flex-col items-center justify-center rounded-lg px-2 py-1.5 transition-colors"
                style={{
                  background: i === dayIdx ? GOLD : "rgba(16,24,40,0.05)",
                  color: i === dayIdx ? "#FFFFFF" : CREAM,
                  minWidth: 38,
                }}
              >
                <span className="text-xs font-semibold">{d}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-center gap-4 mb-3 px-1">
          <div className="flex items-center gap-1.5" style={{ color: CREAM, opacity: 0.7 }}>
            <TimerIcon size={14} />
            <span className="text-xs tabular-nums">{fmtTime(seconds)}</span>
          </div>
          <div style={{ color: CREAM, opacity: 0.7 }} className="text-xs">
            route: <span style={{ color: ZIP_GREEN }}>explore freely</span>
          </div>
          <div style={{ color: CREAM, opacity: 0.7 }} className="text-xs">
            hints: <span style={{ color: hintsUsed > 0 ? GOLD : CREAM }}>{hintsUsed}</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 mb-4">
          {[
            { Icon: CornerUpLeft, label: "Undo", onClick: handleUndo, disabled: solved || history.length === 0 },
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
              className="zp-toolbar-btn relative flex items-center justify-center rounded-2xl transition-colors"
              style={{
                width: 46,
                height: 46,
                background: disabled ? "rgba(16,24,40,0.05)" : "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(240,246,244,0.96))",
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
            Drag through cells (or tap one at a time) to extend your path — orange bars are walls
            you can't cross, dark voids are black holes you must route around, and matching colored
            letters are linked tunnels: step into one and you continue from its pair. Tap any earlier
            cell on your path to roll back to it and correct your route. Hint points to your last
            correct cell if you've gone off track, or the next cell if you're still on it. Visit
            every open cell once, hit the checkpoints in order, and finish on the highest number.
          </div>
        )}

        <div
          ref={boardRef}
          onMouseDown={handleMouseDown}
          className="relative w-full rounded-xl overflow-hidden select-none"
          style={{
            aspectRatio: "1 / 1",
            display: "grid",
            gridTemplateColumns: `repeat(${boardSize}, 1fr)`,
            gridTemplateRows: `repeat(${boardSize}, 1fr)`,
            background: BG,
            touchAction: "none",
          }}
        >
          {Array.from({ length: boardSize }, (_, r) =>
            Array.from({ length: boardSize }, (_, c) => {
              const key = `${r}-${c}`;
              const isBlackHole = puzzle.blockedSet.has(`${r},${c}`);

              if (isBlackHole) {
                return (
                  <div
                    key={key}
                    style={{
                      position: "relative",
                      border: "1px solid rgba(20,20,24,0.30)",
                      overflow: "hidden",
                      background: "rgba(255,255,255,0.18)",
                    }}
                  >
                    <svg
                      viewBox="0 0 100 100"
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                      aria-hidden="true"
                    >
                      <defs>
                        <radialGradient id={`bhMist-${r}-${c}`} cx="50%" cy="50%" r="52%">
                          <stop offset="0%" stopColor="#050505" stopOpacity="1" />
                          <stop offset="38%" stopColor="#090909" stopOpacity="0.98" />
                          <stop offset="66%" stopColor="#252525" stopOpacity="0.72" />
                          <stop offset="100%" stopColor="#777777" stopOpacity="0" />
                        </radialGradient>
                        <filter id={`bhBlur-${r}-${c}`} x="-30%" y="-30%" width="160%" height="160%">
                          <feGaussianBlur stdDeviation="3.2" />
                        </filter>
                        <filter id={`bhBlurWide-${r}-${c}`} x="-40%" y="-40%" width="180%" height="180%">
                          <feGaussianBlur stdDeviation="5.4" />
                        </filter>
                      </defs>

                      <g filter={`url(#bhBlurWide-${r}-${c})`} opacity="0.42">
                        <path d="M9 52 C22 24, 56 13, 82 31 C96 41, 96 63, 79 77 C58 95, 24 87, 11 67" fill="none" stroke="#4A4A4A" strokeWidth="9" strokeLinecap="round" />
                        <path d="M18 34 C39 10, 75 19, 87 46 C97 69, 76 89, 49 90" fill="none" stroke="#6A6A6A" strokeWidth="8" strokeLinecap="round" />
                      </g>

                      <g filter={`url(#bhBlur-${r}-${c})`} opacity="0.78">
                        <path d="M13 58 C23 29, 54 18, 76 32 C92 42, 93 62, 77 74 C60 87, 34 82, 25 66 C18 54, 23 41, 35 34" fill="none" stroke="#2B2B2B" strokeWidth="7" strokeLinecap="round" />
                        <path d="M22 73 C12 54, 21 30, 43 23 C66 15, 85 28, 87 47 C89 65, 75 78, 58 79 C45 80, 34 73, 32 62" fill="none" stroke="#3A3A3A" strokeWidth="6" strokeLinecap="round" />
                        <path d="M29 31 C45 19, 68 22, 79 38 C89 53, 82 70, 67 77 C52 84, 34 77, 28 63 C23 51, 28 40, 39 35" fill="none" stroke="#171717" strokeWidth="5.5" strokeLinecap="round" />
                      </g>

                      <circle cx="50" cy="50" r="36" fill={`url(#bhMist-${r}-${c})`} />
                      <ellipse cx="51" cy="50" rx="22" ry="18" fill="#020202" opacity="0.98" />
                    </svg>
                  </div>
                );
              }

              const isVisited = visited.has(key);
              const isCurrent = r === curR && c === curC;
              const num = puzzle.numberGrid[r][c];
              const tunnel = tunnelInfo.get(`${r},${c}`);
              const isHint = hintCell && hintCell.r === r && hintCell.c === c;
              const hintClass = isHint ? `zp-hint-${hintCell.type}` : "";
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleCellClick(r, c)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleCellClick(r, c);
                    }
                  }}
                  className={`zp-cell relative flex items-center justify-center transition-colors duration-200 ${hintClass}`}
                  style={{
                    background: visitedCellBg(key),
                    border: "1px solid rgba(20,20,24,0.30)",
                    cursor: solved ? "default" : "pointer",
                    WebkitTouchCallout: "none",
                    WebkitUserSelect: "none",
                    userSelect: "none",
                  }}
                >
                  {num !== 0 && !solved && (
                    <span
                      className="zp-dot flex items-center justify-center rounded-full"
                      style={{
                        width: "72%",
                        height: "72%",
                        background: isVisited ? visitedDotBg(key) : "rgba(16,24,40,0.08)",
                        color: isVisited ? "#FFFFFF" : CREAM,
                        fontWeight: 800,
                        fontSize: Math.max(14, 22 - boardSize),
                        border: orderConflict && isVisited ? `2px solid ${RED}` : "none",
                        position: "relative",
                        zIndex: 5,
                      }}
                    >
                      {num}
                    </span>
                  )}
                  {tunnel && (
                    <span
                      style={{
                        position: "absolute",
                        top: 2,
                        right: 2,
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        background: tunnel.color,
                        color: "#FFFFFF",
                        fontSize: 8,
                        fontWeight: 800,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 1,
                      }}
                    >
                      {tunnel.label}
                    </span>
                  )}
                  {isCurrent && (
                    <span style={{ position: "absolute", inset: 0, borderRadius: 8, boxShadow: `inset 0 0 0 2px ${ZIP_GREEN}`, pointerEvents: "none" }} />
                  )}
                </div>
              );
            })
          )}

          {puzzle.walls.map((w) => {
            const horizontal = w.r1 === w.r2;
            const style = horizontal
              ? {
                  left: `${((w.c1 + 1) / boardSize) * 100}%`,
                  top: `${(w.r1 / boardSize) * 100}%`,
                  width: 3,
                  height: `${(1 / boardSize) * 100}%`,
                  transform: "translateX(-50%)",
                }
              : {
                  left: `${(w.c1 / boardSize) * 100}%`,
                  top: `${((w.r1 + 1) / boardSize) * 100}%`,
                  width: `${(1 / boardSize) * 100}%`,
                  height: 3,
                  transform: "translateY(-50%)",
                };
            return (
              <span
                key={`wall-${w.r1}-${w.c1}-${w.r2}-${w.c2}`}
                style={{ position: "absolute", background: WALL_COLOR, borderRadius: 2, pointerEvents: "none", zIndex: 2, ...style }}
              />
            );
          })}

          <svg className="absolute inset-0 pointer-events-none" style={{ width: "100%", height: "100%" }} viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="zipSnakeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FF6B6B" />
                <stop offset="24%" stopColor="#F6C85F" />
                <stop offset="48%" stopColor="#62C370" />
                <stop offset="72%" stopColor="#4D96FF" />
                <stop offset="100%" stopColor="#9B5DE5" />
              </linearGradient>
            </defs>
            {pathSegments.map((seg, idx) => {
              const points = seg.map(([r, c]) => `${((c + 0.5) / boardSize) * 100},${((r + 0.5) / boardSize) * 100}`).join(" ");
              const mainStroke = orderConflict ? RED : zipPathStyle === "rainbow" ? "url(#zipSnakeGradient)" : ZIP_GREEN;
              return (
                <g key={idx}>
                  <polyline
                    points={points}
                    fill="none"
                    stroke={orderConflict ? "rgba(217,105,92,0.28)" : "rgba(255,255,255,0.90)"}
                    strokeWidth="7.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <polyline
                    points={points}
                    fill="none"
                    stroke={mainStroke}
                    strokeWidth="5.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.98"
                  />
                </g>
              );
            })}
            {path.length > 1 && (
              <circle
                cx={((path[0][1] + 0.5) / boardSize) * 100}
                cy={((path[0][0] + 0.5) / boardSize) * 100}
                r="1.75"
                fill={ZIP_GREEN}
                stroke="#FFFFFF"
                strokeWidth="0.6"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <circle
              cx={((path[path.length - 1][1] + 0.5) / boardSize) * 100}
              cy={((path[path.length - 1][0] + 0.5) / boardSize) * 100}
              r="1.9"
              fill="#FFFFFF"
              stroke={ZIP_GREEN}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            {lastMoveIsTunnel && lastMove && (
              <>
                {[lastMove[0], lastMove[1]].map(([r, c], idx) => {
                  const warpColor = tunnelInfo.get(`${r},${c}`)?.color || ZIP_GREEN;
                  const cx = ((c + 0.5) / boardSize) * 100;
                  const cy = ((r + 0.5) / boardSize) * 100;
                  return (
                    <g key={`warp-${path.length}-${idx}`}>
                      <circle
                        className="zp-warp"
                        cx={cx}
                        cy={cy}
                        r="3.8"
                        fill="none"
                        stroke={warpColor}
                        strokeWidth="1.6"
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        className="zp-warp zp-warp-secondary"
                        cx={cx}
                        cy={cy}
                        r="2.6"
                        fill="none"
                        stroke={warpColor}
                        strokeWidth="0.95"
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        cx={cx}
                        cy={cy}
                        r="1.05"
                        fill={warpColor}
                        opacity="0.34"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })}
              </>
            )}
          </svg>

          {solved && difficultyRating === null && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl p-4"
              style={{ background: "rgba(255,255,255,0.97)", backdropFilter: "blur(4px)", zIndex: 20 }}
            >
              <Flag size={28} style={{ color: ZIP_GREEN }} />
              <p style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600, color: CREAM }} className="text-2xl">Solved</p>
              <p style={{ color: CREAM, opacity: 0.7 }} className="text-xs mb-1">
                {fmtTime(seconds)} &middot; {hintsUsed} hint{hintsUsed === 1 ? "" : "s"}
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
                  className="zp-play-again mt-2 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors"
                  style={{ background: GOLD, color: "#FFFFFF" }}
                >
                  Play again
                </button>
              )}
            </div>
          )}
        </div>

        {solved && difficultyRating !== null && (
          <div className="flex justify-center mt-3">
            <DifficultyRatingBadge value={difficultyRating} />
          </div>
        )}

      </div>
    </div>
  );
}
