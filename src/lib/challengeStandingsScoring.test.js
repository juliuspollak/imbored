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
  { game: "tango", date: TUESDAY },
];
const BENCHMARKS = {
  [`hive:${dayIndex(MONDAY)}`]: 100,
  [`tango:${dayIndex(TUESDAY)}`]: 100,
};

function result(game, date, overrides = {}) {
  return { user_id: "quiet", game, challenge_date: date, seconds: 100, hints: 0, mistakes: 0, completed_at: `${date}T09:00:00Z`, ...overrides };
}

test("pooled summary scores what was played and charges the penalty for what was not", () => {
  const summary = pooledChallengeSummary(
    [result("hive", MONDAY), null],
    BENCHMARKS,
    MISSED_ROUND_PENALTY,
  );
  assert.equal(summary.played, 1);
  assert.equal(summary.score, 100 + MISSED_ROUND_PENALTY);
  assert.deepEqual(summary.dailyScores, [100, null]);
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

// The database strips a private player's rows before they reach the browser,
// so "no results" and "missed every round" look identical on the client. The
// standings must not read that silence as a forfeit.
test("a player who hides their stats is left unranked, not scored as absent", () => {
  const standings = buildChallengeStandings({
    rows: [{ user_id: "me", game: "hive", challenge_date: MONDAY, seconds: 100, hints: 0, mistakes: 0, completed_at: "x" }],
    roster: [
      { id: "me", name: "Me", show_stats_to_others: true },
      { id: "quiet", name: "Quiet", show_stats_to_others: false },
    ],
    slots: ROUNDS,
    benchmarkMap: BENCHMARKS,
    userId: "me",
    missedPenalty: MISSED_ROUND_PENALTY,
  });
  const quiet = standings.find((entry) => entry.userId === "quiet");

  assert.equal(quiet.unranked, true);
  assert.equal(quiet.rank, null);
  assert.equal(quiet.score, null);
  assert.notEqual(quiet.score, ROUNDS.length * MISSED_ROUND_PENALTY);
  assert.equal(standings.find((entry) => entry.userId === "me").rank, 1);
});

test("a player who is visible but absent is still charged for missed rounds", () => {
  const standings = buildChallengeStandings({
    rows: [],
    roster: [{ id: "absent", name: "Absent", show_stats_to_others: true }],
    slots: ROUNDS,
    benchmarkMap: BENCHMARKS,
    userId: "me",
    missedPenalty: MISSED_ROUND_PENALTY,
  });
  assert.deepEqual(
    { unranked: standings[0].unranked, score: standings[0].score, played: standings[0].played },
    { unranked: false, score: ROUNDS.length * MISSED_ROUND_PENALTY, played: 0 },
  );
});

// Admins can read private rows, so when the data does arrive the player is a
// real competitor again — only the per-round detail stays masked.
test("a private player whose rows are visible is ranked, with per-round detail masked", () => {
  const standings = buildChallengeStandings({
    rows: [result("hive", MONDAY), result("tango", TUESDAY)],
    roster: [{ id: "quiet", name: "Quiet", show_stats_to_others: false }],
    slots: ROUNDS,
    benchmarkMap: BENCHMARKS,
    userId: "admin",
    missedPenalty: MISSED_ROUND_PENALTY,
  });
  assert.equal(standings[0].unranked, false);
  assert.equal(standings[0].rank, 1);
  assert.equal(standings[0].score, 200);
  assert.ok(standings[0].dailyResults.every((entry) => entry.is_private));
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
    challenge_score: 100,
    rounds_played: 2,
    rounds_total: 3,
    is_private: false,
    round_scores: [
      { challenge_date: MONDAY, game: "hive", score: 100 },
      { challenge_date: TUESDAY, game: "tango", score: 100 },
      { challenge_date: "2026-08-05", game: "hive", score: null },
    ],
    ...overrides,
  };
}

test("server standings are rendered in the order and score the database gave", () => {
  const [player] = fromServerStandings([serverRow()], "me");
  assert.equal(player.rank, 1);
  assert.equal(player.score, 100);
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

test("a private player keeps a real rank and score, with only per-round detail withheld", () => {
  const [player] = fromServerStandings(
    [serverRow({ member_id: "quiet", member_name: "Quiet", is_private: true, round_scores: null })],
    "me",
  );
  assert.equal(player.unranked, false);
  assert.equal(player.rank, 1);
  assert.equal(player.score, 100);
  assert.equal(player.played, 2);
  assert.equal(player.detailHidden, true);
  assert.deepEqual(player.dailyScores, []);
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
  assert.equal(onWrongDay[0].played, 0);
  assert.equal(anyDay[0].played, 1);
});
