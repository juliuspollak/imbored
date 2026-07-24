begin;

-- Deleted profiles are historical records, not blocked/pending active users.
update public.profiles
set is_blocked = false,
    blocked_at = null,
    blocked_by = null,
    blocked_reason = null,
    is_approved = false,
    approved_at = null,
    approved_by = null,
    hidden_from_others = true
where account_deleted_at is not null;

create or replace function public.prepare_account_deletion(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare team_row record; replacement uuid;
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admin only.' using errcode='42501'; end if;
  if target_user_id=auth.uid() then raise exception 'You cannot delete your own account.' using errcode='22023'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and is_admin=true) then raise exception 'Another admin cannot be deleted here.' using errcode='42501'; end if;

  for team_row in select id from public.teams where created_by=target_user_id loop
    select tm.user_id into replacement
    from public.team_members tm
    where tm.team_id=team_row.id and tm.user_id<>target_user_id
    order by tm.joined_at asc nulls last, tm.user_id
    limit 1;
    if replacement is null then delete from public.teams where id=team_row.id;
    else update public.teams set created_by=replacement where id=team_row.id; end if;
    replacement:=null;
  end loop;

  delete from public.team_members where user_id=target_user_id;
  delete from public.team_join_requests where user_id=target_user_id;
  delete from public.presence where user_id=target_user_id;
  update public.profiles set
    account_deleted_at=now(), account_deleted_by=auth.uid(),
    is_blocked=false, is_approved=false, hidden_from_others=true,
    blocked_at=null, blocked_by=null, blocked_reason=null,
    approved_at=null, approved_by=null
  where id=target_user_id;
end;
$$;

revoke all on function public.prepare_account_deletion(uuid) from public;
grant execute on function public.prepare_account_deletion(uuid) to authenticated;

alter table public.game_config
  add column if not exists zip_path_style text not null default 'solid';

alter table public.game_config
  drop constraint if exists game_config_zip_path_style_check;
alter table public.game_config
  add constraint game_config_zip_path_style_check
  check (zip_path_style in ('solid', 'rainbow'));

update public.game_config
set zip_path_style = 'solid'
where game_id = 'zip' and zip_path_style is null;

notify pgrst, 'reload schema';
commit;
