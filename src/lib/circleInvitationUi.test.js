import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const circles = readFileSync(new URL("../Circles.jsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../Home.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../game-tile-artwork.css", import.meta.url), "utf8");

test("circle invites show pending status and verify membership after acceptance", () => {
  assert.match(circles, /setSentInvitations\(sentInvitationsResult\.data \|\| \[\]\)/);
  assert.match(circles, /sentInvitations\.some\(\(item\) => item\.circle_id === inviteCircle\.id && item\.invited_user_id === c\.id\)/);
  assert.match(circles, /<Button variant="secondary" size="sm" disabled>Invited<\/Button>/);
  assert.match(circles, /decideInvitation\(item\.invitation_id, true, item\.circle_id\)/);
  assert.match(circles, /\.from\("circle_members"\)[\s\S]*\.eq\("user_id", user\.id\)\.maybeSingle\(\)/);
});

test("circle dashboard does not list unrelated public circles", () => {
  assert.match(circles, /const visibleCircles = circles\.filter/);
  assert.match(circles, /\{visibleCircles\.map\(\(circle, circleIndex\)/);
});

test("personal challenge uses explicit responsive grid for all games", () => {
  assert.equal((home.match(/className="challenge-mini-strip challenge-mini-strip--personal"/g) || []).length, 2);
  assert.match(styles, /\.challenge-mini-strip\.challenge-mini-strip--personal/);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important/);
  assert.match(styles, /grid-auto-flow: row !important/);
});
