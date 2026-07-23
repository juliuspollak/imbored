-- v64: admin soft delete for Feedback and What's New
alter table public.feedback add column if not exists deleted_at timestamptz;
alter table public.release_notes add column if not exists deleted_at timestamptz;

create or replace function public.set_release_note_deleted(target_release_note_id bigint, deleted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Admin access required';
  end if;
  update public.release_notes
  set deleted_at = case when deleted then now() else null end
  where id = target_release_note_id;
end;
$$;

grant execute on function public.set_release_note_deleted(bigint, boolean) to authenticated;

-- Existing admin update policy on feedback covers deleted_at. Regular clients hide
-- soft-deleted rows in the application; admins can restore them from the Deleted tab.
