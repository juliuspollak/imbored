-- Phase: feedback board
-- Run this in Supabase SQL Editor.

alter table profiles add column is_admin boolean not null default false;

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

alter table feedback enable row level security;
alter table feedback_votes enable row level security;

create policy "feedback is publicly readable" on feedback for select using (true);
create policy "users can submit feedback" on feedback for insert with check (auth.uid() = user_id);
-- only an admin (checked against profiles.is_admin) can change status/comment
create policy "admins can update feedback" on feedback for update
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

create policy "votes are publicly readable" on feedback_votes for select using (true);
create policy "users can vote" on feedback_votes for insert with check (auth.uid() = user_id);
create policy "users can remove their own vote" on feedback_votes for delete using (auth.uid() = user_id);

-- Run this yourself, once, to make your own account an admin — replace
-- with your email:
-- update profiles set is_admin = true where id = (select id from auth.users where email = 'you@example.com');
