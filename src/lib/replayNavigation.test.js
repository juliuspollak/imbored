import test from "node:test";
import assert from "node:assert/strict";
import { REPLAYABLE_GAME_IDS, REPLAY_LOCATION_CHANGE_EVENT, exitReplayToHome, homeLocationFrom, replayStatIdFrom } from "./replayNavigation.js";
import { readFileSync } from "node:fs";

test("challenge replay Home replaces replay with the normal Home route", () => {
  const calls = [], events = [];
  const browserWindow = {
    location: { href:"capacitor://localhost/?puzzle=481#challenge" },
    history: { replaceState:(_state,_title,url) => {
      calls.push(url);
      browserWindow.location.href = new URL(url, browserWindow.location.href).href;
    } },
    Event,
    dispatchEvent:event => events.push(event.type),
  };
  assert.equal(replayStatIdFrom(browserWindow.location.href), "481");
  exitReplayToHome(browserWindow);
  assert.deepEqual(calls, ["/"]);
  assert.equal(replayStatIdFrom(browserWindow.location.href), null);
  assert.deepEqual(events, [REPLAY_LOCATION_CHANGE_EVENT]);
});

for (const game of REPLAYABLE_GAME_IDS) {
  test(`${game} replay uses the shared Home replacement`, () => {
    const calls=[], events=[];
    const browserWindow={ location:{ href:`capacitor://localhost/?puzzle=7&game=${game}` },history:{ replaceState:(_s,_t,url)=>calls.push(url) },Event,dispatchEvent:event=>events.push(event.type) };
    exitReplayToHome(browserWindow);
    assert.deepEqual(calls,["/"]);
    assert.deepEqual(events,[REPLAY_LOCATION_CHANGE_EVENT]);
  });
}

test("shared replay navigation covers every supported puzzle game", () => {
  assert.deepEqual(REPLAYABLE_GAME_IDS, ["hive", "binary", "gridly", "minisudoku", "geo", "zoom"]);
  assert.equal(homeLocationFrom("https://app.example/?puzzle=4&auth_return=profile#challenge"), "/");
});

test("canonical replay Home preserves an app subpath but no routing state",()=>{
  assert.equal(homeLocationFrom("https://app.example/imbored/?puzzle=4&rush=room#replay"),"/imbored/");
});

test("completed challenge re-practice mounts the real pre-App route and wires Home above overlays",()=>{
  const main=readFileSync(new URL("../main.jsx",import.meta.url),"utf8");
  const shared=readFileSync(new URL("../SharedPuzzleApp.jsx",import.meta.url),"utf8");
  const button=readFileSync(new URL("../GameHomeButton.jsx",import.meta.url),"utf8");
  assert.match(main,/return puzzleStatId \? <SharedPuzzleApp statId=\{puzzleStatId\} \/> : <App \/>/);
  assert.match(main,/addEventListener\(REPLAY_LOCATION_CHANGE_EVENT, readLocation\)/);
  assert.match(shared,/function goHome\(\) \{[\s\S]*exitReplayToHome\(window\)/);
  assert.match(shared,/<GameHomeButton onClick=\{goHome\} \/>/);
  assert.match(button,/zIndex: 250/);
});

test("completed challenge replay Home makes bootstrap false without rendering a replay loader",()=>{
  let href="capacitor://localhost/?puzzle=912";
  let bootstrap=replayStatIdFrom(href);
  const renders=[];
  const browserWindow={
    location:{ get href(){ return href; } },
    history:{ replaceState:(_state,_title,url)=>{ href=new URL(url,href).href; } },
    Event,
    dispatchEvent:event=>{
      assert.equal(event.type,REPLAY_LOCATION_CHANGE_EVENT);
      bootstrap=replayStatIdFrom(href);
      renders.push(bootstrap ? "Loading the exact puzzle…" : "App/Home");
    },
  };

  assert.equal(bootstrap,"912", "the actual replay bootstrap is mounted");
  exitReplayToHome(browserWindow);
  assert.equal(bootstrap,null, "the replay bootstrap condition becomes false");
  assert.deepEqual(renders,["App/Home"]);
  assert.ok(!renders.includes("Loading the exact puzzle…"));
});
