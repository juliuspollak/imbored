export function rewardStatusText(reward, fallback = "No points awarded") {
  if (!reward) return fallback;
  if (Number(reward.points_awarded) > 0) return `★ +${reward.points_awarded} Points`;
  if (reward.already_awarded) return "Points kept from your first completion";
  if (reward.practice_limit_reached || reward.daily_limit_reached) {
    return "You’ve earned points for today’s Practice rounds in this game. Try another game to keep earning, or keep playing for fun.";
  }
  if (reward.daily_points_cap_reached) {
    return "You’ve earned points for today’s Practice rounds in this game. Try another game to keep earning, or keep playing for fun.";
  }
  if (/^\s*\d+\s*\/\s*\d+\s*$/.test(reward.message || "")) {
    return "You’ve earned points for today’s Practice rounds in this game. Try another game to keep earning, or keep playing for fun.";
  }
  return reward.message || fallback;
}
