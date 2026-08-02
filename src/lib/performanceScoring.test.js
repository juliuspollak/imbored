import test from "node:test";
import assert from "node:assert/strict";
import { challengeScore, performanceAdjustment, scoredSeconds, weekdayBonus } from "./performanceScoring.js";

test("penalties scale with the puzzle's typical time", () => {
  assert.equal(scoredSeconds({ seconds: 60, hints: 1, mistakes: 1, typicalSeconds: 100 }), 90);
  assert.equal(scoredSeconds({ seconds: 120, hints: 1, mistakes: 1, typicalSeconds: 200 }), 180);
});

test("every hint, mistake, and extra second makes a result no better", () => {
  for (const typical of [12, 30, 60, 180, 600]) {
    for (const seconds of [5, typical * 0.5, typical, typical * 2]) {
      const base = scoredSeconds({ seconds, typicalSeconds: typical });
      assert.ok(scoredSeconds({ seconds: seconds + 1, typicalSeconds: typical }) > base);
      assert.ok(scoredSeconds({ seconds, hints: 1, typicalSeconds: typical }) > base);
      assert.ok(scoredSeconds({ seconds, mistakes: 1, typicalSeconds: typical }) > base);
    }
  }
});

test("performance adjustment is bounded and based on scored time", () => {
  assert.equal(performanceAdjustment({ seconds: 50 }, 100), 3);
  assert.equal(performanceAdjustment({ seconds: 100 }, 100), 0);
  assert.equal(performanceAdjustment({ seconds: 200 }, 100), -3);
  assert.equal(performanceAdjustment({ seconds: 70, hints: 1, mistakes: 1 }, 100), 0);
});

test("challenge score uses the same penalties", () => {
  assert.deepEqual(challengeScore({ seconds: 70, hints: 1, mistakes: 1 }, 100), { adjusted: 100, score: 100 });
  assert.equal(challengeScore({ seconds: 1 }, 100).score, 150);
  assert.equal(challengeScore({ seconds: 1000 }, 100).score, 20);
});

test("weekday progression is modest and monotonic", () => {
  assert.deepEqual(Array.from({ length: 7 }, (_, day) => weekdayBonus(day)), [0, 1, 1, 2, 2, 3, 3]);
});
