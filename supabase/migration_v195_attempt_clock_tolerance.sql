-- v195: animal_rush_submit_attempt rejected any tap where the server's
-- clock_timestamp() was still before reveal_at, with zero tolerance. The
-- client only opens tapping once its own clock-offset estimate (RTT-based,
-- see synchroniseClock) says reveal_at has passed - on a real multi-device
-- connection that estimate is never perfectly exact, so a tap fired right
-- at the client's perceived "open" moment could still arrive at the server
-- a little before its own reveal_at and get rejected. The frontend already
-- showed zero feedback for this error (fixed separately), so every rejected
-- tap looked like nothing happened at all - and since nothing ever reached
-- the "correct" branch, the round would just time out and auto-advance
-- with no winner, repeatedly, exactly matching "no one could ever win a
-- card" on real rooms while Bot Mode (fully client-side, no RPC/clock
-- involved) worked fine.
--
-- Add a small grace window before rejecting as "too early". This does not
-- meaningfully help a genuine early guess (300ms is far below human
-- reaction variance to the actual reveal), it only forgives clock-sync
-- imprecision.

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
  if clock_timestamp()<target_room.reveal_at-interval '300 milliseconds' then
    raise exception 'Wait for the animal to appear.' using errcode='22023';
  end if;

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
        finished_at=clock_timestamp(),
        updated_at=now()
      where id=target_room_id;
      perform public.animal_rush_record_results(target_room_id);
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

revoke all on function public.animal_rush_submit_attempt(uuid,text) from public;
grant execute on function public.animal_rush_submit_attempt(uuid,text) to authenticated;

notify pgrst,'reload schema';
