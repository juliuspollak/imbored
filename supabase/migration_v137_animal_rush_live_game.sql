-- v137: Animal Rush phone-only live multiplayer game.
--
-- Run once in Supabase Dashboard -> SQL Editor before making the game visible.
-- The server owns room state, reveal time, first-correct resolution and every
-- card penalty. Clients can render optimistically but cannot choose a winner.

create extension if not exists pgcrypto;

create table if not exists public.animal_rush_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-F0-9]{6}$'),
  host_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'lobby'
    check (status in ('lobby','countdown','round_result','finished')),
  match_number integer not null default 0 check (match_number >= 0),
  round_number integer not null default 0 check (round_number >= 0),
  target_animal text
    check (target_animal is null or target_animal in ('fox','panda','owl','rabbit','lion','frog')),
  card_order text[] not null
    default array['fox','panda','owl','rabbit','lion','frog']::text[],
  reveal_at timestamptz,
  round_closed_at timestamptz,
  round_winner_id uuid references public.profiles(id) on delete set null,
  winner_user_id uuid references public.profiles(id) on delete set null,
  winning_cards smallint not null default 7 check (winning_cards between 3 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.animal_rush_players (
  room_id uuid not null references public.animal_rush_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  player_name text not null,
  player_icon text,
  safety_cards smallint not null default 2 check (safety_cards between 0 and 2),
  won_cards smallint not null default 0 check (won_cards >= 0),
  rounds_won integer not null default 0 check (rounds_won >= 0),
  wrong_taps integer not null default 0 check (wrong_taps >= 0),
  eliminated boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (room_id,user_id)
);

create table if not exists public.animal_rush_attempts (
  room_id uuid not null references public.animal_rush_rooms(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  user_id uuid not null references public.profiles(id) on delete cascade,
  selected_animal text not null
    check (selected_animal in ('fox','panda','owl','rabbit','lion','frog')),
  correct boolean not null,
  reaction_ms integer not null check (reaction_ms >= 0),
  created_at timestamptz not null default now(),
  primary key (room_id,round_number,user_id)
);

create table if not exists public.animal_rush_match_results (
  id bigint generated always as identity primary key,
  room_id uuid references public.animal_rush_rooms(id) on delete set null,
  match_number integer not null check (match_number > 0),
  user_id uuid not null references public.profiles(id) on delete cascade,
  placement smallint not null check (placement between 1 and 6),
  won boolean not null default false,
  rounds_won integer not null default 0 check (rounds_won >= 0),
  wrong_taps integer not null default 0 check (wrong_taps >= 0),
  cards_held integer not null default 0 check (cards_held >= 0),
  safety_cards integer not null default 0 check (safety_cards >= 0),
  finished_at timestamptz not null default now(),
  unique(room_id,match_number,user_id)
);

create index if not exists animal_rush_players_user_idx
  on public.animal_rush_players(user_id,joined_at desc);
create index if not exists animal_rush_attempts_room_round_idx
  on public.animal_rush_attempts(room_id,round_number,created_at);

alter table public.animal_rush_rooms enable row level security;
alter table public.animal_rush_players enable row level security;
alter table public.animal_rush_attempts enable row level security;
alter table public.animal_rush_match_results enable row level security;

create or replace function public.animal_rush_is_member(target_room_id uuid,target_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1
    from public.animal_rush_players player
    where player.room_id=target_room_id
      and player.user_id=target_user_id
  );
$$;

revoke all on function public.animal_rush_is_member(uuid,uuid) from public;
grant execute on function public.animal_rush_is_member(uuid,uuid) to authenticated;

drop policy if exists "members read animal rush rooms" on public.animal_rush_rooms;
create policy "members read animal rush rooms"
on public.animal_rush_rooms for select
using (public.animal_rush_is_member(id,auth.uid()));

drop policy if exists "members read animal rush players" on public.animal_rush_players;
create policy "members read animal rush players"
on public.animal_rush_players for select
using (public.animal_rush_is_member(room_id,auth.uid()));

drop policy if exists "members read animal rush attempts" on public.animal_rush_attempts;
create policy "members read animal rush attempts"
on public.animal_rush_attempts for select
using (public.animal_rush_is_member(room_id,auth.uid()));

drop policy if exists "animal rush results follow stats privacy" on public.animal_rush_match_results;
create policy "animal rush results follow stats privacy"
on public.animal_rush_match_results for select
using (
  public.can_view_user(user_id)
  and (
    user_id=auth.uid()
    or public.is_admin(auth.uid())
    or coalesce((
      select profile.show_stats_to_others
      from public.profiles profile
      where profile.id=user_id
    ),false)
  )
);

revoke insert,update,delete on public.animal_rush_rooms from authenticated;
revoke insert,update,delete on public.animal_rush_players from authenticated;
revoke insert,update,delete on public.animal_rush_attempts from authenticated;
revoke insert,update,delete on public.animal_rush_match_results from authenticated;
grant select on public.animal_rush_rooms to authenticated;
grant select on public.animal_rush_players to authenticated;
grant select on public.animal_rush_attempts to authenticated;
grant select on public.animal_rush_match_results to authenticated;

create or replace function public.animal_rush_record_results(target_room_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.animal_rush_match_results(
    room_id,match_number,user_id,placement,won,rounds_won,wrong_taps,cards_held,safety_cards,finished_at
  )
  select
    target_room_id,
    room.match_number,
    ranked.user_id,
    ranked.placement,
    ranked.user_id=room.winner_user_id,
    ranked.rounds_won,
    ranked.wrong_taps,
    ranked.won_cards,
    ranked.safety_cards,
    coalesce(room.finished_at,now())
  from public.animal_rush_rooms room
  cross join lateral (
    select
      player.user_id,
      player.rounds_won,
      player.wrong_taps,
      player.won_cards,
      player.safety_cards,
      row_number() over(
        order by
          (player.user_id=room.winner_user_id) desc,
          player.won_cards desc,
          player.safety_cards desc,
          player.rounds_won desc,
          player.joined_at
      )::smallint as placement
    from public.animal_rush_players player
    where player.room_id=room.id
  ) ranked
  where room.id=target_room_id
    and room.status='finished'
  on conflict(room_id,match_number,user_id) do nothing;
$$;

create or replace function public.animal_rush_server_time()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select now();
$$;

create or replace function public.animal_rush_create_room()
returns setof public.animal_rush_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.profiles%rowtype;
  new_room public.animal_rush_rooms%rowtype;
  new_code text;
begin
  select * into current_profile
  from public.profiles
  where id=auth.uid()
    and account_deleted_at is null
    and not coalesce(is_blocked,false)
    and (coalesce(is_admin,false) or coalesce(is_approved,true));

  if not found then
    raise exception 'Your account cannot create a live room.' using errcode='42501';
  end if;

  delete from public.animal_rush_rooms
  where (status='finished' and finished_at < now()-interval '7 days')
     or (status='lobby' and created_at < now()-interval '1 day');

  loop
    new_code:=upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text),1,6));
    exit when not exists(select 1 from public.animal_rush_rooms where code=new_code);
  end loop;

  insert into public.animal_rush_rooms(code,host_user_id)
  values(new_code,auth.uid())
  returning * into new_room;

  insert into public.animal_rush_players(room_id,user_id,player_name,player_icon)
  values(new_room.id,auth.uid(),coalesce(nullif(btrim(current_profile.name),''),'Player'),current_profile.icon);

  return next new_room;
end;
$$;

create or replace function public.animal_rush_join_room(room_code text)
returns setof public.animal_rush_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.profiles%rowtype;
  target_room public.animal_rush_rooms%rowtype;
  player_count integer;
begin
  select * into current_profile
  from public.profiles
  where id=auth.uid()
    and account_deleted_at is null
    and not coalesce(is_blocked,false)
    and (coalesce(is_admin,false) or coalesce(is_approved,true));

  if not found then
    raise exception 'Your account cannot join a live room.' using errcode='42501';
  end if;

  select * into target_room
  from public.animal_rush_rooms
  where code=upper(btrim(room_code))
  for update;

  if not found then
    raise exception 'Room not found. Check the six-character code.' using errcode='22023';
  end if;
  if target_room.status<>'lobby' then
    if exists(
      select 1
      from public.animal_rush_players
      where room_id=target_room.id
        and user_id=auth.uid()
        and left_at is null
    ) then
      return next target_room;
      return;
    end if;
    raise exception 'That match has already started.' using errcode='22023';
  end if;

  select count(*) into player_count
  from public.animal_rush_players
  where room_id=target_room.id and left_at is null;

  if player_count>=6 and not exists(
    select 1 from public.animal_rush_players
    where room_id=target_room.id and user_id=auth.uid()
  ) then
    raise exception 'That room is full.' using errcode='22023';
  end if;

  insert into public.animal_rush_players(
    room_id,user_id,player_name,player_icon,safety_cards,won_cards,rounds_won,wrong_taps,eliminated,left_at
  )
  values(
    target_room.id,auth.uid(),coalesce(nullif(btrim(current_profile.name),''),'Player'),
    current_profile.icon,2,0,0,0,false,null
  )
  on conflict(room_id,user_id) do update set
    player_name=excluded.player_name,
    player_icon=excluded.player_icon,
    safety_cards=2,
    won_cards=0,
    rounds_won=0,
    wrong_taps=0,
    eliminated=false,
    left_at=null;

  return next target_room;
end;
$$;

create or replace function public.animal_rush_start_room(target_room_id uuid)
returns setof public.animal_rush_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.animal_rush_rooms%rowtype;
  player_count integer;
  animals constant text[]:=array['fox','panda','owl','rabbit','lion','frog']::text[];
  next_order text[];
begin
  select * into target_room
  from public.animal_rush_rooms
  where id=target_room_id
  for update;

  if not found then raise exception 'Room not found.' using errcode='22023'; end if;
  if target_room.host_user_id<>auth.uid() then raise exception 'Only the room creator can start.' using errcode='42501'; end if;
  if target_room.status<>'lobby' then raise exception 'The match has already started.' using errcode='22023'; end if;

  select count(*) into player_count
  from public.animal_rush_players
  where room_id=target_room_id and left_at is null;
  if player_count<2 then raise exception 'At least two players are required.' using errcode='22023'; end if;

  select array_agg(animal order by random()) into next_order from unnest(animals) animal;
  update public.animal_rush_rooms set
    status='countdown',
    match_number=match_number+1,
    round_number=1,
    target_animal=animals[1+floor(random()*array_length(animals,1))::integer],
    card_order=next_order,
    reveal_at=clock_timestamp()+interval '3 seconds',
    round_closed_at=null,
    round_winner_id=null,
    winner_user_id=null,
    finished_at=null,
    updated_at=now()
  where id=target_room_id
  returning * into target_room;

  return next target_room;
end;
$$;

create or replace function public.animal_rush_submit_attempt(
  target_room_id uuid,
  selected_animal text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.animal_rush_rooms%rowtype;
  current_player public.animal_rush_players%rowtype;
  remaining_player public.animal_rush_players%rowtype;
  is_correct boolean;
  reaction integer;
  penalty text:='none';
  active_count integer;
  waiting_count integer;
begin
  if selected_animal<>all(array['fox','panda','owl','rabbit','lion','frog']::text[]) then
    raise exception 'Unknown animal.' using errcode='22023';
  end if;

  select * into target_room
  from public.animal_rush_rooms
  where id=target_room_id
  for update;

  if not found then raise exception 'Room not found.' using errcode='22023'; end if;
  if target_room.status<>'countdown' then raise exception 'This round is closed.' using errcode='22023'; end if;
  if clock_timestamp()<target_room.reveal_at then raise exception 'Wait for the animal to appear.' using errcode='22023'; end if;

  select * into current_player
  from public.animal_rush_players
  where room_id=target_room_id and user_id=auth.uid()
  for update;

  if not found or current_player.left_at is not null then raise exception 'You are not in this room.' using errcode='42501'; end if;
  if current_player.eliminated then raise exception 'You have been eliminated.' using errcode='22023'; end if;
  if exists(
    select 1 from public.animal_rush_attempts
    where room_id=target_room_id
      and round_number=target_room.round_number
      and user_id=auth.uid()
  ) then
    raise exception 'Your first touch has already been counted.' using errcode='23505';
  end if;

  is_correct:=selected_animal=target_room.target_animal;
  reaction:=greatest(0,floor(extract(epoch from (clock_timestamp()-target_room.reveal_at))*1000)::integer);

  insert into public.animal_rush_attempts(room_id,round_number,user_id,selected_animal,correct,reaction_ms)
  values(target_room_id,target_room.round_number,auth.uid(),selected_animal,is_correct,reaction);

  if is_correct then
    update public.animal_rush_players set
      won_cards=won_cards+1,
      rounds_won=rounds_won+1
    where room_id=target_room_id and user_id=auth.uid()
    returning * into current_player;

    if current_player.won_cards>=target_room.winning_cards then
      update public.animal_rush_rooms set
        status='finished',
        round_winner_id=auth.uid(),
        winner_user_id=auth.uid(),
        round_closed_at=clock_timestamp(),
        finished_at=clock_timestamp(),
        updated_at=now()
      where id=target_room_id;
      perform public.animal_rush_record_results(target_room_id);
    else
      update public.animal_rush_rooms set
        status='round_result',
        round_winner_id=auth.uid(),
        round_closed_at=clock_timestamp(),
        updated_at=now()
      where id=target_room_id;
    end if;
  else
    if current_player.safety_cards>0 then
      penalty:='safety';
      update public.animal_rush_players set
        safety_cards=safety_cards-1,
        wrong_taps=wrong_taps+1,
        eliminated=(safety_cards-1+won_cards)=0
      where room_id=target_room_id and user_id=auth.uid()
      returning * into current_player;
    elsif current_player.won_cards>0 then
      penalty:='won_card';
      update public.animal_rush_players set
        won_cards=won_cards-1,
        wrong_taps=wrong_taps+1,
        eliminated=(won_cards-1)=0
      where room_id=target_room_id and user_id=auth.uid()
      returning * into current_player;
    else
      penalty:='eliminated';
      update public.animal_rush_players set
        wrong_taps=wrong_taps+1,
        eliminated=true
      where room_id=target_room_id and user_id=auth.uid()
      returning * into current_player;
    end if;

    if current_player.eliminated then penalty:='eliminated'; end if;

    select count(*) into active_count
    from public.animal_rush_players
    where room_id=target_room_id and not eliminated and left_at is null;

    if active_count<=1 then
      select * into remaining_player
      from public.animal_rush_players
      where room_id=target_room_id and not eliminated and left_at is null
      order by won_cards desc,safety_cards desc,rounds_won desc,joined_at
      limit 1;

      update public.animal_rush_rooms set
        status='finished',
        winner_user_id=remaining_player.user_id,
        round_closed_at=clock_timestamp(),
        finished_at=clock_timestamp(),
        updated_at=now()
      where id=target_room_id;
      perform public.animal_rush_record_results(target_room_id);
    else
      select count(*) into waiting_count
      from public.animal_rush_players player
      where player.room_id=target_room_id
        and not player.eliminated
        and player.left_at is null
        and not exists(
          select 1
          from public.animal_rush_attempts attempt
          where attempt.room_id=target_room_id
            and attempt.round_number=target_room.round_number
            and attempt.user_id=player.user_id
        );

      if waiting_count=0 then
        update public.animal_rush_rooms set
          status='round_result',
          round_winner_id=null,
          round_closed_at=clock_timestamp(),
          updated_at=now()
        where id=target_room_id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'correct',is_correct,
    'reaction_ms',reaction,
    'penalty',penalty,
    'eliminated',current_player.eliminated
  );
end;
$$;

create or replace function public.animal_rush_advance_room(target_room_id uuid)
returns setof public.animal_rush_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.animal_rush_rooms%rowtype;
  animals constant text[]:=array['fox','panda','owl','rabbit','lion','frog']::text[];
  next_order text[];
  active_count integer;
  remaining_player public.animal_rush_players%rowtype;
begin
  select * into target_room
  from public.animal_rush_rooms
  where id=target_room_id
  for update;

  if not found then raise exception 'Room not found.' using errcode='22023'; end if;
  if not public.animal_rush_is_member(target_room_id,auth.uid()) then
    raise exception 'You are not in this room.' using errcode='42501';
  end if;
  if target_room.status='countdown' then
    if clock_timestamp()<target_room.reveal_at+interval '8 seconds' then
      return next target_room;
      return;
    end if;
    select array_agg(animal order by random()) into next_order from unnest(animals) animal;
    update public.animal_rush_rooms set
      status='countdown',
      round_number=round_number+1,
      target_animal=animals[1+floor(random()*array_length(animals,1))::integer],
      card_order=next_order,
      reveal_at=clock_timestamp()+interval '3 seconds',
      round_closed_at=null,
      round_winner_id=null,
      updated_at=now()
    where id=target_room_id
    returning * into target_room;
    return next target_room;
    return;
  end if;
  if target_room.status<>'round_result' then
    return next target_room;
    return;
  end if;
  if clock_timestamp()<target_room.round_closed_at+interval '2.2 seconds' then
    return next target_room;
    return;
  end if;

  select count(*) into active_count
  from public.animal_rush_players
  where room_id=target_room_id and not eliminated and left_at is null;

  if active_count<=1 then
    select * into remaining_player
    from public.animal_rush_players
    where room_id=target_room_id and not eliminated and left_at is null
    order by won_cards desc,safety_cards desc,rounds_won desc,joined_at
    limit 1;

    update public.animal_rush_rooms set
      status='finished',
      winner_user_id=remaining_player.user_id,
      finished_at=clock_timestamp(),
      updated_at=now()
    where id=target_room_id
    returning * into target_room;
    perform public.animal_rush_record_results(target_room_id);
    return next target_room;
    return;
  end if;

  select array_agg(animal order by random()) into next_order from unnest(animals) animal;
  update public.animal_rush_rooms set
    status='countdown',
    round_number=round_number+1,
    target_animal=animals[1+floor(random()*array_length(animals,1))::integer],
    card_order=next_order,
    reveal_at=clock_timestamp()+interval '3 seconds',
    round_closed_at=null,
    round_winner_id=null,
    updated_at=now()
  where id=target_room_id
  returning * into target_room;

  return next target_room;
end;
$$;

create or replace function public.animal_rush_leave_room(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.animal_rush_rooms%rowtype;
  active_count integer;
  next_host uuid;
  remaining_player uuid;
begin
  select * into target_room
  from public.animal_rush_rooms
  where id=target_room_id
  for update;
  if not found then return; end if;

  update public.animal_rush_players set
    left_at=clock_timestamp(),
    eliminated=true
  where room_id=target_room_id and user_id=auth.uid();

  if target_room.status='lobby' and target_room.host_user_id=auth.uid() then
    select user_id into next_host
    from public.animal_rush_players
    where room_id=target_room_id and left_at is null
    order by joined_at
    limit 1;
    if next_host is null then
      delete from public.animal_rush_rooms where id=target_room_id;
      return;
    end if;
    update public.animal_rush_rooms set host_user_id=next_host,updated_at=now() where id=target_room_id;
  end if;

  if target_room.status in ('countdown','round_result') then
    select count(*) into active_count
    from public.animal_rush_players
    where room_id=target_room_id and not eliminated and left_at is null;
    if active_count<=1 then
      select user_id into remaining_player
      from public.animal_rush_players
      where room_id=target_room_id and not eliminated and left_at is null
      order by won_cards desc,safety_cards desc,rounds_won desc,joined_at
      limit 1;
      update public.animal_rush_rooms set
        status='finished',
        winner_user_id=remaining_player,
        finished_at=clock_timestamp(),
        updated_at=now()
      where id=target_room_id;
      perform public.animal_rush_record_results(target_room_id);
    end if;
  end if;
end;
$$;

create or replace function public.animal_rush_rematch(target_room_id uuid)
returns setof public.animal_rush_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.animal_rush_rooms%rowtype;
begin
  select * into target_room
  from public.animal_rush_rooms
  where id=target_room_id
  for update;

  if not found then raise exception 'Room not found.' using errcode='22023'; end if;
  if target_room.host_user_id<>auth.uid() then raise exception 'Only the room creator can start a rematch.' using errcode='42501'; end if;
  if target_room.status<>'finished' then raise exception 'This match has not finished.' using errcode='22023'; end if;

  delete from public.animal_rush_players
  where room_id=target_room_id and left_at is not null;
  delete from public.animal_rush_attempts where room_id=target_room_id;
  update public.animal_rush_players set
    safety_cards=2,
    won_cards=0,
    rounds_won=0,
    wrong_taps=0,
    eliminated=false,
    left_at=null
  where room_id=target_room_id;

  update public.animal_rush_rooms set
    status='lobby',
    round_number=0,
    target_animal=null,
    reveal_at=null,
    round_closed_at=null,
    round_winner_id=null,
    winner_user_id=null,
    finished_at=null,
    updated_at=now()
  where id=target_room_id
  returning * into target_room;

  return next target_room;
end;
$$;

revoke all on function public.animal_rush_server_time() from public;
revoke all on function public.animal_rush_record_results(uuid) from public;
revoke all on function public.animal_rush_create_room() from public;
revoke all on function public.animal_rush_join_room(text) from public;
revoke all on function public.animal_rush_start_room(uuid) from public;
revoke all on function public.animal_rush_submit_attempt(uuid,text) from public;
revoke all on function public.animal_rush_advance_room(uuid) from public;
revoke all on function public.animal_rush_leave_room(uuid) from public;
revoke all on function public.animal_rush_rematch(uuid) from public;

grant execute on function public.animal_rush_server_time() to authenticated;
grant execute on function public.animal_rush_create_room() to authenticated;
grant execute on function public.animal_rush_join_room(text) to authenticated;
grant execute on function public.animal_rush_start_room(uuid) to authenticated;
grant execute on function public.animal_rush_submit_attempt(uuid,text) to authenticated;
grant execute on function public.animal_rush_advance_room(uuid) to authenticated;
grant execute on function public.animal_rush_leave_room(uuid) to authenticated;
grant execute on function public.animal_rush_rematch(uuid) to authenticated;

-- Presence can distinguish this live activity from asynchronous game modes.
alter table public.presence drop constraint if exists presence_mode_check;
alter table public.presence
  add constraint presence_mode_check
  check (mode is null or mode in ('challenge','practice','live'));

insert into public.game_config(
  game_id,visible,available,sort_order,hint_cooldown_base,hint_cooldown_per_day
)
values('animalrush',true,true,6,0,0)
on conflict(game_id) do update set available=true;

do $$
begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='animal_rush_rooms'
  ) then
    alter publication supabase_realtime add table public.animal_rush_rooms;
  end if;
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='animal_rush_players'
  ) then
    alter publication supabase_realtime add table public.animal_rush_players;
  end if;
end;
$$;
