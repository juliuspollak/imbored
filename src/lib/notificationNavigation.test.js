import test from "node:test";
import assert from "node:assert/strict";
import { notificationNavigation } from "./notificationNavigation.js";

test("notification navigation accepts allowlisted routes with valid record IDs", () => {
  assert.deepEqual(notificationNavigation({ route:"daily_challenge", circleId:"12", challenge_id:34 }), {
    screen:"circles", circleId:12, challengeId:34,
  });
});

test("notification navigation rejects unknown routes and missing or malformed IDs", () => {
  assert.equal(notificationNavigation({ route:"external", circleId:1, challengeId:2 }), null);
  assert.equal(notificationNavigation({ route:"daily_challenge", circleId:1 }), null);
  assert.equal(notificationNavigation({ route:"daily_challenge", circleId:-1, challengeId:2 }), null);
  assert.equal(notificationNavigation({ route:"daily_challenge", circleId:1.5, challengeId:2 }), null);
});
