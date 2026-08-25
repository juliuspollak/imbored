import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("the committed iOS project consistently targets iOS 15", () => {
  const project = read("../../ios/App/App.xcodeproj/project.pbxproj");
  const targets = [...project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);/g)].map((match) => match[1]);
  assert.ok(targets.length > 0);
  assert.deepEqual([...new Set(targets)], ["15.0"]);
  assert.match(read("../../ios/App/Podfile"), /platform :ios, '15\.0'/);
});

test("the source plist declares that the app uses no non-exempt encryption", () => {
  const plist = read("../../ios/App/App/Info.plist");
  assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
});

test("push and remote-notification capabilities remain committed", () => {
  const project = read("../../ios/App/App.xcodeproj/project.pbxproj");
  const plist = read("../../ios/App/App/Info.plist");
  const entitlements = read("../../ios/App/App/App.entitlements");
  assert.match(project, /com\.apple\.Push = \{\s*enabled = 1;/);
  assert.match(project, /com\.apple\.BackgroundModes = \{\s*enabled = 1;/);
  assert.match(plist, /<string>remote-notification<\/string>/);
  assert.match(entitlements, /<key>aps-environment<\/key>/);
});
