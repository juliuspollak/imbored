const REMINDER_TIMES = {
  morning:{ hour:9, minute:0 },
  afternoon:{ hour:15, minute:0 },
  evening:{ hour:19, minute:0 },
};

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
  return [...firstIncompleteByDate.entries()].map(([date, round]) => ({
    id:reminderIdForDate(date),
    date,
    at:parseLocalCalendarDate(date, time.hour, time.minute),
    round,
  })).filter((item) => item.at > now);
}

export { REMINDER_TIMES, buildDailyReminderCandidates, localCalendarDate, parseLocalCalendarDate, reminderIdForDate };
