import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  challengeScore, roundInefficiency,
  CHALLENGE_HINT_COST, CHALLENGE_MISTAKE_COST, INEFFICIENCY_COST, ACCURACY_EXPONENT,
  TYPICAL_SCORE, SPREAD_POINTS, SCORE_FLOOR, MAX_DAILY_SCORE, MIN_DAILY_SCORE,
} from "./performanceScoring.js";

// A challenge round is scored twice: here in the browser for the personal
// challenge, and in circle_challenge_daily_score() for circles. The two must
// agree exactly or the same play scores differently depending on which screen
// you are on. They drifted repeatedly while this scoring was being built, and
// nothing caught it - the failures were found by hand each time.
//
// These tests read the SQL and check it against the JavaScript, so a constant
// changed on one side and not the other fails the build.

const schema = readFileSync(new URL("../../supabase/schemas/public.sql", import.meta.url), "utf8");

function sqlBody(name) {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`);
  assert.ok(start > 0, `${name} missing from the schema`);
  const end = schema.indexOf("$$;", start);
  return schema.slice(start, end);
}

test("the SQL and JavaScript price a hint, a mistake and rework identically", () => {
  const effective = sqlBody("effective_round_seconds");
  const hint = effective.match(/hint_count,0\)\)\*coalesce\(benchmark_seconds,100\)\*([\d.]+)/);
  const mistake = effective.match(/mistake_count,0\)\)\*coalesce\(benchmark_seconds,100\)\*([\d.]+)/);
  const rework = effective.match(/inefficiency,0\)\)\*([\d.]+)/);
  assert.ok(hint && mistake && rework, "could not read the costs out of the SQL");
  assert.equal(Number(hint[1]), CHALLENGE_HINT_COST);
  assert.equal(Number(mistake[1]), CHALLENGE_MISTAKE_COST);
  assert.equal(Number(rework[1]), INEFFICIENCY_COST);
  // Accuracy is squared on both sides; SQL spells it as a self-multiplication.
  assert.ok(effective.includes("share.accuracy * share.accuracy"), "SQL accuracy exponent changed");
  assert.equal(ACCURACY_EXPONENT, 2);
});

test("the SQL and JavaScript use the same scale and clamps", () => {
  const score = sqlBody("circle_challenge_daily_score");
  const measured = score.match(/greatest\((\d+),least\((\d+),round\(\s*(\d+) \+ (\d+)\*/);
  assert.ok(measured, "could not read the measured-path scale out of the SQL");
  assert.equal(Number(measured[1]), SCORE_FLOOR);
  assert.equal(Number(measured[2]), MAX_DAILY_SCORE);
  assert.equal(Number(measured[3]), TYPICAL_SCORE);
  assert.equal(Number(measured[4]), SPREAD_POINTS);
  // The unmeasured fallback keeps the older floor.
  const fallback = score.match(/greatest\((\d+),least\((\d+),round\(\s*100\*/);
  assert.ok(fallback, "could not read the fallback out of the SQL");
  assert.equal(Number(fallback[1]), MIN_DAILY_SCORE);
});

test("round_inefficiency clamps the same way on both sides", () => {
  const sql = sqlBody("round_inefficiency");
  const cap = sql.match(/least\((\d+),/);
  assert.ok(cap, "could not read the inefficiency cap out of the SQL");
  assert.equal(Number(cap[1]), 4);
  assert.equal(roundInefficiency({ wasted_moves: 1000, expected_moves: 10 }), 4);
});

// A transcription of the SQL, kept deliberately literal so it can be read
// against the migration side by side. If the SQL changes, this changes with it
// and the sweep below proves the two still agree.
function sqlScore(profile, row) {
  const bench = profile.seconds ?? 100;
  const total = row.total_count ?? 0;
  const accuracy = total <= 0 ? 1 : Math.min(1, Math.max(0, row.correct_count ?? 0) / total);
  if (accuracy <= 0) return 0;
  const required = row.expected_moves ?? row.zip_required_moves ?? 0;
  const wasted = row.wasted_moves ?? row.zip_backtracked_cells ?? 0;
  const inefficiency = required <= 0 ? 0 : Math.min(4, Math.max(0, wasted) / required);
  const inner = Math.max(1,
    Math.max(0, row.seconds ?? 0)
    + Math.max(0, row.hints ?? 0) * bench * 0.35
    + (total > 0 ? 0 : Math.max(0, row.mistakes ?? 0) * bench * 0.25));
  const value = inner * (1 + inefficiency * 2.5) / (accuracy * accuracy);
  if (profile.logMean != null && (profile.logSd ?? 0) > 0.01) {
    return Math.max(20, Math.min(150, Math.round(100 + 25 * ((profile.logMean - Math.log(value)) / profile.logSd))));
  }
  return Math.max(45, Math.min(150, Math.round(100 * bench / value)));
}

test("both implementations agree across the whole input space", () => {
  const profiles = [
    { seconds: 6, logMean: Math.log(21.4), logSd: 0.45 },
    { seconds: 14, logMean: Math.log(16.9), logSd: 0.35 },
    { seconds: 27, logMean: Math.log(182), logSd: 0.6 },
    { seconds: 100, logMean: null, logSd: null },
  ];
  let compared = 0;
  for (const profile of profiles) {
    for (const seconds of [1, 8, 14, 27, 60, 200]) {
      for (const hints of [0, 1, 3]) {
        for (const mistakes of [0, 4]) {
          for (const [correct_count, total_count] of [[null, null], [0, 9], [5, 9], [9, 9]]) {
            for (const [wasted_moves, expected_moves] of [[null, null], [0, 25], [6, 25], [40, 25]]) {
              const row = { seconds, hints, mistakes, correct_count, total_count, wasted_moves, expected_moves };
              assert.equal(challengeScore(row, profile).score, sqlScore(profile, row),
                `disagreement on ${JSON.stringify(row)} against ${JSON.stringify(profile)}`);
              compared += 1;
            }
          }
        }
      }
    }
  }
  assert.ok(compared > 1000, `only ${compared} combinations compared`);
});
