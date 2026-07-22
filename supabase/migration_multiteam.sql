-- Phase: Multi-team membership + fixes
-- Run this in Supabase SQL Editor. Adds a proper many-to-many team
-- membership table. Your existing single team_id assignments (if any) are
-- migrated into it automatically, then the old column is dropped.

create table team_members (
  team_id bigint references teams(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key (team_id, user_id)
);

-- carry over anyone already assigned via the old single team_id column
insert into team_members (team_id, user_id)
select team_id, id from profiles where team_id is not null
on conflict do nothing;

alter table profiles drop column team_id;

alter table team_members enable row level security;
create policy "team membership is publicly readable" on team_members for select using (true);
create policy "users can join a team themselves" on team_members for insert with check (auth.uid() = user_id);
create policy "users can remove themselves from a team" on team_members for delete using (auth.uid() = user_id);

-- Replaces the old single-team version: adds someone to ANOTHER team (not
-- just themselves), still gated on the target not being private. A user
-- can now belong to several teams at once, so this just adds a row rather
-- than overwriting one.
create or replace function add_player_to_team(target_user_id uuid, target_team_id bigint)
returns void
language plpgsql
security definer
as $$
begin
  if exists (select 1 from profiles where id = target_user_id and is_private = false) then
    insert into team_members (team_id, user_id) values (target_team_id, target_user_id)
    on conflict do nothing;
  end if;
end;
$$;

grant execute on function add_player_to_team to authenticated;
