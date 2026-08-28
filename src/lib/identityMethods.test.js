import test from "node:test";
import assert from "node:assert/strict";
import { canUnlinkIdentity, identityProvider } from "./identityMethods.js";

const apple={id:"apple",provider:"apple",identity_data:{email:"relay@privaterelay.appleid.com"}};
const google={id:"google",identity_data:{provider:"google"}};
const email={id:"email",provider:"email"};
test("providers come from identity metadata, not displayed email",()=>{ assert.equal(identityProvider(apple),"apple");assert.equal(identityProvider(google),"google"); });
test("last usable authentication method cannot be unlinked",()=>{ assert.equal(canUnlinkIdentity({identities:[apple]},apple),false);assert.equal(canUnlinkIdentity({identities:[apple],passkeyCount:1},apple),true);assert.equal(canUnlinkIdentity({identities:[apple,email]},apple),true); });
test("unlinking Apple and Google is identity-specific",()=>{ assert.deepEqual([apple,google].filter(i=>i.id!==apple.id).map(identityProvider),["google"]);assert.deepEqual([apple,google].filter(i=>i.id!==google.id).map(identityProvider),["apple"]); });
