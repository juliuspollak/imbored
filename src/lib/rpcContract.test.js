import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Every supabase.rpc("name") in the app must name a function the schema
// actually defines. PostgREST only reports the mismatch at runtime, as
// "Could not find the function ... in the schema cache", and only to whoever
// happens to press the button — so renaming a function in public.sql without
// updating its caller has shipped silently more than once:
// force_delete_reward, decide_player_approval, price_reward, reject_reward,
// fulfill_reward and get_last_seen_times all reached main broken.
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..");
const srcRoot = join(projectRoot, "src");
const schemaFile = join(projectRoot, "supabase", "schemas", "public.sql");

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.jsx?$/.test(entry) && !entry.endsWith(".test.js") ? [path] : [];
  });
}

function definedFunctions() {
  const schema = readFileSync(schemaFile, "utf8");
  const names = new Set();
  for (const match of schema.matchAll(/^CREATE FUNCTION public\.([a-zA-Z0-9_]+)/gm)) {
    names.add(match[1]);
  }
  return names;
}

test("every supabase.rpc call names a function the schema defines", () => {
  const defined = definedFunctions();
  // Guards against a silently passing test if the schema ever moves.
  assert.ok(defined.size > 50, `expected to parse the schema, found ${defined.size} functions`);

  const missing = [];
  for (const file of sourceFiles(srcRoot)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\brpc\(\s*"([a-zA-Z0-9_]+)"/g)) {
      if (!defined.has(match[1])) {
        missing.push(`${relative(projectRoot, file)} calls ${match[1]}()`);
      }
    }
  }

  assert.deepEqual(missing, [], `RPC calls with no matching function in public.sql:\n${missing.join("\n")}`);
});
