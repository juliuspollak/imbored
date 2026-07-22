-- Run this in Supabase SQL Editor.
alter table profiles add column default_mode text not null default 'challenge'
  check (default_mode in ('challenge', 'practice'));
