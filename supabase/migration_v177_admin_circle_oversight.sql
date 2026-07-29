-- v177: v174 correctly removed admin's blanket auto-membership from every
-- circle, but several read RPCs only ever checked literal circle
-- membership, never an is_admin bypass — so admin lost visibility into
-- pending proposals, rosters and invitations for any circle they aren't a
-- member of, even though the underlying approve/invite/etc RPCs already
-- treat is_admin as approver-equivalent via is_circle_approver(). Give
-- admin the same oversight on the read side that it already has on write.
-- Run after v176.

begin;

create or replace function public.get_my_circles()
returns table(circle_id bigint,circle_name text,can_approve boolean,member_count int,approver_count int)
language sql security definer stable set search_path=public as $$
  select c.id,c.name::text,
    coalesce(gcm.can_approve,is_admin(auth.uid())),
    (select count(*)::int from guardian_circle_members m where m.circle_id=c.id),
    (select count(*)::int from guardian_circle_members m where m.circle_id=c.id and m.can_approve=true)
  from guardian_circles c
  left join guardian_circle_members gcm on gcm.circle_id=c.id and gcm.user_id=auth.uid()
  where gcm.user_id is not null or is_admin(auth.uid())
  order by c.name;
$$;
revoke all on function public.get_my_circles() from public;
grant execute on function public.get_my_circles() to authenticated;

create or replace function public.get_circle_roster(target_circle_id bigint)
returns table(user_id uuid,name text,icon text,can_approve boolean)
language sql security definer stable set search_path=public as $$
  select p.id,p.name::text,p.icon::text,gcm.can_approve
  from guardian_circle_members gcm
  join profiles p on p.id=gcm.user_id
  where gcm.circle_id=target_circle_id
    and (is_circle_member(target_circle_id,auth.uid()) or is_admin(auth.uid()))
    and (p.id=auth.uid() or coalesce(p.hidden_from_others,false)=false)
    and p.account_deleted_at is null
  order by gcm.can_approve desc,p.name;
$$;
revoke all on function public.get_circle_roster(bigint) from public;
grant execute on function public.get_circle_roster(bigint) to authenticated;

create or replace function public.get_circle_pending_invitations(target_circle_id bigint)
returns table(invitation_id bigint,invited_user_id uuid,invited_name text,invited_icon text,created_at timestamptz)
language sql security definer stable set search_path=public as $$
  select i.id,i.invited_user_id,p.name::text,p.icon::text,i.created_at
  from guardian_circle_invitations i
  join profiles p on p.id=i.invited_user_id
  where i.circle_id=target_circle_id and i.status='pending'
    and (is_circle_member(target_circle_id,auth.uid()) or is_admin(auth.uid()))
  order by i.created_at desc;
$$;
revoke all on function public.get_circle_pending_invitations(bigint) from public;
grant execute on function public.get_circle_pending_invitations(bigint) to authenticated;

create or replace function public.get_pending_reward_proposals()
returns table(id bigint,circle_id bigint,circle_name text,name text,description text,image_url text,points_cost bigint,stock_quantity int,created_by uuid,creator_name text,creator_icon text,approve_count int,reject_count int,required_count int)
language sql security definer stable set search_path=public as $$
  select rw.id,rw.circle_id,gc.name::text,rw.name::text,rw.description::text,rw.image_url::text,rw.points_cost,rw.stock_quantity,
    rw.created_by,creator.name::text,creator.icon::text,
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='approve'),
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='reject'),
    (floor((select count(*)::int from guardian_circle_members m where m.circle_id=rw.circle_id and m.can_approve=true)::numeric/2)+1)::int
  from rewards rw
  join guardian_circles gc on gc.id=rw.circle_id
  join profiles creator on creator.id=rw.created_by
  where rw.status='pending' and (is_circle_member(rw.circle_id,auth.uid()) or is_admin(auth.uid()))
  order by rw.created_at desc;
$$;
revoke all on function public.get_pending_reward_proposals() from public;
grant execute on function public.get_pending_reward_proposals() to authenticated;

create or replace function public.propose_reward(
  target_circle_id bigint,reward_name text,reward_description text,reward_image_url text,
  reward_points_cost bigint,reward_stock_quantity int
) returns bigint language plpgsql security definer set search_path=public as $$
declare new_id bigint;
begin
  if not (is_admin(auth.uid()) or is_reward_steward(auth.uid())) then raise exception 'Reward managers only.' using errcode='42501'; end if;
  if not (is_circle_member(target_circle_id,auth.uid()) or is_admin(auth.uid())) then raise exception 'You are not a member of this circle.' using errcode='42501'; end if;
  insert into rewards(name,description,image_url,points_cost,stock_quantity,circle_id,status,created_by)
  values(reward_name,reward_description,reward_image_url,reward_points_cost,reward_stock_quantity,target_circle_id,'pending',auth.uid())
  returning id into new_id;
  return new_id;
end; $$;
revoke all on function public.propose_reward(bigint,text,text,text,bigint,int) from public;
grant execute on function public.propose_reward(bigint,text,text,text,bigint,int) to authenticated;

notify pgrst,'reload schema';
commit;
