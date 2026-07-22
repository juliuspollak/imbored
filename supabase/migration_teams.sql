-- Phase: Teams + profile customization
-- Run this in Supabase SQL Editor. Safe on top of the schema you already ran —
-- only adds new things, doesn't touch existing profiles/game_stats/presence data.

create table teams (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

alter table profiles add column icon text default '🙂';
alter table profiles add column is_private boolean not null default false;
alter table profiles add column team_id bigint references teams(id) on delete set null;

alter table teams enable row level security;
create policy "teams are publicly readable" on teams for select using (true);
create policy "logged in users can create a team" on teams for insert with check (auth.uid() = created_by);

-- Players can always edit their own name/icon/privacy directly (already
-- covered by the existing "users update their own profile" policy from the
-- first schema). Adding someone ELSE to a team is different — that's not a
-- direct table update, it goes through this function instead, so a private
-- profile can never be added by anyone but themselves, and nobody can use
-- team-adding as a backdoor to edit someone else's name or icon.
create or replace function add_player_to_team(target_user_id uuid, target_team_id bigint)
returns void
language plpgsql
security definer
as $$
begin
  update profiles
  set team_id = target_team_id
  where id = target_user_id and is_private = false;
end;
$$;

grant execute on function add_player_to_team to authenticated;
