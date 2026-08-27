import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sandboxPushTestEnabled } from "./sandboxPushTestConfig.js";

test("sandbox push test UI requires both explicit flags",()=>{
  assert.equal(sandboxPushTestEnabled({VITE_ENABLE_SANDBOX_PUSH_TEST:"true",VITE_APNS_ENVIRONMENT:"sandbox"}),true);
  assert.equal(sandboxPushTestEnabled({VITE_ENABLE_SANDBOX_PUSH_TEST:"true",VITE_APNS_ENVIRONMENT:"production"}),false);
  assert.equal(sandboxPushTestEnabled({VITE_APNS_ENVIRONMENT:"sandbox"}),false);
  assert.equal(sandboxPushTestEnabled({}),false);
});

test("TestFlight workflow enables neither sandbox APNs nor sandbox push test UI",()=>{
  const workflow=readFileSync(new URL("../../.github/workflows/testflight.yml",import.meta.url),"utf8");
  assert.doesNotMatch(workflow,/VITE_ENABLE_SANDBOX_PUSH_TEST/);
  assert.doesNotMatch(workflow,/VITE_APNS_ENVIRONMENT\s*:\s*sandbox/);
});
