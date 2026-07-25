begin;

create or replace function public.delete_managed_team(
  target_team_id bigint,
  expected_team_name text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  target_team public.teams;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;

  select * into target_team
  from public.teams
  where id=target_team_id
  for update;
  if not found then raise exception 'Team not found.'; end if;

  if auth.uid()<>target_team.created_by then
    raise exception 'Only the team owner can delete this team.' using errcode='42501';
  end if;
  if btrim(coalesce(expected_team_name,''))<>target_team.name then
    raise exception 'Enter the exact team name to confirm deletion.';
  end if;

  delete from public.teams where id=target_team_id;
end;
$$;

revoke all on function public.delete_managed_team(bigint,text) from public;
grant execute on function public.delete_managed_team(bigint,text) to authenticated;

notify pgrst,'reload schema';
commit;
