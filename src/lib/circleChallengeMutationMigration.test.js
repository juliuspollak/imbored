import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(join(root, "supabase/migrations/202608232300_atomic_single_occurrence_challenge_edits.sql"), "utf8");

test("existing challenge edits update only the selected occurrence and preserve series metadata", () => {
  const editBranch = sql.slice(sql.indexOf("if target_challenge_id is not null"), sql.indexOf("if repeat_weekly_in is null"));
  assert.match(editBranch, /where id=current_challenge\.id/);
  assert.match(editBranch, /return current_challenge\.id/);
  assert.doesNotMatch(editBranch, /delete from public\.circle_weekly_challenges/);
  assert.doesNotMatch(editBranch, /series_id\s*=/);
  assert.doesNotMatch(editBranch, /occurrence_number\s*=/);
  assert.doesNotMatch(editBranch, /series_weeks\s*=/);
});

test("stake validation occurs before challenge creation in the same database function", () => {
  const validation = sql.indexOf("if stake_requested_in then");
  const creation = sql.indexOf("insert into public.circle_weekly_challenges");
  assert.ok(validation > 0 && creation > validation);
  assert.match(sql, /status='active' and circle_id=target_circle_id/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path to 'public'/);
  assert.match(sql, /grant execute .* to authenticated/);
});

test("new challenges still support non-stake and atomic stake values", () => {
  assert.match(sql, /stake_requested_in boolean default false/);
  assert.match(sql, /case when stake_requested_in and week_offset=0 then stake_reward_id_in else null end/);
  assert.match(sql, /case when stake_requested_in and week_offset=0 then stake_split_method_in else null end/);
});
