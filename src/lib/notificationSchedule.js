const REMINDER_TIMES = {
  morning:{ hour:9, minute:0 },
  afternoon:{ hour:15, minute:0 },
  evening:{ hour:19, minute:0 },
};

// iOS permits only a bounded number of pending local notifications. Keep this
// layer as a rolling convenience fallback; Phase 3 server push is responsible
// for authoritative long-range delivery.
const LOCAL_REMINDER_HORIZON_DAYS = 30;

function parseLocalCalendarDate(dateString, hour = 12, minute = 0) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function localCalendarDate(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function reminderIdForDate(dateString) {
  return Number(String(dateString).replaceAll("-", ""));
}

function reminderHorizonEnd(now = new Date(), days = LOCAL_REMINDER_HORIZON_DAYS) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  end.setDate(end.getDate() + days);
  return localCalendarDate(end);
}

function buildDailyReminderCandidates({ rounds = [], completed = [], period = "off", now = new Date() }) {
  const time = REMINDER_TIMES[period];
  if (!time) return [];
  const completedKeys = new Set(completed.map((item) => `${item.circle_challenge_id}:${item.challenge_date}`));
  const firstIncompleteByDate = new Map();
  [...rounds]
    .sort((a, b) => String(a.challenge_date).localeCompare(String(b.challenge_date)) || Number(a.challenge_id) - Number(b.challenge_id))
    .forEach((round) => {
      const key = `${round.challenge_id}:${round.challenge_date}`;
      if (!completedKeys.has(key) && !firstIncompleteByDate.has(round.challenge_date)) firstIncompleteByDate.set(round.challenge_date, round);
    });
  const horizonEnd = reminderHorizonEnd(now);
  return [...firstIncompleteByDate.entries()].filter(([date]) => date <= horizonEnd).map(([date, round]) => ({
    id:reminderIdForDate(date),
    date,
    at:parseLocalCalendarDate(date, time.hour, time.minute),
    round,
  })).filter((item) => item.at > now);
}

export { LOCAL_REMINDER_HORIZON_DAYS, REMINDER_TIMES, buildDailyReminderCandidates, localCalendarDate, parseLocalCalendarDate, reminderHorizonEnd, reminderIdForDate };
