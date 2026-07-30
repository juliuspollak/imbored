-- v192: OrganiserRewards.jsx had to click Remove, hit a rejection, and
-- only then get offered the force-delete option — a wasted round trip
-- since redemption history is knowable up front. Expose has_history on
-- the catalog and new-ideas listings so the client picks the right
-- confirmation immediately.

begin;

create or replace function public.get_organiser_reward_catalog()
returns table(
  id bigint, circle_id bigint, circle_name text, name text, reward_type text,
  points_cost bigint, stock_quantity int, has_history boolean, created_at timestamptz
)
language sql security definer stable set search_path=public as $$
  select rw.id, rw.circle_id, c.name::text, rw.name::text, rw.reward_type,
    rw.points_cost, rw.stock_quantity,
    exists(select 1 from reward_redemptions red where red.reward_id=rw.id),
    rw.created_at
  from rewards rw
  join circles c on c.id=rw.circle_id
  where rw.status='active'
    and public.is_circle_organiser(rw.circle_id,auth.uid())
  order by rw.created_at desc;
$$;
revoke all on function public.get_organiser_reward_catalog() from public;
grant execute on function public.get_organiser_reward_catalog() to authenticated;

create or replace function public.get_organiser_new_ideas()
returns table(
  id bigint, circle_id bigint, circle_name text, name text, description text,
  image_url text, reward_type text, is_physical boolean, status text,
  points_cost bigint, created_by uuid, creator_name text, creator_icon text,
  approve_count int, required_count int, has_history boolean, created_at timestamptz
)
language sql security definer stable set search_path=public as $$
  select rw.id, rw.circle_id, c.name::text, rw.name::text, rw.description::text,
    rw.image_url::text, rw.reward_type, rw.is_physical, rw.status, rw.points_cost,
    rw.created_by, creator.name::text, creator.icon::text,
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='approve'),
    (floor((select count(*)::int from circle_members m where m.circle_id=rw.circle_id)::numeric/2)+1)::int,
    exists(select 1 from reward_redemptions red where red.reward_id=rw.id),
    rw.created_at
  from rewards rw
  join circles c on c.id=rw.circle_id
  join profiles creator on creator.id=rw.created_by
  where rw.status in ('suggested','pending')
    and public.is_circle_organiser(rw.circle_id,auth.uid())
  order by rw.created_at desc;
$$;
revoke all on function public.get_organiser_new_ideas() from public;
grant execute on function public.get_organiser_new_ideas() to authenticated;

notify pgrst,'reload schema';
commit;
