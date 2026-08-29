import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const versionParts = (version) => version.split(".").map(Number);
const compareVersions = (left, right) => {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
};

test("TestFlight archive does not apply the app provisioning profile globally", () => {
  const workflow = read("../../.github/workflows/testflight.yml");
  const archive = workflow.match(/- name: Archive app[\s\S]*?(?=\n      - name:)/)?.[0] || "";
  assert.doesNotMatch(archive, /PROVISIONING_PROFILE_SPECIFIER|CODE_SIGN_STYLE|CODE_SIGN_IDENTITY/);
  assert.match(workflow, /provisioningProfiles:\$APP_IDENTIFIER string \$PROFILE_UUID/);
});

test("CI signing is target-scoped and imports a codesign-capable private key", () => {
  const workflow = read("../../.github/workflows/testflight.yml");
  const fastfile = read("../../fastlane/Fastfile");
  assert.match(fastfile, /targets: \["App"\]/);
  assert.match(fastfile, /build_configurations: \["Release"\]/);
  assert.match(workflow, /security import[^\n]+-f pkcs12 -k/);
  assert.doesNotMatch(workflow, /security import[^\n]+-t cert/);
  assert.match(workflow, /security set-key-partition-list -S apple-tool:,apple:/);
  assert.match(workflow, /security find-identity -v -p codesigning/);
  assert.match(workflow, /profile_certificate_hashes/);
});

test("TestFlight uses stable Xcode 26 while retaining the iOS 15 deployment target", () => {
  const workflow = read("../../.github/workflows/testflight.yml");
  const project = read("../../ios/App/App.xcodeproj/project.pbxproj");
  const podfile = read("../../ios/App/Podfile");
  assert.match(workflow, /runs-on: macos-26/);
  assert.match(workflow, /Xcode_26\*\.app/);
  assert.doesNotMatch(workflow, /Xcode_16|Xcode_27/);
  assert.match(workflow, /xcode-select --switch/);
  assert.match(workflow, /xcodebuild -version/);
  assert.match(workflow, /xcode_major[\s\S]*-ge 26/);
  assert.match(workflow, /xcrun --sdk iphoneos --show-sdk-version/);
  assert.match(workflow, /sdk_major[\s\S]*-ge 26/);
  assert.deepEqual([...project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);/g)].map((match) => match[1]), ["15.0", "15.0", "15.0", "15.0"]);
  assert.match(podfile, /platform :ios, '15\.0'/);
});

test("Capacitor sync uses a Ruby compatible with the locked bundle", () => {
  const workflow = read("../../.github/workflows/testflight.yml");
  const lockfile = read("../../Gemfile.lock");
  const rubySetupIndex = workflow.indexOf("uses: ruby/setup-ruby@v1");
  const binstubIndex = workflow.indexOf("bundle binstubs cocoapods");
  const syncIndex = workflow.indexOf("run: npm run ios:sync:production");
  const rubyVersion = workflow.match(/ruby-version: "(\d+)\.(\d+)(?:\.\d+)?"/)?.slice(1, 3).map(Number);
  const propertyListVersion = lockfile.match(/^    CFPropertyList \((\d+\.\d+\.\d+)\)$/m)?.[1];
  assert.deepEqual(rubyVersion, [3, 1]);
  assert.ok(propertyListVersion, "CFPropertyList must remain locked");
  assert.ok(compareVersions(propertyListVersion, "2.3.3") >= 0, "CFPropertyList must satisfy xcodeproj's lower bound");
  assert.ok(compareVersions(propertyListVersion, "4.0.0") < 0, "CFPropertyList must satisfy Fastlane and xcodeproj's upper bound");
  assert.match(lockfile, /fastlane \([^)]+\)[\s\S]*?CFPropertyList \(>= 2\.3, < 4\.0\.0\)/);
  assert.match(lockfile, /xcodeproj \([^)]+\)[\s\S]*?CFPropertyList \(>= 2\.3\.3, < 4\.0\)/);
  assert.match(lockfile, /BUNDLED WITH\s+2\.5\.23/);
  assert.match(workflow, /bundler-cache: true/);
  assert.ok(rubySetupIndex > -1 && rubySetupIndex < binstubIndex && binstubIndex < syncIndex);
  assert.match(workflow, /echo "\$RUNNER_TEMP\/bundle-bin" >> "\$GITHUB_PATH"/);
  assert.match(workflow, /bundle exec fastlane --version/);
  assert.match(workflow, /bundle exec pod --version/);
  assert.match(workflow, /which pod[\s\S]*pod --version/);
  assert.match(workflow, /\$RUNNER_TEMP\/bundle-bin\/pod/);
  assert.doesNotMatch(workflow, /brew (?:install|upgrade).*cocoapods|\/opt\/homebrew.*pod/);
});
