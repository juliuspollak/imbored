begin;

-- A team member may see the full roster of their own teams even when another
-- member keeps their general profile private. This reveals only the compact
-- identity needed by the team screen, never account or admin fields.
create or replace function public.get_my_team_rosters()
returns table(
  team_id bigint,
  user_id uuid,
  member_name text,
  member_icon text,
  member_mood text,
  is_owner boolean
)
language sql
security definer
stable
set search_path=public
as $$
  select
    tm.team_id,
    tm.user_id,
    p.name::text,
    p.icon::text,
    p.mood::text,
    (t.created_by=tm.user_id)
  from public.team_members tm
  join public.teams t on t.id=tm.team_id
  join public.profiles p on p.id=tm.user_id
  where exists(
    select 1
    from public.team_members mine
    where mine.team_id=tm.team_id
      and mine.user_id=auth.uid()
  )
    and p.account_deleted_at is null
  order by tm.team_id,(t.created_by=tm.user_id) desc,p.name;
$$;

revoke all on function public.get_my_team_rosters() from public;
grant execute on function public.get_my_team_rosters() to authenticated;

-- Membership removal is deliberately owner-only. The owner cannot remove
-- themselves through this action; deleting/leaving an owned team remains a
-- separate, explicit workflow.
create or replace function public.remove_player_from_team(
  target_team_id bigint,
  target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not exists(
    select 1
    from public.teams
    where id=target_team_id
      and created_by=auth.uid()
  ) then
    raise exception 'Only the team owner can remove members.' using errcode='42501';
  end if;
  if target_user_id=auth.uid() then
    raise exception 'The team owner cannot remove themselves.';
  end if;

  delete from public.team_members
  where team_id=target_team_id
    and user_id=target_user_id;

  delete from public.team_join_requests
  where team_id=target_team_id
    and user_id=target_user_id;
end;
$$;

revoke all on function public.remove_player_from_team(bigint,uuid) from public;
grant execute on function public.remove_player_from_team(bigint,uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
