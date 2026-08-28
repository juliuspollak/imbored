import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql=readFileSync(new URL("../../supabase/migrations/202608291000_wake_push_worker_after_social_enqueue.sql",import.meta.url),"utf8");
const outbox=readFileSync(new URL("../../supabase/migrations/202608271200_server_push_notification_outbox.sql",import.meta.url),"utf8");
test("chat and poke each enqueue one deduplicated event",()=>{ assert.equal((sql.match(/queued_event_id:=public\.enqueue_notification_event\(/g)||[]).length,2);assert.match(sql,/'chat:'\|\|new\.id/);assert.match(sql,/'poke:'\|\|new\.id/);assert.match(outbox,/on conflict\(event_key\) do nothing returning id into inserted_id/); });
test("successful enqueue attempts one server-side post-commit worker wake-up",()=>{ assert.match(sql,/if queued_event_id is not null then perform public\.wake_push_worker\(\)/);assert.match(sql,/net\.http_post/);assert.match(sql,/vault\.decrypted_secrets/);assert.doesNotMatch(sql,/grant execute on function public\.wake_push_worker\(\) to authenticated/); });
test("wake-up failure is swallowed so message commit and scheduled recovery survive",()=>{ assert.match(sql,/exception when others then[\s\S]*raise warning/);assert.match(outbox,/status in \('pending','retry'\)/);assert.match(outbox,/unique\(event_id,device_registration_id\)/);assert.match(outbox,/on conflict do nothing/); });
