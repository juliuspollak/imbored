import test from "node:test";
import assert from "node:assert/strict";
import {
  mondayForDateString,
  pastIsoDays,
  resolveChallengeDates,
  shouldAdvanceToNextWeek,
  weekStartForChallenge,
  weekStartForMode,
} from "./circleChallengeSchedule.js";

const localNoon = (year, month, day) => new Date(year, month - 1, day, 12);

test("Monday selected early in the week stays in the same week", () => {
  const now = localNoon(2026, 8, 17);
  const weekStart = weekStartForMode("this", { now });
  assert.equal(weekStart, "2026-08-17");
  assert.deepEqual(resolveChallengeDates({ weekStart, selectedDays:[1] }), [{ isoDay:1, date:"2026-08-17" }]);
  assert.equal(shouldAdvanceToNextWeek({ weekStart, selectedDays:[1], now }), false);
});

test("Sunday moves an implicit Mon Wed Fri selection to next week", () => {
  const now = localNoon(2026, 8, 23);
  const thisWeek = weekStartForMode("this", { now });
  assert.equal(shouldAdvanceToNextWeek({ weekStart:thisWeek, selectedDays:[1,3,5], now }), true);
  const nextWeek = weekStartForMode("next", { now });
  assert.deepEqual(resolveChallengeDates({ weekStart:nextWeek, selectedDays:[1,3,5] }), [
    { isoDay:1, date:"2026-08-24" },
    { isoDay:3, date:"2026-08-26" },
    { isoDay:5, date:"2026-08-28" },
  ]);
});

test("explicit Next week always resolves against the following Monday", () => {
  assert.equal(weekStartForMode("next", { now:localNoon(2026, 8, 18) }), "2026-08-24");
});

test("a chosen future date resolves to its containing Monday", () => {
  assert.equal(weekStartForMode("choose", { now:localNoon(2026, 8, 18), chosenDate:"2026-09-17" }), "2026-09-14");
});

test("past weekdays in This week are identified as unavailable", () => {
  assert.deepEqual([...pastIsoDays("2026-08-17", localNoon(2026, 8, 20))], [1,2,3]);
});

test("month and year boundaries resolve without UTC date shifts", () => {
  assert.deepEqual(resolveChallengeDates({ weekStart:"2026-08-31", selectedDays:[1,3,7] }), [
    { isoDay:1, date:"2026-08-31" },
    { isoDay:3, date:"2026-09-02" },
    { isoDay:7, date:"2026-09-06" },
  ]);
  assert.deepEqual(resolveChallengeDates({ weekStart:"2026-12-28", selectedDays:[1,5,7] }), [
    { isoDay:1, date:"2026-12-28" },
    { isoDay:5, date:"2027-01-01" },
    { isoDay:7, date:"2027-01-03" },
  ]);
});

test("date parsing and Monday resolution use local calendar components", () => {
  const date = mondayForDateString("2027-01-01");
  assert.equal(date, "2026-12-28");
});

test("existing challenge records retain their stored week and legacy records get the current week", () => {
  const now = localNoon(2026, 8, 23);
  assert.equal(weekStartForChallenge({ week_start:"2026-08-24" }, now), "2026-08-24");
  assert.equal(weekStartForChallenge({ challenge_id:42 }, now), "2026-08-17");
});
