export function rewardStatusText(reward, fallback = "No points awarded") {
  if (!reward) return fallback;
  if (Number(reward.points_awarded) > 0) return `★ +${reward.points_awarded} Points`;
  if (reward.already_awarded) return "Points kept from your first completion";
  if (reward.practice_limit_reached || reward.daily_limit_reached) return "Practice points finished for today";
  if (reward.daily_points_cap_reached) return "Daily points earned — keep playing for fun";
  return reward.message || fallback;
}
