begin;

alter table public.profiles
  add column if not exists is_approved boolean,
  add column if not exists approved_at timestamp with time zone,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null;

-- Existing players remain active. New profiles created after this migration wait for approval.
update public.profiles
set is_approved = true,
    approved_at = coalesce(approved_at, now())
where is_approved is null;

alter table public.profiles alter column is_approved set default false;
alter table public.profiles alter column is_approved set not null;

update public.profiles set is_approved=true, approved_at=coalesce(approved_at,now()) where is_admin=true;

create or replace function public.set_user_approval(target_user_id uuid, approved boolean)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin only.' using errcode='42501';
  end if;
  if target_user_id=auth.uid() and approved=false then
    raise exception 'You cannot revoke your own approval.' using errcode='22023';
  end if;
  update public.profiles
  set is_approved=approved,
      approved_at=case when approved then now() else null end,
      approved_by=case when approved then auth.uid() else null end
  where id=target_user_id and is_admin=false;
end;
$$;
revoke all on function public.set_user_approval(uuid,boolean) from public;
grant execute on function public.set_user_approval(uuid,boolean) to authenticated;

-- Reinforce that each team/week owns its own independently selected game set.
create unique index if not exists team_weekly_challenges_team_week_unique
on public.team_weekly_challenges(team_id,week_start);

create or replace function public.set_team_weekly_challenge(target_team_id bigint,selected_games text[])
returns bigint language plpgsql security definer set search_path=public as $$
declare result_id bigint; clean_games text[];
begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_approved=true) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not exists(select 1 from public.teams t where t.id=target_team_id and t.created_by=auth.uid()) then
    raise exception 'Only this team creator can set its challenge.' using errcode='42501';
  end if;
  select array_agg(distinct g) into clean_games
  from unnest(selected_games) g
  where g in ('queens','tango','zip','minisudoku','geo');
  if coalesce(array_length(clean_games,1),0)=0 then raise exception 'Choose at least one game.'; end if;
  insert into public.team_weekly_challenges(team_id,week_start,game_ids,created_by)
  values(target_team_id,public.current_week_start(),clean_games,auth.uid())
  on conflict(team_id,week_start) do update
    set game_ids=excluded.game_ids,updated_at=now(),created_by=auth.uid()
  returning id into result_id;
  return result_id;
end;
$$;
grant execute on function public.set_team_weekly_challenge(bigint,text[]) to authenticated;

notify pgrst,'reload schema';
commit;
