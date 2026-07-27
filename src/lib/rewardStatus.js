export function rewardStatusText(reward, fallback = "No points awarded") {
  if (!reward) return fallback;
  if (Number(reward.points_awarded) > 0) return `★ +${reward.points_awarded} Points`;
  if (reward.already_awarded) return "Points kept from your first completion";
  if (reward.daily_limit_reached) return "Daily practice points limit reached";
  return reward.message || fallback;
}
