import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../../supabase/migrations/202609071200_auto_approve_normal_accounts.sql");
const schema = read("../../supabase/schemas/public.sql");
const app = read("../App.jsx");
const main = read("../main.jsx");
const auth = read("./AuthContext.jsx");
const players = read("../AdminPlayers.jsx");
const profile = read("../ProfileSetup.jsx");

test("new profiles are active immediately without weakening protected account fields", () => {
  assert.match(migration, /alter column is_approved set default true/);
  assert.match(migration, /if tg_op='INSERT'[\s\S]*new\.is_admin:=false;[\s\S]*new\.is_approved:=true;/);
  assert.match(migration, /new\.is_blocked:=false/);
  assert.match(migration, /new\.account_deleted_at:=null/);
  assert.match(schema, /is_approved boolean DEFAULT true NOT NULL/);
});

test("existing pending accounts are backfilled without approving blocked or deleted accounts", () => {
  assert.match(migration, /update public\.profiles[\s\S]*set is_approved=true/);
  assert.match(migration, /where is_admin=false[\s\S]*and is_approved=false[\s\S]*coalesce\(is_blocked,false\)=false[\s\S]*account_deleted_at is null/);
  assert.match(schema, /CREATE FUNCTION public\.is_approved_user[\s\S]*account_deleted_at is null[\s\S]*is_blocked,false\)=false[\s\S]*is_approved=true/);
});

test("existing approved accounts are outside the one-time update", () => {
  assert.match(migration, /where is_admin=false[\s\S]*and is_approved=false/);
});

test("blocking remains authoritative and restoring produces a usable active account", () => {
  assert.match(migration, /is_blocked=blocked/);
  assert.match(migration, /is_approved=case when blocked then is_approved else true end/);
  assert.match(app, /if \(profile\.account_deleted_at\)[\s\S]*if \(profile\.is_blocked\) return <BlockedAccount/);
});

test("every supported sign-in method reaches the same automatic profile onboarding", () => {
  assert.match(auth, /signInWithOAuthProvider\("apple"\)/);
  assert.match(auth, /signInWithOAuthProvider\("google"\)/);
  assert.match(auth, /signInWithEmail/);
  assert.match(auth, /signInWithPasskey/);
  assert.match(app, /if \(!profile\) return <ProfileSetup \/>/);
});

test("manual approval UI is retired while moderation and privacy remain", () => {
  assert.doesNotMatch(app, /PendingApproval|pendingPlayersCount/);
  assert.doesNotMatch(main, /InvitedApprovalNotice/);
  assert.doesNotMatch(players, /Needs approval|Require approval|handleApproval|Approving…/);
  assert.match(players, /setActionTarget\(\{ type: "block"/);
  assert.match(players, /player\.is_blocked \? handleAccountAction\("unblock"/);
  assert.match(players, /setUserHidden/);
  assert.match(profile, /is_private/);
  assert.match(profile, /show_stats_to_others/);
});

test("the migration changes account activation only, not Circle, chat, reward, or RLS permissions", () => {
  assert.doesNotMatch(migration, /create policy|drop policy|disable row level security/i);
  assert.doesNotMatch(migration, /circle_members|direct_messages|reward_redemptions/);
});
