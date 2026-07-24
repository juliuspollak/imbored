# v87 deployment
1. Deploy the frontend.
2. Run `migration_v87_account_management_and_unique_names.sql` in SQL Editor.
3. Deploy Edge Function: `supabase functions deploy admin-user-action`.
4. Ensure the function has the standard project secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
5. In Authentication settings, enable Manual Linking under Identity Linking before using Connect Google.
