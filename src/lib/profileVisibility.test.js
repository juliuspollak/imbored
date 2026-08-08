import test from "node:test";
import assert from "node:assert/strict";
import {
  canContinueConversation,
  canDiscoverProfile,
  isCommunityVisibleProfile,
  isStandingsVisible,
} from "./profileVisibility.js";

// Player Stats used to list private players to everyone, because it filtered
// on hidden_from_others alone.
test("private players are in the community leaderboard only for themselves", () => {
  const privateProfile = { id: "quiet", hidden_from_others: false, is_private: true, account_deleted_at: null };
  const hidden = { id: "gone", hidden_from_others: true, is_private: false, account_deleted_at: null };
  const open = { id: "loud", hidden_from_others: false, is_private: false, account_deleted_at: null };

  assert.equal(isStandingsVisible(privateProfile, "someone-else"), false);
  assert.equal(isStandingsVisible(privateProfile, "quiet"), true);
  assert.equal(isStandingsVisible(hidden, "someone-else"), false);
  assert.equal(isStandingsVisible(open, "someone-else"), true);
});

test("hidden profiles stay out of community surfaces for every role", () => {
  const hidden = { hidden_from_others: true, is_private: false, account_deleted_at: null };
  assert.equal(isCommunityVisibleProfile(hidden), false);
  assert.equal(canDiscoverProfile(hidden), false);
  assert.equal(canDiscoverProfile(hidden, { isAdmin: true }), false);
});

test("private profiles differ from admin-hidden profiles", () => {
  const privateProfile = { hidden_from_others: false, is_private: true, account_deleted_at: null };
  assert.equal(isCommunityVisibleProfile(privateProfile), true);
  assert.equal(canDiscoverProfile(privateProfile), false);
  assert.equal(canDiscoverProfile(privateProfile, { isAdmin: true }), true);
});

// The unread badge counts the continuity set, and Chats lists the continuity
// set. Anything undiscoverable that stays continuable is a conversation the
// player can still open — which is exactly what keeps a badge clearable.
test("a player you cannot discover can still be replied to", () => {
  const privateProfile = { hidden_from_others: false, is_private: true, account_deleted_at: null };
  const banned = { hidden_from_others: false, is_private: false, is_blocked: true, account_deleted_at: null };
  const pending = { hidden_from_others: false, is_private: false, is_approved: false, account_deleted_at: null };

  for (const profile of [privateProfile, banned, pending]) {
    assert.equal(canContinueConversation(profile), true);
  }
  assert.equal(canDiscoverProfile(privateProfile), false);
});

test("conversations end where the messages stop being readable", () => {
  const hidden = { hidden_from_others: true, is_private: false, account_deleted_at: null };
  const deleted = { hidden_from_others: false, is_private: false, account_deleted_at: "2026-01-01T00:00:00Z" };
  const stranger = { hidden_from_others: false, is_private: false, account_deleted_at: null };

  assert.equal(canContinueConversation(hidden), false);
  assert.equal(canContinueConversation(deleted), false);
  // A player block hides the rows both ways, so there is nothing left to open.
  assert.equal(canContinueConversation(stranger, { blockedBetween: true }), false);
  // Challenge results are self-addressed and never unreachable.
  assert.equal(canContinueConversation(null, { isSelf: true }), true);
});
