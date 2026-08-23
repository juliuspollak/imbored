import test from "node:test";
import assert from "node:assert/strict";
import { shouldLockNativeDocumentScroll } from "./nativeScrollLock.js";

const gameIds = ["hive", "zoom", "gridly"];

test("native games lock document scrolling and normal routes release it", () => {
  assert.equal(shouldLockNativeDocumentScroll({ native:true, active:"zoom", scoreChallenge:null, gameIds }), true);
  assert.equal(shouldLockNativeDocumentScroll({ native:true, active:"circles", scoreChallenge:null, gameIds }), false);
  assert.equal(shouldLockNativeDocumentScroll({ native:true, active:null, scoreChallenge:null, gameIds }), false);
});

test("web pages never receive the native body lock", () => {
  assert.equal(shouldLockNativeDocumentScroll({ native:false, active:"zoom", scoreChallenge:{ id:1 }, gameIds }), false);
});
