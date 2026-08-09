import test from "node:test";
import assert from "node:assert/strict";
import {
  MISSED_ROUND_PENALTY,
  buildChallengeStandings,
  compareStandings,
  fromServerStandings,
  pooledChallengeSummary,
  rankStandings,
} from "./challengeStandingsScoring.js";

const MONDAY = "2026-08-03";
const TUESDAY = "2026-08-04";
const dayIndex = (date) => (new Date(`${date}T12:00:00`).getDay() || 7) - 1;

const ROUNDS = [
  { game: "hive", date: MONDAY },
  { game: "binary", date: TUESDAY },
];
const BENCHMARKS = {
  [`hive:${dayIndex(MONDAY)}`]: 100,
  [`binary:${dayIndex(TUESDAY)}`]: 100,
};

function result(game, date, overrides = {}) {
  return { user_id: "quiet", game, challenge_date: date, seconds: 100, hints: 0, mistakes: 0, completed_at: `${date}T09:00:00Z`, ...overrides };
}

// A missed round scores nothing rather than costing points, so turning up on
// six days out of seven can never rank below turning up on none.
test("pooled summary scores what was played and does not charge for what was not", () => {
  const summary = pooledChallengeSummary(
    [result("hive", MONDAY), null],
    BENCHMARKS,
    MISSED_ROUND_PENALTY,
  );
  assert.equal(summary.played, 1);
  assert.equal(summary.score, 100 + MISSED_ROUND_PENALTY);
  assert.deepEqual(summary.dailyScores, [100, null]);
});

// Participation has to be rewarded by the sum itself, not enforced by docking
// absentees — otherwise removing the penalty would let a part-timer win.
test("playing more rounds outranks playing fewer, with no penalty doing the work", () => {
  const standings = buildChallengeStandings({
    rows: [
      result("hive", MONDAY, { user_id: "steady" }),
      result("binary", TUESDAY, { user_id: "steady" }),
      // One brilliant round beats either of Steady's individually.
      result("hive", MONDAY, { user_id: "sprinter", seconds: 40 }),
    ],
    roster: [{ id: "steady", name: "Steady" }, { id: "sprinter", name: "Sprinter" }],
    slots: [ROUNDS[0], ROUNDS[1]],
    benchmarkMap: BENCHMARKS,
    userId: "steady",
    missedPenalty: MISSED_ROUND_PENALTY,
  });
  assert.equal(MISSED_ROUND_PENALTY, 0);
  assert.equal(standings[0].userId, "steady");
  assert.equal(standings[1].userId, "sprinter");
  // Nobody's total is dragged below what they actually earned.
  assert.ok(standings.every((entry) => entry.score > 0));
});

test("standings tie-break follows score, rounds played, then hints and mistakes", () => {
  const base = { score: 100, played: 2, hints: 0, mistakes: 0, adjusted: 100, finishedAt: "a", userId: "a" };
  assert.ok(compareStandings({ ...base, score: 120 }, base) < 0);
  assert.ok(compareStandings({ ...base, played: 3 }, base) < 0);
  assert.ok(compareStandings({ ...base, hints: 1 }, base) > 0);
  assert.ok(compareStandings({ ...base, mistakes: 1 }, base) > 0);
});

test("unranked players sort last and never take a rank number", () => {
  const ranked = rankStandings([
    { userId: "c", name: "Cara", unranked: true },
    { userId: "a", name: "Ada", score: 50, played: 1, hints: 0, mistakes: 0, adjusted: 1, finishedAt: "a" },
    { userId: "b", name: "Bo", score: 90, played: 1, hints: 0, mistakes: 0, adjusted: 1, finishedAt: "b" },
  ]);
  assert.deepEqual(ranked.map((entry) => [entry.userId, entry.rank]), [["b", 1], ["a", 2], ["c", null]]);
});

// Standings list participants only. A private player's rows are stripped by
// the database before they reach the browser, so they arrive with nothing
// visible and drop out for the same reason a no-show does — no forfeit score
// is invented for either.
test("players with nothing visible are left out of the standings entirely", () => {
  const standings = buildChallengeStandings({
    rows: [{ user_id: "me", game: "hive", challenge_date: MONDAY, seconds: 100, hints: 0, mistakes: 0, completed_at: "x" }],
    roster: [
      { id: "me", name: "Me" },
      { id: "quiet", name: "Quiet" },
      { id: "absent", name: "Absent" },
    ],
    slots: ROUNDS,
    benchmarkMap: BENCHMARKS,
    userId: "me",
    missedPenalty: MISSED_ROUND_PENALTY,
  });
  assert.deepEqual(standings.map((entry) => entry.userId), ["me"]);
  assert.equal(standings[0].rank, 1);
});

test("a roster member flagged private is dropped before scoring", () => {
  const standings = buildChallengeStandings({
    rows: [result("hive", MONDAY, { user_id: "quiet" }), result("binary", TUESDAY, { user_id: "quiet" })],
    roster: [{ id: "quiet", name: "Quiet", is_private: true }],
    slots: ROUNDS,
    benchmarkMap: BENCHMARKS,
    userId: "me",
    missedPenalty: MISSED_ROUND_PENALTY,
  });
  assert.deepEqual(standings, []);
});

test("a participant whose rows are visible is ranked on those rows", () => {
  const standings = buildChallengeStandings({
    rows: [result("hive", MONDAY), result("binary", TUESDAY)],
    roster: [{ id: "quiet", name: "Quiet" }],
    slots: ROUNDS,
    benchmarkMap: BENCHMARKS,
    userId: "admin",
    missedPenalty: MISSED_ROUND_PENALTY,
  });
  assert.equal(standings[0].rank, 1);
  assert.equal(standings[0].score, 200);
  assert.equal(standings[0].played, 2);
});

test("your own results are never masked by your own privacy setting", () => {
  const standings = buildChallengeStandings({
    rows: [result("hive", MONDAY, { user_id: "quiet" })],
    roster: [{ id: "quiet", name: "Quiet", show_stats_to_others: false }],
    slots: [ROUNDS[0]],
    benchmarkMap: BENCHMARKS,
    userId: "quiet",
    missedPenalty: MISSED_ROUND_PENALTY,
  });
  assert.equal(standings[0].isPrivate, false);
  assert.equal(standings[0].score, 100);
  assert.equal(standings[0].dailyResults[0].is_private, undefined);
});

function serverRow(overrides = {}) {
  return {
    member_id: "a",
    member_name: "Ada",
    member_icon: "🙂",
    standing_rank: 1,
    challenge_score: 200,
    rounds_played: 2,
    rounds_total: 3,
    is_private: false,
    round_scores: [
      { challenge_date: MONDAY, game: "hive", score: 100 },
      { challenge_date: TUESDAY, game: "binary", score: 100 },
      { challenge_date: "2026-08-05", game: "hive", score: null },
    ],
    ...overrides,
  };
}

test("server standings are rendered in the order and score the database gave", () => {
  const [player] = fromServerStandings([serverRow()], "me");
  assert.equal(player.rank, 1);
  assert.equal(player.score, 200);
  assert.equal(player.played, 2);
  assert.equal(player.missed, 1);
  assert.equal(player.unranked, false);
  assert.equal(player.isCurrentUser, false);
  assert.deepEqual(player.dailyScores, [100, 100, null]);
});

// The per-round tiles used to be recomputed in the browser and could not be
// reconciled with the headline. Both now come from the same server row.
test("per-round tiles reconcile with the headline score", () => {
  const [player] = fromServerStandings([serverRow()], "me");
  const fromTiles = player.dailyScores.reduce(
    (total, score) => total + (score == null ? MISSED_ROUND_PENALTY : score),
    0,
  );
  assert.equal(fromTiles, player.score);
});

test("a private player is dropped from server standings, but never your own row", () => {
  assert.deepEqual(
    fromServerStandings([serverRow({ member_id: "quiet", is_private: true, round_scores: null })], "me"),
    [],
  );
  // The RPC computes is_private as "someone else, and hidden", so your own row
  // always arrives visible even when you have stats hidden from everyone else.
  const [mine] = fromServerStandings([serverRow({ member_id: "me", is_private: false })], "me");
  assert.equal(mine.isCurrentUser, true);
});

test("players who have not started are left out of server standings", () => {
  assert.deepEqual(
    fromServerStandings([serverRow({ rounds_played: 0, round_scores: null })], "me"),
    [],
  );
});

test("your own row is marked so the standings can label it", () => {
  const [player] = fromServerStandings([serverRow({ member_id: "me" })], "me");
  assert.equal(player.isCurrentUser, true);
  assert.equal(player.isPrivate, false);
});

test("circle rounds match on day and game, the personal challenge on game alone", () => {
  const rows = [result("hive", TUESDAY, { user_id: "p" })];
  const roster = [{ id: "p", name: "P", show_stats_to_others: true }];
  const onWrongDay = buildChallengeStandings({
    rows, roster, slots: [{ game: "hive", date: MONDAY }], benchmarkMap: BENCHMARKS, userId: "me", missedPenalty: MISSED_ROUND_PENALTY,
  });
  const anyDay = buildChallengeStandings({
    rows, roster, slots: [{ game: "hive" }], benchmarkMap: BENCHMARKS, userId: "me",
  });
  assert.deepEqual(onWrongDay, []);
  assert.equal(anyDay[0].played, 1);
});

test("the card shows the top five, plus your own row when you place below them", () => {
  const rows = (id, score) => ({ member_id: id, member_name: id, member_icon: "🙂", standing_rank: score, challenge_score: 1000 - score, rounds_played: 3, rounds_total: 3, is_private: false, round_scores: [] });
  const seven = ["a", "b", "c", "d", "e", "f", "me"].map((id, index) => rows(id, index + 1));

  const asStranger = fromServerStandings(seven, "nobody");
  assert.deepEqual(asStranger.map((entry) => entry.userId), ["a", "b", "c", "d", "e"]);

  const asMe = fromServerStandings(seven, "me");
  assert.deepEqual(asMe.map((entry) => entry.userId), ["a", "b", "c", "d", "e", "me"]);
  assert.equal(asMe.at(-1).rank, 7);
});

test("a top-five finisher is not duplicated at the end of their own card", () => {
  const rows = ["me", "b", "c"].map((id, index) => ({ member_id: id, member_name: id, member_icon: "🙂", standing_rank: index + 1, challenge_score: 100 - index, rounds_played: 2, rounds_total: 3, is_private: false, round_scores: [] }));
  assert.deepEqual(fromServerStandings(rows, "me").map((entry) => entry.userId), ["me", "b", "c"]);
});
