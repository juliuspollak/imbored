-- v72: reliable transfer notifications + team join request workflow
alter table public.points_transactions add column if not exists seen_at timestamptz;

create or replace function public.mark_my_transfers_seen()
returns void language sql security definer set search_path=public as $$
  update public.points_transactions set seen_at=now()
  where player_id=auth.uid() and reason_code='TRANSFER_RECEIVED' and seen_at is null;
$$;
grant execute on function public.mark_my_transfers_seen() to authenticated;

create table if not exists public.team_join_requests (
  id bigint generated always as identity primary key,
  team_id bigint not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  user_seen_at timestamptz,
  unique(team_id,user_id,status)
);
alter table public.team_join_requests enable row level security;

drop policy if exists "join requests visible to requester and team owner" on public.team_join_requests;
create policy "join requests visible to requester and team owner" on public.team_join_requests for select using (
  auth.uid()=user_id or exists(select 1 from public.teams t where t.id=team_id and t.created_by=auth.uid())
);

drop policy if exists "users request team membership" on public.team_join_requests;
create policy "users request team membership" on public.team_join_requests for insert with check (
  auth.uid()=user_id
  and not exists(select 1 from public.profiles p where p.id=auth.uid() and coalesce(p.hidden_from_others,false))
);

drop policy if exists "team owner decides join requests" on public.team_join_requests;
create policy "team owner decides join requests" on public.team_join_requests for update using (
  exists(select 1 from public.teams t where t.id=team_id and t.created_by=auth.uid()) or auth.uid()=user_id
);

-- Direct self-join is no longer allowed; creators/admin functions still insert through security definer paths.
drop policy if exists "users can join a team themselves" on public.team_members;

create or replace function public.request_team_join(target_team_id bigint)
returns void language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.profiles where id=auth.uid() and coalesce(hidden_from_others,false)) then
    raise exception 'Hidden players cannot join teams';
  end if;
  if exists(select 1 from public.team_members where team_id=target_team_id and user_id=auth.uid()) then
    raise exception 'You are already a member';
  end if;
  delete from public.team_join_requests where team_id=target_team_id and user_id=auth.uid() and status<>'pending';
  insert into public.team_join_requests(team_id,user_id,status) values(target_team_id,auth.uid(),'pending') on conflict do nothing;
end; $$;
grant execute on function public.request_team_join(bigint) to authenticated;

create or replace function public.decide_team_join_request(request_id bigint, approve boolean)
returns void language plpgsql security definer set search_path=public as $$
declare r public.team_join_requests; owner_id uuid;
begin
  select * into r from public.team_join_requests where id=request_id and status='pending' for update;
  if not found then raise exception 'Request is no longer pending'; end if;
  select created_by into owner_id from public.teams where id=r.team_id;
  if owner_id<>auth.uid() then raise exception 'Only the team owner can decide this request'; end if;
  if approve then
    if exists(select 1 from public.profiles where id=r.user_id and coalesce(hidden_from_others,false)) then
      raise exception 'Hidden players cannot join teams';
    end if;
    insert into public.team_members(team_id,user_id) values(r.team_id,r.user_id) on conflict do nothing;
  end if;
  update public.team_join_requests set status=case when approve then 'approved' else 'declined' end,
    decided_at=now(), decided_by=auth.uid(), user_seen_at=null where id=request_id;
end; $$;
grant execute on function public.decide_team_join_request(bigint,boolean) to authenticated;

create or replace function public.mark_my_team_request_updates_seen()
returns void language sql security definer set search_path=public as $$
 update public.team_join_requests set user_seen_at=now()
 where user_id=auth.uid() and status<>'pending' and user_seen_at is null;
$$;
grant execute on function public.mark_my_team_request_updates_seen() to authenticated;

notify pgrst, 'reload schema';
