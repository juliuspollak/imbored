import test from "node:test";
import assert from "node:assert/strict";
import { displayGameName } from "./gameDisplayName.js";

test("the persisted binary game id is displayed as Twist", () => {
  assert.equal(displayGameName("binary"), "Twist");
});

test("unknown persisted game ids are preserved", () => {
  assert.equal(displayGameName("future-game"), "future-game");
});
