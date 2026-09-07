import test from "node:test";
import assert from "node:assert/strict";
import { configuredAppStoreUrl, shouldShowPublicLanding, shouldShowPublicPrivacy, shouldShowPublicSupport } from "./publicLanding.js";

test("only a plain browser root shows the public landing page", () => {
  assert.equal(shouldShowPublicLanding({ pathname:"/" }), true);
  assert.equal(shouldShowPublicLanding({ native:true, pathname:"/" }), false);
  assert.equal(shouldShowPublicLanding({ pathname:"/", search:"?puzzle=42" }), false);
  assert.equal(shouldShowPublicLanding({ pathname:"/", search:"?auth_return=profile" }), false);
  assert.equal(shouldShowPublicLanding({ pathname:"/", hash:"#access_token=callback" }), false);
  assert.equal(shouldShowPublicLanding({ pathname:"/play" }), false);
});

test("only a plain browser support path shows the public support page", () => {
  assert.equal(shouldShowPublicSupport({ pathname:"/support" }), true);
  assert.equal(shouldShowPublicSupport({ pathname:"/support/" }), true);
  assert.equal(shouldShowPublicSupport({ native:true, pathname:"/support" }), false);
  assert.equal(shouldShowPublicSupport({ pathname:"/support", search:"?code=oauth-code" }), false);
  assert.equal(shouldShowPublicSupport({ pathname:"/support", hash:"#access_token=callback" }), false);
  assert.equal(shouldShowPublicSupport({ pathname:"/challenge/example" }), false);
  assert.equal(shouldShowPublicSupport({ pathname:"/play", search:"?puzzle=42" }), false);
});

test("only a plain browser privacy path shows the public privacy page", () => {
  assert.equal(shouldShowPublicPrivacy({ pathname:"/privacy" }), true);
  assert.equal(shouldShowPublicPrivacy({ pathname:"/privacy/" }), true);
  assert.equal(shouldShowPublicPrivacy({ native:true, pathname:"/privacy" }), false);
  assert.equal(shouldShowPublicPrivacy({ pathname:"/privacy", search:"?code=oauth-code" }), false);
  assert.equal(shouldShowPublicPrivacy({ pathname:"/privacy", hash:"#access_token=callback" }), false);
  assert.equal(shouldShowPublicPrivacy({ pathname:"/support" }), false);
  assert.equal(shouldShowPublicPrivacy({ pathname:"/challenge/example" }), false);
  assert.equal(shouldShowPublicPrivacy({ pathname:"/", search:"?puzzle=42" }), false);
});

test("the App Store link must be explicitly configured and Apple-hosted", () => {
  assert.equal(configuredAppStoreUrl({}), null);
  assert.equal(configuredAppStoreUrl({ VITE_APP_STORE_URL:"https://example.com/invented" }), null);
  assert.equal(configuredAppStoreUrl({ VITE_APP_STORE_URL:"https://apps.apple.com/au/app/example/id123" }), "https://apps.apple.com/au/app/example/id123");
});
