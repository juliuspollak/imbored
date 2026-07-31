export function rewardStatusText(reward, fallback = "No points awarded") {
  if (!reward) return fallback;
  if (Number(reward.points_awarded) > 0) return `★ +${reward.points_awarded} Points`;
  if (reward.already_awarded) return "Points kept from your first completion";
  if (reward.practice_limit_reached || reward.daily_limit_reached) {
    const limit = reward.breakdown?.practice_daily_limit;
    return limit
      ? `Practice limit reached for this game (${limit}/day) — resets tomorrow`
      : "Practice limit reached for this game — resets tomorrow";
  }
  if (reward.daily_points_cap_reached) {
    const earned = reward.daily_points_earned;
    const cap = reward.daily_points_cap;
    return Number.isFinite(earned) && Number.isFinite(cap)
      ? `Practice points limit reached: ${earned} of ${cap} today · resets tomorrow`
      : "Practice points limit reached for today · resets tomorrow";
  }
  if (/^\s*\d+\s*\/\s*\d+\s*$/.test(reward.message || "")) {
    const [earned, cap] = reward.message.split("/").map((value) => Number(value.trim()));
    return `Practice points limit reached: ${earned} of ${cap} today · resets tomorrow`;
  }
  return reward.message || fallback;
}
