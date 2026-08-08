export function isCommunityVisibleProfile(profile) {
  return !!profile
    && profile.hidden_from_others !== true
    && !profile.account_deleted_at;
}

export function canDiscoverProfile(profile, { isAdmin = false } = {}) {
  return isCommunityVisibleProfile(profile)
    && (isAdmin || profile.is_private !== true);
}

// Mirrors the is_private filter in get_public_player_progress() and
// get_public_player_game_summary(). Community standings are a discovery
// surface, so a private player belongs there only in their own view — and,
// unlike canDiscoverProfile, not for admins either: the leaderboard is one
// shared list and an admin-only row would be a different list.
export function isStandingsVisible(profile, viewerId) {
  return isCommunityVisibleProfile(profile)
    && (profile.is_private !== true || profile.id === viewerId);
}

// Mirrors can_continue_conversation() in public.sql. Discovery decides who you
// may START a chat with; continuity decides whose existing conversation you may
// reopen. They are not the same question, and conflating them is what stranded
// unread badges: a notification was counted while Chats filtered its
// conversation out of the list, leaving nothing to open and nothing to clear.
//
// So is_private, is_blocked and is_approved deliberately do not appear here —
// they gate discovery only.
export function canContinueConversation(profile, { isSelf = false, blockedBetween = false } = {}) {
  // Challenge results are a self-conversation and always reachable.
  if (isSelf) return true;
  return isCommunityVisibleProfile(profile) && blockedBetween !== true;
}
