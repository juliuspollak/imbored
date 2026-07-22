-- Run this in Supabase SQL Editor. Every statement is safe to re-run any
-- number of times — nothing here can fail partway through and leave things
-- half-fixed, unlike the previous version which used plain DROP POLICY
-- (that errors, and stops the whole script, if the policy name doesn't
-- exist for any reason).

create or replace function is_admin(uid uuid)
returns boolean
language sql
security definer
stable
as $$
  select coalesce((select is_admin from profiles where id = uid), false);
$$;

grant execute on function is_admin to authenticated;

drop policy if exists "profiles are publicly readable" on profiles;
drop policy if exists "profiles are readable unless hidden" on profiles;
create policy "profiles are readable unless hidden" on profiles for select using (
  hidden_from_others = false
  or id = auth.uid()
  or is_admin(auth.uid())
);

drop policy if exists "admins can update feedback" on feedback;
create policy "admins can update feedback" on feedback for update
  using (is_admin(auth.uid()));

drop policy if exists "admins can post release notes" on release_notes;
create policy "admins can post release notes" on release_notes for insert
  with check (is_admin(auth.uid()));

drop policy if exists "admins can delete release notes" on release_notes;
create policy "admins can delete release notes" on release_notes for delete
  using (is_admin(auth.uid()));

-- Diagnostic: run this separately afterward to see exactly what's live —
-- paste the output back if it's still broken. The "qual" column for the
-- profiles select policy should show is_admin(auth.uid()), NOT a raw
-- "SELECT ... FROM profiles" subquery.
select schemaname, tablename, policyname, cmd, qual
from pg_policies
where tablename = 'profiles';
