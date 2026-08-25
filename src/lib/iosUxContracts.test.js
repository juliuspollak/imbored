import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("game artwork uses one shared framing layer with calibrated source scales", () => {
  const css = source("../game-tile-artwork.css");
  assert.match(css, /\.home-game-tile--artwork::before/);
  assert.match(css, /background-size: var\(--game-tile-art-size, cover\)/);
  const expected = {
    hive:["auto 100%", "39% center"],
    binary:["cover", "center"],
    gridly:["auto 145%", "22% center"],
    minisudoku:["cover", "center"],
    geo:["auto 100%", "center"],
    zoom:["cover", "center"],
    animalrush:["cover", "center"],
  };
  for (const [game, [size, position]] of Object.entries(expected)) {
    for (const prefix of ["home-game-tile", "challenge-mini-game"]) {
      const block = css.match(new RegExp(`\\.${prefix}--${game} \\{([\\s\\S]*?)\\}`))?.[1] || "";
      assert.match(block, new RegExp(`--game-tile-art-size: ${size.replace("%", "\\%")}`));
      assert.match(block, new RegExp(`--game-tile-position: ${position.replace("%", "\\%")}`));
    }
  }
  assert.match(css, /\.challenge-mini-game\[style\][\s\S]*background-size: var\(--game-tile-art-size, cover\)/);
});

test("chat header owns the top safe area and reuses the app back button", () => {
  const chat = source("../Chat.jsx");
  assert.match(chat, /calc\(14px \+ var\(--safe-top\)\)/);
  assert.match(chat, /<BackButton onClick=\{onBack\}/);
});

test("Zoom provides a bounded inner scroller and safe sticky answer controls", () => {
  const zoom = source("../games/Zoom.jsx");
  assert.match(zoom, /height: "100dvh", overflowY: "auto"/);
  assert.match(zoom, /\.zoom-answer-footer[\s\S]*position: sticky/);
  assert.match(zoom, /padding-bottom: max\(var\(--space-2\), var\(--safe-bottom\)\)/);
});

test("Twist is the customer-facing name across app and server message contracts", () => {
  const branding = source("./gameBranding.jsx");
  const displayNames = source("./gameDisplayName.js");
  const home = source("../Home.jsx");
  const app = source("../App.jsx");
  const sharedPuzzle = source("../SharedPuzzleApp.jsx");
  const game = source("../games/Binary.jsx");
  const standings = source("../ChallengeStandings.jsx");
  const progress = source("../Progress.jsx");
  const circles = source("../Circles.jsx");
  const serverRename = source("../../supabase/migrations/202608251200_restore_twist_display_name.sql");
  assert.match(displayNames, /binary: "Twist"/);
  for (const appSurface of [home, app, sharedPuzzle, game, standings, progress, circles]) {
    assert.match(appSurface, /GAME_NAMES\.binary|GAME_NAMES|GAME_LABELS/);
  }
  for (const signature of ["create_score_challenge", "share_puzzle_with_circles", "notify_circle_daily_challenge_completed"]) {
    assert.match(serverRename, new RegExp(signature));
  }
  assert.match(serverRename, /'''Binary''', '''Twist'''/);
  assert.match(serverRename, /replace\(body,'Binary','Twist'\)/);
  assert.match(serverRename, /update public\.direct_messages/);
  assert.match(game, /game: "binary"/);
});

test("profile avatar editing lives in the settings card, not the page header", () => {
  const profile = source("../ProfileSetup.jsx");
  const headerCall = profile.match(/<PageHeader[\s\S]*?\/>/)?.[0] || "";
  assert.doesNotMatch(headerCall, /action=/);
  assert.match(profile, /<Card[^>]*>[\s\S]*?className="profile-avatar-button"[\s\S]*?profile\.picture/);
  assert.match(profile, /minHeight: 56/);
});
