import test from "node:test";
import assert from "node:assert/strict";
import { answerAccuracy, challengeScore, effectiveSeconds, roundInefficiency, reportsAnswers, MIN_DAILY_SCORE, performanceAdjustment, scoredSeconds, weekdayBonus } from "./performanceScoring.js";

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

test("a quiz reports its accuracy under either naming", () => {
  assert.equal(answerAccuracy({}), 1);
  assert.equal(answerAccuracy({ correct_count: 3, total_count: 9 }), 1 / 3);
  assert.equal(answerAccuracy({ correctCount: 9, totalCount: 9 }), 1);
  assert.equal(answerAccuracy({ correct_count: 0, total_count: 9 }), 0);
  assert.equal(answerAccuracy({ correct_count: 5, total_count: 0 }), 1);
});

test("weekday progression is modest and monotonic", () => {
  assert.deepEqual(Array.from({ length: 7 }, (_, day) => weekdayBonus(day)), [0, 0, 1, 1, 1, 2, 2]);
});


// A measured profile: the game's typical effective time and the spread of it.
// Zoom's real shape from the simulation, rounded.
const ZOOM = { seconds: 27, logMean: 4.32, logSd: 1.05 };
const HIVE = { seconds: 14, logMean: 2.69, logSd: 0.44 };

// The whole point of scoring against the spread: a game's time scale stops
// mattering. Playing at exactly the typical pace earns 100 in every game,
// whether that pace is 15 seconds or 75.
test('typical play scores 100 in every game, whatever its time scale', () => {
  for (const profile of [ZOOM, HIVE]) {
    const typicalEffective = Math.exp(profile.logMean);
    assert.equal(challengeScore({ seconds: typicalEffective }, profile).score, 100);
  }
});

// Cross-game fairness, the defect this replaced: equally-standing players in
// different games must score alike. A quiz round at its typical pace and
// typical accuracy has to land where a puzzle round at its typical pace does.
test('a quiz round and a puzzle round of equal standing score alike', () => {
  const puzzle = challengeScore({ seconds: Math.exp(HIVE.logMean) }, HIVE).score;
  const quizTypical = Math.exp(ZOOM.logMean) * (5 / 9) ** 2;   // typical pace at 5 of 9
  const quiz = challengeScore({ seconds: quizTypical, correct_count: 5, total_count: 9 }, ZOOM).score;
  assert.equal(puzzle, 100);
  assert.equal(quiz, 100);
});

// The abuse this whole line of work started from: tap through a quiz fast,
// get almost nothing right, keep the points.
test('rushing a quiz badly cannot beat playing it honestly', () => {
  const rushed = challengeScore({ seconds: 12, correct_count: 1, total_count: 9 }, ZOOM).score;
  const honest = challengeScore({ seconds: 27, correct_count: 5, total_count: 9 }, ZOOM).score;
  const good = challengeScore({ seconds: 22, correct_count: 8, total_count: 9 }, ZOOM).score;
  assert.ok(rushed < honest, `rushed ${rushed} must lose to honest ${honest}`);
  assert.ok(honest < good, `honest ${honest} must lose to good ${good}`);
});

test('a round with nothing correct scores zero, however fast', () => {
  for (const seconds of [1, 5, 12, 40]) {
    assert.equal(challengeScore({ seconds, correct_count: 0, total_count: 9 }, ZOOM).score, 0);
  }
  assert.equal(effectiveSeconds({ seconds: 12, correct_count: 0, total_count: 9 }, 27), null);
});

test('more correct answers always score higher at the same pace', () => {
  let previous = -1;
  for (let correct = 1; correct <= 9; correct += 1) {
    const score = challengeScore({ seconds: 30, correct_count: correct, total_count: 9 }, ZOOM).score;
    assert.ok(score > previous, `${correct}/9 scored ${score}, not above ${previous}`);
    previous = score;
  }
});

test('faster is never worth fewer points', () => {
  for (const profile of [ZOOM, HIVE]) {
    let previous = 151;
    for (let seconds = 2; seconds <= 200; seconds += 1) {
      const score = challengeScore({ seconds, correct_count: 9, total_count: 9 }, profile).score;
      assert.ok(score <= previous, `${seconds}s scored ${score}, above the faster ${previous}`);
      previous = score;
    }
  }
});

// An ungraded puzzle has no accuracy, so its slips must still cost time.
test('an ungraded puzzle still pays for its mistakes, a graded one does not', () => {
  const clean = effectiveSeconds({ seconds: 40 }, 28);
  const slipped = effectiveSeconds({ seconds: 40, mistakes: 4 }, 28);
  assert.ok(slipped > clean, 'a puzzle mistake costs time');
  // The graded round's mistakes are the wrong answers, already in the divisor.
  const graded = effectiveSeconds({ seconds: 40, mistakes: 4, correct_count: 5, total_count: 9 }, 27);
  const gradedNoMistakeField = effectiveSeconds({ seconds: 40, correct_count: 5, total_count: 9 }, 27);
  assert.equal(graded, gradedNoMistakeField, 'a graded round is not charged twice');
});

test('a game with no measured spread falls back to the ratio rule and its floor', () => {
  const result = challengeScore({ seconds: 70 }, 100);
  assert.equal(result.spreads, null);
  assert.equal(result.score, 143);
  assert.equal(challengeScore({ seconds: 10000 }, 100).score, MIN_DAILY_SCORE);
});

// Two thirds of real rounds have no mistakes and no hints, so for the pure
// puzzles the clock was the only thing being measured. These are the one
// non-speed signal those games already record, and they have to be worth
// something for a clean round to beat a scrappy one of the same length.
test('a hint and a mistake cost a challenge round real ground', () => {
  // Binary's live profile. Measured spread, not the ratio fallback — the
  // fallback's 45 floor squashes the gap and is not the path that ships.
  const BINARY = { seconds: 28, logMean: Math.log(48.5), logSd: 0.35 };
  const clean = challengeScore({ seconds: 51 }, BINARY);
  const messy = challengeScore({ seconds: 51, mistakes: 4 }, BINARY);
  assert.ok(clean.score - messy.score >= 25,
    `four mistakes moved the score by only ${clean.score - messy.score} points`);
  assert.equal(effectiveSeconds({ seconds: 51, mistakes: 4 }, 28), 51 + 4 * 28 * 0.25);
  assert.equal(effectiveSeconds({ seconds: 51, hints: 2 }, 28), 51 + 2 * 28 * 0.35);
});

// The points economy prices the same events separately; moving the challenge
// costs must not drag everyone's balances with it.
test('the points economy keeps its own hint and mistake prices', () => {
  assert.equal(scoredSeconds({ seconds: 60, hints: 1, mistakes: 1, typicalSeconds: 100 }), 90);
});

// Gridly records backtracked cells against required moves - the only signal any
// puzzle game has beyond the clock. 0 means the route was planned, 119 on a
// 48-move board means it was brute-forced.
test('route planning counts, not just pace', () => {
  const GRIDLY = { seconds: 6, logMean: Math.log(21.4), logSd: 0.45 };
  const at = (seconds, backtracked) => challengeScore(
    { seconds, zip_backtracked_cells: backtracked, zip_required_moves: 48 }, GRIDLY).score;

  // Same time, different amounts of flailing.
  assert.ok(at(12, 0) > at(12, 15), 'a planned route beats a typical one');
  assert.ok(at(12, 15) > at(12, 50), 'heavy backtracking costs');
  assert.ok(at(12, 50) > at(12, 119), 'brute force costs more still');

  // The point of the whole exercise: thinking can beat hurrying.
  assert.ok(at(20, 0) > at(8, 50),
    `slow and clean (${at(20, 0)}) must beat fast and scrappy (${at(8, 50)})`);
});

test('games that record no efficiency signal are untouched', () => {
  const HIVE = { seconds: 14, logMean: Math.log(16.9), logSd: 0.35 };
  assert.equal(roundInefficiency({ seconds: 14 }), 0);
  assert.equal(roundInefficiency({ zip_backtracked_cells: 5, zip_required_moves: 0 }), 0);
  assert.equal(challengeScore({ seconds: 14 }, HIVE).score,
               challengeScore({ seconds: 14, zip_backtracked_cells: null }, HIVE).score);
});

// Hive, Twist and Sudoku had zero mistakes across 29 real rounds, so their
// score was pace and nothing else. All three track an undo stack that never
// reached the database; an undo is work placed and then taken back, the same
// signal Gridly gets from backtracking.
test('undos count for the puzzles that record no mistakes', () => {
  const HIVE = { seconds: 14, logMean: Math.log(21), logSd: 0.35 };
  const at = (seconds, undos) => challengeScore(
    { seconds, wasted_moves: undos, expected_moves: 25 }, HIVE).score;
  assert.ok(at(14, 0) > at(14, 2), 'a clean solve beats one with rework');
  assert.ok(at(14, 2) > at(14, 6));
  assert.ok(at(14, 6) > at(14, 15));
  assert.ok(at(14, 0) - at(14, 15) > 50, 'rework has to be worth real points');
});

// Rounds saved before the columns existed must score exactly as they did.
test('rounds with no recorded rework are unaffected', () => {
  const HIVE = { seconds: 14, logMean: Math.log(21), logSd: 0.35 };
  assert.equal(roundInefficiency({ seconds: 14 }), 0);
  assert.equal(roundInefficiency({ wasted_moves: 3, expected_moves: null }), 0);
  assert.equal(challengeScore({ seconds: 14 }, HIVE).score,
               challengeScore({ seconds: 14, wasted_moves: null, expected_moves: null }, HIVE).score);
});

// The generic pair wins over Gridly's older columns when both are present.
test('the generic rework columns take precedence over Gridly-specific ones', () => {
  assert.equal(roundInefficiency({
    wasted_moves: 5, expected_moves: 50,
    zip_backtracked_cells: 40, zip_required_moves: 48,
  }), 0.1);
});
