// All challenge-mode logic is anchored to the real calendar, in the
// player's local time zone — a fresh set of 7 puzzles per game each week,
// Monday through Sunday.

function toDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Monday of the week containing `date` (defaults to today), at local midnight.
export function mondayOf(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow; // days to subtract to reach Monday
  d.setDate(d.getDate() + diff);
  return d;
}

// The 7 calendar dates (as 'YYYY-MM-DD' strings) for the week containing today.
export function weekDates(date = new Date()) {
  const monday = mondayOf(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return toDateString(d);
  });
}

// Index of today within Mon(0)..Sun(6).
export function todayIndex(date = new Date()) {
  const dow = date.getDay();
  return dow === 0 ? 6 : dow - 1;
}

export { toDateString };
