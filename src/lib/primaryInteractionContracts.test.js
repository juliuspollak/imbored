import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const players = readFileSync(new URL("../AdminPlayers.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../Home.jsx", import.meta.url), "utf8");
const standings = readFileSync(new URL("../ChallengeStandings.jsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("../ChallengeResultDialog.jsx", import.meta.url), "utf8");

test("a player row opens the existing player conversation and ellipsis stays independent", () => {
  assert.ok(players.includes('onClick={() => onOpenPlayer?.(player)} aria-label={`Open ${player.name}`} className="admin-player-primary"'));
  assert.match(players, /event\.stopPropagation\(\); setExpandedId/);
  assert.match(app, /onOpenPlayer=\{\(player\) => \{ setChatReturn\("adminplayers"\); setChatPlayer\(player\); \}\}/);
});

test("My Challenge completed tiles open the shared result dialog", () => {
  assert.match(home, /completed \? openMyChallengeResult\(game\.id, todayString\(\)\) : onSelect\(game\.id\)/);
  assert.match(home, /<ChallengeResultDialog result=\{selectedChallengeResult\}/);
  assert.match(standings, /<ChallengeResultDialog result=\{selectedResult\}/);
  assert.match(standings, /fetchCurrentUserChallengeResult/);
});

test("shared result details preserve Challenge score and practice-only replay", () => {
  assert.match(dialog, /\.eq\("user_id", userId\)\.eq\("mode", "challenge"\)\.eq\("game", game\)\.eq\("challenge_date", challengeDate\)/);
  assert.match(dialog, /circleChallengeId === null[\s\S]*\.is\("circle_challenge_id", null\)[\s\S]*\.eq\("circle_challenge_id", circleChallengeId\)/);
  assert.match(dialog, /Your original Challenge result stays locked/);
  assert.match(dialog, /openPuzzlePractice\(result\.id\)/);
  assert.match(dialog, /GAME_NAMES\[result\.game\]/);
  assert.match(home, /Play missed challenge · ranked/);
  assert.match(home, /Ranked play is closed\. Practice uses the game normally and cannot change these standings\./);
});
