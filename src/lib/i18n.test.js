import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// i18n.jsx cannot be imported here — node's test runner does not parse JSX — so
// the translation tables are read as text. That is enough to catch the failure
// that actually happens: a key added to English and forgotten in Slovak, which
// falls back to showing the raw key to the player.
const source = readFileSync(fileURLToPath(new URL("./i18n.jsx", import.meta.url)), "utf8");

function parseTable(name) {
  const start = source.indexOf(`  ${name}: {`);
  assert.ok(start > -1, `missing ${name} translation table`);
  const end = name === "en" ? source.indexOf("  sk: {") : source.indexOf("\n};", start);
  const table = new Map();
  for (const match of source.slice(start, end).matchAll(/^\s+"([a-zA-Z0-9._]+)":\s*"((?:[^"\\]|\\.)*)"/gm)) {
    table.set(match[1], match[2]);
  }
  return table;
}

const en = parseTable("en");
const sk = parseTable("sk");
const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("every language defines the same keys", () => {
  assert.ok(en.size > 0, "no English keys parsed");
  assert.deepEqual([...en.keys()].filter((key) => !sk.has(key)), [], "keys missing a Slovak translation");
  assert.deepEqual([...sk.keys()].filter((key) => !en.has(key)), [], "Slovak keys with no English original");
});

// A translation that drops or renames a {placeholder} renders the literal
// "{name}" to the player, which is worse than the untranslated string.
test("translations keep the same interpolation placeholders", () => {
  const mismatched = [...en.entries()]
    .filter(([key, value]) => sk.has(key) && placeholders(value) !== placeholders(sk.get(key)))
    .map(([key]) => key);
  assert.deepEqual(mismatched, []);
});
