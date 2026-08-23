import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyReminderCandidates, parseLocalCalendarDate, reminderHorizonEnd, reminderIdForDate } from "./notificationSchedule.js";

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

test("the local fallback includes day 30 and excludes dates beyond its bounded horizon", () => {
  const now = new Date(2026, 7, 23, 8);
  assert.equal(reminderHorizonEnd(now), "2026-09-22");
  const reminders = buildDailyReminderCandidates({
    period:"morning",
    now,
    rounds:[
      { challenge_id:1, challenge_date:"2026-09-22", game:"hive" },
      { challenge_id:2, challenge_date:"2026-09-23", game:"zoom" },
    ],
  });
  assert.deepEqual(reminders.map((item) => item.date), ["2026-09-22"]);
});

test("rolling the foreground date brings a previously out-of-range reminder into range without duplicates", () => {
  const rounds = [
    { challenge_id:2, challenge_date:"2026-09-23", game:"zoom" },
    { challenge_id:2, challenge_date:"2026-09-23", game:"zoom" },
  ];
  assert.equal(buildDailyReminderCandidates({ period:"morning", now:new Date(2026,7,23,8), rounds }).length, 0);
  const refreshed = buildDailyReminderCandidates({ period:"morning", now:new Date(2026,7,24,8), rounds });
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].date, "2026-09-23");
});
