import test from "node:test";
import assert from "node:assert/strict";
import { REPLAYABLE_GAME_IDS, exitReplayToHome, homeLocationFrom } from "./replayNavigation.js";

test("challenge replay Home replaces replay with the normal Home route", () => {
  const calls = [];
  const browserWindow = {
    location: { href:"capacitor://localhost/?puzzle=481#challenge", replace:(url) => calls.push(url) },
  };
  exitReplayToHome(browserWindow);
  assert.deepEqual(calls, ["capacitor://localhost/"]);
});

for (const game of REPLAYABLE_GAME_IDS) {
  test(`${game} replay uses the shared Home replacement`, () => {
    const calls=[];
    exitReplayToHome({ location:{ href:`capacitor://localhost/?puzzle=7&game=${game}`, replace:(url)=>calls.push(url) } });
    assert.deepEqual(calls,["capacitor://localhost/"]);
  });
}

test("shared replay navigation covers every supported puzzle game", () => {
  assert.deepEqual(REPLAYABLE_GAME_IDS, ["hive", "binary", "gridly", "minisudoku", "geo", "zoom"]);
  assert.equal(homeLocationFrom("https://app.example/?puzzle=4&auth_return=profile#challenge"), "/");
});

test("canonical replay Home preserves an app subpath but no routing state",()=>{
  assert.equal(homeLocationFrom("https://app.example/imbored/?puzzle=4&rush=room#replay"),"/imbored/");
});
