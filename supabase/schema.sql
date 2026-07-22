-- Run this once in your Supabase project: Dashboard → SQL Editor → New query → paste → Run

-- One row per signed-up player. Created automatically the first time they
-- complete the profile-setup screen after their first login.
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  name text not null,
  team text,
  created_at timestamptz default now()
);

-- One row per completed puzzle. Written automatically when a game is solved.
create table game_stats (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  game text not null,              -- 'queens' | 'tango' | 'zip'
  day_index int not null,          -- 0=Mon .. 6=Sun, which difficulty was played
  seconds int not null,
  mistakes int not null default 0,
  hints int not null default 0,
  completed_at timestamptz default now()
);

-- Lightweight "who's currently playing" presence. One row per active
-- session, upserted every ~20s while a game tab is open and deleted on
-- close. Kept separate from profiles since it changes constantly.
create table presence (
  user_id uuid references profiles(id) on delete cascade primary key,
  game text,                       -- null when just browsing, else which game
  last_seen timestamptz default now()
);

-- Row Level Security: everyone can read names/teams/stats (needed for
-- leaderboards), but you can only write your own rows.
alter table profiles enable row level security;
alter table game_stats enable row level security;
alter table presence enable row level security;

create policy "profiles are publicly readable" on profiles for select using (true);
create policy "users insert their own profile" on profiles for insert with check (auth.uid() = id);
create policy "users update their own profile" on profiles for update using (auth.uid() = id);

create policy "stats are publicly readable" on game_stats for select using (true);
create policy "users insert their own stats" on game_stats for insert with check (auth.uid() = user_id);

create policy "presence is publicly readable" on presence for select using (true);
create policy "users manage their own presence" on presence for insert with check (auth.uid() = user_id);
create policy "users update their own presence" on presence for update using (auth.uid() = user_id);
create policy "users delete their own presence" on presence for delete using (auth.uid() = user_id);
