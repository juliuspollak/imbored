function notificationNavigation(data = {}) {
  const route = data.route || data.type;
  if (!["circle_challenge", "daily_challenge", "competition_update", "challenge_result"].includes(route)) return null;
  const circleId = Number(data.circleId ?? data.circle_id);
  const challengeId = Number(data.challengeId ?? data.challenge_id);
  if (!Number.isSafeInteger(circleId) || circleId <= 0 || !Number.isSafeInteger(challengeId) || challengeId <= 0) return null;
  return { screen:"circles", circleId, challengeId };
}

export { notificationNavigation };
