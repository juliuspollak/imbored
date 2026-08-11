// How much *thinking* a Twist board actually needs.
//
// The generator used to grade difficulty by clue count, verified with a
// brute-force uniqueness check. That guarantees exactly one answer but says
// nothing about the route to it: a seven-clue board can still fall to a chain
// of trivially forced moves, which is why Sunday played like a weekday.
//
// This solves the way a person does — only deductions someone can see — and
// reports how deep the chain had to go. The generator then grades on that.

export const SIZE = 6;
export const HALF = SIZE / 2;
export const EMPTY = 0, SUN = 1, MOON = 2;

const other = (value) => (value === SUN ? MOON : SUN);

export function edgeKey(r1, c1, r2, c2) {
  if (r1 > r2 || (r1 === r2 && c1 > c2)) [r1, c1, r2, c2] = [r2, c2, r1, c1];
  return `${r1},${c1}|${r2},${c2}`;
}

function lineCells(board, index, isRow) {
  return Array.from({ length: SIZE }, (unused, i) => (isRow ? board[index][i] : board[i][index]));
}

function setCell(board, index, i, isRow, value) {
  if (isRow) board[index][i] = value; else board[i][index] = value;
}

// "Two in a row means the neighbours differ", plus the gap form X_X.
// The technique a player reaches for first, and the one that makes a puzzle
// feel mechanical when it is the only one needed.
function applyTriples(board) {
  let placed = 0;
  for (let index = 0; index < SIZE; index += 1) {
    for (const isRow of [true, false]) {
      const cells = lineCells(board, index, isRow);
      for (let i = 0; i < SIZE; i += 1) {
        const a = cells[i], b = cells[i + 1], c = cells[i + 2];
        if (a !== EMPTY && a === b && c === EMPTY && i + 2 < SIZE) { setCell(board, index, i + 2, isRow, other(a)); cells[i + 2] = other(a); placed += 1; }
        if (b !== EMPTY && b === c && a === EMPTY && i + 2 < SIZE) { setCell(board, index, i, isRow, other(b)); cells[i] = other(b); placed += 1; }
        // X _ X — the middle cannot match or it makes a run of three.
        if (a !== EMPTY && a === c && b === EMPTY && i + 2 < SIZE) { setCell(board, index, i + 1, isRow, other(a)); cells[i + 1] = other(a); placed += 1; }
      }
    }
  }
  return placed;
}

// A line already holding half its quota of one symbol: everything else in it
// is the other symbol.
function applyCounts(board) {
  let placed = 0;
  for (let index = 0; index < SIZE; index += 1) {
    for (const isRow of [true, false]) {
      const cells = lineCells(board, index, isRow);
      for (const value of [SUN, MOON]) {
        if (cells.filter((cell) => cell === value).length !== HALF) continue;
        for (let i = 0; i < SIZE; i += 1) {
          if (cells[i] === EMPTY) { setCell(board, index, i, isRow, other(value)); cells[i] = other(value); placed += 1; }
        }
      }
    }
  }
  return placed;
}

// = and x signs: once either side is known the other follows.
function applyEdges(board, edgeMap) {
  let placed = 0;
  for (const [key, type] of edgeMap) {
    const [left, right] = key.split("|");
    const [r1, c1] = left.split(",").map(Number);
    const [r2, c2] = right.split(",").map(Number);
    const a = board[r1][c1], b = board[r2][c2];
    if (a === EMPTY && b === EMPTY) continue;
    if (a !== EMPTY && b === EMPTY) { board[r2][c2] = type === "eq" ? a : other(a); placed += 1; }
    else if (b !== EMPTY && a === EMPTY) { board[r1][c1] = type === "eq" ? b : other(b); placed += 1; }
  }
  return placed;
}

/**
 * Solves using only human techniques and reports how hard that was.
 *
 * `rounds` is the number of sweeps needed — a proxy for chain depth, since a
 * board that gives up everything in two sweeps required no sustained
 * reasoning. `solved` is false when these techniques stall, which means the
 * board needs guesswork rather than deduction; those are rejected, not prized.
 */
export function gradeTwistBoard(givens, edgeMap) {
  const board = givens.map((row) => row.slice());
  let rounds = 0;
  let usedEdges = false;
  let neededBeyondTriples = false;

  for (;;) {
    const triples = applyTriples(board);
    const counts = applyCounts(board);
    const edges = applyEdges(board, edgeMap);
    const placed = triples + counts + edges;
    if (placed === 0) break;
    if (edges > 0) usedEdges = true;
    if (counts > 0 || edges > 0) neededBeyondTriples = true;
    rounds += 1;
  }

  const solved = board.every((row) => row.every((cell) => cell !== EMPTY));
  return { solved, rounds, usedEdges, neededBeyondTriples, board };
}
