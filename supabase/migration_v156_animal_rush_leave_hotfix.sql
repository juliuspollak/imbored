begin;

-- v156 hotfix: v155's Animal Rush roster trigger calls is_user_hidden().
-- Projects that had not run v153 could install v155 successfully because
-- PL/pgSQL resolves the helper at runtime, then fail when a player left or
-- joined a room. Define the helper here so already-installed v155 databases
-- recover without rerunning older migrations.
create or replace function public.is_user_hidden(target_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path=public
as $$
  select coalesce((
    select
      coalesce(profile.hidden_from_others,false)
      or profile.account_deleted_at is not null
    from public.profiles profile
    where profile.id=target_user_id
  ),true);
$$;

revoke all on function public.is_user_hidden(uuid) from public;
grant execute on function public.is_user_hidden(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
