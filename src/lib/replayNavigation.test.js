import test from "node:test";
import assert from "node:assert/strict";
import { REPLAYABLE_GAME_IDS, exitReplayToHome, homeLocationFrom } from "./replayNavigation.js";

test("challenge replay Home removes replay state and reloads the normal Home route", () => {
  const calls = [];
  const browserWindow = {
    location: { href:"capacitor://localhost/?puzzle=481#challenge", reload:() => calls.push("reload") },
    history: { replaceState:(_state, _title, url) => calls.push(url) },
  };
  exitReplayToHome(browserWindow);
  assert.deepEqual(calls, ["/#challenge", "reload"]);
});

test("shared replay navigation covers every supported puzzle game", () => {
  assert.deepEqual(REPLAYABLE_GAME_IDS, ["hive", "binary", "gridly", "minisudoku", "geo", "zoom"]);
  assert.equal(homeLocationFrom("https://app.example/?puzzle=4&auth_return=profile"), "/?auth_return=profile");
});
