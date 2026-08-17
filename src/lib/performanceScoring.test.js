import test from "node:test";
import assert from "node:assert/strict";
import { answerAccuracy, challengeScore, reportsAnswers, performanceAdjustment, scoredSeconds, weekdayBonus } from "./performanceScoring.js";

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
  assert.equal(performanceAdjustment({ seconds: 50 }, 100), 4);
  assert.equal(performanceAdjustment({ seconds: 100 }, 100), 0);
  assert.equal(performanceAdjustment({ seconds: 200 }, 100), -4);
  assert.equal(performanceAdjustment({ seconds: 70, hints: 1, mistakes: 1 }, 100), 0);
});

test("challenge score uses the same penalties and rewards completion", () => {
  assert.deepEqual(challengeScore({ seconds: 70, hints: 1, mistakes: 1 }, 100), { adjusted: 100, accuracy: 1, speedScore: 100, score: 100 });
  assert.equal(challengeScore({ seconds: 1 }, 100).score, 150);
  assert.equal(challengeScore({ seconds: 1000 }, 100).score, 45);
});

test("missing benchmarks use the same 100-second fallback as PostgreSQL", () => {
  assert.equal(scoredSeconds({ seconds: 70, hints: 1, mistakes: 1 }), 100);
  assert.deepEqual(challengeScore({ seconds: 70, hints: 1, mistakes: 1 }), { adjusted: 100, accuracy: 1, speedScore: 100, score: 100 });
});

// The cap used to swallow the accuracy penalty whole: scaling before the clamp
// left a fast round above 150 even with an answer wrong, so it still read 150.
test("a wrong answer shows up even on a run fast enough to cap", () => {
  const flawlessAndFast = challengeScore({ seconds: 60, correct_count: 9, total_count: 9 }, 165);
  const oneWrongAndFast = challengeScore({ seconds: 60, mistakes: 1, correct_count: 8, total_count: 9 }, 165);
  assert.equal(flawlessAndFast.score, 150);
  assert.equal(oneWrongAndFast.speedScore, 150, "both runs cap on speed");
  assert.equal(oneWrongAndFast.score, 133, "but only the flawless one keeps the full 150");
});

test("only a flawless round can reach the maximum, however fast", () => {
  for (const seconds of [1, 5, 30, 60]) {
    assert.equal(challengeScore({ seconds, correct_count: 9, total_count: 9 }, 165).score, 150);
    assert.ok(challengeScore({ seconds, correct_count: 8, total_count: 9 }, 165).score < 150);
  }
});

test("a quiz reports its accuracy under either naming", () => {
  assert.equal(answerAccuracy({}), 1);
  assert.equal(answerAccuracy({ correct_count: 3, total_count: 9 }), 1 / 3);
  assert.equal(answerAccuracy({ correctCount: 9, totalCount: 9 }), 1);
  assert.equal(answerAccuracy({ correct_count: 0, total_count: 9 }), 0);
  assert.equal(answerAccuracy({ correct_count: 5, total_count: 0 }), 1);
});

// The bug this replaced: a wrong answer ends a Zoom round early, so quitting
// fast scored the 150 cap while a careful correct run scored less.
test("bailing out of a quiz can no longer beat playing it properly", () => {
  const wipeoutInTenSeconds = challengeScore({ seconds: 10, mistakes: 3, correct_count: 0, total_count: 9 }, 100);
  const carefulRun = challengeScore({ seconds: 120, mistakes: 0, correct_count: 9, total_count: 9 }, 100);
  assert.equal(wipeoutInTenSeconds.score, 0);
  assert.ok(carefulRun.score > wipeoutInTenSeconds.score);
});

test("completion floor is still scaled by quiz accuracy", () => {
  const slowPerfect = challengeScore({ seconds: 1000, correct_count: 9, total_count: 9 }, 100);
  const slowHalfCorrect = challengeScore({ seconds: 1000, correct_count: 5, total_count: 10 }, 100);
  const slowWipeout = challengeScore({ seconds: 1000, correct_count: 0, total_count: 10 }, 100);
  assert.equal(slowPerfect.score, 45);
  assert.equal(slowHalfCorrect.score, 23);
  assert.equal(slowWipeout.score, 0);
});

test("accuracy and speed both move the score", () => {
  const perfect = challengeScore({ seconds: 100, correct_count: 9, total_count: 9 }, 100).score;
  const twoThirds = challengeScore({ seconds: 100, correct_count: 6, total_count: 9 }, 100).score;
  assert.equal(perfect, 100);
  assert.equal(twoThirds, 67);
});

test("weekday progression is modest and monotonic", () => {
  assert.deepEqual(Array.from({ length: 7 }, (_, day) => weekdayBonus(day)), [0, 0, 1, 1, 1, 2, 2]);
});

// A quiz game's mistakes are its wrong answers, so charging them as penalty
// seconds as well as a lower accuracy share billed one set of errors twice.
test("a graded round is penalised by accuracy, not by accuracy plus a time charge", () => {
  // Real row: Geo, 17s, 1 wrong, 4 of 5 correct, 15s benchmark.
  const geo = { seconds: 17, mistakes: 1, correct_count: 4, total_count: 5 };
  assert.ok(reportsAnswers(geo));
  assert.equal(challengeScore(geo, 15).adjusted, 17, "the clock reads 17s, not 17 + 15*0.10");
  assert.equal(challengeScore(geo, 15).score, 70);

  // An ungraded game still pays for its mistakes in time — its only penalty.
  const binary = { seconds: 51, mistakes: 4, hints: 1 };
  assert.equal(reportsAnswers(binary), false);
  assert.equal(challengeScore(binary, 28).adjusted, 67.8);
});

test("hints still cost time on a graded round", () => {
  const withHint = challengeScore({ seconds: 20, hints: 1, correct_count: 5, total_count: 5 }, 15);
  const without = challengeScore({ seconds: 20, hints: 0, correct_count: 5, total_count: 5 }, 15);
  assert.ok(withHint.score < without.score, "a hint shortens the round, so it is charged");
});
