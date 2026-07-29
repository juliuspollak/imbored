-- Reward steward role, public request board, and redemption disputes.
-- Run after v166.

-- ---------- profiles.is_reward_steward ----------
alter table profiles add column if not exists is_reward_steward boolean not null default false;

create or replace function public.is_reward_steward(uid uuid)
returns boolean language sql stable set search_path=public as $$
  select coalesce((select is_reward_steward from profiles where id=uid),false);
$$;
grant execute on function public.is_reward_steward(uuid) to authenticated;

create or replace function public.is_reward_manager(uid uuid)
returns boolean language sql stable set search_path=public as $$
  select public.is_admin(uid) or public.is_reward_steward(uid);
$$;
grant execute on function public.is_reward_manager(uuid) to authenticated;

-- ---------- reward_redemptions: dispute support ----------
alter table reward_redemptions add column if not exists dispute_reason text;
alter table reward_redemptions add column if not exists disputed_at timestamptz;

alter table reward_redemptions drop constraint if exists reward_redemptions_status_check;
alter table reward_redemptions add constraint reward_redemptions_status_check
  check (status in ('requested','approved','declined','fulfilled','disputed','cancelled'));

-- ---------- RLS: reward managers instead of admin-only ----------
drop policy if exists "admins manage rewards" on rewards;
create policy "reward managers manage rewards" on rewards
  for all using (is_reward_manager(auth.uid())) with check (is_reward_manager(auth.uid()));

drop policy if exists "admins manage wishes" on reward_wishes;
create policy "reward managers manage wishes" on reward_wishes
  for all using (is_reward_manager(auth.uid())) with check (is_reward_manager(auth.uid()));

-- Direct table access to reward_redemptions stays limited to the requester
-- or a reward manager: admin_note is an internal steward comment and must
-- never be readable by every player. The public request board instead reads
-- through list_reward_requests() below, which returns a safe column subset
-- only — the same pattern admin_list_players() already uses for profiles.
drop policy if exists "redemptions owner or admin" on reward_redemptions;
create policy "redemptions owner or manager" on reward_redemptions
  for select using (player_id=auth.uid() or is_reward_manager(auth.uid()));

-- ---------- review_redemption: reward managers, and dispute transitions ----------
create or replace function review_redemption(target_id bigint, new_status text, admin_note_in text default null)
returns void language plpgsql security definer set search_path=public as $$
declare red reward_redemptions;
begin
  if not is_reward_manager(auth.uid()) then raise exception 'Reward managers only'; end if;
  if new_status not in ('approved','declined','fulfilled') then raise exception 'Invalid status'; end if;
  select * into red from reward_redemptions where id=target_id for update;
  if not found then raise exception 'Redemption not found'; end if;
  if red.status not in ('requested','approved','disputed') then
    raise exception 'This request is already %', red.status;
  end if;
  if new_status='declined' and red.status not in ('declined','cancelled') then
    update player_progress set available_points=available_points+red.points_cost,updated_at=now() where player_id=red.player_id;
    insert into points_transactions(player_id,points,reason_code,reward_id,metadata,created_by)
      values(red.player_id,red.points_cost,'REWARD_REFUND',red.reward_id,jsonb_build_object('redemption_id',red.id),auth.uid());
    update rewards set stock_quantity=stock_quantity+1 where id=red.reward_id and stock_quantity is not null;
  end if;
  update reward_redemptions set status=new_status,admin_note=admin_note_in,reviewed_by=auth.uid(),reviewed_at=now(),
    fulfilled_at=case when new_status='fulfilled' then now() else fulfilled_at end,
    dispute_reason=case when new_status='fulfilled' then null else dispute_reason end,
    disputed_at=case when new_status='fulfilled' then null else disputed_at end
    where id=target_id;
end; $$;
grant execute on function review_redemption(bigint,text,text) to authenticated;

-- ---------- dispute_redemption: player raises a dispute on their own row ----------
create or replace function dispute_redemption(target_id bigint, reason text)
returns void language plpgsql security definer set search_path=public as $$
declare red reward_redemptions;
begin
  select * into red from reward_redemptions where id=target_id and player_id=auth.uid() for update;
  if not found then raise exception 'Redemption not found'; end if;
  if red.status<>'fulfilled' then raise exception 'Only a fulfilled request can be disputed'; end if;
  if red.fulfilled_at is null or red.fulfilled_at < now() - interval '48 hours' then
    raise exception 'Disputes must be raised within 48 hours of fulfilment';
  end if;
  if nullif(trim(reason),'') is null then raise exception 'A reason is required'; end if;
  update reward_redemptions set status='disputed',dispute_reason=reason,disputed_at=now() where id=target_id;
end; $$;
grant execute on function dispute_redemption(bigint,text) to authenticated;

-- ---------- list_reward_requests: the public request board's read path ----------
-- Every signed-in player can see who requested what and its status, but
-- never admin_note (internal steward commentary) or another player's
-- player_note. Mirrors admin_list_players()'s "safe column subset" pattern.
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
    red.requested_at,
    red.reviewed_at,
    red.fulfilled_at,
    red.disputed_at
  from reward_redemptions red
  join profiles profile on profile.id=red.player_id
  join rewards rw on rw.id=red.reward_id
  order by red.requested_at desc;
end;
$$;
revoke all on function public.list_reward_requests() from public;
grant execute on function public.list_reward_requests() to authenticated;

-- ---------- set_user_reward_steward: admin-only grant/revoke ----------
create or replace function public.set_user_reward_steward(target_user_id uuid, steward boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin only.' using errcode='42501';
  end if;
  update public.profiles set is_reward_steward=steward where id=target_user_id;
end; $$;
revoke all on function public.set_user_reward_steward(uuid,boolean) from public;
grant execute on function public.set_user_reward_steward(uuid,boolean) to authenticated;

-- ---------- admin_list_players: surface is_reward_steward ----------
-- The return row shape is changing (new is_reward_steward column), which
-- create-or-replace cannot do for a table-returning function.
drop function if exists public.admin_list_players();

create or replace function public.admin_list_players()
returns table(
  id uuid,
  name text,
  icon text,
  is_private boolean,
  is_admin boolean,
  is_reward_steward boolean,
  hidden_from_others boolean,
  is_approved boolean,
  is_blocked boolean,
  account_deleted_at timestamptz,
  auth_deleted_at timestamptz
)
language plpgsql
security definer
stable
set search_path=public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin only.' using errcode='42501';
  end if;

  return query
  select
    profile.id,
    profile.name::text,
    profile.icon::text,
    profile.is_private,
    profile.is_admin,
    profile.is_reward_steward,
    profile.hidden_from_others,
    profile.is_approved,
    profile.is_blocked,
    profile.account_deleted_at,
    profile.auth_deleted_at
  from public.profiles profile
  order by profile.name;
end;
$$;

revoke all on function public.admin_list_players() from public;
grant execute on function public.admin_list_players() to authenticated;
