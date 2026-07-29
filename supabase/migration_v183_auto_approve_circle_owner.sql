-- v183: A new circle starts with zero reward approvers (can_approve_rewards
-- defaults false), so the quorum required to approve the very first proposed
-- item — floor(0/2)+1 = 1 — can never be met by anyone but an app admin,
-- until the owner manually grants themselves approver status. The owner
-- already has strictly more authority than an approver (can grant/revoke
-- approver status on anyone, transfer ownership, delete the circle), so
-- withholding this isn't a real security boundary — just friction. Auto-grant
-- it on creation, and backfill existing circles that are currently stuck.
-- Run after v182.

begin;

create or replace function public.create_circle(circle_name text, circle_emoji text default '⭐')
returns public.circles
language plpgsql
security definer
set search_path=public
as $$
declare result public.circles;
begin
  if not public.is_available_player(auth.uid()) then
    raise exception 'Your account must be active and approved first.' using errcode='42501';
  end if;
  if exists(
    select 1 from public.profiles profile
    where profile.id=auth.uid() and coalesce(profile.hidden_from_others,false)
  ) then
    raise exception 'Hidden players cannot create circles.' using errcode='42501';
  end if;
  if nullif(btrim(circle_name),'') is null then
    raise exception 'Circle name is required.' using errcode='22023';
  end if;

  insert into public.circles(name,emoji,created_by)
  values(btrim(circle_name),coalesce(nullif(btrim(circle_emoji),''),'⭐'),auth.uid())
  returning * into result;

  insert into public.circle_members(circle_id,user_id,can_approve_rewards)
  values(result.id,auth.uid(),true);
  return result;
end;
$$;
revoke all on function public.create_circle(text,text) from public;
grant execute on function public.create_circle(text,text) to authenticated;

update public.circle_members cm
set can_approve_rewards=true
from public.circles c
where cm.circle_id=c.id
  and cm.user_id=c.created_by
  and not exists(
    select 1 from public.circle_members m2
    where m2.circle_id=c.id and m2.can_approve_rewards=true
  );

commit;
