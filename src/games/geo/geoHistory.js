const HISTORY_LIMIT = 5000;
const STRICT_RECENT_SOURCE_COUNT = 60;
const STRICT_RECENT_FACT_COUNT = 180;

function historyKey(userId) {
  return `geo_question_history_v2:${userId || "guest"}`;
}

function getQuestionHistory(userId) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(historyKey(userId)) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry === "object" && entry.sourceId)
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function rememberQuestions(userId, questions) {
  if (typeof window === "undefined") return;
  try {
    const existing = getQuestionHistory(userId);
    const now = Date.now();
    const additions = questions.map((question, index) => ({
      sourceId: question.sourceId,
      factId: question.factId,
      promptKey: `${question.factId}:${question.templateIndex ?? 0}`,
      seenAt: now + index,
    }));
    const additionKeys = new Set(additions.map((entry) => `${entry.factId}|${entry.promptKey}`));
    const next = [
      ...additions,
      ...existing.filter((entry) => !additionKeys.has(`${entry.factId}|${entry.promptKey}`)),
    ].slice(0, HISTORY_LIMIT);
    window.localStorage.setItem(historyKey(userId), JSON.stringify(next));
  } catch {
    // Repetition protection is best effort when browser storage is unavailable.
  }
}

function buildHistoryIndex(history) {
  const sourceRank = new Map();
  const factRank = new Map();
  history.forEach((entry, index) => {
    if (!sourceRank.has(entry.sourceId)) sourceRank.set(entry.sourceId, index);
    if (!factRank.has(entry.factId)) factRank.set(entry.factId, index);
  });
  return { sourceRank, factRank };
}



export { getQuestionHistory, rememberQuestions, buildHistoryIndex };
