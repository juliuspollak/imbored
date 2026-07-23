-- v65: editable open feedback, completion notifications, and week-start preference
alter table public.profiles add column if not exists week_starts_on integer not null default 1 check (week_starts_on in (0, 1));

alter table public.feedback add column if not exists deleted_at timestamptz;
alter table public.feedback add column if not exists updated_at timestamptz;
alter table public.feedback add column if not exists user_seen_at timestamptz;

drop policy if exists "authors can update open feedback" on public.feedback;
create policy "authors can update open feedback" on public.feedback for update
  using (auth.uid() = user_id and status = 'open' and deleted_at is null)
  with check (auth.uid() = user_id and status = 'open' and deleted_at is null);

-- Admins continue to use the existing admin update policy. When an item is
-- closed the app clears user_seen_at, which creates an in-app notification
-- badge for the author until they open the Feedback page.

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
