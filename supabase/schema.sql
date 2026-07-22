-- Run this ONCE, all together, in Supabase Dashboard → SQL Editor → New query.
-- This is the consolidated final state of every phase built so far — use
-- this instead of running the individual migration_*.sql files one by one.

-- ============ profiles ============
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  name text not null,
  icon text default '🙂',
  is_private boolean not null default false,
  mood text,
  is_admin boolean not null default false,
  created_at timestamptz default now()
);

-- ============ game_stats ============
create table game_stats (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  game text not null,                -- 'queens' | 'tango' | 'zip'
  day_index int not null,            -- 0=Mon .. 6=Sun, which difficulty was played
  seconds int not null,
  mistakes int not null default 0,
  hints int not null default 0,
  mode text not null default 'practice', -- 'practice' | 'challenge'
  challenge_date date,               -- the calendar date, only set for mode='challenge'
  difficulty_rating int,             -- 0-100, null until rated
  completed_at timestamptz default now()
);

-- one challenge attempt per (player, game, calendar day)
create unique index game_stats_one_challenge_per_day
  on game_stats (user_id, game, challenge_date)
  where mode = 'challenge';

-- ============ presence ("currently playing") ============
create table presence (
  user_id uuid references profiles(id) on delete cascade primary key,
  game text,
  last_seen timestamptz default now()
);

-- ============ teams ============
create table teams (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table team_members (
  team_id bigint references teams(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key (team_id, user_id)
);

-- ============ feedback board ============
create table feedback (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'open', -- 'open' | 'closed'
  admin_comment text,
  created_at timestamptz default now(),
  closed_at timestamptz
);

create table feedback_votes (
  feedback_id bigint references feedback(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  primary key (feedback_id, user_id)
);

-- ============ row level security ============
alter table profiles enable row level security;
alter table game_stats enable row level security;
alter table presence enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table feedback enable row level security;
alter table feedback_votes enable row level security;

create policy "profiles are publicly readable" on profiles for select using (true);
create policy "users insert their own profile" on profiles for insert with check (auth.uid() = id);
create policy "users update their own profile" on profiles for update using (auth.uid() = id);

create policy "stats are publicly readable" on game_stats for select using (true);
create policy "users insert their own stats" on game_stats for insert with check (auth.uid() = user_id);

create policy "presence is publicly readable" on presence for select using (true);
create policy "users manage their own presence" on presence for insert with check (auth.uid() = user_id);
create policy "users update their own presence" on presence for update using (auth.uid() = user_id);
create policy "users delete their own presence" on presence for delete using (auth.uid() = user_id);

create policy "teams are publicly readable" on teams for select using (true);
create policy "logged in users can create a team" on teams for insert with check (auth.uid() = created_by);

create policy "team membership is publicly readable" on team_members for select using (true);
create policy "users can join a team themselves" on team_members for insert with check (auth.uid() = user_id);
create policy "users can remove themselves from a team" on team_members for delete using (auth.uid() = user_id);

create policy "feedback is publicly readable" on feedback for select using (true);
create policy "users can submit feedback" on feedback for insert with check (auth.uid() = user_id);
create policy "admins can update feedback" on feedback for update
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

create policy "votes are publicly readable" on feedback_votes for select using (true);
create policy "users can vote" on feedback_votes for insert with check (auth.uid() = user_id);
create policy "users can remove their own vote" on feedback_votes for delete using (auth.uid() = user_id);

-- ============ functions ============
-- Adding someone ELSE to a team goes through this function (not a direct
-- insert), so a private profile can never be added by anyone but
-- themselves. Joining yourself is a plain insert, already allowed above.
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

-- ============ one-time: make yourself admin ============
-- Sign up in the app FIRST (so your profile row exists), then come back and
-- run this on its own, with your real email:
--
-- update profiles set is_admin = true where id = (select id from auth.users where email = 'you@example.com');
