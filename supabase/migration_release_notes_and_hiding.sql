-- Phase: release notes + admin player hiding
-- Run this in Supabase SQL Editor.

-- ============ release notes ============
create table release_notes (
  id bigint generated always as identity primary key,
  title text not null,
  body text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

alter table release_notes enable row level security;
create policy "release notes are publicly readable" on release_notes for select using (true);
create policy "admins can post release notes" on release_notes for insert with check (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);
create policy "admins can delete release notes" on release_notes for delete using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

-- ============ admin-only player hiding ============
-- A hidden player is invisible to everyone except themselves and admins —
-- enforced here at the database level (rewriting the profiles select
-- policy), not just filtered out in the UI. Anywhere else in the app joins
-- against profiles for a name/icon, a hidden player's row simply won't
-- come back for a non-admin viewer.
alter table profiles add column hidden_from_others boolean not null default false;

drop policy "profiles are publicly readable" on profiles;
create policy "profiles are readable unless hidden" on profiles for select using (
  hidden_from_others = false
  or id = auth.uid()
  or exists (select 1 from profiles me where me.id = auth.uid() and me.is_admin = true)
);

create or replace function set_user_hidden(target_user_id uuid, hidden boolean)
returns void
language plpgsql
security definer
as $$
begin
  if exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    update profiles set hidden_from_others = hidden where id = target_user_id;
  end if;
end;
$$;

grant execute on function set_user_hidden to authenticated;
