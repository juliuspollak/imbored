function groupChallengeCompletions(rows = []) {
  const grouped = { personal: new Set() };
  rows.forEach((row) => {
    const key = row.team_challenge_id == null ? "personal" : String(row.team_challenge_id);
    if (!grouped[key]) grouped[key] = new Set();
    grouped[key].add(row.game);
  });
  return grouped;
}

function challengeProgress(gameIds = [], completed = new Set()) {
  const uniqueGames = [...new Set(gameIds)];
  const completedCount = uniqueGames.filter((gameId) => completed.has(gameId)).length;
  return {
    total: uniqueGames.length,
    completed: completedCount,
    remaining: Math.max(0, uniqueGames.length - completedCount),
    done: uniqueGames.length > 0 && completedCount >= uniqueGames.length,
  };
}

export { groupChallengeCompletions, challengeProgress };
