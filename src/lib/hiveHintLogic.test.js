import test from "node:test";
import assert from "node:assert/strict";
import { findCompletionForcedStep } from "./hiveHintLogic.js";

const regionsByColumn = Array.from({ length: 4 }, () => [0, 1, 2, 3]);

test("an almost-empty uniquely constrained Hive board suggests an elimination before a bee", () => {
  const board = Array.from({ length: 4 }, () => Array(4).fill(0));
  board[0][2] = 1; // excludes one of the two classic 4x4 queen arrangements
  const step = findCompletionForcedStep(board, regionsByColumn);
  assert.equal(step?.type, "cross");
  assert.equal(step?.src, "completion-elimination");
});

test("an ambiguous board only suggests cells excluded by every valid completion", () => {
  const board = Array.from({ length: 4 }, () => Array(4).fill(0));
  const step = findCompletionForcedStep(board, regionsByColumn);
  assert.equal(step?.type, "cross");
  assert.equal(step && board[step.r][step.c], 0);
});

test("a bee is suggested only after all remaining alternatives are eliminated", () => {
  const solution = [1, 3, 0, 2];
  const board = Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => c === solution[r] ? 0 : 1));
  const step = findCompletionForcedStep(board, regionsByColumn);
  assert.equal(step?.type, "bee");
  assert.deepEqual([step?.r, step?.c], [0, 1]);
});

test("contradictory player marks do not produce a fabricated hint", () => {
  const board = Array.from({ length: 4 }, () => Array(4).fill(1));
  assert.equal(findCompletionForcedStep(board, regionsByColumn), null);
});
