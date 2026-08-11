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
  assert.equal(grade.rounds, 0);
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
// need no real thinking. Depth is what separates Sunday from Monday.
test("depth reports how many sweeps the chain actually took", () => {
  const shallow = board([
    [S, S, M, S, M, M],
    [M, M, S, M, S, S],
    [S, S, M, M, S, M],
    [M, S, S, M, M, S],
    [S, M, M, S, S, _],
    [M, M, S, S, M, _],
  ]);
  const grade = gradeTwistBoard(shallow, new Map());
  assert.equal(grade.solved, true);
  assert.ok(grade.rounds >= 1 && grade.rounds <= 2, `expected a shallow chain, got ${grade.rounds}`);
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
  assert.equal(grade.rounds, 0);
});
