import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const circles = readFileSync(new URL("../Circles.jsx", import.meta.url), "utf8");

test("circle cards expose an accessible detail navigation target", () => {
  assert.match(circles, /className="circle-card-main"[\s\S]*role=\{isMine \|\| manager \? "button"[\s\S]*tabIndex=\{isMine \|\| manager \? 0/);
  assert.match(circles, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(circles, /onClick=\{isMine \|\| manager \? \(\) => openCircleDetails\(circle\)/);
});

test("the ellipsis remains independent from card navigation", () => {
  assert.ok(circles.includes('onClick={(event) => { event.stopPropagation(); setCardMenuCircleId(menuOpen ? null : circle.id); }'));
  assert.equal(circles.match(/aria-label=\{`More actions for \$\{circle\.name\}`\}/g)?.length, 1);
});

test("the owner menu offers challenge creation and circle management", () => {
  assert.ok(circles.includes('onClick={() => openNewChallenge(circle)}>New challenge</Button>'));
  assert.match(circles, />Manage circle<\/Button>/);
  assert.doesNotMatch(circles, />Manage members<\/Button>/);
  assert.match(circles, /function openNewChallenge\(circle\) \{[\s\S]*openCircleDetails\(circle\);[\s\S]*startNewChallenge\(circle\.id\);/);
});

test("circle detail uses the circle name and owner-first actions", () => {
  assert.match(circles, /className="truncate">\{rosterCircle\.name\}<\/div>[\s\S]*Challenges, members and invites/);
  assert.doesNotMatch(circles, /`Manage \$\{rosterCircle\.name\}`/);
  assert.ok(circles.includes('{owner && <Button variant="primary"'));
  assert.ok(circles.includes('onClick={() => startNewChallenge(rosterCircle.id)}>New challenge</Button>'));
  assert.ok(circles.includes('{member && <Button variant="secondary"'));
  assert.ok(circles.includes('>Invite a player</Button>'));
});

test("only an owner gets challenge creation controls", () => {
  assert.ok(circles.includes('{owner && <Button variant="secondary" before={<Plus size={14} />} onClick={() => startNewChallenge(rosterCircle.id)}'));
  assert.ok(circles.includes('>Create challenge</Button>}'));
  assert.match(circles, /\{owner \? "Create one for your circle to play\." : "The owner hasn't scheduled one yet\."\}/);
  assert.doesNotMatch(circles, />New<\/Button>/);
});

test("challenge, member, invitation, and circle mutations retain their existing paths", () => {
  assert.match(circles, /function startNewChallenge\(circleId\)/);
  assert.match(circles, /onClick=\{\(\) => saveCircleChallenge\(rosterCircle, ck\)\}/);
  assert.match(circles, /save_circle_weekly_challenge_schedule/);
  assert.match(circles, /moderate_circle_member/);
  assert.match(circles, /addPlayerToCircle\(playerId, inviteCircle\.id\)/);
  assert.match(circles, /delete_managed_circle/);
  assert.match(circles, /leaveCircle\(circle\.id\)/);
});
