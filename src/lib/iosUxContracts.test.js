import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("game artwork uses one shared framing layer with calibrated source scales", () => {
  const css = source("../game-tile-artwork.css");
  assert.match(css, /\.home-game-tile--artwork::before/);
  assert.match(css, /background-size: var\(--game-tile-art-size, cover\)/);
  assert.match(css, /\.home-game-tile--gridly[\s\S]*--game-tile-art-size: 124% auto/);
  assert.match(css, /\.home-game-tile--minisudoku[\s\S]*--game-tile-art-size: auto 92%/);
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
