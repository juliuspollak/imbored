-- v173: Search within a circle instead of always shipping its full roster
-- to the client. Members and pending invitees are searched together so the
-- "Invited" badge still shows up for an in-progress invite.
-- Run after v172.

begin;

create or replace function public.search_circle_members(target_circle_id bigint, search_query text)
returns table(user_id uuid,name text,icon text,can_approve boolean,status text)
language sql security definer stable set search_path=public as $$
  select p.id,p.name::text,p.icon::text,gcm.can_approve,'member'::text
  from guardian_circle_members gcm
  join profiles p on p.id=gcm.user_id
  where gcm.circle_id=target_circle_id
    and is_circle_member(target_circle_id,auth.uid())
    and (p.id=auth.uid() or coalesce(p.hidden_from_others,false)=false)
    and p.account_deleted_at is null
    and nullif(trim(search_query),'') is not null
    and p.name ilike '%'||trim(search_query)||'%'
  union all
  select p.id,p.name::text,p.icon::text,false,'invited'::text
  from guardian_circle_invitations i
  join profiles p on p.id=i.invited_user_id
  where i.circle_id=target_circle_id and i.status='pending'
    and is_circle_member(target_circle_id,auth.uid())
    and nullif(trim(search_query),'') is not null
    and p.name ilike '%'||trim(search_query)||'%'
  order by status,name
  limit 20;
$$;
revoke all on function public.search_circle_members(bigint,text) from public;
grant execute on function public.search_circle_members(bigint,text) to authenticated;

notify pgrst,'reload schema';
commit;
