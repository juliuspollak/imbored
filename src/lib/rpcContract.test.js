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
const schemaFile = join(projectRoot, "supabase", "schemas", "public.sql");
// Edge Functions call RPCs too — admin-user-action depends on set_user_approval,
// so a rename there breaks approvals exactly as invisibly as a client rename.
const callerRoots = [
  { dir: join(projectRoot, "src"), match: /\.jsx?$/ },
  { dir: join(projectRoot, "supabase", "functions"), match: /\.ts$/ },
];

function sourceFiles(directory, match) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path, match);
    return match.test(entry) && !entry.endsWith(".test.js") ? [path] : [];
  });
}

function definedFunctions() {
  const migrationsDirectory = join(projectRoot,"supabase","migrations");
  // Pending migrations are intentionally not folded into public.sql until
  // they are applied, but Edge Functions added in the same change must still
  // have their RPC contract checked during review.
  const schema = [readFileSync(schemaFile,"utf8"),...sourceFiles(migrationsDirectory,/\.sql$/).map((file)=>readFileSync(file,"utf8"))].join("\n");
  const names = new Set();
  for (const match of schema.matchAll(/^\s*create(?: or replace)? function public\.([a-zA-Z0-9_]+)/gim)) {
    names.add(match[1]);
  }
  return names;
}

test("every supabase.rpc call names a function the schema defines", () => {
  const defined = definedFunctions();
  // Guards against a silently passing test if the schema ever moves.
  assert.ok(defined.size > 50, `expected to parse the schema, found ${defined.size} functions`);

  const missing = [];
  let callsChecked = 0;
  for (const root of callerRoots) {
    for (const file of sourceFiles(root.dir, root.match)) {
      const source = readFileSync(file, "utf8");
      // Accepts "name", 'name' and `name` so a quote-style change cannot
      // quietly drop a call out of this check.
      for (const match of source.matchAll(/\brpc\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g)) {
        callsChecked += 1;
        if (!defined.has(match[1])) {
          missing.push(`${relative(projectRoot, file)} calls ${match[1]}()`);
        }
      }
    }
  }
  assert.ok(callsChecked > 50, `expected to find the rpc calls, found ${callsChecked}`);

  assert.deepEqual(missing, [], `RPC calls with no matching function in public.sql:\n${missing.join("\n")}`);
});
