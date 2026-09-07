import test from "node:test";
import assert from "node:assert/strict";
import { configuredAppStoreUrl, shouldShowPublicLanding } from "./publicLanding.js";

test("only a plain browser root shows the public landing page", () => {
  assert.equal(shouldShowPublicLanding({ pathname:"/" }), true);
  assert.equal(shouldShowPublicLanding({ native:true, pathname:"/" }), false);
  assert.equal(shouldShowPublicLanding({ pathname:"/", search:"?puzzle=42" }), false);
  assert.equal(shouldShowPublicLanding({ pathname:"/", search:"?auth_return=profile" }), false);
  assert.equal(shouldShowPublicLanding({ pathname:"/", hash:"#access_token=callback" }), false);
  assert.equal(shouldShowPublicLanding({ pathname:"/play" }), false);
});

test("the App Store link must be explicitly configured and Apple-hosted", () => {
  assert.equal(configuredAppStoreUrl({}), null);
  assert.equal(configuredAppStoreUrl({ VITE_APP_STORE_URL:"https://example.com/invented" }), null);
  assert.equal(configuredAppStoreUrl({ VITE_APP_STORE_URL:"https://apps.apple.com/au/app/example/id123" }), "https://apps.apple.com/au/app/example/id123");
});
