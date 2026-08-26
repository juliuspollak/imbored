const SUMMARY_FIELDS = ["seconds", "mistakes", "hints", "correct_count", "total_count"];

export function canOpenChallengeResult(result, { isCurrentUser = false, detailHidden = false } = {}) {
  if (!result || result.is_private || detailHidden || !result.game || !result.challenge_date) return false;
  return isCurrentUser || SUMMARY_FIELDS.some((field) => result[field] != null);
}

export function mergeChallengeRoundSummary(round, detailRows = [], userId = null, memberId = null) {
  if (!round || round.score == null) return null;
  const detail = detailRows.find((row) => row.user_id === memberId
    && row.game === round.game
    && row.challenge_date === round.challenge_date);
  if (!detail) return { game:round.game, challenge_date:round.challenge_date };
  const summary = Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, detail[field]]));
  return {
    game:round.game,
    challenge_date:round.challenge_date,
    ...summary,
    completed_at:detail.completed_at,
    ...(memberId === userId && detail.id ? { id:detail.id } : {}),
  };
}
