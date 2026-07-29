function localDateString(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function currentMondayString(value = new Date()) {
  const isoDay = value.getDay() || 7;
  const monday = new Date(value.getFullYear(), value.getMonth(), value.getDate() - isoDay + 1);
  return localDateString(monday);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

function buildCircleChallengeRounds({ activeDays = [], gameIds = [], weekStart = null } = {}) {
  const games = [...new Set(gameIds.filter(Boolean))];
  if (!games.length) return [];
  const monday = weekStart || currentMondayString();
  return [...new Set(activeDays.map(Number).filter((day) => day >= 1 && day <= 7))]
    .sort((a, b) => a - b)
    .map((isoDay, index) => ({
      date: addDays(monday, isoDay - 1),
      isoDay,
      game: games[index % games.length],
      roundNumber: index + 1,
    }));
}

export { addDays, buildCircleChallengeRounds, currentMondayString, localDateString };
