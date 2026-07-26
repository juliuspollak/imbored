begin;

-- Return only unapproved accounts whose verified Auth email matches an email
-- invitation created by the current user. Keeping this lookup server-side avoids
-- exposing Auth emails through the profiles table or trusting a client-supplied
-- email address.
create or replace function public.get_my_pending_invited_players()
returns table(
  user_id uuid,
  player_name text,
  player_icon text,
  invited_email text,
  invited_at timestamptz
)
language sql
security definer
set search_path=public,auth
stable
as $$
  select distinct on (p.id)
    p.id,
    p.name,
    p.icon,
    lower(u.email),
    i.created_at
  from public.app_email_invitations i
  join auth.users u
    on lower(u.email)=lower(i.invitee_email)
  join public.profiles p
    on p.id=u.id
  where i.inviter_id=auth.uid()
    and coalesce(p.is_admin,false)=false
    and coalesce(p.is_approved,false)=false
    and coalesce(p.is_blocked,false)=false
    and p.account_deleted_at is null
  order by p.id,i.created_at desc;
$$;

revoke all on function public.get_my_pending_invited_players() from public;
grant execute on function public.get_my_pending_invited_players() to authenticated;

-- An admin may still approve any eligible player through set_user_approval.
-- A normal player may approve only an account whose Auth email matches an email
-- invitation that player personally created. Inviters cannot revoke approval.
create or replace function public.approve_invited_player(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path=public,auth
as $$
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be active and approved.' using errcode='42501';
  end if;

  if not exists(
    select 1
    from public.app_email_invitations i
    join auth.users u
      on u.id=target_user_id
     and lower(u.email)=lower(i.invitee_email)
    join public.profiles p
      on p.id=target_user_id
    where i.inviter_id=auth.uid()
      and coalesce(p.is_admin,false)=false
      and coalesce(p.is_blocked,false)=false
      and p.account_deleted_at is null
  ) then
    raise exception 'You can approve only players you invited by email.' using errcode='42501';
  end if;

  update public.profiles
  set is_approved=true,
      approved_at=now(),
      approved_by=auth.uid()
  where id=target_user_id
    and coalesce(is_admin,false)=false
    and coalesce(is_blocked,false)=false
    and account_deleted_at is null;
end;
$$;

revoke all on function public.approve_invited_player(uuid) from public;
grant execute on function public.approve_invited_player(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
