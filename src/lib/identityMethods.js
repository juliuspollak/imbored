export function identityProvider(identity) {
  return identity?.provider || identity?.identity_data?.provider || "email";
}

export function canUnlinkIdentity({ identities = [], passkeyCount = 0 }, identity) {
  const remaining = identities.filter((candidate) => candidate.id !== identity?.id);
  return remaining.length + Math.max(0, Number(passkeyCount) || 0) > 0;
}
