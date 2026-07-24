begin;

-- Level 2 is the first trust milestone. Use lifetime progress rather than the
-- spendable balance so redeeming a reward never removes an earned capability.
create or replace function public.has_social_unlock(uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path=public
as $$
  select public.is_admin(uid) or exists(
    select 1
    from public.player_progress progress
    where progress.player_id=uid
      and (coalesce(progress.current_level,1)>=2 or coalesce(progress.lifetime_points,0)>=500)
  )
$$;

revoke all on function public.has_social_unlock(uuid) from public;
grant execute on function public.has_social_unlock(uuid) to authenticated;

create or replace function public.is_available_player(uid uuid)
returns boolean
language sql
security definer
stable
set search_path=public
as $$
  select exists(
    select 1
    from public.profiles profile
    where profile.id=uid
      and profile.account_deleted_at is null
      and coalesce(profile.is_blocked,false)=false
      and (profile.is_admin=true or profile.is_approved=true)
  )
$$;

revoke all on function public.is_available_player(uuid) from public;
grant execute on function public.is_available_player(uuid) to authenticated;

drop policy if exists "visible users create teams" on public.teams;
drop policy if exists "trusted visible users create teams" on public.teams;
create policy "trusted visible users create teams"
on public.teams for insert to authenticated
with check (
  created_by=auth.uid()
  and public.is_available_player(auth.uid())
  and public.has_social_unlock(auth.uid())
  and not exists(
    select 1 from public.profiles profile
    where profile.id=auth.uid() and coalesce(profile.hidden_from_others,false)
  )
);

create or replace function public.create_team(team_name text, team_emoji text default '⭐')
returns public.teams
language plpgsql
security definer
set search_path=public
as $$
declare result public.teams;
begin
  if not public.is_available_player(auth.uid()) then
    raise exception 'Your account must be active and approved first.' using errcode='42501';
  end if;
  if not public.has_social_unlock(auth.uid()) then
    raise exception 'Team creation unlocks at Level 2.' using errcode='42501';
  end if;
  if exists(
    select 1 from public.profiles profile
    where profile.id=auth.uid() and coalesce(profile.hidden_from_others,false)
  ) then
    raise exception 'Hidden players cannot create teams.' using errcode='42501';
  end if;
  if nullif(btrim(team_name),'') is null then
    raise exception 'Team name is required.' using errcode='22023';
  end if;

  insert into public.teams(name,emoji,created_by)
  values(btrim(team_name),coalesce(nullif(btrim(team_emoji),''),'⭐'),auth.uid())
  returning * into result;

  insert into public.team_members(team_id,user_id)
  values(result.id,auth.uid());
  return result;
end;
$$;

revoke all on function public.create_team(text,text) from public;
grant execute on function public.create_team(text,text) to authenticated;

drop policy if exists "players create wishes" on public.reward_wishes;
drop policy if exists "level two players create wishes" on public.reward_wishes;
create policy "level two players create wishes"
on public.reward_wishes for insert to authenticated
with check (
  player_id=auth.uid()
  and public.is_available_player(auth.uid())
  and public.has_social_unlock(auth.uid())
);

create or replace function public.transfer_points(target_player_id uuid, amount bigint)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare sender public.player_progress; recipient public.player_progress;
begin
  if not public.is_available_player(auth.uid()) then
    raise exception 'Your account is not available for transfers.' using errcode='42501';
  end if;
  if not public.has_social_unlock(auth.uid()) then
    raise exception 'Point transfers unlock at Level 2.' using errcode='42501';
  end if;
  if amount < 10 then raise exception 'Minimum transfer is 10 points'; end if;
  if target_player_id=auth.uid() then raise exception 'You cannot transfer points to yourself'; end if;
  if not public.is_available_player(target_player_id) then raise exception 'Player not available'; end if;

  perform public.ensure_player_progress(auth.uid());
  perform public.ensure_player_progress(target_player_id);
  select * into sender from public.player_progress where player_id=auth.uid() for update;
  if sender.available_points < amount then raise exception 'Not enough points'; end if;
  select * into recipient from public.player_progress where player_id=target_player_id for update;

  update public.player_progress
  set available_points=available_points-amount,updated_at=now()
  where player_id=auth.uid();
  update public.player_progress
  set available_points=available_points+amount,updated_at=now()
  where player_id=target_player_id;
  insert into public.points_transactions(player_id,points,reason_code,related_player_id,created_by)
  values
    (auth.uid(),-amount,'TRANSFER_SENT',target_player_id,auth.uid()),
    (target_player_id,amount,'TRANSFER_RECEIVED',auth.uid(),auth.uid());
  return jsonb_build_object('balance',sender.available_points-amount);
end;
$$;

revoke all on function public.transfer_points(uuid,bigint) from public;
grant execute on function public.transfer_points(uuid,bigint) to authenticated;

create or replace function public.send_direct_message(target_recipient_id uuid,message_body text)
returns table(id bigint,sender_id uuid,recipient_id uuid,body text,created_at timestamp with time zone,read_at timestamp with time zone)
language plpgsql
security definer
set search_path=public,auth
as $$
declare current_sender_id uuid:=auth.uid(); cleaned_body text:=btrim(message_body);
begin
  if not public.is_available_player(current_sender_id) then
    raise exception 'Your account must be active and approved before messaging.' using errcode='42501';
  end if;
  if target_recipient_id is null or target_recipient_id=current_sender_id then
    raise exception 'Choose another player to message.' using errcode='22023';
  end if;
  if cleaned_body is null or char_length(cleaned_body) not between 1 and 1000 then
    raise exception 'Message must contain 1 to 1000 characters.' using errcode='22023';
  end if;
  if not public.is_available_player(target_recipient_id) then
    raise exception 'This player is no longer available for messages.' using errcode='42501';
  end if;

  return query
  insert into public.direct_messages as message(sender_id,recipient_id,body)
  values(current_sender_id,target_recipient_id,cleaned_body)
  returning message.id,message.sender_id,message.recipient_id,message.body,message.created_at,message.read_at;
end;
$$;

revoke all on function public.send_direct_message(uuid,text) from public;
grant execute on function public.send_direct_message(uuid,text) to authenticated;

-- Prevent bypassing the RPC through a direct table insert.
drop policy if exists "users can send direct messages" on public.direct_messages;
drop policy if exists "available users can send direct messages" on public.direct_messages;
create policy "available users can send direct messages"
on public.direct_messages for insert to authenticated
with check (
  auth.uid()=sender_id
  and sender_id<>recipient_id
  and public.is_available_player(sender_id)
  and public.is_available_player(recipient_id)
);

drop policy if exists "users can send a poke" on public.pokes;
drop policy if exists "available users can send a poke" on public.pokes;
create policy "available users can send a poke"
on public.pokes for insert to authenticated
with check (
  auth.uid()=from_user
  and public.is_available_player(from_user)
  and public.is_available_player(to_user)
  and public.can_view_user(from_user)
  and public.can_view_user(to_user)
);

-- Old messages are retained as history, but deleted accounts disappear from
-- active chat lists and can no longer leave a ghost unread badge.
update public.direct_messages message
set read_at=coalesce(message.read_at,now())
where message.read_at is null
  and exists(
    select 1 from public.profiles profile
    where profile.id=message.sender_id and profile.account_deleted_at is not null
  );

create or replace function public.retire_deleted_player_messages()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if old.account_deleted_at is null and new.account_deleted_at is not null then
    update public.direct_messages
    set read_at=coalesce(read_at,now())
    where sender_id=new.id and read_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_retire_deleted_player_messages on public.profiles;
create trigger profiles_retire_deleted_player_messages
after update of account_deleted_at on public.profiles
for each row execute function public.retire_deleted_player_messages();

notify pgrst,'reload schema';
commit;
