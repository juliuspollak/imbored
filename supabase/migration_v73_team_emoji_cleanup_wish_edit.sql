-- v73: hidden-user team creation protection, team emoji, empty-team cleanup,
-- and safe editing of wishes that are still submitted.

alter table public.teams add column if not exists emoji text not null default '⭐';

-- Frontend checks are helpful, but this policy is the authoritative guard.
drop policy if exists "authenticated users create teams" on public.teams;
drop policy if exists "users create teams" on public.teams;
drop policy if exists "logged in users can create a team" on public.teams;
drop policy if exists "visible users create teams" on public.teams;
create policy "visible users create teams"
on public.teams for insert to authenticated
with check (
  created_by = auth.uid()
  and not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and coalesce(p.hidden_from_others,false)
  )
);



-- Create the team and initial membership atomically. This avoids relying on a
-- direct team_members INSERT policy and enforces the hidden-user rule server-side.
create or replace function public.create_team(team_name text, team_emoji text default '⭐')
returns public.teams
language plpgsql
security definer
set search_path=public
as $$
declare result public.teams;
begin
  if exists(
    select 1 from public.profiles p
    where p.id=auth.uid() and coalesce(p.hidden_from_others,false)
  ) then
    raise exception 'Hidden players cannot create teams';
  end if;

  if nullif(btrim(team_name),'') is null then
    raise exception 'Team name is required';
  end if;

  insert into public.teams(name,emoji,created_by)
  values(btrim(team_name),coalesce(nullif(btrim(team_emoji),''),'⭐'),auth.uid())
  returning * into result;

  insert into public.team_members(team_id,user_id)
  values(result.id,auth.uid());

  return result;
end;
$$;
grant execute on function public.create_team(text,text) to authenticated;

-- Leave atomically and remove the team once its final membership disappears.
create or replace function public.leave_team(target_team_id bigint)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  delete from public.team_members
  where team_id=target_team_id and user_id=auth.uid();

  if not found then
    raise exception 'You are not a member of this team';
  end if;

  delete from public.teams t
  where t.id=target_team_id
    and not exists(select 1 from public.team_members m where m.team_id=t.id);
end;
$$;
grant execute on function public.leave_team(bigint) to authenticated;

-- A submitted wish can be changed only by its owner. Status/review fields must
-- remain untouched; the RPC exposes only the three player-editable fields.
create or replace function public.update_submitted_wish(
  target_wish_id bigint,
  new_name text,
  new_product_url text,
  new_note text
)
returns public.reward_wishes
language plpgsql
security definer
set search_path=public
as $$
declare result public.reward_wishes;
begin
  if nullif(btrim(new_name),'') is null then
    raise exception 'Wish name is required';
  end if;

  update public.reward_wishes
  set name=btrim(new_name),
      product_url=nullif(btrim(new_product_url),''),
      note=nullif(btrim(new_note),'')
  where id=target_wish_id
    and player_id=auth.uid()
    and status='submitted'
  returning * into result;

  if not found then
    raise exception 'Only submitted wishes can be edited';
  end if;
  return result;
end;
$$;
grant execute on function public.update_submitted_wish(bigint,text,text,text) to authenticated;

notify pgrst, 'reload schema';
