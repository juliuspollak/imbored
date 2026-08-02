# Declarative database schema

Files in this directory describe the current application-owned database
schema. They are the source of truth for tables, functions, triggers, policies,
and grants. Player data and Supabase-managed schemas are not stored here.

After the initial remote export is validated, split `public.sql` into focused
domain files and list them in dependency order under `schema_paths` in
`supabase/config.toml`.
