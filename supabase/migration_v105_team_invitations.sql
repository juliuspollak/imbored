begin;

create table if not exists public.team_invitations (
  id bigint generated always as identity primary key,
  team_id bigint not null references public.teams(id) on delete cascade,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create unique index if not exists team_invitations_one_pending_idx
on public.team_invitations(team_id,invited_user_id)
where status='pending';

alter table public.team_invitations enable row level security;
drop policy if exists "invitation participants can view" on public.team_invitations;
create policy "invitation participants can view"
on public.team_invitations for select to authenticated
using(
  invited_user_id=auth.uid()
  or invited_by=auth.uid()
  or exists(
    select 1 from public.team_members tm
    where tm.team_id=team_invitations.team_id and tm.user_id=auth.uid()
  )
);

create or replace function public.invite_player_to_team(
  target_user_id uuid,
  target_team_id bigint
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  invitation_id bigint;
  inviter_name text;
  team_name text;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.team_members
    where team_id=target_team_id and user_id=auth.uid()
  ) then
    raise exception 'Only team members can invite players.' using errcode='42501';
  end if;
  if target_user_id=auth.uid() then raise exception 'You are already on this team.'; end if;
  if exists(
    select 1 from public.team_members
    where team_id=target_team_id and user_id=target_user_id
  ) then raise exception 'This player is already on the team.'; end if;
  if exists(
    select 1 from public.team_member_blocks
    where team_id=target_team_id and user_id=target_user_id
  ) then raise exception 'This player cannot be invited to the team.'; end if;
  if not exists(
    select 1 from public.profiles
    where id=target_user_id
      and account_deleted_at is null
      and coalesce(is_blocked,false)=false
      and coalesce(is_approved,false)=true
      and coalesce(is_private,false)=false
      and coalesce(hidden_from_others,false)=false
  ) then raise exception 'This player is not available for invitations.'; end if;

  insert into public.team_invitations(team_id,invited_user_id,invited_by)
  values(target_team_id,target_user_id,auth.uid())
  on conflict(team_id,invited_user_id) where status='pending'
  do update set invited_by=excluded.invited_by,created_at=now()
  returning id into invitation_id;

  select name into inviter_name from public.profiles where id=auth.uid();
  select name into team_name from public.teams where id=target_team_id;

  delete from public.direct_messages
  where activity_type='team_invitation'
    and source_stat_id=invitation_id
    and recipient_id=target_user_id;
  insert into public.direct_messages(
    sender_id,recipient_id,body,system_generated,activity_type,source_stat_id
  ) values(
    auth.uid(),target_user_id,
    format('💌 %s invited you to join %s. Tap to respond.',coalesce(inviter_name,'A player'),coalesce(team_name,'a team')),
    true,'team_invitation',invitation_id
  );
end;
$$;

revoke all on function public.invite_player_to_team(uuid,bigint) from public;
grant execute on function public.invite_player_to_team(uuid,bigint) to authenticated;

create or replace function public.get_my_pending_team_invitations()
returns table(
  invitation_id bigint,team_id bigint,team_name text,team_emoji text,
  invited_by uuid,inviter_name text,inviter_icon text,created_at timestamptz
)
language sql
security definer
stable
set search_path=public
as $$
  select i.id,t.id,t.name::text,t.emoji::text,i.invited_by,p.name::text,p.icon::text,i.created_at
  from public.team_invitations i
  join public.teams t on t.id=i.team_id
  join public.profiles p on p.id=i.invited_by
  where i.invited_user_id=auth.uid() and i.status='pending'
  order by i.created_at desc;
$$;

revoke all on function public.get_my_pending_team_invitations() from public;
grant execute on function public.get_my_pending_team_invitations() to authenticated;

create or replace function public.decide_team_invitation(
  target_invitation_id bigint,
  accept_invitation boolean
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  item public.team_invitations;
begin
  select * into item from public.team_invitations
  where id=target_invitation_id and invited_user_id=auth.uid() and status='pending'
  for update;
  if not found then raise exception 'Invitation is no longer available.'; end if;

  if accept_invitation then
    if exists(
      select 1 from public.team_member_blocks
      where team_id=item.team_id and user_id=auth.uid()
    ) then raise exception 'You cannot join this team.'; end if;
    insert into public.team_members(team_id,user_id)
    values(item.team_id,auth.uid())
    on conflict do nothing;
  end if;

  update public.team_invitations
  set status=case when accept_invitation then 'accepted' else 'declined' end,
      decided_at=now()
  where id=item.id;
  update public.direct_messages
  set read_at=coalesce(read_at,now())
  where activity_type='team_invitation'
    and source_stat_id=item.id
    and recipient_id=auth.uid();
end;
$$;

revoke all on function public.decide_team_invitation(bigint,boolean) from public;
grant execute on function public.decide_team_invitation(bigint,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
