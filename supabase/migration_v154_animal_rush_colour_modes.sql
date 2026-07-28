-- Animal Rush v154: host-selected, synchronised animal colour modes.
--
-- "uniform" keeps every animal in the same palette so shape recognition
-- decides the round. "individual" restores a distinct colour per animal.

alter table public.animal_rush_rooms
  add column if not exists colour_mode text not null default 'uniform';

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='animal_rush_rooms_colour_mode_check'
      and conrelid='public.animal_rush_rooms'::regclass
  ) then
    alter table public.animal_rush_rooms
      add constraint animal_rush_rooms_colour_mode_check
      check(colour_mode in ('uniform','individual'));
  end if;
end;
$$;

alter table public.animal_rush_attempt_history
  add column if not exists colour_mode text;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='animal_rush_attempt_history_colour_mode_check'
      and conrelid='public.animal_rush_attempt_history'::regclass
  ) then
    alter table public.animal_rush_attempt_history
      add constraint animal_rush_attempt_history_colour_mode_check
      check(colour_mode is null or colour_mode in ('uniform','individual'));
  end if;
end;
$$;

create index if not exists animal_rush_attempt_history_colour_idx
  on public.animal_rush_attempt_history(colour_mode,correct,created_at);

create or replace function public.animal_rush_archive_attempt()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  target_room public.animal_rush_rooms%rowtype;
begin
  select * into target_room
  from public.animal_rush_rooms
  where id=new.room_id;

  if found then
    insert into public.animal_rush_attempt_history(
      room_id,match_number,round_number,difficulty,colour_mode,target_animal,
      selected_animal,correct,reaction_ms,created_at
    )
    values(
      new.room_id,target_room.match_number,new.round_number,target_room.difficulty,
      target_room.colour_mode,target_room.target_animal,new.selected_animal,
      new.correct,new.reaction_ms,new.created_at
    );
  end if;
  return new;
end;
$$;

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
    or selected_colour_mode not in ('uniform','individual')
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

revoke all on function public.animal_rush_archive_attempt() from public;
revoke all on function public.animal_rush_set_colour_mode(uuid,text) from public;
grant execute on function public.animal_rush_set_colour_mode(uuid,text) to authenticated;

notify pgrst,'reload schema';
