begin;

-- Keep validation separate from cleanup so the Edge Function can prove that
-- deletion is allowed before removing the Auth user. Cleanup remains
-- idempotent and runs only after Auth deletion succeeds.
create or replace function public.validate_account_deletion(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin only.' using errcode='42501';
  end if;
  if target_user_id=auth.uid() then
    raise exception 'You cannot delete your own account.' using errcode='22023';
  end if;
  if not exists(select 1 from public.profiles where id=target_user_id) then
    raise exception 'Player profile not found.' using errcode='P0002';
  end if;
  if exists(select 1 from public.profiles where id=target_user_id and is_admin=true) then
    raise exception 'Another admin cannot be deleted here.' using errcode='42501';
  end if;
end;
$$;

revoke all on function public.validate_account_deletion(uuid) from public;
grant execute on function public.validate_account_deletion(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
