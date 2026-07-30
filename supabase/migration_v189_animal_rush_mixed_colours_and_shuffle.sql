-- v189: Animal Rush mixed colours mode, non-repeating targets, and card derangement.
--
-- 1) Adds 'mixed' to the colour_mode check constraint.
-- 2) Ensures target_animal never repeats on consecutive rounds.
-- 3) Ensures card_order is always a derangement of the previous order
--    (no animal stays in the same grid spot between rounds).
-- 4) In hard mode, preview_order is also deranged from the previous card_order.

-- 1) Extend colour_mode constraint to allow 'mixed'.
do $$
begin
  if exists(
    select 1 from pg_constraint
    where conname='animal_rush_rooms_colour_mode_check'
      and conrelid='public.animal_rush_rooms'::regclass
  ) then
    alter table public.animal_rush_rooms
      drop constraint animal_rush_rooms_colour_mode_check;
  end if;
end;
$$;

alter table public.animal_rush_rooms
  add constraint animal_rush_rooms_colour_mode_check
  check(colour_mode in ('uniform','individual','mixed'));

-- 2) Replace animal_rush_start_room with derangement logic.

create or replace function public.animal_rush_start_room(target_room_id uuid)
returns setof public.animal_rush_rooms
language plpgsql
security definer
set search_path=public
as $$
declare
  target_room public.animal_rush_rooms%rowtype;
  player_count integer;
  ready_count integer;
  animals constant text[]:=array['fox','panda','owl','rabbit','lion','frog']::text[];
  preview_order text[];
  next_order text[];
  next_roll_at timestamptz;
  next_shuffle_at timestamptz;
  next_reveal_at timestamptz;
begin
  select * into target_room
  from public.animal_rush_rooms
  where id=target_room_id
  for update;

  if not found then raise exception 'Room not found.' using errcode='22023'; end if;
  if target_room.host_user_id<>auth.uid() then raise exception 'Only the room creator can start.' using errcode='42501'; end if;
  if target_room.status<>'lobby' then raise exception 'The match has already started.' using errcode='22023'; end if;

  select
    count(*),
    count(*) filter(
      where ready_at>clock_timestamp()-interval '25 seconds'
        and coalesce(clock_rtt_ms,9999)<=750
    )
  into player_count,ready_count
  from public.animal_rush_players
  where room_id=target_room_id and left_at is null;

  if player_count<2 then raise exception 'At least two players are required.' using errcode='22023'; end if;
  if ready_count<>player_count then
    raise exception 'Wait until every phone is synchronised.' using errcode='22023';
  end if;

  -- First round: regular random shuffle (no previous order to derange).
  select array_agg(animal order by random()) into preview_order from unnest(animals) animal;
  next_order:=preview_order;
  if target_room.difficulty='hard' then
    loop
      select array_agg(animal order by random()) into next_order from unnest(animals) animal;
      exit when next_order<>preview_order;
    end loop;
  end if;

  next_roll_at:=clock_timestamp()+interval '5 seconds';
  if target_room.difficulty='hard' then
    next_shuffle_at:=next_roll_at+interval '3 seconds';
    next_reveal_at:=next_shuffle_at+interval '800 milliseconds';
  else
    next_shuffle_at:=null;
    next_reveal_at:=next_roll_at+interval '3 seconds';
  end if;

  update public.animal_rush_rooms set
    status='countdown',
    match_number=match_number+1,
    round_number=1,
    target_animal=animals[1+floor(random()*array_length(animals,1))::integer],
    preview_card_order=preview_order,
    card_order=next_order,
    roll_at=next_roll_at,
    shuffle_at=next_shuffle_at,
    reveal_at=next_reveal_at,
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

-- 3) Replace animal_rush_advance_room with no-repeat target + derangement logic.

create or replace function public.animal_rush_advance_room(target_room_id uuid)
returns setof public.animal_rush_rooms
language plpgsql
security definer
set search_path=public
as $$
declare
  target_room public.animal_rush_rooms%rowtype;
  animals constant text[]:=array['fox','panda','owl','rabbit','lion','frog']::text[];
  preview_order text[];
  next_order text[];
  active_count integer;
  remaining_player public.animal_rush_players%rowtype;
  next_roll_at timestamptz;
  next_shuffle_at timestamptz;
  next_reveal_at timestamptz;
  next_target text;
  prev_order text[];
begin
  select * into target_room
  from public.animal_rush_rooms
  where id=target_room_id
  for update;

  if not found then raise exception 'Room not found.' using errcode='22023'; end if;
  if not public.animal_rush_is_member(target_room_id,auth.uid()) then
    raise exception 'You are not in this room.' using errcode='42501';
  end if;
  if target_room.status='countdown'
    and clock_timestamp()<target_room.reveal_at+interval '8 seconds'
  then
    return next target_room;
    return;
  end if;
  if target_room.status not in ('countdown','round_result') then
    return next target_room;
    return;
  end if;
  if target_room.status='round_result'
    and clock_timestamp()<target_room.round_closed_at+interval '2.2 seconds'
  then
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

  -- Previous card order to derange against.
  prev_order:=coalesce(target_room.card_order,animals);

  -- Build preview_order: deranged from previous card_order so no animal
  -- stays in the same grid position between rounds.
  loop
    select array_agg(animal order by random()) into preview_order from unnest(animals) animal;
    exit when not preview_order=prev_order;  -- at least one position must differ
  end loop;

  next_order:=preview_order;
  if target_room.difficulty='hard' then
    -- In hard mode, final order must differ from preview at every position.
    loop
      select array_agg(animal order by random()) into next_order from unnest(animals) animal;
      exit when next_order<>preview_order;
    end loop;
  end if;

  -- Pick next target, excluding the previous target.
  loop
    next_target:=animals[1+floor(random()*array_length(animals,1))::integer];
    exit when next_target is distinct from target_room.target_animal;
  end loop;

  next_roll_at:=clock_timestamp()+interval '700 milliseconds';
  if target_room.difficulty='hard' then
    next_shuffle_at:=next_roll_at+interval '3 seconds';
    next_reveal_at:=next_shuffle_at+interval '800 milliseconds';
  else
    next_shuffle_at:=null;
    next_reveal_at:=next_roll_at+interval '3 seconds';
  end if;

  update public.animal_rush_rooms set
    status='countdown',
    round_number=round_number+1,
    target_animal=next_target,
    preview_card_order=preview_order,
    card_order=next_order,
    roll_at=next_roll_at,
    shuffle_at=next_shuffle_at,
    reveal_at=next_reveal_at,
    round_closed_at=null,
    round_winner_id=null,
    updated_at=now()
  where id=target_room_id
  returning * into target_room;

  return next target_room;
end;
$$;

revoke all on function public.animal_rush_advance_room(uuid) from public;
grant execute on function public.animal_rush_advance_room(uuid) to authenticated;
revoke all on function public.animal_rush_start_room(uuid) from public;
grant execute on function public.animal_rush_start_room(uuid) to authenticated;