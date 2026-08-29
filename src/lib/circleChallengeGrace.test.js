import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rankStandings } from "./challengeStandingsScoring.js";

const migration=readFileSync(new URL("../../supabase/migrations/202608291100_circle_challenge_grace_period.sql",import.meta.url),"utf8");
const repairMigration=readFileSync(new URL("../../supabase/migrations/202608291200_reopen_premature_circle_challenge_winners.sql",import.meta.url),"utf8");
const finishEarlyMigration=readFileSync(new URL("../../supabase/migrations/202608291700_finalize_circle_when_everyone_finishes.sql",import.meta.url),"utf8");
const home=readFileSync(new URL("../Home.jsx",import.meta.url),"utf8");
const gate=readFileSync(new URL("../ChallengeGate.jsx",import.meta.url),"utf8");
const standings=readFileSync(new URL("../ChallengeStandings.jsx",import.meta.url),"utf8");

test("scheduled day and following 24-hour grace are ranked against the original date",()=>{
  assert.match(migration,/local_now<target_challenge_date::timestamp then 'scheduled'/);
  assert.match(migration,/local_now<\(target_challenge_date\+1\)::timestamp then 'open'/);
  assert.match(migration,/local_now<\(target_challenge_date\+2\)::timestamp then 'grace'/);
  assert.match(migration,/where challenge_id=challenge\.id and challenge_date=target_challenge_date/);
});
test("Friday remains ranked on Saturday grace and becomes final at Sunday local midnight",()=>{
  assert.match(migration,/\(target_challenge_date\+2\)::timestamp at time zone public\.resolve_timezone\(circle\.timezone\)/);
  assert.equal(new Date("2026-08-30T00:00:00+10:00").toISOString(),"2026-08-29T14:00:00.000Z");
});
test("DST cutoff is based on Circle local midnight rather than adding UTC hours",()=>{
  assert.equal(new Date("2026-10-05T00:00:00+11:00").toISOString(),"2026-10-04T13:00:00.000Z");
  assert.doesNotMatch(migration,/interval '48 hours'/);
});
test("server rejects starts and direct result inserts outside open or grace",()=>{
  assert.match(migration,/state not in \('open','grace'\)/);
  assert.match(migration,/before insert on public\.game_stats/);
  assert.match(migration,/circle_challenge_round_state\(challenge\.id,round_item\.challenge_date\) in \('open','grace'\)/);
});
test("grace waits for missing players but finalizes immediately once every eligible player finishes",()=>{
  assert.match(migration,/round_state\(target_challenge_id,last_round\)<>'final'/);
  assert.match(finishEarlyMigration,/circle_challenge_all_eligible_players_complete/);
  assert.match(finishEarlyMigration,/and not public\.circle_challenge_all_eligible_players_complete\(target_challenge_id\)/);
  assert.match(finishEarlyMigration,/challenge_closed_at is not null then return 'final'/);
  assert.match(finishEarlyMigration,/perform public\.finalize_circle_challenge\(item\.id\)/);
  assert.match(standings,/Current leader/);
  assert.match(standings,/closed \? "Winner/);
});
test("premature persisted winners are reopened without deleting ranked scores",()=>{
  assert.match(repairMigration,/round_state\(challenge\.id,rounds\.last_round\) in \('open','grace'\)/);
  assert.match(repairMigration,/set closed_at=null,loser_id=null/);
  assert.match(repairMigration,/delete from public\.circle_challenge_reward_awards/);
  assert.doesNotMatch(repairMigration,/delete from public\.game_stats/);
});
test("a late grace score can replace the provisional leader",()=>{
  const before=rankStandings([{userId:"early",score:110,played:1,hints:0,mistakes:0,adjusted:90,finishedAt:"a"}]);
  const after=rankStandings([...before.map(({rank,...entry})=>entry),{userId:"late",score:130,played:1,hints:0,mistakes:0,adjusted:80,finishedAt:"b"}]);
  assert.equal(before[0].userId,"early");
  assert.deepEqual(after.map((entry)=>entry.userId),["late","early"]);
});
test("missed grace action is ranked while expired history remains practice-only",()=>{
  assert.match(home,/Play missed challenge · ranked/);
  assert.match(gate,/Play missed challenge · ranked grace period/);
  assert.match(home,/Ranked play is closed\. Practice uses the game normally and cannot change these standings/);
});
test("late standings keep the backend binary key and customer-facing Twist label",()=>{
  assert.match(home,/GAME_NAMES\[round\.game\]/);
  assert.match(migration,/round_item\.game/);
});
