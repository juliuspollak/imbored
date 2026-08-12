import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY, MOON, SUN, gradeTwistBoard } from "./twistLogic.js";

const board = (rows) => rows.map((row) => [...row]);
const S = SUN, M = MOON, _ = EMPTY;

test("a solved board needs no deduction at all", () => {
  const full = board([
    [S, S, M, S, M, M],
    [M, M, S, M, S, S],
    [S, S, M, M, S, M],
    [M, S, S, M, M, S],
    [S, M, M, S, S, M],
    [M, M, S, S, M, S],
  ]);
  const grade = gradeTwistBoard(full, new Map());
  assert.equal(grade.solved, true);
  assert.equal(grade.steps, 0);
});

test("two in a row forces the neighbour, and a gap forces the middle", () => {
  const grid = board([
    [S, S, _, _, _, _],
    [_, _, _, _, _, _],
    [_, _, _, _, _, _],
    [_, _, _, _, _, _],
    [_, _, _, _, _, _],
    [_, _, _, _, _, _],
  ]);
  assert.equal(gradeTwistBoard(grid, new Map()).board[0][2], MOON);

  const gap = board([[S, _, S, _, _, _], [_, _, _, _, _, _], [_, _, _, _, _, _], [_, _, _, _, _, _], [_, _, _, _, _, _], [_, _, _, _, _, _]]);
  assert.equal(gradeTwistBoard(gap, new Map()).board[0][1], MOON);
});

test("a line holding its full quota of one symbol fills with the other", () => {
  const grid = board([
    [S, M, S, M, S, _],
    [_, _, _, _, _, _],
    [_, _, _, _, _, _],
    [_, _, _, _, _, _],
    [_, _, _, _, _, _],
    [_, _, _, _, _, _],
  ]);
  // Three suns already present, so the last cell can only be a moon.
  assert.equal(gradeTwistBoard(grid, new Map()).board[0][5], MOON);
});

test("edge constraints carry a known cell across to its neighbour", () => {
  const grid = board([[S, _, _, _, _, _], [_, _, _, _, _, _], [_, _, _, _, _, _], [_, _, _, _, _, _], [_, _, _, _, _, _], [_, _, _, _, _, _]]);
  assert.equal(gradeTwistBoard(grid, new Map([["0,0|1,0", "eq"]])).board[1][0], SUN);
  assert.equal(gradeTwistBoard(grid, new Map([["0,0|1,0", "neq"]])).board[1][0], MOON);
});

// The whole point of the grader: a board can be uniquely solvable and still
// ask nothing of the player. Bottlenecks are the moments that require hunting,
// and they are what separates Sunday from Monday.
test("a board offering many moves at once has no bottlenecks", () => {
  // Only the last row missing, so every column's quota forces its final cell
  // at the same moment.
  const open = board([
    [S, S, M, S, M, M],
    [M, M, S, M, S, S],
    [S, S, M, M, S, M],
    [M, S, S, M, M, S],
    [S, M, M, S, S, M],
    [_, _, _, _, _, _],
  ]);
  const grade = gradeTwistBoard(open, new Map());
  assert.equal(grade.solved, true);
  // Every remaining cell is forced by its column quota at the same moment:
  // one wide step, nothing to search for.
  assert.ok(grade.widths[0] > 2, `expected a wide first step, got ${grade.widths[0]}`);
  assert.equal(grade.bottlenecks, 0);
});

test("a single forced cell counts as a bottleneck", () => {
  const tight = board([[S, S, _, _, _, _], [_, _, _, _, _, _], [_, _, _, _, _, _], [_, _, _, _, _, _], [_, _, _, _, _, _], [_, _, _, _, _, _]]);
  const grade = gradeTwistBoard(tight, new Map());
  assert.equal(grade.widths[0], 1);
  assert.equal(grade.tightest, 1);
  assert.ok(grade.bottlenecks >= 1);
});
test("a board the basic techniques cannot finish is reported unsolved, not guessed at", () => {
  const stuck = board([
    [_, _, _, _, _, _],
    [_, _, _, _, _, _],
    [_, _, _, _, _, _],
    [_, _, _, _, _, _],
    [_, _, _, _, _, _],
    [_, _, _, _, _, _],
  ]);
  const grade = gradeTwistBoard(stuck, new Map());
  assert.equal(grade.solved, false);
  assert.equal(grade.steps, 0);
});
