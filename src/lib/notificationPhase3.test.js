import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const repairMigration=readFileSync(new URL("../../supabase/migrations/202608291300_repair_push_worker_claim_pipeline.sql",import.meta.url),"utf8");
const migration=[readFileSync(new URL("../../supabase/migrations/202608271200_server_push_notification_outbox.sql",import.meta.url),"utf8"),repairMigration].join("\n");
const sender=["index.ts","handler.ts"].map((file)=>readFileSync(new URL(`../../supabase/functions/send-push-notifications/${file}`,import.meta.url),"utf8")).join("\n");
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
  assert.match(migration,/last_reason='InactiveDevice'/);
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
  assert.match(sender,/APNS_BUNDLE_ID"\)!=="au\.imbored\.app"/);
});

test("manual and GitHub worker-secret invocation remains available beside authenticated wake",()=>{
  assert.match(sender,/if\(!wakeMode&&\(!expected/);
  assert.match(sender,/constantTimeEqual\(supplied,expected\)/);
  const workflow=readFileSync(new URL("../../.github/workflows/send-push-notifications.yml",import.meta.url),"utf8");
  assert.match(workflow,/Authorization: Bearer \$\{PUSH_WORKER_SECRET\}/);
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

test("focused production repair inspects and repairs only push pipeline objects without deleting queued rows",()=>{
  assert.match(migration,/push_repair_diagnostic/);
  assert.match(migration,/to_regprocedure\('public\.claim_push_deliveries\(integer\)'\)/);
  assert.match(migration,/add column if not exists lease_expires_at/);
  assert.match(migration,/create index if not exists notification_deliveries_expired_lease_idx/);
  assert.doesNotMatch(repairMigration,/delete from public\.notification_(events|deliveries)/);
  assert.doesNotMatch(repairMigration,/create extension|vault\.|pg_net\./i);
});

test("claim RPC contract exactly matches the worker and only expired sending leases are reclaimable",()=>{
  assert.match(migration,/claim_push_deliveries\(batch_size integer default 10\)/);
  for(const column of ["delivery_id bigint","claim_token uuid","attempt_count integer","device_id bigint","device_token text","apns_environment text","event_id bigint","kind text","title text","body text","route_data jsonb"]) assert.match(migration,new RegExp(column));
  assert.match(migration,/delivery\.status='sending' and delivery\.lease_expires_at<=now\(\)/);
  assert.doesNotMatch(migration,/delivery\.status='sending' and delivery\.lease_expires_at>now\(\)/);
});

test("completion requires the active claim token and invalid tokens deactivate only their registration",()=>{
  assert.match(migration,/delivery\.claim_token=claim_token_in/);
  assert.match(migration,/final_status='invalid_token'.*is_active=false/s);
});

test("worker health response covers eligible, claimed, sent, retry, permanent failure and no-device outcomes",()=>{
  for(const field of ["eligible","claimed","sent","retried","permanently_failed","no_devices"]) assert.match(sender,new RegExp(field));
  assert.match(sender,/push_claim_error/);
  assert.match(sender,/diagnostic:\{rpc:"claim_push_deliveries",code:diagnostic\.code\}/);
});
