import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyReminderCandidates, parseLocalCalendarDate, reminderIdForDate } from "./notificationSchedule.js";

test("daily reminders use local wall-clock periods without UTC date parsing", () => {
  const date = parseLocalCalendarDate("2026-08-24", 9);
  assert.deepEqual([date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours()], [2026,8,24,9]);
});

test("only one routine reminder is created per challenge date", () => {
  const reminders = buildDailyReminderCandidates({
    period:"morning",
    now:new Date(2026,7,23,12),
    rounds:[
      { challenge_id:2, challenge_date:"2026-08-24", game:"hive" },
      { challenge_id:1, challenge_date:"2026-08-24", game:"zoom" },
      { challenge_id:3, challenge_date:"2026-08-26", game:"gridly" },
    ],
  });
  assert.equal(reminders.length, 2);
  assert.equal(reminders[0].round.challenge_id, 1);
  assert.equal(reminders[0].at.getHours(), 9);
});

test("completed challenge dates are skipped and Off schedules nothing", () => {
  const input = {
    now:new Date(2026,7,23,12),
    rounds:[{ challenge_id:7, challenge_date:"2026-08-24", game:"hive" }],
    completed:[{ circle_challenge_id:7, challenge_date:"2026-08-24" }],
  };
  assert.deepEqual(buildDailyReminderCandidates({ ...input, period:"evening" }), []);
  assert.deepEqual(buildDailyReminderCandidates({ ...input, completed:[], period:"off" }), []);
});

test("reminder identifiers are stable calendar-date integers", () => {
  assert.equal(reminderIdForDate("2027-01-03"), 20270103);
});
