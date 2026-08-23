import { addDays, currentMondayString, localDateString } from "./circleChallengeRounds.js";

function parseLocalDate(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function mondayForDateString(dateString) {
  const date = parseLocalDate(dateString);
  const isoDay = date.getDay() || 7;
  date.setDate(date.getDate() - isoDay + 1);
  return localDateString(date);
}

function resolveCalendarTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone:timezone || "Australia/Sydney" }).format(new Date());
    return timezone || "Australia/Sydney";
  } catch {
    return "Australia/Sydney";
  }
}

function calendarDateInTimezone(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone:resolveCalendarTimezone(timezone), year:"numeric", month:"2-digit", day:"2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function weekStartForMode(mode, { now = new Date(), chosenDate = null, calendarToday = null } = {}) {
  const thisWeek = mondayForDateString(calendarToday || localDateString(now));
  if (mode === "next") return addDays(thisWeek, 7);
  if (mode === "choose" && chosenDate) return mondayForDateString(chosenDate);
  return thisWeek;
}

function weekStartForChallenge(challenge, now = new Date()) {
  return challenge?.week_start || challenge?.weekStart || currentMondayString(now);
}

function resolveChallengeDates({ weekStart, selectedDays = [] }) {
  return [...new Set(selectedDays.map(Number).filter((day) => day >= 1 && day <= 7))]
    .sort((a, b) => a - b)
    .map((isoDay) => ({ isoDay, date: addDays(weekStart, isoDay - 1) }));
}

function pastIsoDays(weekStart, now = new Date(), calendarToday = null) {
  const today = calendarToday || localDateString(now);
  return new Set(resolveChallengeDates({ weekStart, selectedDays:[1,2,3,4,5,6,7] })
    .filter((item) => item.date < today)
    .map((item) => item.isoDay));
}

function shouldAdvanceToNextWeek({ weekStart, selectedDays = [], now = new Date(), calendarToday = null }) {
  const today = calendarToday || localDateString(now);
  if (weekStart !== mondayForDateString(today) || !selectedDays.length) return false;
  return resolveChallengeDates({ weekStart, selectedDays }).every((item) => item.date < today);
}

function formatChallengeDate(dateString, locale = undefined) {
  return new Intl.DateTimeFormat(locale, { weekday:"short", day:"numeric", month:"short" })
    .format(parseLocalDate(dateString));
}

function formatChallengeWeek(weekStart, locale = undefined) {
  const end = addDays(weekStart, 6);
  const formatter = new Intl.DateTimeFormat(locale, { day:"numeric", month:"short", year:"numeric" });
  return `${formatter.format(parseLocalDate(weekStart))} – ${formatter.format(parseLocalDate(end))}`;
}

export {
  calendarDateInTimezone,
  formatChallengeDate,
  formatChallengeWeek,
  mondayForDateString,
  parseLocalDate,
  pastIsoDays,
  resolveChallengeDates,
  resolveCalendarTimezone,
  shouldAdvanceToNextWeek,
  weekStartForChallenge,
  weekStartForMode,
};
