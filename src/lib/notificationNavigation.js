function notificationNavigation(data = {}) {
  const route = data.route || data.type;
  if (route === "chat") {
    const playerId=String(data.playerId ?? data.player_id ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(playerId)) return null;
    return { screen:"chat",playerId };
  }
  if (!["circle_challenge", "daily_challenge", "competition_update", "challenge_result"].includes(route)) return null;
  const circleId = Number(data.circleId ?? data.circle_id);
  const challengeId = Number(data.challengeId ?? data.challenge_id);
  if (!Number.isSafeInteger(circleId) || circleId <= 0 || !Number.isSafeInteger(challengeId) || challengeId <= 0) return null;
  return { screen:"circles", circleId, challengeId };
}

export { notificationNavigation };
