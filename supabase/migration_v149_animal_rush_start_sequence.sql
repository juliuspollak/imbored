-- Animal Rush v149: give the first round a separate three-second match intro
-- followed by the existing three-second animal die roll.

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
    reveal_at=clock_timestamp()+interval '6 seconds',
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

revoke all on function public.animal_rush_start_room(uuid) from public;
grant execute on function public.animal_rush_start_room(uuid) to authenticated;
