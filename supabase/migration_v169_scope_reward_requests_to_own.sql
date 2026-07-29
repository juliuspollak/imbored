-- v169: A regular player only needs to see their own reward requests to
-- track status and raise a dispute. Only reward managers need visibility
-- into everyone's queue, to actually review it. Restrict at the RPC level
-- (not just in the UI) so this can't be bypassed by calling the RPC directly.
-- Run after v168.

drop function if exists public.list_reward_requests();

create or replace function public.list_reward_requests()
returns table(
  id bigint,
  player_id uuid,
  player_name text,
  player_icon text,
  reward_id bigint,
  reward_name text,
  points_cost bigint,
  status text,
  player_note text,
  dispute_reason text,
  reviewed_by_name text,
  reviewed_by_icon text,
  requested_at timestamptz,
  reviewed_at timestamptz,
  fulfilled_at timestamptz,
  disputed_at timestamptz
)
language plpgsql
security definer
stable
set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501'; end if;
  return query
  select
    red.id,
    red.player_id,
    profile.name::text,
    profile.icon::text,
    red.reward_id,
    rw.name::text,
    red.points_cost,
    red.status,
    case when red.player_id=auth.uid() or is_reward_manager(auth.uid()) then red.player_note else null end,
    red.dispute_reason,
    reviewer.name::text,
    reviewer.icon::text,
    red.requested_at,
    red.reviewed_at,
    red.fulfilled_at,
    red.disputed_at
  from reward_redemptions red
  join profiles profile on profile.id=red.player_id
  join rewards rw on rw.id=red.reward_id
  left join profiles reviewer on reviewer.id=red.reviewed_by
  where red.player_id=auth.uid() or is_reward_manager(auth.uid())
  order by red.requested_at desc;
end;
$$;
revoke all on function public.list_reward_requests() from public;
grant execute on function public.list_reward_requests() to authenticated;
