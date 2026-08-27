import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const auth = readFileSync(new URL("./AuthContext.jsx", import.meta.url), "utf8");
const profile = readFileSync(new URL("../ProfileSetup.jsx", import.meta.url), "utf8");

test("Apple identity linking uses the signed-in user's linkIdentity flow", () => {
  const implementation = auth.match(/async function linkAppleIdentity\(\)[\s\S]*?\n  }/)?.[0] || "";
  assert.match(implementation, /if \(!supabaseReady \|\| !session\)/);
  assert.match(implementation, /supabase\.auth\.linkIdentity\(\{/);
  assert.match(implementation, /provider: "apple"/);
  assert.doesNotMatch(implementation, /signInWithOAuth/);
  assert.doesNotMatch(implementation, /setSession|signOut/);
  assert.match(auth, /linkAppleIdentity,\n/);
});

test("Apple identity linking preserves native and web callback contracts", () => {
  const implementation = auth.match(/async function linkAppleIdentity\(\)[\s\S]*?\n  }/)?.[0] || "";
  assert.match(implementation, /native \? NATIVE_AUTH_CALLBACK : `\$\{window\.location\.origin\}\/\?auth_return=profile`/);
  assert.match(auth, /NATIVE_AUTH_CALLBACK[^\n]*nativeOAuth\.js/);
  assert.match(readFileSync(new URL("./nativeOAuth.js", import.meta.url), "utf8"), /NATIVE_AUTH_CALLBACK = "imbored:\/\/auth\/callback"/);
});

test("Profile shows Link for unlinked Apple and Connected for linked Apple", () => {
  assert.match(profile, /=== "apple"\) \? "Connected" : "Not connected"/);
  assert.match(profile, /=== "apple"\) && <Button[^>]*onClick=\{handleLinkApple\}>Link<\/Button>/);
  assert.match(profile, /const \{ error \} = await linkAppleIdentity\(\)/);
});

test("Apple linking cancellation is quiet on both callback and direct error paths", () => {
  assert.match(profile, /callbackError && !isOAuthCancellation\(callbackError\)/);
  assert.match(profile, /error && !isOAuthCancellation\(error\)/);
});
