// Lightweight repetition protection for Zoom, independent of Geo's history
// (separate storage key) since the two games draw from overlapping but
// differently-shaped pools. Only tracks which target countries were used
// recently — Zoom's chain always re-derives its own continent/subregion/
// fact wording fresh, so there's no need for Geo's fuller fact/template
// tracking.
const HISTORY_LIMIT = 500;

function historyKey(userId) {
  return `zoom_target_history_v1:${userId || "guest"}`;
}

function getTargetHistory(userId) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(historyKey(userId)) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function rememberTargets(userId, countryIds = []) {
  if (typeof window === "undefined") return;
  try {
    const existing = getTargetHistory(userId);
    const next = [...countryIds, ...existing.filter((id) => !countryIds.includes(id))].slice(0, HISTORY_LIMIT);
    window.localStorage.setItem(historyKey(userId), JSON.stringify(next));
  } catch {
    // Best effort — a fresh browser profile or blocked storage just means
    // slightly more repetition, never a broken game.
  }
}

export { getTargetHistory, rememberTargets };
