-- URGENT FIX: infinite recursion in RLS policies
-- Run this in Supabase SQL Editor immediately.
--
-- The bug: the profiles SELECT policy checks admin status via a subquery
-- on profiles itself ("...exists (select 1 from profiles where ...)").
-- Evaluating that policy requires re-evaluating the same policy to run the
-- subquery — infinite recursion. A couple of other policies (feedback,
-- release_notes) had the identical pattern and were exposed to the same
-- bug, just not yet triggered.
--
-- Fix: a SECURITY DEFINER function bypasses RLS for the query it runs
-- internally, so checking admin status through it doesn't re-trigger the
-- policy that's calling it.

create or replace function is_admin(uid uuid)
returns boolean
language sql
security definer
stable
as $$
  select coalesce((select is_admin from profiles where id = uid), false);
$$;

grant execute on function is_admin to authenticated;

-- profiles: the actual source of the recursion
drop policy "profiles are readable unless hidden" on profiles;
create policy "profiles are readable unless hidden" on profiles for select using (
  hidden_from_others = false
  or id = auth.uid()
  or is_admin(auth.uid())
);

-- feedback: same pattern, was exposed to the same bug
drop policy "admins can update feedback" on feedback;
create policy "admins can update feedback" on feedback for update
  using (is_admin(auth.uid()));

-- release_notes: same pattern, was exposed to the same bug
drop policy "admins can post release notes" on release_notes;
create policy "admins can post release notes" on release_notes for insert
  with check (is_admin(auth.uid()));

drop policy "admins can delete release notes" on release_notes;
create policy "admins can delete release notes" on release_notes for delete
  using (is_admin(auth.uid()));
