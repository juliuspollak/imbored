import test from "node:test";
import assert from "node:assert/strict";
import { pooledChallengeSummary } from "./lib/challengeStandingsScoring.js";

const benchmarks = { "minisudoku:0": 240, "binary:1": 100 };

test("scores private results from their real values and only masks their display", () => {
  const result = {
    game: "minisudoku",
    challenge_date: "2026-07-27",
    seconds: 200,
    hints: 0,
    mistakes: 0,
    is_private: true,
  };
  const summary = pooledChallengeSummary([result], benchmarks, -100);
  assert.equal(summary.score, 120);
  assert.deepEqual(summary.dailyScores, [120]);
});

test("uses the server's missed-round penalty for circle totals", () => {
  const played = {
    game: "binary",
    challenge_date: "2026-07-28",
    seconds: 100,
    hints: 0,
    mistakes: 0,
  };
  assert.equal(pooledChallengeSummary([played, null], benchmarks, -100).score, 0);
});

test("daily scores and the headline use the same game benchmark", () => {
  const result = {
    game: "minisudoku",
    challenge_date: "2026-07-27",
    seconds: 200,
    hints: 0,
    mistakes: 0,
  };
  const summary = pooledChallengeSummary([result], benchmarks, -100);
  assert.equal(summary.score, summary.dailyScores[0]);
  assert.equal(summary.score, 120);
});
