-- Allow admins to hide individual What's New entries without removing them.
-- Hidden entries remain visible to admins and keep their existing reactions.

alter table public.release_notes
  add column if not exists is_hidden boolean not null default false;

-- Replace the broad read policy so ordinary players cannot retrieve hidden notes.
drop policy if exists "release notes are publicly readable" on public.release_notes;
drop policy if exists "visible release notes are readable" on public.release_notes;

create policy "visible release notes are readable"
on public.release_notes
for select
to authenticated
using (
  is_hidden = false
  or public.is_admin(auth.uid())
);

create or replace function public.set_release_note_hidden(
  target_release_note_id bigint,
  hidden boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only administrators can change release-note visibility';
  end if;

  update public.release_notes
  set is_hidden = hidden
  where id = target_release_note_id;

  if not found then
    raise exception 'Release note % was not found', target_release_note_id;
  end if;
end;
$$;

revoke all on function public.set_release_note_hidden(bigint, boolean) from public;
grant execute on function public.set_release_note_hidden(bigint, boolean) to authenticated;
