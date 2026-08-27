import test from "node:test";
import assert from "node:assert/strict";
import { REPLAYABLE_GAME_IDS, exitReplayToHome, homeLocationFrom } from "./replayNavigation.js";

test("challenge replay Home replaces replay with the normal Home route", () => {
  const calls = [];
  const browserWindow = {
    location: { href:"capacitor://localhost/?puzzle=481#challenge", replace:(url) => calls.push(url) },
  };
  exitReplayToHome(browserWindow);
  assert.deepEqual(calls, ["capacitor://localhost/#challenge"]);
});

for (const game of REPLAYABLE_GAME_IDS) {
  test(`${game} replay uses the shared Home replacement`, () => {
    const calls=[];
    exitReplayToHome({ location:{ href:`capacitor://localhost/?puzzle=7&game=${game}`, replace:(url)=>calls.push(url) } });
    assert.deepEqual(calls,[`capacitor://localhost/?game=${game}`]);
  });
}

test("shared replay navigation covers every supported puzzle game", () => {
  assert.deepEqual(REPLAYABLE_GAME_IDS, ["hive", "binary", "gridly", "minisudoku", "geo", "zoom"]);
  assert.equal(homeLocationFrom("https://app.example/?puzzle=4&auth_return=profile"), "/?auth_return=profile");
});
