import test from "node:test";
import assert from "node:assert/strict";
import {
  challengeAward,
  countChallengeGames,
  practiceAward,
  priceGuide,
  suggestedPrice,
  weeklyEarnings,
} from "./rewardPricing.js";

// The shipped defaults, with the streak bonus raised to 100.
const RULES = {
  base_points: 6,
  minimum_points: 2,
  maximum_points: 15,
  practice_points_percent: 50,
  practice_daily_limit: 3,
  streak_weekly_bonus: 100,
};

test("a good week matches the play that was actually measured", () => {
  const { total, days } = weeklyEarnings(RULES, 6);
  // Monday carries no weekday bonus, Sunday carries two.
  assert.equal(days[0].total, 120);
  assert.equal(days[6].total, 150);
  // 972 of game income plus the streak bonus. The best player observed over
  // the twelve calibration days earned ~990 with the old bonus of 20.
  assert.equal(total, 1072);
});

test("practice is scaled against its own floor and ceiling, not the challenge one", () => {
  assert.equal(challengeAward(RULES, 0), 8);
  assert.equal(practiceAward(RULES, 0), 4);
  // A percentage this low would round under the scaled minimum, so the floor
  // has to bite rather than paying nothing for a completed round.
  assert.equal(practiceAward({ ...RULES, practice_points_percent: 10 }, 0), 1);
});

test("prices stay proportional to the week they take to earn", () => {
  assert.equal(suggestedPrice(RULES, 5, 6), 1050);
  assert.equal(suggestedPrice(RULES, 10, 6), 2150);
  // Halving practice value roughly halves the week, so everything gets cheaper
  // in step — the guide can never drift from the rules it is derived from.
  const leanWeek = weeklyEarnings({ ...RULES, practice_points_percent: 25 }, 6).total;
  assert.ok(leanWeek < 800);
  assert.ok(suggestedPrice({ ...RULES, practice_points_percent: 25 }, 5, 6) < 800);
});

test("the guide reports a per-dollar rate and a time-to-earn for each example", () => {
  const guide = priceGuide(RULES, 6);
  assert.equal(guide.perDollar, 214);
  assert.deepEqual(guide.rows.map((row) => row.dollars), [2, 5, 10, 20]);
  // A $5 item should sit near nine days for an average player.
  const five = guide.rows.find((row) => row.dollars === 5);
  assert.ok(five.averageDays > 8 && five.averageDays < 10, `got ${five.averageDays}`);
});

test("fewer challenge games means a smaller week, and a missing config is not zero", () => {
  assert.ok(weeklyEarnings(RULES, 3).total < weeklyEarnings(RULES, 6).total);
  assert.equal(countChallengeGames(null), 6);
  assert.equal(countChallengeGames({}), 6);
  assert.equal(countChallengeGames({
    hive: { available: true, challenge_enabled: true },
    zoom: { available: true, challenge_enabled: true },
    patches: { available: false, challenge_enabled: true },
    rush: { available: true, challenge_enabled: false },
  }), 2);
});
