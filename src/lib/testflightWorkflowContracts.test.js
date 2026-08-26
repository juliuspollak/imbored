import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

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

test("Capacitor sync resolves CocoaPods through the Ruby 3.3 bundle", () => {
  const workflow = read("../../.github/workflows/testflight.yml");
  const rubySetupIndex = workflow.indexOf("uses: ruby/setup-ruby@v1");
  const binstubIndex = workflow.indexOf("bundle binstubs cocoapods");
  const syncIndex = workflow.indexOf("run: npm run ios:sync");
  assert.match(workflow, /ruby-version: "3\.3"/);
  assert.match(workflow, /bundler-cache: true/);
  assert.ok(rubySetupIndex > -1 && rubySetupIndex < binstubIndex && binstubIndex < syncIndex);
  assert.match(workflow, /echo "\$RUNNER_TEMP\/bundle-bin" >> "\$GITHUB_PATH"/);
  assert.match(workflow, /bundle exec pod --version/);
  assert.match(workflow, /which pod[\s\S]*pod --version/);
  assert.match(workflow, /\$RUNNER_TEMP\/bundle-bin\/pod/);
  assert.doesNotMatch(workflow, /brew (?:install|upgrade).*cocoapods|\/opt\/homebrew.*pod/);
});
