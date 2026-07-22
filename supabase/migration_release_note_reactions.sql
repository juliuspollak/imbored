-- Run this in Supabase SQL Editor.

create table release_note_reactions (
  release_note_id bigint references release_notes(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  reaction text not null check (reaction in ('up', 'down')),
  created_at timestamptz default now(),
  primary key (release_note_id, user_id)
);

alter table release_note_reactions enable row level security;
create policy "reactions are publicly readable" on release_note_reactions for select using (true);
create policy "users can react" on release_note_reactions for insert with check (auth.uid() = user_id);
create policy "users can change their own reaction" on release_note_reactions for update using (auth.uid() = user_id);
create policy "users can remove their own reaction" on release_note_reactions for delete using (auth.uid() = user_id);
