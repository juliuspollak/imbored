import test from "node:test";
import assert from "node:assert/strict";
import { notificationNavigation } from "./notificationNavigation.js";

test("chat push accepts only a validated player identifier",()=>{
  const id="123e4567-e89b-42d3-a456-426614174000";
  assert.deepEqual(notificationNavigation({ route:"chat",playerId:id }),{ screen:"chat",playerId:id });
  assert.equal(notificationNavigation({ route:"chat",playerId:"../../admin" }),null);
});

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
