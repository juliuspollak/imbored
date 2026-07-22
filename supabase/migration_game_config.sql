-- Run this in Supabase SQL Editor.

create table game_config (
  game_id text primary key,
  visible boolean not null default true,
  available boolean not null default true,
  sort_order int not null default 0
);

insert into game_config (game_id, visible, available, sort_order) values
  ('queens', true, true, 0),
  ('tango', true, true, 1),
  ('zip', true, true, 2),
  ('minisudoku', true, true, 3),
  ('pinpoint', false, false, 4),
  ('crossclimb', false, false, 5),
  ('patches', false, false, 6),
  ('wend', false, false, 7);

alter table game_config enable row level security;
create policy "game config is publicly readable" on game_config for select using (true);
create policy "admins can update game config" on game_config for update using (is_admin(auth.uid()));
