import React, { useState, useEffect, useRef, useCallback } from "react";
import { withSeededRandom } from "../lib/seededRandom.js";
import { useHintCooldown } from "../lib/useHintCooldown.js";
import { rateDifficulty } from "../lib/saveStats.js";
import DifficultyRating, { DifficultyRatingBadge } from "../DifficultyRating.jsx";
import { Sun, Moon, RotateCcw, Undo2, Shuffle, Lightbulb, Timer as TimerIcon, HelpCircle, Lock } from "lucide-react";

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

/* ---------------- design tokens ---------------- */

const BG = "#F1F3F7";
const PANEL = "#FFFFFF";
const CREAM = "#1B2129";
const GOLD = "#2F6FED";
const RED = "#E5484D";
const TEAL = "#5FA8A3";
const SUN_COLOR = "#E8A020";
const MOON_COLOR = "#3E6BC2";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GIVEN_TARGETS = [16, 14, 12, 10, 9, 8, 7];
const EDGE_TARGETS = [6, 5, 5, 4, 4, 3, 3];

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

/* ---------------- component ---------------- */

export default function TangoGame({ userId, onSolved, mode = "practice", forcedDayIdx, seed, challengeDate, hintCooldownConfig, savedStatId } = {}) {
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
  const timerRef = useRef(null);

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

  if (!board || !puzzle) {
    return (
      <div style={{ background: BG, minHeight: "100vh" }} className="flex items-center justify-center">
        <span style={{ color: CREAM, opacity: 0.6 }} className="text-sm">Building today's puzzle…</span>
      </div>
    );
  }

  const conflicts = getConflicts(board, puzzle.edgeMap);
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
    // 1) flag one wrong symbol, if any — this is the only place a mistake
    // gets counted, not every wrong tap, only a wrong tap hint catches you on
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] !== 0 && board[r][c] !== puzzle.solution[r][c]) {
          setHintCell({ r, c, type: "error" });
          setHintsUsed((h) => h + 1);
          setMistakes((m) => m + 1);
          hintCooldown.startCooldown();
          return;
        }
      }
    }
    // 2) a cell whose symbol is already logically forced but not filled yet
    const forced = findForcedCell(board, puzzle.edgeMap);
    if (forced) {
      setHintCell({ r: forced.r, c: forced.c, type: "forced" });
      setHintsUsed((h) => h + 1);
      hintCooldown.startCooldown();
      return;
    }
    // 3) nothing forced — just point at one blank cell
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === 0) {
          setHintCell({ r, c, type: "next" });
          setHintsUsed((h) => h + 1);
          hintCooldown.startCooldown();
          return;
        }
      }
    }
  }

  return (
    <div
      style={{ background: BG, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }}
      className="flex items-center justify-center p-4"
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        @keyframes popIn { 0% { transform: scale(0.3); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes fadeUp { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }
        @keyframes hintPulseError { 0%, 100% { box-shadow: inset 0 0 0 3px rgba(217,105,92,1); } 50% { box-shadow: inset 0 0 0 3px rgba(217,105,92,0.25); } }
        @keyframes hintPulseForced { 0%, 100% { box-shadow: inset 0 0 0 3px rgba(95,168,163,1); } 50% { box-shadow: inset 0 0 0 3px rgba(95,168,163,0.25); } }
        @keyframes hintPulseNext { 0%, 100% { box-shadow: inset 0 0 0 3px rgba(217,174,88,1); } 50% { box-shadow: inset 0 0 0 3px rgba(217,174,88,0.25); } }
        .tg-symbol { animation: popIn 0.22s ease-out; }
        .tg-card { animation: fadeUp 0.4s ease-out; }
        .tg-hint-error { animation: hintPulseError 1.1s ease-in-out infinite; }
        .tg-hint-forced { animation: hintPulseForced 1.1s ease-in-out infinite; }
        .tg-hint-next { animation: hintPulseNext 1.1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .tg-symbol, .tg-card, .tg-hint-error, .tg-hint-forced, .tg-hint-next { animation: none !important; }
        }
        @media (hover: hover) and (pointer: fine) {
          .tg-cell:not(:disabled):hover { filter: brightness(1.2); }
          .tg-day-btn:hover { filter: brightness(1.12); }
          .tg-icon-btn:hover { opacity: 0.85; }
          .tg-play-again:hover { filter: brightness(1.08); }
          .tg-toolbar-btn:not(:disabled):hover { background: rgba(16,24,40,0.10) !important; }
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
              <span className="text-xs font-semibold">Today's Challenge</span>
              <span className="text-[10px] opacity-80">{GIVEN_TARGETS[dayIdx]} clues</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-1.5 mb-4">
            {DAYS.map((d, i) => (
              <button
                key={d}
                onClick={() => setDayIdx(i)}
                className="tg-day-btn flex flex-col items-center justify-center rounded-lg px-2 py-1.5 transition-colors"
                style={{
                  background: i === dayIdx ? GOLD : "rgba(16,24,40,0.05)",
                  color: i === dayIdx ? "#FFFFFF" : CREAM,
                  minWidth: 38,
                }}
              >
                <span className="text-xs font-semibold">{d}</span>
                <span className="text-[10px] opacity-70">{GIVEN_TARGETS[i]} clues</span>
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
            { Icon: Undo2, label: "Undo", onClick: handleUndo, disabled: solved || history.length === 0 },
            { Icon: RotateCcw, label: "Reset", onClick: handleReset, disabled: solved },
            { Icon: Shuffle, label: "New", onClick: () => newPuzzle(dayIdx), disabled: isChallenge },
            {
              Icon: hintCooldown.locked ? Lock : Lightbulb,
              label: hintCooldown.locked ? `${hintCooldown.remaining}s` : "Hint",
              onClick: handleHint,
              disabled: solved || hintCooldown.locked,
            },
          ].map(({ Icon, label, onClick, disabled }) => (
            <button
              key={label}
              onClick={onClick}
              disabled={disabled}
              className="tg-toolbar-btn flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 transition-colors"
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
            Tap a blank cell to cycle sun → moon → blank. Every row and column needs three suns and
            three moons, and no more than two of the same symbol can sit in a row. An "=" between
            two cells means they match; a "×" means they differ. Hint flags one wrong symbol, or one
            cell that's already logically forced, or — as a last resort — just points at a blank one.
          </div>
        )}

        {/* board */}
        <div
          className="relative w-full rounded-xl overflow-hidden"
          style={{
            aspectRatio: "1 / 1",
            display: "grid",
            gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
            gridTemplateRows: `repeat(${SIZE}, 1fr)`,
            background: BG,
          }}
        >
          {board.map((row, r) =>
            row.map((val, c) => {
              const isGiven = puzzle.givens[r][c] !== 0;
              const isConflict = conflicts.has(`${r}-${c}`);
              const isHint = hintCell && hintCell.r === r && hintCell.c === c;
              const hintClass = isHint && !isConflict ? `tg-hint-${hintCell.type}` : "";
              return (
                <button
                  key={`${r}-${c}`}
                  onClick={() => handleCellClick(r, c)}
                  disabled={isGiven}
                  className={`tg-cell relative flex items-center justify-center transition-colors duration-200 ${hintClass}`}
                  style={{
                    background: isGiven ? "rgba(16,24,40,0.05)" : "transparent",
                    border: "1px solid rgba(20,20,24,0.30)",
                    boxShadow: isConflict ? `inset 0 0 0 3px ${RED}` : "none",
                    cursor: isGiven ? "default" : "pointer",
                  }}
                >
                  {val === SUN && (
                    <Sun key={`sun-${r}-${c}`} className="tg-symbol" size={Math.max(16, 26 - SIZE)} style={{ color: isConflict ? RED : SUN_COLOR }} strokeWidth={2.25} />
                  )}
                  {val === MOON && (
                    <Moon key={`moon-${r}-${c}`} className="tg-symbol" size={Math.max(16, 26 - SIZE)} style={{ color: isConflict ? RED : MOON_COLOR }} strokeWidth={2.25} />
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
                style={{
                  position: "absolute",
                  left: `${cx}%`,
                  top: `${cy}%`,
                  transform: "translate(-50%, -50%)",
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: PANEL,
                  border: `1px solid rgba(16,24,40,0.25)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                  color: CREAM,
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              >
                {e.type === "eq" ? "=" : "×"}
              </span>
            );
          })}

          {solved && difficultyRating === null && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl p-4"
              style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(3px)", zIndex: 3 }}
            >
              <div className="flex items-center gap-1">
                <Sun size={26} style={{ color: SUN_COLOR }} />
                <Moon size={26} style={{ color: MOON_COLOR }} />
              </div>
              <p style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600, color: CREAM }} className="text-2xl">
                Solved
              </p>
              <p style={{ color: CREAM, opacity: 0.7 }} className="text-xs mb-1">
                {fmtTime(seconds)} &middot; {mistakes} mistake{mistakes === 1 ? "" : "s"} &middot; {hintsUsed} hint{hintsUsed === 1 ? "" : "s"}
              </p>
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
                  className="tg-play-again mt-2 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors"
                  style={{ background: GOLD, color: "#FFFFFF" }}
                >
                  Play again
                </button>
              )}
            </div>
          )}
        </div>

        <p style={{ color: CREAM, opacity: 0.35 }} className="text-center text-[11px] mt-3">
          {filledCount}/{SIZE * SIZE} filled
        </p>
      </div>
    </div>
  );
}
