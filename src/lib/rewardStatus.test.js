import test from "node:test";
import assert from "node:assert/strict";
import { rewardStatusText } from "./rewardStatus.js";

test("explains the Practice daily limit instead of showing an unexplained fraction", () => {
  assert.equal(
    rewardStatusText({ daily_points_cap_reached: true, daily_points_earned: 40, daily_points_cap: 40 }),
    "Practice points limit reached: 40 of 40 today · resets tomorrow"
  );
  assert.equal(
    rewardStatusText({ message: "40/40" }),
    "Practice points limit reached: 40 of 40 today · resets tomorrow"
  );
});

test("continues to show awarded Challenge points normally", () => {
  assert.equal(rewardStatusText({ points_awarded: 14 }), "★ +14 Points");
});
