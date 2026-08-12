// How much *thinking* a Twist board actually needs.
//
// First attempt at this counted solver sweeps. That was the wrong measure: one
// sweep can place fifteen cells, so a board could score "deep" while never
// asking the player anything — which is exactly how Sunday played, solvable in
// half a minute by following obvious placements.
//
// What makes these puzzles hard is bottlenecks. An easy board offers ten
// legal deductions at every moment and you just keep picking them off. A hard
// one repeatedly narrows to a single deducible cell that has to be hunted for.
// So we solve the way a person does, and at each step record how many moves
// were available. The count of near-forced steps is the difficulty.

export const SIZE = 6;
export const HALF = SIZE / 2;
export const EMPTY = 0, SUN = 1, MOON = 2;

// A step offering this many moves or fewer is a bottleneck: the player has to
// search for it rather than spot it.
export const BOTTLENECK_WIDTH = 2;

const other = (value) => (value === SUN ? MOON : SUN);

export function edgeKey(r1, c1, r2, c2) {
  if (r1 > r2 || (r1 === r2 && c1 > c2)) [r1, c1, r2, c2] = [r2, c2, r1, c1];
  return `${r1},${c1}|${r2},${c2}`;
}

const at = (board, index, i, isRow) => (isRow ? board[index][i] : board[i][index]);
const coord = (index, i, isRow) => (isRow ? [index, i] : [i, index]);

// Every cell whose value is forced by a technique a player can see, without
// placing anything. Returned as a de-duplicated list so its length is a
// faithful measure of how many moves are on offer right now.
export function collectDeductions(board, edgeMap) {
  const found = new Map();
  const add = (r, c, value) => {
    if (board[r][c] === EMPTY) found.set(`${r},${c}`, { r, c, value });
  };

  for (let index = 0; index < SIZE; index += 1) {
    for (const isRow of [true, false]) {
      const cells = Array.from({ length: SIZE }, (unused, i) => at(board, index, i, isRow));

      // Two alike force the neighbours; a gap between two alike forces the middle.
      for (let i = 0; i + 2 < SIZE; i += 1) {
        const a = cells[i], b = cells[i + 1], c = cells[i + 2];
        if (a !== EMPTY && a === b && c === EMPTY) add(...coord(index, i + 2, isRow), other(a));
        if (b !== EMPTY && b === c && a === EMPTY) add(...coord(index, i, isRow), other(b));
        if (a !== EMPTY && a === c && b === EMPTY) add(...coord(index, i + 1, isRow), other(a));
      }

      // A line already holding its full quota of one symbol.
      for (const value of [SUN, MOON]) {
        if (cells.filter((cell) => cell === value).length !== HALF) continue;
        for (let i = 0; i < SIZE; i += 1) {
          if (cells[i] === EMPTY) add(...coord(index, i, isRow), other(value));
        }
      }
    }
  }

  // = and x signs carry a known cell across to its neighbour.
  for (const [key, type] of edgeMap) {
    const [left, right] = key.split("|");
    const [r1, c1] = left.split(",").map(Number);
    const [r2, c2] = right.split(",").map(Number);
    const a = board[r1][c1], b = board[r2][c2];
    if (a !== EMPTY && b === EMPTY) add(r2, c2, type === "eq" ? a : other(a));
    else if (b !== EMPTY && a === EMPTY) add(r1, c1, type === "eq" ? b : other(b));
  }

  return [...found.values()];
}

/**
 * Solves with human techniques and reports how demanding the route was.
 *
 * `bottlenecks` — steps offering at most BOTTLENECK_WIDTH moves. This is the
 * difficulty signal: it counts the moments the player has to search.
 * `tightest` — the narrowest step seen, 1 meaning a single forced cell.
 * `solved` is false when the techniques stall, which means the board needs
 * trial and error; those are rejected rather than prized.
 */
export function gradeTwistBoard(givens, edgeMap) {
  const board = givens.map((row) => row.slice());
  const widths = [];

  for (;;) {
    const moves = collectDeductions(board, edgeMap);
    if (moves.length === 0) break;
    widths.push(moves.length);
    for (const { r, c, value } of moves) board[r][c] = value;
  }

  const solved = board.every((row) => row.every((cell) => cell !== EMPTY));
  const bottlenecks = widths.filter((width) => width <= BOTTLENECK_WIDTH).length;
  return {
    solved,
    steps: widths.length,
    widths,
    bottlenecks,
    tightest: widths.length ? Math.min(...widths) : 0,
    board,
  };
}
