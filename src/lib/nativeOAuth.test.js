import test from "node:test";
import assert from "node:assert/strict";
import { completeNativeOAuthCallback, isOAuthCancellation, parseNativeOAuthCallback } from "./nativeOAuth.js";

test("native OAuth accepts only the exact registered callback and a PKCE code", () => {
  assert.deepEqual(parseNativeOAuthCallback("imbored://auth/callback?code=secure-code"), {
    url:"imbored://auth/callback?code=secure-code",
    code:"secure-code",
  });
  assert.equal(parseNativeOAuthCallback("imbored://auth/callback-evil?code=secure-code"), null);
  assert.equal(parseNativeOAuthCallback("https://auth/callback?code=secure-code"), null);
  assert.match(parseNativeOAuthCallback("imbored://auth/callback#access_token=legacy").errorDescription, /PKCE/);
});

test("Apple or Google cancellation is treated as a quiet user choice",()=>{
  assert.equal(isOAuthCancellation("access_denied"),true);
  assert.equal(isOAuthCancellation(new Error("User cancelled the login")),true);
  assert.equal(isOAuthCancellation(new Error("PKCE exchange failed")),false);
});

test("duplicate callback delivery performs one exchange", async () => {
  let exchanges = 0;
  const url = "imbored://auth/callback?code=duplicate-code";
  const exchange = async () => { exchanges += 1; };
  await Promise.all([
    completeNativeOAuthCallback(url, exchange),
    completeNativeOAuthCallback(url, exchange),
  ]);
  assert.equal(exchanges, 1);
  await completeNativeOAuthCallback(url, exchange);
  assert.equal(exchanges, 1);
});

test("a failed callback exchange can retry when iOS redelivers it", async () => {
  let exchanges = 0;
  const url = "imbored://auth/callback?code=retryable-code";
  await assert.rejects(completeNativeOAuthCallback(url, async () => {
    exchanges += 1;
    throw new Error("storage not ready");
  }), /storage not ready/);
  await completeNativeOAuthCallback(url, async () => { exchanges += 1; });
  assert.equal(exchanges, 2);
});
