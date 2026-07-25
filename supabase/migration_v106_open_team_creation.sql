begin;

drop policy if exists "trusted visible users create teams" on public.teams;
drop policy if exists "visible users create teams" on public.teams;
create policy "approved visible users create teams"
on public.teams for insert to authenticated
with check (
  created_by=auth.uid()
  and public.is_available_player(auth.uid())
  and not exists(
    select 1 from public.profiles profile
    where profile.id=auth.uid() and coalesce(profile.hidden_from_others,false)
  )
);

create or replace function public.create_team(team_name text, team_emoji text default '⭐')
returns public.teams
language plpgsql
security definer
set search_path=public
as $$
declare result public.teams;
begin
  if not public.is_available_player(auth.uid()) then
    raise exception 'Your account must be active and approved first.' using errcode='42501';
  end if;
  if exists(
    select 1 from public.profiles profile
    where profile.id=auth.uid() and coalesce(profile.hidden_from_others,false)
  ) then
    raise exception 'Hidden players cannot create teams.' using errcode='42501';
  end if;
  if nullif(btrim(team_name),'') is null then
    raise exception 'Team name is required.' using errcode='22023';
  end if;

  insert into public.teams(name,emoji,created_by)
  values(btrim(team_name),coalesce(nullif(btrim(team_emoji),''),'⭐'),auth.uid())
  returning * into result;

  insert into public.team_members(team_id,user_id)
  values(result.id,auth.uid());
  return result;
end;
$$;

revoke all on function public.create_team(text,text) from public;
grant execute on function public.create_team(text,text) to authenticated;

notify pgrst,'reload schema';
commit;
