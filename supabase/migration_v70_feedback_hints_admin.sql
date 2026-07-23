-- v70: repair missing feedback/hint columns and refresh PostgREST's schema cache.
-- Safe to run more than once in the Supabase SQL Editor.

alter table public.feedback
  add column if not exists updated_at timestamptz,
  add column if not exists user_seen_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.game_config
  add column if not exists hint_cooldown_base integer not null default 0,
  add column if not exists hint_cooldown_per_day integer not null default 0;

alter table public.profiles
  add column if not exists week_starts_on integer not null default 1;

-- Keep the author edit rule available on databases that missed the v65 migration.
drop policy if exists "authors can update open feedback" on public.feedback;
create policy "authors can update open feedback" on public.feedback
  for update
  using (auth.uid() = user_id and status = 'open' and deleted_at is null)
  with check (auth.uid() = user_id and status = 'open' and deleted_at is null);

create or replace function public.mark_my_feedback_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.feedback
  set user_seen_at = now()
  where user_id = auth.uid()
    and status = 'closed'
    and user_seen_at is null;
$$;

grant execute on function public.mark_my_feedback_seen() to authenticated;

-- Ask PostgREST/Supabase to reload the table definitions immediately.
notify pgrst, 'reload schema';
