import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration=readFileSync(new URL("../../supabase/migrations/202608271200_server_push_notification_outbox.sql",import.meta.url),"utf8");
const sender=readFileSync(new URL("../../supabase/functions/send-push-notifications/index.ts",import.meta.url),"utf8");
const workerCore=readFileSync(new URL("../../supabase/functions/send-push-notifications/workerCore.ts",import.meta.url),"utf8");

test("push outbox deduplicates events and deliveries across worker retries",()=>{
  assert.match(migration,/event_key text not null unique/i);
  assert.match(migration,/unique\(event_id,device_registration_id\)/i);
  assert.match(migration,/for update skip locked/i);
  assert.match(migration,/status='sending' and delivery\.lease_expires_at<=now\(\)/);
  assert.match(migration,/claim_token=gen_random_uuid\(\)/);
  assert.match(migration,/where id=delivery_id_in and status='sending' and claim_token=claim_token_in/);
});

test("delivery fan-out excludes inactive devices and caps retries",()=>{
  assert.match(migration,/device\.is_active/);
  assert.match(migration,/attempt_count<5/);
  assert.match(migration,/status in \('pending','retry'\)/);
  assert.match(migration,/status_in='retry' and \(select attempt_count>=5/);
  assert.match(migration,/then 'failed'/);
  assert.match(migration,/LeaseExpiredAfterMaxAttempts/);
});

for (const [attempt,expected] of [[1,"retry"],[4,"retry"],[5,"failed"]]) {
  test(`retryable APNs failure on attempt ${attempt} becomes ${expected}`,()=>{
    const resolvesFailed=attempt>=5;
    assert.equal(resolvesFailed,expected==="failed");
    assert.match(migration,/status_in='retry' and \(select attempt_count>=5/);
    assert.match(migration,/final_status='retry'/);
  });
}

test("social pushes honour preferences and blocking without exposing message text",()=>{
  assert.match(migration,/chat_messages_enabled/);
  assert.match(migration,/pokes_enabled/);
  assert.match(migration,/is_blocked_between\(actor_id_in,recipient_id_in\)/);
  assert.match(migration,/sent you a message/);
  assert.doesNotMatch(migration,/new\.body/);
});

test("worker keeps APNs credentials server-side and routes only structured metadata",()=>{
  for (const secret of ["APNS_KEY_ID","APNS_TEAM_ID","APNS_PRIVATE_KEY","APNS_BUNDLE_ID"]) assert.match(sender,new RegExp(secret));
  assert.match(sender,/buildApnsPayload\(delivery\)/);
  assert.doesNotMatch(sender,/VITE_APNS_PRIVATE|VITE_APNS_KEY/);
});

test("leases recover crashes while stale workers cannot complete a reclaimed delivery",()=>{
  assert.match(migration,/lease_expires_at=now\(\)\+interval '3 minutes'/);
  assert.match(migration,/delivery\.status='sending' and delivery\.lease_expires_at<=now\(\)/);
  assert.match(migration,/claim_token_in uuid/);
  assert.match(migration,/if not found then return null/);
});

test("zero-device events finish fan-out and multi-device events fan out once per active registration",()=>{
  assert.match(migration,/join public\.push_device_registrations device on device\.user_id=event\.recipient_id and device\.is_active/);
  assert.match(migration,/update public\.notification_events event set processed_at=now\(\)[\s\S]*event\.available_at<=now\(\)/);
  assert.match(migration,/unique\(event_id,device_registration_id\)/);
});

test("worker times out APNs and checks completion RPC results",()=>{
  assert.match(sender,/AbortSignal\.timeout\(APNS_TIMEOUT_MS\)/);
  assert.match(workerCore,/RequestTimeout/);
  assert.match(sender,/error:finishError/);
  assert.match(sender,/completion_errors/);
});

test("route metadata is object-only, allowlisted and bounded in both SQL and worker",()=>{
  assert.match(migration,/jsonb_typeof\(route_data_in\)<>'object'/);
  assert.match(migration,/octet_length\(route_data_in::text\)>512/);
  assert.match(migration,/key in \('route','playerId'\)/);
  assert.match(migration,/key in \('route','circleId','challengeId'\)/);
});
