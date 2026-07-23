// Challenge calendars use the player's local time zone and can start on
// either Monday (default) or Sunday, according to their profile preference.

function toDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function startOfWeek(date = new Date(), weekStartsOn = 1) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const startDay = weekStartsOn === 0 ? 0 : 1;
  const diff = (d.getDay() - startDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

export function mondayOf(date = new Date()) {
  return startOfWeek(date, 1);
}

export function weekDates(date = new Date(), weekStartsOn = 1) {
  const start = startOfWeek(date, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return toDateString(d);
  });
}

export function todayIndex(date = new Date(), weekStartsOn = 1) {
  const startDay = weekStartsOn === 0 ? 0 : 1;
  return (date.getDay() - startDay + 7) % 7;
}

export function weekDayLabels(weekStartsOn = 1) {
  return weekStartsOn === 0
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
}

export { toDateString };
