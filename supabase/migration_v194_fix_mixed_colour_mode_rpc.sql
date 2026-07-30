-- v194: v189 added 'mixed' to the animal_rush_rooms.colour_mode check
-- constraint and to the frontend picker, but animal_rush_set_colour_mode
-- (v154) still only accepted 'uniform'/'individual' and raised "Unknown
-- colour mode." for anything else - so a host could never actually select
-- Mixed for a new room.

create or replace function public.animal_rush_set_colour_mode(
  target_room_id uuid,
  selected_colour_mode text
)
returns setof public.animal_rush_rooms
language plpgsql
security definer
set search_path=public
as $$
declare
  target_room public.animal_rush_rooms%rowtype;
begin
  if selected_colour_mode is null
    or selected_colour_mode not in ('uniform','individual','mixed')
  then
    raise exception 'Unknown colour mode.' using errcode='22023';
  end if;

  select * into target_room
  from public.animal_rush_rooms
  where id=target_room_id
  for update;

  if not found then raise exception 'Room not found.' using errcode='22023'; end if;
  if target_room.host_user_id<>auth.uid() then
    raise exception 'Only the room creator can change animal colours.' using errcode='42501';
  end if;
  if target_room.status<>'lobby' then
    raise exception 'Animal colours cannot change after the match starts.' using errcode='22023';
  end if;

  update public.animal_rush_rooms
  set colour_mode=selected_colour_mode,updated_at=now()
  where id=target_room_id
  returning * into target_room;

  return next target_room;
end;
$$;

revoke all on function public.animal_rush_set_colour_mode(uuid,text) from public;
grant execute on function public.animal_rush_set_colour_mode(uuid,text) to authenticated;

notify pgrst,'reload schema';
