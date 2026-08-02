export function rewardStatusText(reward, fallback = "No points awarded") {
  if (!reward) return fallback;
  if (Number(reward.points_awarded) > 0) return `★ +${reward.points_awarded} Points`;
  if (reward.already_awarded) return "Points kept from your first completion";
  if (
    reward.daily_points_cap_reached
    || reward.practice_limit_reached
    || reward.daily_limit_reached
  ) {
    return "You’ve earned all your Practice points for today. You can keep playing for fun — Practice points reset tomorrow.";
  }
  if (/^\s*\d+\s*\/\s*\d+\s*$/.test(reward.message || "")) {
    return "You’ve earned all your Practice points for today. You can keep playing for fun — Practice points reset tomorrow.";
  }
  return reward.message || fallback;
}
