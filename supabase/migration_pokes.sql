-- Phase: pokes (send a fun nudge to another online player)
-- Run this in Supabase SQL Editor.

create table pokes (
  id bigint generated always as identity primary key,
  from_user uuid references profiles(id) on delete set null,
  to_user uuid references profiles(id) on delete cascade not null,
  message text,
  created_at timestamptz default now(),
  seen boolean not null default false
);

alter table pokes enable row level security;

create policy "users see pokes they sent or received" on pokes for select
  using (auth.uid() = to_user or auth.uid() = from_user);
create policy "users can send a poke" on pokes for insert with check (auth.uid() = from_user);
create policy "users can mark their own incoming pokes seen" on pokes for update using (auth.uid() = to_user);
