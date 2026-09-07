import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { APP_REVIEW_EMAIL, signInReviewAccount } from "./appReviewAuth.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const login = read("../Login.jsx");
const form = read("../components/AppReviewAccess.jsx");
const auth = read("./AuthContext.jsx");
const app = read("../App.jsx");

test("review credentials call password auth unchanged and return its ordinary session", async () => {
  const password = ` ${randomBytes(32).toString("hex")} `;
  const result = { data: { session: { user: { id: "review-user" } } }, error: null };
  const calls = [];
  const client = { auth: { signInWithPassword: async (credentials) => { calls.push(credentials); return result; } } };
  assert.equal(await signInReviewAccount(client, "  REVIEW@IMBORED.AU ", password), result);
  assert.deepEqual(calls, [{ email: APP_REVIEW_EMAIL, password }]);
});

test("other emails and missing passwords never call Supabase", async () => {
  let calls = 0;
  const client = { auth: { signInWithPassword: async () => { calls++; } } };
  for (const email of ["normal@example.com", "review@imbored.au.evil.example", "", null]) {
    assert.match((await signInReviewAccount(client, email, randomBytes(16).toString("hex"))).error.message, /dedicated review account/);
  }
  for (const password of ["", null, undefined]) {
    assert.match((await signInReviewAccount(client, APP_REVIEW_EMAIL, password)).error.message, /Enter the App Review password/);
  }
  assert.equal(calls, 0);
});

test("auth rejection and network failures produce safe errors without leaking server details", async () => {
  const password = randomBytes(32).toString("hex");
  for (const throws of [false, true]) {
    const client = { auth: { signInWithPassword: async () => {
      const error = new Error(password);
      if (throws) throw error;
      return { error };
    } } };
    const result = await signInReviewAccount(client, APP_REVIEW_EMAIL, password);
    assert.ok(result.error);
    assert.ok(!result.error.message.includes(password));
  }
  assert.match((await signInReviewAccount(null, APP_REVIEW_EMAIL, password)).error.message, /configured/);
});

test("review UI opens separately, labels fields, clears password, and offers a way back", () => {
  assert.match(login, /onClick=\{\(\) => \{ setError\(null\); setReviewAccess\(true\); \}\}/);
  assert.match(login, /reviewAccess \? \([\s\S]*<AppReviewAccess onBack=\{\(\) => setReviewAccess\(false\)\}/);
  for (const field of ["email", "password"]) {
    assert.ok(form.includes(`htmlFor="app-review-${field}"`));
    assert.ok(form.includes(`id="app-review-${field}"`));
  }
  assert.match(form, /type="password" autoComplete="current-password"/);
  assert.match(form, /loading=\{busy\}/);
  assert.match(form, /role="alert"/);
  assert.match(form, /finally \{\s*setPassword\(""\)/);
  assert.match(form, /onClick=\{onBack\}/);
});

test("review password comes only from form input, with no persistence or bypass", () => {
  const helper = read("./appReviewAuth.js");
  assert.match(form, /\[password, setPassword\] = useState\(""\)/);
  assert.match(form, /setPassword\(event.target.value\)/);
  assert.match(form, /signInWithAppReview\(email, password\)/);
  assert.match(helper, /signInWithPassword\(\{ email: normalizedEmail, password \}\)/);
  assert.doesNotMatch(form + helper, /localStorage|sessionStorage|import.meta.env|service_role|signUp|verifyOtp|setSession/);
  assert.doesNotMatch(helper, /password\s*[:=]\s*["'`]/);
});

test("normal OTP remains eight digits and retains its send and verify behavior", () => {
  assert.match(login, /const EMAIL_OTP_LENGTH = 8;/);
  assert.match(login, /cleanCode.length !== EMAIL_OTP_LENGTH/);
  assert.match(login, /maxLength=\{EMAIL_OTP_LENGTH\}/);
  assert.match(login, /await signInWithEmail\(cleanEmail\)/);
  assert.match(login, /await verifyCode\(email, cleanCode\)/);
  assert.match(auth, /signInWithOtp\(\{[\s\S]*shouldCreateUser: true/);
  assert.match(auth, /verifyOtp\(\{ email, token, type: "email" \}\)/);
});

test("Apple, Google and passkey retain their original provider paths", () => {
  for (const provider of ["Apple", "Google", "Passkey"]) {
    assert.ok(login.includes(`await signInWith${provider}()`));
  }
  assert.match(auth, /signInWithOAuthProvider\("apple"\)/);
  assert.match(auth, /signInWithOAuthProvider\("google"\)/);
  assert.match(auth, /return supabase.auth.signInWithPasskey\(\)/);
});

test("review uses the shared session listener, onboarding and protected account gates", () => {
  assert.match(auth, /return signInReviewAccount\(supabase, email, password\)/);
  assert.match(auth, /onAuthStateChange\([\s\S]*setSession\(newSession\)/);
  assert.match(auth, /loadProfile\(newSession.user.id/);
  assert.match(app, /if \(!user\) return <Login/);
  assert.match(app, /if \(!profile\) return <ProfileSetup/);
  assert.match(app, /if \(profile.account_deleted_at\)[\s\S]*if \(profile.is_blocked\) return <BlockedAccount/);
  assert.doesNotMatch(app, /APP_REVIEW_EMAIL|review@imbored.au|PendingApproval/);
  assert.match(read("../../supabase/schemas/public.sql"), /is_approved boolean DEFAULT true NOT NULL/);
});
