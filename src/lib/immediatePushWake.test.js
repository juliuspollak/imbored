import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requestPushWake } from "./pushWakeCore.js";

const chat=readFileSync(new URL("../Chat.jsx",import.meta.url),"utf8");
const pokes=readFileSync(new URL("./pokes.js",import.meta.url),"utf8");
const handler=readFileSync(new URL("../../supabase/functions/send-push-notifications/handler.ts",import.meta.url),"utf8");
const outbox=readFileSync(new URL("../../supabase/migrations/202608271200_server_push_notification_outbox.sql",import.meta.url),"utf8");

test("successful message and Poke enqueue each attempt an immediate wake",()=>{
  assert.match(chat,/if \(sendError\)[\s\S]*else \{[\s\S]*void wakePushNotifications\(\)/);
  assert.match(pokes,/if \(error\)[\s\S]*else void wakePushNotifications\(\)/);
});
test("wake failure is best-effort and does not fail the saved message or Poke",async()=>{
  const client={functions:{invoke:async()=>{throw new Error("offline");}}};
  assert.equal(await requestPushWake(client),false);
  assert.match(chat,/setMessages\([\s\S]*void wakePushNotifications\(\)/);
  assert.match(pokes,/return \{ error \}/);
});
test("client wake sends only a fixed mode and contains no worker credential",()=>{
  const clientSource=readFileSync(new URL("./pushWakeCore.js",import.meta.url),"utf8");
  assert.match(clientSource,/body: \{ mode:"wake" \}/);
  assert.doesNotMatch(clientSource,/WORKER_SECRET|recipient|device|eventId|user_id/);
  for(const source of [chat,pokes,clientSource,readFileSync(new URL("./pushWake.js",import.meta.url),"utf8")]) {
    assert.doesNotMatch(source,/PUSH_WORKER_SECRET|VITE_PUSH_WORKER/);
  }
});
test("authenticated wake validates JWT and rejects caller-selected targets",()=>{
  assert.match(handler,/wakeMode[\s\S]*createUserClient\(authorization\)\.auth\.getUser\(\)/);
  assert.match(handler,/Object\.keys\(payload\|\|\{\}\)\.length!==1/);
  assert.match(handler,/lastWakeByUser/);
});
test("scheduled recovery and immediate execution share lease/dedupe protection",()=>{
  assert.match(outbox,/unique\(event_id,device_registration_id\)/);
  assert.match(outbox,/for update skip locked/);
  assert.match(outbox,/status='sending'/);
  assert.match(handler,/if\(!wakeMode&&\(!expected/);
});
