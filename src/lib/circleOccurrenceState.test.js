import test from "node:test";
import assert from "node:assert/strict";
import { CIRCLE_OCCURRENCE_STATE, circleHistoryResultLabel, circleOccurrenceCutoff, circleOccurrenceState } from "./circleOccurrenceState.js";
import { rankStandings } from "./challengeStandingsScoring.js";

const fridayGrace = [{ challenge_date:"2026-08-28",round_state:"grace",closes_at:"2026-08-29T14:00:00.000Z" }];

test("Friday leader stays provisional throughout Saturday grace", () => {
  const standings = rankStandings([{ userId:"a",score:110,played:1,hints:0,mistakes:0,adjusted:90,finishedAt:"2026-08-28T10:00:00Z" }]);
  assert.equal(circleOccurrenceState(fridayGrace), CIRCLE_OCCURRENCE_STATE.GRACE);
  assert.equal(circleOccurrenceCutoff(fridayGrace), "2026-08-29T14:00:00.000Z");
  assert.equal(circleHistoryResultLabel({ item:{ winner_id:"a" },userId:"a",state:CIRCLE_OCCURRENCE_STATE.GRACE,standings }), "Currently 1st · grace");
});

test("a future round keeps the whole occurrence open", () => {
  assert.equal(circleOccurrenceState([{ round_state:"grace" },{ round_state:"scheduled" }]), CIRCLE_OCCURRENCE_STATE.OPEN);
});

test("late better score changes the current leader without final winner wording", () => {
  const standings = rankStandings([
    { userId:"a",score:110,played:1,hints:0,mistakes:0,adjusted:90,finishedAt:"2026-08-28T10:00:00Z" },
    { userId:"b",score:130,played:1,hints:0,mistakes:0,adjusted:80,finishedAt:"2026-08-29T09:00:00Z" },
  ]);
  assert.deepEqual(standings.map((entry) => entry.userId), ["b","a"]);
  assert.equal(circleHistoryResultLabel({ item:{ winner_id:"a" },userId:"a",state:CIRCLE_OCCURRENCE_STATE.GRACE,standings }), "Currently 2nd · grace");
  assert.doesNotMatch(circleHistoryResultLabel({ item:{ winner_id:"b" },userId:"b",state:CIRCLE_OCCURRENCE_STATE.GRACE,standings }), /won|winner/i);
});

test("winner wording appears only after the authoritative final state", () => {
  assert.equal(circleOccurrenceState([{ round_state:"final",closes_at:"2026-08-29T14:00:00.000Z" }]), CIRCLE_OCCURRENCE_STATE.FINAL);
  assert.equal(circleHistoryResultLabel({ item:{ winner_id:"b" },userId:"b",state:CIRCLE_OCCURRENCE_STATE.FINAL }), "Final · You won");
});
