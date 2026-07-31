-- Restore the organiser reward page. The menu badge already uses
-- is_circle_organiser(circle_id); every list below uses that same permission
-- rule so the badge and page cannot disagree about which circles are managed.

begin;

create or replace function public.am_i_a_circle_organiser()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists(
    select 1
    from public.circles c
    where public.is_circle_organiser(c.id)
  );
$function$;

create or replace function public.list_organiser_ideas()
returns table(
  id bigint,
  name text,
  description text,
  reward_type text,
  is_physical boolean,
  status text,
  circle_id bigint,
  circle_name text,
  creator_id uuid,
  creator_name text,
  creator_icon text,
  approve_count bigint,
  required_count bigint,
  has_history boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    rw.id,
    rw.name,
    rw.description,
    rw.reward_type,
    rw.is_physical,
    rw.status,
    rw.circle_id,
    c.name as circle_name,
    rw.created_by as creator_id,
    coalesce(p.name,'Unknown player') as creator_name,
    coalesce(p.icon,'🎮') as creator_icon,
    null::bigint as approve_count,
    null::bigint as required_count,
    exists(
      select 1 from public.reward_redemptions rr where rr.reward_id=rw.id
    ) as has_history,
    rw.created_at
  from public.rewards rw
  join public.circles c on c.id=rw.circle_id
  left join public.profiles p on p.id=rw.created_by
  where rw.status in ('suggested','pending')
    and public.is_circle_organiser(rw.circle_id)
  order by
    case rw.status when 'suggested' then 0 else 1 end,
    rw.created_at desc;
$function$;

create or replace function public.list_organiser_active_requests()
returns table(
  id bigint,
  reward_id bigint,
  reward_name text,
  points_cost bigint,
  status text,
  cancellation_requested_at timestamptz,
  circle_id bigint,
  circle_name text,
  player_id uuid,
  player_name text,
  player_icon text,
  requested_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    rr.id,
    rr.reward_id,
    rw.name as reward_name,
    rr.points_cost,
    rr.status,
    rr.cancellation_requested_at,
    rw.circle_id,
    c.name as circle_name,
    rr.player_id,
    coalesce(p.name,'Unknown player') as player_name,
    coalesce(p.icon,'🎮') as player_icon,
    rr.requested_at
  from public.reward_redemptions rr
  join public.rewards rw on rw.id=rr.reward_id
  join public.circles c on c.id=rw.circle_id
  left join public.profiles p on p.id=rr.player_id
  where rr.status in ('requested','approved')
    and public.is_circle_organiser(rw.circle_id)
  order by
    case when rr.cancellation_requested_at is not null then 0 else 1 end,
    rr.requested_at asc;
$function$;

create or replace function public.list_organiser_reward_catalog()
returns table(
  id bigint,
  name text,
  description text,
  reward_type text,
  is_physical boolean,
  points_cost bigint,
  stock_quantity integer,
  status text,
  circle_id bigint,
  circle_name text,
  has_history boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    rw.id,
    rw.name,
    rw.description,
    rw.reward_type,
    rw.is_physical,
    rw.points_cost,
    rw.stock_quantity,
    rw.status,
    rw.circle_id,
    c.name as circle_name,
    exists(
      select 1 from public.reward_redemptions rr where rr.reward_id=rw.id
    ) as has_history,
    rw.created_at
  from public.rewards rw
  join public.circles c on c.id=rw.circle_id
  where rw.status='available'
    and public.is_circle_organiser(rw.circle_id)
  order by rw.updated_at desc nulls last,rw.created_at desc;
$function$;

create or replace function public.list_organiser_finished_requests()
returns table(
  id bigint,
  reward_id bigint,
  reward_name text,
  points_cost bigint,
  status text,
  dispute_reason text,
  circle_id bigint,
  circle_name text,
  player_id uuid,
  player_name text,
  player_icon text,
  requested_at timestamptz,
  fulfilled_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    rr.id,
    rr.reward_id,
    rw.name as reward_name,
    rr.points_cost,
    rr.status,
    rr.dispute_reason,
    rw.circle_id,
    c.name as circle_name,
    rr.player_id,
    coalesce(p.name,'Unknown player') as player_name,
    coalesce(p.icon,'🎮') as player_icon,
    rr.requested_at,
    rr.fulfilled_at
  from public.reward_redemptions rr
  join public.rewards rw on rw.id=rr.reward_id
  join public.circles c on c.id=rw.circle_id
  left join public.profiles p on p.id=rr.player_id
  where rr.status in ('fulfilled','cancelled','rejected','disputed')
    and public.is_circle_organiser(rw.circle_id)
  order by coalesce(rr.fulfilled_at,rr.reviewed_at,rr.disputed_at,rr.requested_at) desc;
$function$;

revoke all on function public.list_organiser_ideas() from public;
revoke all on function public.list_organiser_active_requests() from public;
revoke all on function public.list_organiser_reward_catalog() from public;
revoke all on function public.list_organiser_finished_requests() from public;
grant execute on function public.am_i_a_circle_organiser() to authenticated;
grant execute on function public.list_organiser_ideas() to authenticated;
grant execute on function public.list_organiser_active_requests() to authenticated;
grant execute on function public.list_organiser_reward_catalog() to authenticated;
grant execute on function public.list_organiser_finished_requests() to authenticated;

commit;

-- Verification (run while signed in through the app): the first value must
-- equal suggested ideas plus active cancellation requests returned below.
-- select public.get_organiser_attention_count();
-- select * from public.list_organiser_ideas();
-- select * from public.list_organiser_active_requests();
