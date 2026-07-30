-- v186: players who suggest a reward item currently have no way to see it
-- again — get_pending_reward_proposals() only surfaces 'suggested'/'pending'
-- items and is only called from the admin/reward-steward AdminRewards page.
-- Add a proper "my suggestions" view covering every status (including
-- approved and rejected) for whichever items the current user proposed.

create or replace function public.get_my_reward_proposals()
returns table(
  id bigint,
  circle_id bigint,
  circle_name text,
  name text,
  description text,
  image_url text,
  points_cost bigint,
  status text,
  approve_count int,
  reject_count int,
  required_count int,
  created_at timestamptz
)
language sql
security definer
stable
set search_path=public
as $$
  select
    rw.id,
    rw.circle_id,
    c.name::text,
    rw.name::text,
    rw.description::text,
    rw.image_url::text,
    rw.points_cost,
    rw.status,
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='approve'),
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='reject'),
    (floor((select count(*)::int from circle_members m where m.circle_id=rw.circle_id and m.can_approve_rewards=true)::numeric/2)+1)::int,
    rw.created_at
  from rewards rw
  join circles c on c.id=rw.circle_id
  where rw.created_by=auth.uid()
  order by rw.created_at desc;
$$;

revoke all on function public.get_my_reward_proposals() from public;
grant execute on function public.get_my_reward_proposals() to authenticated;

notify pgrst,'reload schema';
