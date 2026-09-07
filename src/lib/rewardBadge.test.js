import test from "node:test";
import assert from "node:assert/strict";
import { organiserActionBadgeCount, rewardsUnreadBadgeCount } from "./rewardBadge.js";
import { readFileSync } from "node:fs";

const rewardsScreen = readFileSync(new URL("../Rewards.jsx", import.meta.url), "utf8");
const updatesHook = readFileSync(new URL("./useMyRedemptionUpdates.js", import.meta.url), "utf8");

test("Rewards counts unread personal updates, not actionable organiser work", () => {
  assert.equal(rewardsUnreadBadgeCount(1), 1);
  assert.equal(rewardsUnreadBadgeCount(0), 0);
  assert.equal(organiserActionBadgeCount(2, 1), 3);
});

test("opening Rewards persists its seen timestamp and refreshes the unread source", () => {
  assert.match(rewardsScreen, /user_section_views[\s\S]*section: "rewardrequests"[\s\S]*rewardrequests-section-seen/);
  assert.match(updatesHook, /getSectionViewedAt\(userId, "rewardrequests"\)/);
  assert.match(updatesHook, /query = query\.gt\("reviewed_at", view\.viewedAt\)/);
  assert.match(updatesHook, /seenEvent: "rewardrequests-section-seen"/);
});
