import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const home=readFileSync(new URL("../Home.jsx",import.meta.url),"utf8");
const schema=readFileSync(new URL("../../supabase/schemas/public.sql",import.meta.url),"utf8");
const grace=readFileSync(new URL("../../supabase/migrations/202608291100_circle_challenge_grace_period.sql",import.meta.url),"utf8");
test("past Circle winners open score, rank, winner and participant standings",()=>{ assert.match(home,/chooseHistoricalChallenge\(item\)/);assert.match(home,/winnerId=\{item\.winner_id\}/);assert.match(home,/serverStandings=\{serverStandings\}/);assert.match(home,/item\.finisher_count/); });
test("expired ranked rounds remain server-closed while practice saves outside Circle scoring",()=>{ assert.match(grace,/Ranked play for this Circle challenge round is closed/);assert.match(home,/Ranked play is closed\. Practice/);assert.match(home,/onPlayModeChange\?\.\("practice"\);onSelect\(gameId\)/); });
test("historical results keep privacy-aware standings and binary displays as Twist",()=>{ assert.match(home,/Object\.values\(challengeProfiles\)/);assert.match(home,/GAME_NAMES\[gameId\]/); });
