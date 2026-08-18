// Does every function change in supabase/schemas/public.sql actually ship in a
// migration? Four times this session the schema was edited and the migration
// generated for only some of the functions involved, leaving the database with
// a reader but no writer, or a scorer that disagreed with its own reference.
//
// Run from the repo root: node scripts/check-schema-migration-drift.cjs
// Exits non-zero if the schema is ahead of every migration for any function.
const fs=require("fs"), path=require("path");
const schema=fs.readFileSync("supabase/schemas/public.sql","utf8").split(/\r?\n/);
function bodyFrom(lines,startsWithList){
  const i=lines.findIndex(l=>startsWithList.some(p=>l.startsWith(p)));
  if(i<0) return null;
  let j=i+1; while(j<lines.length && !/\$\$;\s*$/.test(lines[j])) j++;
  return lines.slice(i,j+1).join("\n");
}
const norm=s=>s.replace(/--[^\n]*/g,"").replace(/^\s*(create or replace function|create function)/i,"fn")
               .replace(/\s+/g," ").trim().toLowerCase();
const files=fs.readdirSync("supabase/migrations").filter(f=>f.endsWith(".sql")).sort();
const fns=["refresh_game_time_benchmark","circle_challenge_member_totals","circle_challenge_daily_score",
  "effective_round_seconds","round_inefficiency","challenge_benchmark_profile",
  "get_personal_challenge_standings","get_circle_challenge_standings","award_game_points"];
const rows=[];
for(const fn of fns){
  const inSchema=bodyFrom(schema,["CREATE FUNCTION public."+fn+"("]);
  let latest=null,latestBody=null;
  for(const f of files){
    const b=bodyFrom(fs.readFileSync(path.join("supabase/migrations",f),"utf8").split(/\r?\n/),
      ["create or replace function public."+fn+"(","create function public."+fn+"(","CREATE FUNCTION public."+fn+"("]);
    if(b){ latest=f; latestBody=b; }
  }
  const ok = inSchema && latestBody ? norm(inSchema)===norm(latestBody) : false;
  rows.push([fn,(latest||"NONE"),!inSchema?"n/a":(ok?"yes":"NO  <-- schema ahead of migrations")]);
}


// Non-zero exit so this can gate a commit or CI run.
{
  const drifted = fns.filter((fn) => {
    const inSchema = bodyFrom(schema, ["CREATE FUNCTION public." + fn + "("]);
    if (!inSchema) return false;
    let latestBody = null;
    for (const f of files) {
      const b = bodyFrom(fs.readFileSync(path.join("supabase/migrations", f), "utf8").split(/\r?\n/),
        ["create or replace function public." + fn + "(", "create function public." + fn + "(",
         "CREATE FUNCTION public." + fn + "("]);
      if (b) latestBody = b;
    }
    return !latestBody || norm(inSchema) !== norm(latestBody);
  });
  if (drifted.length) {
    console.error("\nSchema is ahead of every migration for: " + drifted.join(", "));
    process.exit(1);
  }
  console.log("\nNo drift: every listed function's schema version ships in a migration.");
}
