export function isCommunityVisibleProfile(profile) {
  return !!profile
    && profile.hidden_from_others !== true
    && !profile.account_deleted_at;
}

export function canDiscoverProfile(profile, { isAdmin = false } = {}) {
  return isCommunityVisibleProfile(profile)
    && (isAdmin || profile.is_private !== true);
}
