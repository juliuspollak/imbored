import test from "node:test";
import assert from "node:assert/strict";
import { rewardStatusText } from "./rewardStatus.js";

const practiceCapMessage = "You’ve earned all your Practice points for today. You can keep playing for fun — Practice points reset tomorrow.";

test("uses one clear message for the Practice points cap", () => {
  assert.equal(
    rewardStatusText({ daily_points_cap_reached: true, daily_points_earned: 40, daily_points_cap: 40 }),
    practiceCapMessage
  );
  assert.equal(
    rewardStatusText({ message: "40/40" }),
    practiceCapMessage
  );
  assert.equal(rewardStatusText({ practice_limit_reached: true }), practiceCapMessage);
});

test("continues to show awarded Challenge points normally", () => {
  assert.equal(rewardStatusText({ points_awarded: 14 }), "★ +14 Points");
});
