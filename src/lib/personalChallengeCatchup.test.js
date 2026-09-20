import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const home = readFileSync(new URL("../Home.jsx", import.meta.url), "utf8");
const gate = readFileSync(new URL("../ChallengeGate.jsx", import.meta.url), "utf8");

test("home surfaces personal games missed yesterday", () => {
  assert.match(home, /yesterdayPersonalRows/);
  assert.match(home, /MISSED YESTERDAY/);
  assert.match(home, /Still playable/);
  assert.match(home, /choosePersonalChallenge\(daysAgoDate\(1\)\)/);
});

test("personal catch-up can cross the Monday week boundary", () => {
  assert.match(gate, /personalTargetDate/);
  assert.match(gate, /!dates\.includes\(personalTargetDate\)/);
  assert.match(gate, /Missed yesterday — tap to catch up/);
  assert.match(gate, /challengeScope\?\.targetDate/);
});
