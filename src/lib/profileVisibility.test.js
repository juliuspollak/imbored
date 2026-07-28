import test from "node:test";
import assert from "node:assert/strict";
import {
  canDiscoverProfile,
  isCommunityVisibleProfile,
} from "./profileVisibility.js";

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
