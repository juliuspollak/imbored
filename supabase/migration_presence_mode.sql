-- Track presence separately for Challenge and Practice tiles.
alter table public.presence
  add column if not exists mode text
  check (mode is null or mode in ('challenge', 'practice'));
