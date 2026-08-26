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
