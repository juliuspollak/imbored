import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUPPORT_EMAIL } from "./supportContact.js";

const supportPage = readFileSync(new URL("../PublicSupport.jsx", import.meta.url), "utf8");
const bootstrap = readFileSync(new URL("../main.jsx", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));

test("public support page publishes the customer support address and Home link", () => {
  assert.equal(SUPPORT_EMAIL, "support@imbored.au");
  assert.match(supportPage, /href=\"\/\">Home<\/a>/);
  assert.match(supportPage, /mailto:\$\{SUPPORT_EMAIL\}/);
});

test("bootstrap selects support through the guarded public route", () => {
  assert.match(bootstrap, /shouldShowPublicSupport\(publicLocation\)\) return <PublicSupport/);
  assert.match(bootstrap, /<FullApplication puzzleStatId=\{puzzleStatId\}/);
  assert.deepEqual(vercel.rewrites, [{ source:"/(.*)", destination:"/index.html" }]);
});
