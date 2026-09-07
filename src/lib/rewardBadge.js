// The player-facing Rewards badge is unread history: decisions or fulfilment
// updates on this player's own redemptions since Rewards was last opened.
// Organiser queues are actionable work and belong on Organise rewards instead.
export function rewardsUnreadBadgeCount(myRedemptionUpdates = 0) {
  return Math.max(0, Number(myRedemptionUpdates) || 0);
}

export function organiserActionBadgeCount(organiserAttention = 0, openRequests = 0) {
  return Math.max(0, Number(organiserAttention) || 0) + Math.max(0, Number(openRequests) || 0);
}
