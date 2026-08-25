import test from "node:test";
import assert from "node:assert/strict";
import { shouldShowGameHelp } from "./gameUiState.js";

test("game help is available during play and hidden on completed results", () => {
  assert.equal(shouldShowGameHelp(false), true);
  assert.equal(shouldShowGameHelp(true), false);
});
