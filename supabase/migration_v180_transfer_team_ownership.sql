-- v180: Let a team owner (or admin) hand ownership to another member.
-- Run after v179.

begin;

create or replace function public.transfer_team_ownership(target_team_id bigint, new_owner_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare team_owner uuid;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  select created_by into team_owner from public.teams where id=target_team_id for update;
  if not found then raise exception 'Team not found.'; end if;
  if auth.uid()<>team_owner and not public.is_admin(auth.uid()) then
    raise exception 'Only the team owner or an app administrator can transfer ownership.' using errcode='42501';
  end if;
  if not exists(select 1 from public.team_members where team_id=target_team_id and user_id=new_owner_user_id) then
    raise exception 'That person is not a member of this team.';
  end if;
  if new_owner_user_id=team_owner then
    raise exception 'That person already owns this team.';
  end if;

  update public.teams set created_by=new_owner_user_id where id=target_team_id;
  update public.team_members set can_approve_rewards=true where team_id=target_team_id and user_id=new_owner_user_id;
end; $$;
revoke all on function public.transfer_team_ownership(bigint,uuid) from public;
grant execute on function public.transfer_team_ownership(bigint,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
