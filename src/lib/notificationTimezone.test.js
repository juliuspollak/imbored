import test from "node:test";
import assert from "node:assert/strict";
import { hasReminderTimezoneChanged } from "./notificationTimezone.js";

test("an unchanged device timezone does not require a timezone rebuild", () => {
  assert.equal(hasReminderTimezoneChanged("Australia/Sydney", "Australia/Sydney"), false);
});

test("a changed or previously unknown device timezone requires a rebuild", () => {
  assert.equal(hasReminderTimezoneChanged("Australia/Sydney", "Europe/Bratislava"), true);
  assert.equal(hasReminderTimezoneChanged(null, "Australia/Sydney"), true);
});
