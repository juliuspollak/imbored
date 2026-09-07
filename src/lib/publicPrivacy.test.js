import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUPPORT_EMAIL } from "./supportContact.js";

const privacyPage = readFileSync(new URL("../PublicPrivacy.jsx", import.meta.url), "utf8");
const bootstrap = readFileSync(new URL("../main.jsx", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));

test("public privacy page has its policy, contact, and public navigation", () => {
  assert.equal(SUPPORT_EMAIL, "support@imbored.au");
  assert.match(privacyPage, /<h1>Privacy Policy<\/h1>/);
  assert.match(privacyPage, /mailto:\$\{SUPPORT_EMAIL\}/);
  assert.match(privacyPage, /<a href="\/">Home<\/a>/);
  assert.match(privacyPage, /<a href="\/support">Support<\/a>/);
});

test("privacy uses the guarded public route and existing SPA fallback", () => {
  assert.match(bootstrap, /shouldShowPublicPrivacy\(publicLocation\)\) return <PublicPrivacy/);
  assert.match(bootstrap, /<FullApplication puzzleStatId=\{puzzleStatId\}/);
  assert.deepEqual(vercel.rewrites, [{ source:"/(.*)", destination:"/index.html" }]);
});

test("policy names only integrations evidenced by the application", () => {
  for (const service of ["Supabase", "Apple", "Google", "Resend", "Vercel", "GitHub", "FlagCDN"]) assert.match(privacyPage, new RegExp(service));
  assert.doesNotMatch(privacyPage, /Google Analytics|Sentry|Crashlytics|advertising partners/);
});
