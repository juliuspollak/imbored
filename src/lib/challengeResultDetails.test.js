import test from "node:test";
import assert from "node:assert/strict";
import { canOpenChallengeResult, mergeChallengeRoundSummary } from "./challengeResultDetails.js";

test("own and eligible completed participant results can open", () => {
  const result = { game:"hive", challenge_date:"2026-08-26", seconds:52, mistakes:1, hints:0 };
  assert.equal(canOpenChallengeResult(result, { isCurrentUser:true }), true);
  assert.equal(canOpenChallengeResult(result), true);
});

test("incomplete, private, and withheld participant details stay protected", () => {
  assert.equal(canOpenChallengeResult(null), false);
  assert.equal(canOpenChallengeResult({ game:"hive", challenge_date:"2026-08-26" }), false);
  assert.equal(canOpenChallengeResult({ game:"hive", challenge_date:"2026-08-26", seconds:52, is_private:true }), false);
  assert.equal(canOpenChallengeResult({ game:"hive", challenge_date:"2026-08-26", seconds:52 }, { detailHidden:true }), false);
});

test("another player's summary never inherits a result id used for exact replay", () => {
  const row = { user_id:"other", game:"binary", challenge_date:"2026-08-26", seconds:40, mistakes:0, hints:1, id:99 };
  assert.deepEqual(mergeChallengeRoundSummary({ game:"binary", challenge_date:"2026-08-26", score:120 }, [row], "me", "other"), {
    game:"binary", challenge_date:"2026-08-26", seconds:40, mistakes:0, hints:1, correct_count:undefined, total_count:undefined, completed_at:undefined,
  });
});
