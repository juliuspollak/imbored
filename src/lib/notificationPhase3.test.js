import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration=readFileSync(new URL("../../supabase/migrations/202608271200_server_push_notification_outbox.sql",import.meta.url),"utf8");
const sender=readFileSync(new URL("../../supabase/functions/send-push-notifications/index.ts",import.meta.url),"utf8");

test("push outbox deduplicates events and deliveries across worker retries",()=>{
  assert.match(migration,/event_key text not null unique/i);
  assert.match(migration,/unique\(event_id,device_registration_id\)/i);
  assert.match(migration,/for update skip locked/i);
});

test("delivery fan-out excludes inactive devices and caps retries",()=>{
  assert.match(migration,/device\.is_active/);
  assert.match(migration,/attempt_count<5/);
  assert.match(migration,/status in \('pending','retry'\)/);
});

test("social pushes honour preferences and blocking without exposing message text",()=>{
  assert.match(migration,/chat_messages_enabled/);
  assert.match(migration,/pokes_enabled/);
  assert.match(migration,/is_blocked_between\(actor_id_in,recipient_id_in\)/);
  assert.match(migration,/sent you a message/);
  assert.doesNotMatch(migration,/new\.body/);
});

test("worker keeps APNs credentials server-side and routes only structured metadata",()=>{
  for (const secret of ["APNS_KEY_ID","APNS_TEAM_ID","APNS_PRIVATE_KEY","APNS_BUNDLE_ID"]) assert.match(sender,new RegExp(secret));
  assert.match(sender,/\.\.\.delivery\.route_data/);
  assert.doesNotMatch(sender,/VITE_APNS_PRIVATE|VITE_APNS_KEY/);
});
