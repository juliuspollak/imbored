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
    binary:["auto 92%", "left center"],
    gridly:["auto 145%", "22% center"],
    minisudoku:["auto 78%", "left 70%"],
    geo:["auto 100%", "center"],
    zoom:["auto 92%", "left center"],
    animalrush:["auto 78%", "left 42%"],
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
