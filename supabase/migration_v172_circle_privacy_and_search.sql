-- v172: Circles fixes — respect hidden/deleted profile privacy in rosters,
-- purge deleted accounts from membership, add server-side search for
-- inviting (instead of shipping the whole player list to the client), and
-- surface a circle's outgoing pending invitations.
-- Run after v171.

begin;

-- The v170 backfill added every profile to the Default circle without
-- checking account_deleted_at/hidden_from_others. A deleted account should
-- not occupy a membership row at all.
delete from public.guardian_circle_members m
using public.profiles p
where p.id=m.user_id and p.account_deleted_at is not null;

create or replace function public.get_circle_roster(target_circle_id bigint)
returns table(user_id uuid,name text,icon text,can_approve boolean)
language sql security definer stable set search_path=public as $$
  select p.id,p.name::text,p.icon::text,gcm.can_approve
  from guardian_circle_members gcm
  join profiles p on p.id=gcm.user_id
  where gcm.circle_id=target_circle_id
    and is_circle_member(target_circle_id,auth.uid())
    and (p.id=auth.uid() or coalesce(p.hidden_from_others,false)=false)
    and p.account_deleted_at is null
  order by gcm.can_approve desc,p.name;
$$;
revoke all on function public.get_circle_roster(bigint) from public;
grant execute on function public.get_circle_roster(bigint) to authenticated;

create or replace function public.search_invitable_players(search_query text, exclude_circle_id bigint)
returns table(id uuid,name text,icon text)
language sql security definer stable set search_path=public as $$
  select p.id,p.name::text,p.icon::text
  from profiles p
  where p.id<>auth.uid()
    and p.account_deleted_at is null
    and coalesce(p.hidden_from_others,false)=false
    and coalesce(p.is_approved,true)=true
    and coalesce(p.is_blocked,false)=false
    and not is_circle_member(exclude_circle_id,p.id)
    and nullif(trim(search_query),'') is not null
    and length(trim(search_query))>=2
    and p.name ilike '%'||trim(search_query)||'%'
  order by p.name
  limit 20;
$$;
revoke all on function public.search_invitable_players(text,bigint) from public;
grant execute on function public.search_invitable_players(text,bigint) to authenticated;

create or replace function public.get_circle_pending_invitations(target_circle_id bigint)
returns table(invitation_id bigint,invited_user_id uuid,invited_name text,invited_icon text,created_at timestamptz)
language sql security definer stable set search_path=public as $$
  select i.id,i.invited_user_id,p.name::text,p.icon::text,i.created_at
  from guardian_circle_invitations i
  join profiles p on p.id=i.invited_user_id
  where i.circle_id=target_circle_id and i.status='pending'
    and is_circle_member(target_circle_id,auth.uid())
  order by i.created_at desc;
$$;
revoke all on function public.get_circle_pending_invitations(bigint) from public;
grant execute on function public.get_circle_pending_invitations(bigint) to authenticated;

notify pgrst,'reload schema';
commit;
