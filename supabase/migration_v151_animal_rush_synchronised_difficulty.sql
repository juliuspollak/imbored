-- Animal Rush v151: server-synchronised difficulty modes and player readiness.
--
-- Every phone receives the same future timestamps, target and card orders.
-- The server remains the authority for when cards become tappable.

alter table public.animal_rush_rooms
  add column if not exists difficulty text not null default 'standard',
  add column if not exists preview_card_order text[] not null
    default array['fox','panda','owl','rabbit','lion','frog']::text[],
  add column if not exists roll_at timestamptz,
  add column if not exists shuffle_at timestamptz;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='animal_rush_rooms_difficulty_check'
      and conrelid='public.animal_rush_rooms'::regclass
  ) then
    alter table public.animal_rush_rooms
      add constraint animal_rush_rooms_difficulty_check
      check(difficulty in ('easy','standard','hard'));
  end if;
end;
$$;

alter table public.animal_rush_players
  add column if not exists ready_at timestamptz,
  add column if not exists clock_rtt_ms integer;

create table if not exists public.animal_rush_attempt_history (
  id bigint generated always as identity primary key,
  room_id uuid references public.animal_rush_rooms(id) on delete set null,
  match_number integer not null,
  round_number integer not null,
  difficulty text not null check(difficulty in ('easy','standard','hard')),
  target_animal text not null,
  selected_animal text not null,
  correct boolean not null,
  reaction_ms integer not null,
  created_at timestamptz not null default now()
);

create index if not exists animal_rush_attempt_history_mode_idx
  on public.animal_rush_attempt_history(difficulty,correct,created_at);

alter table public.animal_rush_attempt_history enable row level security;
revoke all on public.animal_rush_attempt_history from anon,authenticated;

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
      room_id,match_number,round_number,difficulty,target_animal,
      selected_animal,correct,reaction_ms,created_at
    )
    values(
      new.room_id,target_room.match_number,new.round_number,target_room.difficulty,
      target_room.target_animal,new.selected_animal,
      new.correct,new.reaction_ms,new.created_at
    );
  end if;
  return new;
end;
$$;

drop trigger if exists animal_rush_archive_attempt_trigger on public.animal_rush_attempts;
create trigger animal_rush_archive_attempt_trigger
after insert on public.animal_rush_attempts
for each row execute function public.animal_rush_archive_attempt();

create or replace function public.animal_rush_set_ready(
  target_room_id uuid,
  measured_rtt_ms integer
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not exists(
    select 1 from public.animal_rush_rooms
    where id=target_room_id and status='lobby'
  ) then
    return;
  end if;

  update public.animal_rush_players
  set ready_at=clock_timestamp(),
      clock_rtt_ms=greatest(0,least(coalesce(measured_rtt_ms,9999),9999))
  where room_id=target_room_id
    and user_id=auth.uid()
    and left_at is null;

  if not found then
    raise exception 'You are not in this room.' using errcode='42501';
  end if;
end;
$$;

create or replace function public.animal_rush_set_not_ready(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.animal_rush_players
  set ready_at=null
  where room_id=target_room_id and user_id=auth.uid();
end;
$$;

create or replace function public.animal_rush_set_difficulty(
  target_room_id uuid,
  selected_difficulty text
)
returns setof public.animal_rush_rooms
language plpgsql
security definer
set search_path=public
as $$
declare
  target_room public.animal_rush_rooms%rowtype;
begin
  if selected_difficulty is null
    or selected_difficulty not in ('easy','standard','hard')
  then
    raise exception 'Unknown difficulty.' using errcode='22023';
  end if;

  select * into target_room
  from public.animal_rush_rooms
  where id=target_room_id
  for update;

  if not found then raise exception 'Room not found.' using errcode='22023'; end if;
  if target_room.host_user_id<>auth.uid() then
    raise exception 'Only the room creator can change difficulty.' using errcode='42501';
  end if;
  if target_room.status<>'lobby' then
    raise exception 'Difficulty cannot change after the match starts.' using errcode='22023';
  end if;

  update public.animal_rush_rooms
  set difficulty=selected_difficulty,updated_at=now()
  where id=target_room_id
  returning * into target_room;

  return next target_room;
end;
$$;

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

  select array_agg(animal order by random()) into preview_order from unnest(animals) animal;
  next_order:=preview_order;
  if target_room.difficulty='hard' then
    loop
      select array_agg(animal order by random()) into next_order from unnest(animals) animal;
      exit when next_order<>preview_order;
    end loop;
  end if;

  next_roll_at:=clock_timestamp()+interval '1500 milliseconds';
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
    target_animal=animals[1+floor(random()*array_length(animals,1))::integer],
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

create or replace function public.animal_rush_rematch(target_room_id uuid)
returns setof public.animal_rush_rooms
language plpgsql
security definer
set search_path=public
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
    left_at=null,
    ready_at=null,
    clock_rtt_ms=null
  where room_id=target_room_id;

  update public.animal_rush_rooms set
    status='lobby',
    round_number=0,
    target_animal=null,
    roll_at=null,
    shuffle_at=null,
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

create or replace function public.animal_rush_difficulty_stats()
returns table(
  difficulty text,
  attempts bigint,
  correct_attempts bigint,
  median_reaction_ms integer,
  average_reaction_ms integer,
  wrong_touch_rate numeric
)
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.' using errcode='42501';
  end if;

  return query
  select
    history.difficulty,
    count(*) as attempts,
    count(*) filter(where history.correct) as correct_attempts,
    coalesce(
      percentile_cont(0.5) within group(order by history.reaction_ms)
        filter(where history.correct),
      0
    )::integer as median_reaction_ms,
    coalesce(avg(history.reaction_ms) filter(where history.correct),0)::integer as average_reaction_ms,
    round(
      count(*) filter(where not history.correct)::numeric/nullif(count(*),0),
      4
    ) as wrong_touch_rate
  from public.animal_rush_attempt_history history
  group by history.difficulty
  order by history.difficulty;
end;
$$;

revoke all on function public.animal_rush_archive_attempt() from public;
revoke all on function public.animal_rush_set_ready(uuid,integer) from public;
revoke all on function public.animal_rush_set_not_ready(uuid) from public;
revoke all on function public.animal_rush_set_difficulty(uuid,text) from public;
revoke all on function public.animal_rush_difficulty_stats() from public;

grant execute on function public.animal_rush_set_ready(uuid,integer) to authenticated;
grant execute on function public.animal_rush_set_not_ready(uuid) to authenticated;
grant execute on function public.animal_rush_set_difficulty(uuid,text) to authenticated;
grant execute on function public.animal_rush_difficulty_stats() to authenticated;
