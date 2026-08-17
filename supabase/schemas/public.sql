--
-- PostgreSQL database dump
--

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: accept_challenge_stake(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_challenge_stake(target_challenge_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare challenge public.circle_weekly_challenges;
begin
  select * into challenge from public.circle_weekly_challenges where id=target_challenge_id;
  if not found then raise exception 'Challenge not found.'; end if;
  -- Prize challenges are accepted through the same record: the acceptance is
  -- per (challenge, player) and carries no stake-specific data.
  if challenge.stake_reward_id is null and coalesce(challenge.reward_type,'')<>'prize' then
    raise exception 'This challenge has nothing to accept.';
  end if;
  if not exists(select 1 from public.circle_members where circle_id=challenge.circle_id and user_id=auth.uid()) then
    raise exception 'You are not a member of this circle.' using errcode='42501';
  end if;
  insert into public.circle_challenge_stake_acceptances(challenge_id,user_id) values(target_challenge_id,auth.uid())
  on conflict do nothing;
end; $$;


--
--
-- Name: admin_adjust_points(uuid, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_adjust_points(target_player_id uuid, amount bigint, reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare p player_progress;
begin
  if not is_admin(auth.uid()) then raise exception 'Admin only'; end if;
  if amount=0 or nullif(trim(reason),'') is null then raise exception 'Amount and reason are required'; end if;
  if amount < -5000 or amount > 5000 then raise exception 'Adjustment must be between -5000 and 5000 points.'; end if;
  perform ensure_player_progress(target_player_id);
  select * into p from player_progress where player_id=target_player_id for update;
  if p.available_points+amount < 0 then raise exception 'Adjustment would make balance negative'; end if;
  update player_progress set available_points=available_points+amount,
    lifetime_points=lifetime_points+greatest(amount,0), current_level=points_level(lifetime_points+greatest(amount,0)),updated_at=now()
    where player_id=target_player_id;
  insert into points_transactions(player_id,points,reason_code,metadata,created_by)
    values(target_player_id,amount,'ADMIN_ADJUSTMENT',jsonb_build_object('reason',reason),auth.uid());
end; $$;


--
--
-- Name: admin_reset_all_stats(text, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

-- Wipes gameplay so a test round can be run again from a clean slate. Clears
-- results, the points ledger, progress, challenge starts and score challenges;
-- leaves accounts, circles, reward items and configuration alone.
--
-- Guards, because this is unrecoverable:
--   * administrators only;
--   * `confirmation` must be exactly 'RESET ALL STATS', so it cannot be fired
--     by a stray RPC call or a mistyped parameter;
--   * pass target_player to reset one account instead of everybody.
--
-- Shared state (time benchmarks, closed challenges) is only reset on a global
-- run — clearing it for one player would change everyone else's scoring.
CREATE FUNCTION public.admin_reset_all_stats(confirmation text, target_player uuid DEFAULT NULL::uuid, reset_benchmarks boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  removed_results integer:=0;
  removed_transactions integer:=0;
  reopened_challenges integer:=0;
  reset_players integer:=0;
  global_reset boolean:=target_player is null;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  if confirmation is distinct from 'RESET ALL STATS' then
    raise exception 'Pass the exact confirmation phrase to reset statistics.'
      using errcode='22023';
  end if;

  -- One reset at a time; concurrent runs would race the progress rebuild.
  perform pg_advisory_xact_lock(hashtextextended('admin-reset-all-stats',0));

  delete from public.points_transactions
  where global_reset or player_id=target_player;
  get diagnostics removed_transactions=row_count;

  delete from public.challenge_reset_point_credits
  where global_reset or player_id=target_player;

  -- score_challenges cascades from game_stats, but recipients of a challenge
  -- someone else created still need clearing when resetting one player.
  delete from public.score_challenge_recipients
  where global_reset or recipient_id=target_player;

  delete from public.circle_challenge_starts
  where global_reset or player_id=target_player;

  -- Stale "X won the challenge" announcements would otherwise survive the
  -- reset. Only system-generated notices are touched; real conversations stay.
  delete from public.direct_messages
  where system_generated=true
    and activity_type in (
      'circle_challenge_winner','team_challenge_winner',
      'team_challenge_completed','score_challenge','score_challenge_result'
    )
    and (global_reset or recipient_id=target_player);

  delete from public.game_stats
  where global_reset or user_id=target_player;
  get diagnostics removed_results=row_count;

  -- Otherwise a player who was mid-attempt at reset time resumes with a clock
  -- that has been running since before the wipe.
  delete from public.challenge_attempt_starts
  where global_reset or player_id=target_player;

  update public.player_progress set
    available_points=0, lifetime_points=0, current_level=1,
    current_streak=0, longest_streak=0, last_completed_date=null,
    streak_protected_through=null,
    challenge_current_streak=0, challenge_longest_streak=0,
    challenge_last_completed_date=null, challenge_penalty_for_date=null,
    updated_at=now()
  where global_reset or player_id=target_player;
  get diagnostics reset_players=row_count;

  if global_reset then
    -- Every award belongs to a challenge, so this clears the lot. Both
    -- statements in this branch carry a real predicate on purpose: Supabase
    -- runs with safe updates on, which rejects an unqualified DELETE or UPDATE
    -- outright, and that aborted the whole reset before it deleted anything.
    delete from public.circle_challenge_reward_awards
    where challenge_id in (select item.id from public.circle_weekly_challenges item);

    update public.circle_weekly_challenges
    set closed_at=null, updated_at=now()
    where closed_at is not null;
    get diagnostics reopened_challenges=row_count;

    if reset_benchmarks then
      -- Test results would otherwise stay baked into the community medians and
      -- keep skewing every score after the reset. Only rows that actually
      -- drifted from provisional need touching.
      update public.game_time_benchmarks set
        observed_median_seconds=null,
        clean_sample_count=0,
        effective_seconds=provisional_seconds,
        updated_at=now()-interval '1 day'
      where observed_median_seconds is not null
        or clean_sample_count<>0
        or effective_seconds is distinct from provisional_seconds;
    end if;
  end if;

  return jsonb_build_object(
    'scope', case when global_reset then 'all players' else 'single player' end,
    'target_player', target_player,
    'results_removed', removed_results,
    'transactions_removed', removed_transactions,
    'players_reset', reset_players,
    'challenges_reopened', reopened_challenges,
    'benchmarks_reset', global_reset and reset_benchmarks
  );
end;
$$;


--
-- Name: admin_reset_daily_challenge(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_reset_daily_challenge(p_game text, p_challenge_date date) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  reset_result jsonb;
begin
  reset_result := public.admin_reset_personal_challenge(
    p_challenge_date,
    p_game
  );
  return coalesce((reset_result->>'results_removed')::integer,0);
end;
$$;


--
-- Name: admin_reset_my_challenge(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_reset_my_challenge() RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.admin_reset_personal_challenge(public.app_today(),null)
$$;


--
-- Name: admin_reset_personal_challenge(date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_reset_personal_challenge(target_challenge_date date, target_game text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  removed_count integer := 0;
  reversed_reward_count integer := 0;
  reversed_points bigint := 0;
  cleared_attempt_count integer := 0;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required' using errcode='42501';
  end if;

  if target_challenge_date is null then
    raise exception 'Challenge date is required' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format(
        'personal-challenge-reset:%s:%s',
        target_challenge_date,
        coalesce(target_game,'*')
      ),
      0
    )
  );

  create temporary table reset_reward_transactions(
    transaction_id bigint primary key,
    player_id uuid not null,
    points bigint not null
  ) on commit drop;

  -- Rewards still attached to the challenge results being reset.
  insert into pg_temp.reset_reward_transactions(
    transaction_id,
    player_id,
    points
  )
  select
    transaction.id,
    transaction.player_id,
    transaction.points
  from public.game_stats result
  join public.points_transactions transaction
    on transaction.game_stat_id=result.id
   and transaction.reason_code='GAME_COMPLETED'
  where result.mode='challenge'
    and result.circle_challenge_id is null
    and result.challenge_date=target_challenge_date
    and (target_game is null or result.game=target_game)
  on conflict(transaction_id) do nothing;

  -- Rewards preserved by an earlier safe reset but not yet reattached.
  insert into pg_temp.reset_reward_transactions(
    transaction_id,
    player_id,
    points
  )
  select
    transaction.id,
    transaction.player_id,
    transaction.points
  from public.challenge_reset_point_credits credit
  join public.points_transactions transaction
    on transaction.id=credit.points_transaction_id
  where credit.challenge_date=target_challenge_date
    and (target_game is null or credit.game=target_game)
  on conflict(transaction_id) do nothing;

  select count(*),coalesce(sum(points),0)
  into reversed_reward_count,reversed_points
  from pg_temp.reset_reward_transactions;

  -- Do not manufacture points if somebody has already transferred or spent
  -- the reward being reversed. The entire RPC remains atomic and reports a
  -- clear error instead.
  if exists(
    select 1
    from (
      select player_id,sum(points)::bigint as points
      from pg_temp.reset_reward_transactions
      group by player_id
    ) removed
    join public.player_progress progress
      on progress.player_id=removed.player_id
    where progress.available_points<removed.points
       or progress.lifetime_points<removed.points
  ) then
    raise exception 'Hard reset unavailable because challenge points have already been spent or transferred.'
      using errcode='P0001';
  end if;

  -- Remove reset-credit links first, then the actual reward ledger entries.
  delete from public.challenge_reset_point_credits credit
  where credit.challenge_date=target_challenge_date
    and (target_game is null or credit.game=target_game);

  delete from public.points_transactions transaction
  using pg_temp.reset_reward_transactions reset_reward
  where transaction.id=reset_reward.transaction_id;

  -- Keep the cached balances consistent with the remaining reward ledger.
  with removed_by_player as (
    select player_id,sum(points)::bigint as points
    from pg_temp.reset_reward_transactions
    group by player_id
  )
  update public.player_progress progress
  set
    available_points=progress.available_points-removed.points,
    lifetime_points=progress.lifetime_points-removed.points,
    current_level=public.points_level(
      progress.lifetime_points-removed.points
    ),
    updated_at=now()
  from removed_by_player removed
  where progress.player_id=removed.player_id;

  delete from public.game_stats result
  where result.mode='challenge'
    and result.circle_challenge_id is null
    and result.challenge_date=target_challenge_date
    and (target_game is null or result.game=target_game);

  get diagnostics removed_count=row_count;

  -- The attempt clock outlives the result it belongs to, so a reset that left
  -- it behind handed the replay a clock that had been running since the first
  -- open — hours, in practice, which floors the round score no matter how fast
  -- the replay actually was. admin_reset_all_stats() has always cleared these;
  -- the narrower reset has to as well or it does not really reset the round.
  delete from public.challenge_attempt_starts
  where split_part(attempt_key,':',1)='personal'
    and split_part(attempt_key,':',3)=target_challenge_date::text
    and (target_game is null or split_part(attempt_key,':',2)=target_game);

  get diagnostics cleared_attempt_count=row_count;

  return jsonb_build_object(
    'challenge_date',target_challenge_date,
    'results_removed',removed_count,
    'rewards_reversed',reversed_reward_count,
    'points_reversed',reversed_points,
    'attempt_clocks_cleared',cleared_attempt_count
  );
end;
$$;


--
-- Name: admin_set_user_block(uuid, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_user_block(target_user_id uuid, blocked boolean, reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admin only.' using errcode='42501'; end if;
  if target_user_id=auth.uid() then raise exception 'You cannot block your own account.' using errcode='22023'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and is_admin=true) then raise exception 'Another admin cannot be blocked here.' using errcode='42501'; end if;
  update public.profiles set
    is_blocked=blocked,
    blocked_at=case when blocked then now() else null end,
    blocked_by=case when blocked then auth.uid() else null end,
    blocked_reason=case when blocked then nullif(btrim(reason),'') else null end
  where id=target_user_id and account_deleted_at is null;
end;
$$;


--
-- Name: am_i_a_circle_organiser(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.am_i_a_circle_organiser() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists(
    select 1
    from public.circles c
    where public.is_circle_organiser(c.id)
  );
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: animal_rush_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.animal_rush_rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    host_user_id uuid NOT NULL,
    status text DEFAULT 'lobby'::text NOT NULL,
    match_number integer DEFAULT 0 NOT NULL,
    round_number integer DEFAULT 0 NOT NULL,
    target_animal text,
    card_order text[] DEFAULT ARRAY['fox'::text, 'panda'::text, 'owl'::text, 'rabbit'::text, 'lion'::text, 'frog'::text] NOT NULL,
    reveal_at timestamp with time zone,
    round_closed_at timestamp with time zone,
    round_winner_id uuid,
    winner_user_id uuid,
    winning_cards smallint DEFAULT 7 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    difficulty text DEFAULT 'standard'::text NOT NULL,
    preview_card_order text[] DEFAULT ARRAY['fox'::text, 'panda'::text, 'owl'::text, 'rabbit'::text, 'lion'::text, 'frog'::text] NOT NULL,
    roll_at timestamp with time zone,
    shuffle_at timestamp with time zone,
    colour_mode text DEFAULT 'uniform'::text NOT NULL,
    CONSTRAINT animal_rush_rooms_code_check CHECK ((code ~ '^[A-F0-9]{6}$'::text)),
    CONSTRAINT animal_rush_rooms_colour_mode_check CHECK ((colour_mode = ANY (ARRAY['uniform'::text, 'individual'::text, 'mixed'::text]))),
    CONSTRAINT animal_rush_rooms_difficulty_check CHECK ((difficulty = ANY (ARRAY['easy'::text, 'standard'::text, 'hard'::text]))),
    CONSTRAINT animal_rush_rooms_match_number_check CHECK ((match_number >= 0)),
    CONSTRAINT animal_rush_rooms_round_number_check CHECK ((round_number >= 0)),
    CONSTRAINT animal_rush_rooms_status_check CHECK ((status = ANY (ARRAY['lobby'::text, 'countdown'::text, 'round_result'::text, 'finished'::text]))),
    CONSTRAINT animal_rush_rooms_target_animal_check CHECK (((target_animal IS NULL) OR (target_animal = ANY (ARRAY['fox'::text, 'panda'::text, 'owl'::text, 'rabbit'::text, 'lion'::text, 'frog'::text])))),
    CONSTRAINT animal_rush_rooms_winning_cards_check CHECK (((winning_cards >= 3) AND (winning_cards <= 20)))
);


--
-- Name: animal_rush_advance_room(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.animal_rush_advance_room(target_room_id uuid) RETURNS SETOF public.animal_rush_rooms
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: animal_rush_archive_attempt(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.animal_rush_archive_attempt() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: animal_rush_create_room(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.animal_rush_create_room() RETURNS SETOF public.animal_rush_rooms
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
--
-- Name: animal_rush_is_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.animal_rush_is_member(target_room_id uuid, target_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists(
    select 1
    from public.animal_rush_players player
    where player.room_id=target_room_id
      and player.user_id=target_user_id
  );
$$;


--
-- Name: animal_rush_join_room(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.animal_rush_join_room(room_code text) RETURNS SETOF public.animal_rush_rooms
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: animal_rush_leave_room(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.animal_rush_leave_room(target_room_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: animal_rush_record_results(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.animal_rush_record_results(target_room_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: animal_rush_rematch(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.animal_rush_rematch(target_room_id uuid) RETURNS SETOF public.animal_rush_rooms
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: animal_rush_server_time(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.animal_rush_server_time() RETURNS timestamp with time zone
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select now();
$$;


--
-- Name: animal_rush_set_colour_mode(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.animal_rush_set_colour_mode(target_room_id uuid, selected_colour_mode text) RETURNS SETOF public.animal_rush_rooms
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: animal_rush_set_difficulty(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.animal_rush_set_difficulty(target_room_id uuid, selected_difficulty text) RETURNS SETOF public.animal_rush_rooms
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: animal_rush_set_not_ready(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.animal_rush_set_not_ready(target_room_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.animal_rush_players
  set ready_at=null
  where room_id=target_room_id and user_id=auth.uid();
end;
$$;


--
-- Name: animal_rush_set_ready(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.animal_rush_set_ready(target_room_id uuid, measured_rtt_ms integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: animal_rush_start_room(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.animal_rush_start_room(target_room_id uuid) RETURNS SETOF public.animal_rush_rooms
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: animal_rush_submit_attempt(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.animal_rush_submit_attempt(target_room_id uuid, selected_animal text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: app_today(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_today() RETURNS date
    LANGUAGE sql STABLE
    AS $$
  select (timezone('Australia/Sydney', now()))::date
$$;


--
-- Name: resolve_timezone(text); Type: FUNCTION; Schema: public; Owner: -
--

-- Falls back to the original app timezone for anything absent or unusable, so
-- a bad IANA name from a client can never break a date calculation. A CHECK
-- constraint cannot do this: CHECK forbids the subquery a catalog lookup needs.
CREATE FUNCTION public.resolve_timezone(candidate text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
begin
  if candidate is null or btrim(candidate)='' then
    return 'Australia/Sydney';
  end if;
  -- Fixed instant, not now(), so this stays genuinely IMMUTABLE. It only has
  -- to prove the zone name resolves at all.
  perform timezone(candidate, '2000-01-01 00:00:00+00'::timestamptz);
  return candidate;
exception when others then
  return 'Australia/Sydney';
end;
$$;


--
-- Name: player_today(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.player_today(uid uuid) RETURNS date
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select (timezone(
    public.resolve_timezone((select p.timezone from public.profiles p where p.id=uid)),
    now()
  ))::date
$$;


--
-- Name: circle_today(bigint); Type: FUNCTION; Schema: public; Owner: -
--

-- A circle challenge is one shared competition, so its rounds key off a single
-- timezone -- the circle's -- rather than each member's. Members elsewhere all
-- play the same round on the same shared day.
CREATE FUNCTION public.circle_today(target_circle_id bigint) RETURNS date
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select (timezone(
    public.resolve_timezone((select c.timezone from public.circles c where c.id=target_circle_id)),
    now()
  ))::date
$$;


--
-- Name: circle_week_start(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.circle_week_start(target_circle_id bigint) RETURNS date
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select (
    public.circle_today(target_circle_id)
    - (extract(isodow from public.circle_today(target_circle_id))::integer - 1)
  )::date
$$;


--
-- Name: set_my_timezone(text); Type: FUNCTION; Schema: public; Owner: -
--

-- Kept separate from save_my_profile so the client can refresh this silently on
-- load without changing that function's signature.
CREATE FUNCTION public.set_my_timezone(candidate text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.profiles
  set timezone=public.resolve_timezone(candidate)
  where id=auth.uid()
$$;


--
-- Name: players_share_circle(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.players_share_circle(first_player uuid, second_player uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists(
    select 1
    from public.circle_members mine
    join public.circle_members theirs on theirs.circle_id=mine.circle_id
    where mine.user_id=first_player
      and theirs.user_id=second_player
  )
$$;


--
-- Name: get_messageable_players(); Type: FUNCTION; Schema: public; Owner: -
--

-- Everyone the signed-in player can see in Chats, and whether they may start a
-- new conversation with them.
--
-- can_message mirrors the rule send_direct_message enforces, so the "start a
-- chat" list can never offer someone the send would then refuse: people you
-- share a circle with, plus admins so support stays reachable.
--
-- People you already have message history with are returned too, with
-- can_message false. Scoping the list to circle-mates alone silently hid those
-- conversations while the unread badge still counted them, so the badge lit up
-- with nothing to open — and the history itself disappeared.
--
-- Blocked players in either direction are omitted from both sets.
CREATE FUNCTION public.get_messageable_players() RETURNS TABLE(id uuid, name text, icon text, mood text, is_admin boolean, can_message boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with candidate as (
    select
      profile.id,
      profile.name::text as name,
      profile.icon::text as icon,
      profile.mood::text as mood,
      profile.is_admin,
      -- Discovery: who Find people may offer, and who send_direct_message will
      -- accept. is_private, is_blocked and is_approved belong here, not in the
      -- where clause — filtering them there also removed conversations the
      -- player already had, stranding unread badges with nothing to open.
      (
        (
          profile.is_admin=true
          or public.players_share_circle(auth.uid(),profile.id)
        )
        and coalesce(profile.is_blocked,false)=false
        and (profile.is_admin=true or coalesce(profile.is_approved,false)=true)
        and (
          coalesce(profile.is_private,false)=false
          or public.is_admin(auth.uid())
        )
      ) as can_message,
      exists(
        select 1
        from public.direct_messages message
        where (message.sender_id=auth.uid() and message.recipient_id=profile.id)
           or (message.sender_id=profile.id and message.recipient_id=auth.uid())
      ) as has_history
    from public.profiles profile
    where profile.id<>auth.uid()
      -- Continuity: the same rule the unread badge counts by.
      and public.can_continue_conversation(auth.uid(),profile.id)
  )
  select candidate.id,candidate.name,candidate.icon,candidate.mood,
         candidate.is_admin,candidate.can_message
  from candidate
  where candidate.can_message or candidate.has_history
  order by candidate.name
$$;


--
-- Name: get_unread_message_counts(); Type: FUNCTION; Schema: public; Owner: -
--

-- Backs the chat badge. Deliberately SECURITY INVOKER so the direct_messages
-- select policy still applies — the readable set is exactly what the client
-- could query itself, narrowed to conversations Chats can actually open.
CREATE FUNCTION public.get_unread_message_counts() RETURNS TABLE(peer_id uuid, unread_count integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select message.sender_id, count(*)::integer
  from public.direct_messages message
  where message.recipient_id=auth.uid()
    and message.read_at is null
    and public.can_continue_conversation(auth.uid(),message.sender_id)
  group by message.sender_id
$$;


--
-- Name: is_blocked_between(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

-- Blocking is symmetric in effect: once either side blocks, neither can reach
-- the other. Otherwise blocking someone would still leave you reading them.
CREATE FUNCTION public.is_blocked_between(first_player uuid, second_player uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists(
    select 1 from public.player_blocks
    where (blocker_id=first_player and blocked_id=second_player)
       or (blocker_id=second_player and blocked_id=first_player)
  )
$$;


--
-- Name: block_player(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.block_player(target_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode='42501';
  end if;
  if target_user_id is null or target_user_id=auth.uid() then
    raise exception 'Choose another player to block.' using errcode='22023';
  end if;
  insert into public.player_blocks(blocker_id,blocked_id)
  values(auth.uid(),target_user_id)
  on conflict do nothing;
end;
$$;


--
-- Name: unblock_player(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unblock_player(target_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  delete from public.player_blocks
  where blocker_id=auth.uid() and blocked_id=target_user_id;
end;
$$;


--
-- Name: get_my_blocked_players(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_blocked_players() RETURNS TABLE(user_id uuid, name text, icon text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select block.blocked_id, profile.name::text, profile.icon::text, block.created_at
  from public.player_blocks block
  join public.profiles profile on profile.id=block.blocked_id
  where block.blocker_id=auth.uid()
  order by profile.name
$$;


--
-- Name: report_content(uuid, bigint, text, text); Type: FUNCTION; Schema: public; Owner: -
--

-- Filing a report also blocks the reported player: guideline 1.2 expects the
-- reporter to be able to remove themselves from the situation immediately,
-- rather than waiting for a human to act.
CREATE FUNCTION public.report_content(target_user_id uuid, target_message_id bigint, report_reason text, report_details text DEFAULT NULL::text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  me uuid:=auth.uid();
  subject uuid:=target_user_id;
  created_id bigint;
begin
  if me is null then
    raise exception 'You must be signed in.' using errcode='42501';
  end if;
  if target_user_id is null and target_message_id is null then
    raise exception 'Tell us what you are reporting.' using errcode='22023';
  end if;

  if target_message_id is not null then
    select message.sender_id into subject
    from public.direct_messages message
    where message.id=target_message_id
      and (message.sender_id=me or message.recipient_id=me);
    if not found then
      raise exception 'That message could not be found.' using errcode='42501';
    end if;
  end if;

  if subject=me then
    raise exception 'You cannot report your own content.' using errcode='22023';
  end if;

  insert into public.content_reports(reporter_id,reported_user_id,message_id,reason,details)
  values(
    me,
    subject,
    target_message_id,
    coalesce(nullif(btrim(report_reason),''),'other'),
    nullif(btrim(report_details),'')
  )
  returning id into created_id;

  if subject is not null then
    insert into public.player_blocks(blocker_id,blocked_id)
    values(me,subject)
    on conflict do nothing;
  end if;

  return created_id;
end;
$$;


--
-- Name: admin_list_content_reports(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_content_reports() RETURNS TABLE(id bigint, reason text, details text, status text, created_at timestamp with time zone, reporter_name text, reported_name text, reported_user_id uuid, message_body text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    report.id, report.reason, report.details, report.status, report.created_at,
    reporter.name::text, reported.name::text, report.reported_user_id,
    message.body::text
  from public.content_reports report
  left join public.profiles reporter on reporter.id=report.reporter_id
  left join public.profiles reported on reported.id=report.reported_user_id
  left join public.direct_messages message on message.id=report.message_id
  where public.is_admin(auth.uid())
  order by (report.status='open') desc, report.created_at desc
$$;


--
-- Name: admin_resolve_content_report(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_resolve_content_report(target_report_id bigint, new_status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin only.' using errcode='42501';
  end if;
  if new_status not in ('open','actioned','dismissed') then
    raise exception 'Unknown report status.' using errcode='22023';
  end if;
  update public.content_reports
  set status=new_status, reviewed_by=auth.uid(), reviewed_at=now()
  where id=target_report_id;
end;
$$;


--
-- Name: apply_challenge_streak_break(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_challenge_streak_break(target_player_id uuid, missed_date date) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  p public.player_progress;
begin
  perform public.ensure_player_progress(target_player_id);

  select * into p
  from public.player_progress
  where player_id=target_player_id
  for update;

  if p.challenge_current_streak<=0
    or p.challenge_penalty_for_date is not distinct from missed_date then
    return 0;
  end if;

  if p.streak_protected_through is not null
    and p.streak_protected_through>=missed_date then
    -- Paid to protect this exact missed day: bridge the gap so the streak
    -- continues normally on the next challenge play, without penalising or
    -- resetting it.
    update public.player_progress
    set challenge_last_completed_date=missed_date,
        challenge_penalty_for_date=missed_date,
        updated_at=now()
    where player_id=target_player_id;
    return 0;
  end if;

  -- The streak resets, and that is the whole consequence. Taking back points
  -- the player had already earned charged them twice for one absence.
  update public.player_progress
  set
    challenge_current_streak=0,
    challenge_penalty_for_date=missed_date,
    updated_at=now()
  where player_id=target_player_id;

  return 0;
end;
$$;


--
-- Name: approve_invited_player(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_invited_player(target_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be active and approved.' using errcode='42501';
  end if;

  if not exists(
    select 1
    from public.app_email_invitations i
    join auth.users u
      on u.id=target_user_id
     and lower(u.email)=lower(i.invitee_email)
    join public.profiles p
      on p.id=target_user_id
    where i.inviter_id=auth.uid()
      and coalesce(p.is_admin,false)=false
      and coalesce(p.is_blocked,false)=false
      and p.account_deleted_at is null
  ) then
    raise exception 'You can approve only players you invited by email.' using errcode='42501';
  end if;

  update public.profiles
  set is_approved=true,
      approved_at=now(),
      approved_by=auth.uid()
  where id=target_user_id
    and coalesce(is_admin,false)=false
    and coalesce(is_blocked,false)=false
    and account_deleted_at is null;
end;
$$;


--
-- Name: attach_reset_challenge_credit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.attach_reset_challenge_credit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  credit_id bigint;
  transaction_id bigint;
begin
  if new.mode is distinct from 'challenge'
     or new.circle_challenge_id is not null
     or new.challenge_date is null then
    return new;
  end if;

  select credit.id,credit.points_transaction_id
  into credit_id,transaction_id
  from public.challenge_reset_point_credits credit
  where credit.player_id=new.user_id
    and credit.game=new.game
    and credit.challenge_date=new.challenge_date
  order by credit.id
  limit 1
  for update;

  if credit_id is null then
    return new;
  end if;

  update public.points_transactions points_entry
  set game_stat_id=new.id
  where points_entry.id=transaction_id
    and points_entry.game_stat_id is null;

  if found then
    delete from public.challenge_reset_point_credits
    where id=credit_id;
  end if;

  return new;
end;
$$;


--
-- Name: award_completed_circle_challenge(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.award_completed_circle_challenge() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.mode='challenge' and new.circle_challenge_id is not null then
    perform public.finalize_circle_challenge(new.circle_challenge_id);
  end if;
  return new;
end;
$$;


--
-- Name: award_game_points(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.award_game_points(target_stat_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  s public.game_stats;
  p public.player_progress;
  r public.reward_rules;
  benchmark public.game_time_benchmarks;
  benchmark_seconds numeric;
  scored_seconds numeric;
  performance_adjustment integer:=0;
  answer_correct integer;
  answer_total integer;
  answer_share numeric:=1;
  effective_base_points integer;
  day_number integer;
  day_bonus integer:=0;
  mode_percent integer:=100;
  unscaled_game_points integer;
  scaled_game_points integer;
  mode_adjustment integer:=0;
  mode_minimum integer;
  mode_maximum integer;
  game_points integer;
  limit_adjustment integer:=0;
  streak_points integer:=0;
  points_total integer;
  old_level integer;
  new_level integer;
  player_zone text;
  award_date date;
  effective_challenge_date date;
  practice_count integer:=0;
  challenge_games_on_date integer:=0;
  practice_limit_reached boolean:=false;
  breakdown jsonb;
begin
  select * into s from public.game_stats where id=target_stat_id;
  if not found or s.user_id<>auth.uid() then
    raise exception 'Game result not found';
  end if;

  -- The rewarded-Practice allowance resets at the player's own midnight, not
  -- Sydney's. Resolved once here and reused for every day comparison below.
  player_zone:=public.resolve_timezone(
    (select profile.timezone from public.profiles profile where profile.id=s.user_id)
  );
  award_date:=(timezone(player_zone,now()))::date;

  select * into r from public.reward_rules
  where is_active=true order by id desc limit 1;
  if not found then raise exception 'No active reward rules'; end if;

  perform public.ensure_player_progress(s.user_id);
  select * into p from public.player_progress
  where player_id=s.user_id for update;

  if exists(
    select 1 from public.points_transactions
    where game_stat_id=s.id and reason_code='GAME_COMPLETED'
  ) then
    return jsonb_build_object(
      'already_awarded',true,'points_awarded',0,
      'balance',p.available_points,'streak',p.challenge_current_streak,
      'level',p.current_level
    );
  end if;

  if s.mode='practice' then
    select count(*) into practice_count
    from public.points_transactions pt
    join public.game_stats gs on gs.id=pt.game_stat_id
    where pt.player_id=s.user_id
      and pt.reason_code='GAME_COMPLETED'
      and gs.mode='practice'
      and gs.game=s.game
      and (pt.created_at at time zone player_zone)::date=award_date;
    practice_limit_reached:=practice_count>=r.practice_daily_limit;
  end if;

  benchmark:=public.refresh_game_time_benchmark(s.game,s.day_index,s.mode);
  benchmark_seconds:=coalesce(nullif(benchmark.effective_seconds,0),100);
  scored_seconds:=public.scored_game_seconds(
    s.seconds,s.hints,s.mistakes,benchmark_seconds
  );

  -- Any game that reports how many answers it asked for is paid on accuracy,
  -- not just Zoom: a wrong answer costs base points, and an imperfect round
  -- earns no speed bonus, so racing through a quiz getting it wrong cannot
  -- out-earn working through it. Games that report no answer count (the
  -- solve-the-board puzzles) are unaffected and keep scoring on time alone.
  answer_total:=nullif(greatest(coalesce(s.total_count,0),0),0);
  if answer_total is null then
    effective_base_points:=r.base_points;
  else
    answer_correct:=least(answer_total,greatest(coalesce(s.correct_count,answer_total-s.mistakes),0));
    answer_share:=answer_correct::numeric/answer_total;
    effective_base_points:=round(r.base_points*answer_share);
  end if;

  day_number:=greatest(0,least(coalesce(s.day_index,0),6));
  day_bonus:=(array[0,0,1,1,1,2,2])[day_number+1];
  if answer_total is null or answer_correct=answer_total then
    performance_adjustment:=greatest(-4,least(4,round(
      10*(1-scored_seconds/benchmark_seconds)
    )::integer));
  end if;

  unscaled_game_points:=effective_base_points+day_bonus+performance_adjustment;
  mode_percent:=case when s.mode='practice' then r.practice_points_percent else 100 end;
  scaled_game_points:=round(unscaled_game_points*mode_percent::numeric/100);
  mode_adjustment:=scaled_game_points-unscaled_game_points;
  -- The guaranteed floor is earned in proportion to how much was answered
  -- correctly. Flat, it clamped a round answered entirely wrong back up to the
  -- same minimum a clean one gets, and — because nothing stops minimum_points
  -- being configured up towards base_points — a raised floor would have
  -- silently swallowed the accuracy scaling above for every quiz result.
  mode_minimum:=round((case when s.mode='practice'
    then ceil(r.minimum_points*mode_percent::numeric/100)
    else r.minimum_points end)*answer_share)::integer;
  mode_maximum:=case when s.mode='practice'
    then floor(r.maximum_points*mode_percent::numeric/100)::integer
    else r.maximum_points end;
  game_points:=greatest(mode_minimum,least(mode_maximum,scaled_game_points));
  game_points:=greatest(0,least(50,game_points));
  limit_adjustment:=game_points-scaled_game_points;
  if practice_limit_reached then game_points:=0; end if;

  effective_challenge_date:=coalesce(
    s.challenge_date,(s.completed_at at time zone player_zone)::date
  );
  if s.mode='challenge'
    and p.challenge_current_streak>0
    and p.challenge_current_streak%7=0 then
    select count(*) into challenge_games_on_date
    from public.game_stats gs
    where gs.user_id=s.user_id and gs.mode='challenge'
      and coalesce(gs.challenge_date,(gs.completed_at at time zone player_zone)::date)
        =effective_challenge_date;
    if challenge_games_on_date=1 then streak_points:=r.streak_weekly_bonus; end if;
  end if;

  -- Bound by what is actually reachable, not a flat 100. A flat ceiling
  -- silently clipped the weekly streak bonus once it grew past ~88, eating the
  -- game award on the very day the bonus was meant to celebrate.
  points_total:=greatest(0,least(50+coalesce(r.streak_weekly_bonus,0),game_points+streak_points));
  breakdown:=jsonb_build_object(
    'base',effective_base_points,
    'configured_base',r.base_points,
    'day_index',day_number,
    'day_bonus',day_bonus,
    'time',performance_adjustment,
    'performance_adjustment',performance_adjustment,
    'scored_seconds',scored_seconds,
    'hint_penalty_seconds',greatest(coalesce(s.hints,0),0)*benchmark_seconds*0.20,
    'mistake_penalty_seconds',greatest(coalesce(s.mistakes,0),0)*benchmark_seconds*0.10,
    'correct_count',answer_correct,
    'total_count',answer_total,
    'answer_share',answer_share,
    'minimum_points',mode_minimum,
    'rounds_nailed',s.rounds_nailed,
    'weekly_streak',streak_points,
    'mode',s.mode,
    'mode_multiplier_percent',mode_percent,
    'mode_adjustment',mode_adjustment,
    'limit_adjustment',limit_adjustment,
    'uncapped_game_points',game_points,
    'daily_game_points',game_points,
    'practice_reward_number',case when s.mode='practice' then practice_count+1 else null end,
    'practice_daily_limit',r.practice_daily_limit,
    'practice_limit_reached',practice_limit_reached,
    'benchmark_seconds',benchmark_seconds,
    'total',points_total
  );

  old_level:=p.current_level;
  new_level:=public.points_level(p.lifetime_points+points_total);
  insert into public.points_transactions(
    player_id,points,reason_code,game_stat_id,metadata,created_by
  ) values(
    s.user_id,points_total,'GAME_COMPLETED',s.id,
    breakdown||jsonb_build_object(
      'benchmark_provisional_seconds',benchmark.provisional_seconds,
      'benchmark_observed_median_seconds',benchmark.observed_median_seconds,
      'benchmark_clean_sample_count',benchmark.clean_sample_count,
      'benchmark_prior_weight',20,'rule_id',r.id,'economy_version','v211'
    ),s.user_id
  );

  update public.player_progress set
    available_points=available_points+points_total,
    lifetime_points=lifetime_points+points_total,
    current_level=new_level,updated_at=now()
  where player_id=s.user_id returning * into p;

  return jsonb_build_object(
    'points_awarded',points_total,'balance',p.available_points,
    'streak',p.challenge_current_streak,'level',p.current_level,
    'level_up',new_level>old_level,'breakdown',breakdown,
    'weekly_streak_bonus',streak_points,
    'practice_limit_reached',practice_limit_reached,
    'daily_points_cap_reached',false,
    'time_benchmark_seconds',benchmark_seconds,
    'time_clean_sample_count',benchmark.clean_sample_count,
    'scored_seconds',scored_seconds
  );
end;
$$;


--
--
-- Name: can_continue_conversation(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

-- The single definition of "this conversation is still reachable", shared by
-- get_messageable_players (which conversations Chats can list) and
-- get_unread_message_counts (which unread rows the badge may count). Keeping
-- one rule is what guarantees the badge can never outnumber the conversations
-- available to clear it.
--
-- Deliberately narrower than discovery: is_private, is_blocked and is_approved
-- decide who you may *start* a chat with, not whose existing conversation you
-- may reopen. profileVisibility.js draws the same line on the client — a
-- private profile stays community-visible, it just cannot be found.
CREATE FUNCTION public.can_continue_conversation(viewer_id uuid, peer_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select viewer_id is not null
    and peer_id is not null
    and (
      -- Challenge results are a self-conversation and always reachable.
      peer_id=viewer_id
      or (
        exists(
          select 1
          from public.profiles peer
          where peer.id=peer_id
            and peer.account_deleted_at is null
            and coalesce(peer.hidden_from_others,false)=false
        )
        -- Mirrors the direct_messages select policy: rows either side of a
        -- player block are unreadable, so they must not be counted either.
        and not public.is_blocked_between(viewer_id,peer_id)
      )
    );
$$;


--
-- Name: begin_challenge_attempt(text, date, bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.begin_challenge_attempt(
  target_game text,
  target_challenge_date date default null,
  target_circle_challenge_id bigint default null,
  target_score_challenge_id bigint default null
) returns timestamp with time zone
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  key text;
  existing timestamp with time zone;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if coalesce(btrim(target_game),'')='' then
    raise exception 'A game is required to start an attempt.' using errcode='22023';
  end if;

  key := case
    when target_score_challenge_id is not null
      then format('score:%s', target_score_challenge_id)
    when target_circle_challenge_id is not null
      then format('circle:%s:%s:%s', target_circle_challenge_id, target_game, target_challenge_date)
    else format('personal:%s:%s', target_game, target_challenge_date)
  end;

  insert into public.challenge_attempt_starts(player_id, attempt_key)
  values (auth.uid(), key)
  on conflict (player_id, attempt_key) do nothing;

  select item.started_at into existing
  from public.challenge_attempt_starts item
  where item.player_id=auth.uid() and item.attempt_key=key;

  return existing;
end;
$$;


--
-- Name: can_view_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_user(target_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    target_user_id is null
    or target_user_id=auth.uid()
    or coalesce((
      select
        coalesce(profile.hidden_from_others,false)=false
        and profile.account_deleted_at is null
      from public.profiles profile
      where profile.id=target_user_id
    ),false);
$$;


--
-- Name: circle_challenge_daily_score(text, date, integer, integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.challenge_benchmark_seconds(target_game text, target_challenge_date date) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((
    select nullif(benchmark.effective_seconds,0)
    from public.game_time_benchmarks benchmark
    where benchmark.game=target_game
      and benchmark.mode='challenge'
      and benchmark.day_index=extract(isodow from target_challenge_date)::integer-1
    order by benchmark.updated_at desc nulls last
    limit 1
  ),100)::numeric
$$;

--
-- Name: effective_round_seconds; Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.effective_round_seconds(
  elapsed_seconds integer,
  hint_count integer,
  mistake_count integer,
  benchmark_seconds numeric,
  correct_answers integer default null,
  total_answers integer default null
) returns numeric
    language sql immutable
    as $$
  with share as (
    select case
      when coalesce(total_answers,0) <= 0 then 1::numeric
      else least(1,greatest(0,coalesce(correct_answers,0))::numeric/total_answers)
    end as accuracy
  )
  select case when share.accuracy <= 0 then null else
    greatest(1,
      greatest(0,coalesce(elapsed_seconds,0))
      + greatest(0,coalesce(hint_count,0))*coalesce(benchmark_seconds,100)*0.20
      -- An ungraded puzzle has no accuracy to divide by, so its slips are
      -- charged as time. A graded round is not charged here as well: its
      -- mistakes ARE the wrong answers already priced into the divisor.
      + case when coalesce(total_answers,0) > 0 then 0
             else greatest(0,coalesce(mistake_count,0))*coalesce(benchmark_seconds,100)*0.10 end
    ) / (share.accuracy * share.accuracy)
  end
  from share
$$;

--
-- Name: challenge_benchmark_profile; Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.challenge_benchmark_profile(
  target_game text,
  target_challenge_date date
) returns table(seconds numeric, log_mean numeric, log_sd numeric)
    language sql stable security definer
    set search_path to 'public'
    as $$
  select
    coalesce(nullif(benchmark.effective_seconds,0),100)::numeric,
    benchmark.log_mean,
    benchmark.log_sd
  from public.game_time_benchmarks benchmark
  where benchmark.game=target_game
    and benchmark.mode='challenge'
    and benchmark.day_index=extract(isodow from target_challenge_date)::integer-1
  order by benchmark.updated_at desc nulls last
  limit 1
$$;


--
-- Name: circle_challenge_daily_score(text, date, integer, integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

-- Scaled by the share of answers that were correct. On speed alone, failing a
-- quiz was the winning strategy: a wrong answer ends the round early, and the
-- 150 cap made a fast wipeout indistinguishable from a fast perfect run.
-- Games that record no per-answer breakdown score on time only, as before.
CREATE FUNCTION public.circle_challenge_daily_score(
  target_game text,
  target_challenge_date date,
  elapsed_seconds integer,
  hint_count integer,
  mistake_count integer,
  correct_answers integer default null,
  total_answers integer default null
) returns integer
    language sql stable security definer
    set search_path to 'public'
    as $$
  with profile as (
    select seconds,log_mean,log_sd
    from public.challenge_benchmark_profile(target_game,target_challenge_date)
    union all
    select 100::numeric,null::numeric,null::numeric
    limit 1
  ),
  effective as (
    select
      profile.seconds,
      profile.log_mean,
      profile.log_sd,
      public.effective_round_seconds(
        elapsed_seconds,hint_count,mistake_count,profile.seconds,correct_answers,total_answers
      ) as value
    from profile
  )
  select case
    -- Nothing correct: no pace to measure, and no points.
    when effective.value is null then 0
    -- Measured spread: score against it.
    when effective.log_mean is not null and coalesce(effective.log_sd,0) > 0.01 then
      greatest(20,least(150,round(
        100 + 25*((effective.log_mean - ln(effective.value))/effective.log_sd)
      )::integer))
    -- Not yet measured: the previous ratio rule, floor and all, so a game with
    -- no history still scores sensibly.
    else
      greatest(45,least(150,round(
        100*effective.seconds/effective.value
      )::integer))
  end
  from effective
$$;


--
-- Name: circle_challenge_member_totals(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.circle_challenge_member_totals(target_challenge_id bigint) RETURNS TABLE(member_id uuid, challenge_score integer, rounds_played integer, rounds_total integer, total_hints integer, total_mistakes integer, adjusted_seconds bigint, finished_at timestamp with time zone, last_stat_id bigint, round_scores jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with challenge as (
    select item.id,item.circle_id
    from public.circle_weekly_challenges item
    where item.id=target_challenge_id
  ),
  member_rounds as (
    select
      member.user_id,
      round_item.challenge_date,
      round_item.game,
      round_item.round_number,
      result.id as stat_id,
      result.seconds,
      result.hints,
      result.mistakes,
      result.completed_at,
      case
        when result.id is null then null
        else public.circle_challenge_daily_score(
          round_item.game,
          round_item.challenge_date,
          result.seconds,
          result.hints,
          result.mistakes,
          result.correct_count,
          result.total_count
        )
      end as round_score
    from challenge
    join public.circle_members member
      on member.circle_id=challenge.circle_id
    join public.circle_challenge_rounds round_item
      on round_item.challenge_id=challenge.id
    left join lateral (
      select stat.*
      from public.game_stats stat
      where stat.circle_challenge_id=challenge.id
        and stat.user_id=member.user_id
        and stat.mode='challenge'
        and stat.challenge_date=round_item.challenge_date
        and stat.game=round_item.game
      order by stat.completed_at,stat.id
      limit 1
    ) result on true
  )
  select
    member_rounds.user_id,
    -- A missed round scores nothing. The standing is a sum, so a player who
    -- played every round already outranks one who skipped some; -100 punished
    -- on top of that, making a missed round worse than never entering.
    sum(coalesce(member_rounds.round_score,0))::integer,
    count(member_rounds.stat_id)::integer,
    count(*)::integer,
    sum(greatest(coalesce(member_rounds.hints,0),0))::integer,
    sum(greatest(coalesce(member_rounds.mistakes,0),0))::integer,
    sum(
      case
        when member_rounds.stat_id is null then 0
        else public.scored_game_seconds(
          member_rounds.seconds,
          member_rounds.hints,
          member_rounds.mistakes,
          public.challenge_benchmark_seconds(member_rounds.game,member_rounds.challenge_date)
        )
      end
    )::bigint,
    max(member_rounds.completed_at),
    max(member_rounds.stat_id),
    jsonb_agg(
      jsonb_build_object(
        'challenge_date',member_rounds.challenge_date,
        'game',member_rounds.game,
        'score',member_rounds.round_score
      )
      order by member_rounds.round_number,member_rounds.challenge_date
    )
  from member_rounds
  group by member_rounds.user_id
$$;


--
-- Name: get_circle_challenge_standings(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_circle_challenge_standings(target_challenge_id bigint) RETURNS TABLE(member_id uuid, member_name text, member_icon text, standing_rank integer, challenge_score integer, rounds_played integer, rounds_total integer, is_private boolean, round_scores jsonb, total_hints integer, total_mistakes integer, adjusted_seconds bigint, finished_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with visible_challenge as (
    select item.id
    from public.circle_weekly_challenges item
    where item.id=target_challenge_id
      and (
        public.is_admin(auth.uid())
        or exists(
          select 1
          from public.circle_members member
          where member.circle_id=item.circle_id
            and member.user_id=auth.uid()
        )
      )
  )
  select
    totals.member_id,
    profile.name::text,
    profile.icon::text,
    row_number() over(
      order by
        (totals.rounds_played>0) desc,
        totals.challenge_score desc,
        totals.rounds_played desc,
        totals.total_hints,
        totals.total_mistakes,
        totals.adjusted_seconds,
        totals.finished_at,
        totals.member_id
    )::integer,
    totals.challenge_score,
    totals.rounds_played,
    totals.rounds_total,
    (
      totals.member_id<>auth.uid()
      and coalesce(profile.show_stats_to_others,false)=false
    ),
    case
      when totals.member_id<>auth.uid()
        and coalesce(profile.show_stats_to_others,false)=false
      then null
      else totals.round_scores
    end,
    -- The keys that break a tie, returned so the standings can say out loud
    -- why one player finished above another on an identical score.
    totals.total_hints,
    totals.total_mistakes,
    totals.adjusted_seconds,
    totals.finished_at
  from visible_challenge
  cross join public.circle_challenge_member_totals(visible_challenge.id) totals
  join public.profiles profile on profile.id=totals.member_id
  where profile.account_deleted_at is null
    and coalesce(profile.hidden_from_others,false)=false
$$;


--
-- Name: clear_hidden_user_presence(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clear_hidden_user_presence() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.hidden_from_others
    and new.hidden_from_others is distinct from old.hidden_from_others
  then
    delete from public.presence where user_id=new.id;
    update public.animal_rush_players
    set left_at=coalesce(left_at,clock_timestamp()),
        eliminated=true
    where user_id=new.id
      and left_at is null;
  end if;
  return new;
end;
$$;


--
-- Name: complete_feedback(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_feedback(target_feedback_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  item public.feedback;
  notification_body text;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin only.' using errcode='42501';
  end if;

  select * into item
  from public.feedback
  where id=target_feedback_id and deleted_at is null
  for update;
  if not found then raise exception 'Feedback not found.'; end if;

  update public.feedback
  set status='closed',
      admin_comment=null,
      closed_at=now(),
      user_seen_at=null
  where id=target_feedback_id;

  -- The Feedback badge is enough when an admin closes their own submission;
  -- direct_messages intentionally disallows sending a message to yourself.
  if item.user_id<>auth.uid() then
    notification_body:=format(
      '✅ Your feedback “%s” was marked done. Tap to view the update.',
      left(item.title,160)
    );
    insert into public.direct_messages(
      sender_id,recipient_id,body,system_generated,activity_type,source_stat_id
    )
    values(
      auth.uid(),item.user_id,notification_body,true,'feedback_completed',item.id
    )
    on conflict(activity_type,source_stat_id,recipient_id)
      where activity_type='feedback_completed' and source_stat_id is not null
    do update set
      sender_id=excluded.sender_id,
      body=excluded.body,
      created_at=now(),
      read_at=null;
  end if;
end;
$$;


--
-- Name: complete_score_challenge(bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_score_challenge(target_challenge_id bigint, target_stat_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare c public.score_challenges; result public.game_stats; player_name text; result_score numeric; outcome text;
begin
  select * into c from public.score_challenges where id=target_challenge_id;
  select * into result from public.game_stats where id=target_stat_id;
  if not found or result.user_id is distinct from auth.uid() then raise exception 'Game result not found.' using errcode='42501'; end if;
  if not exists(select 1 from public.score_challenge_recipients r where r.challenge_id=c.id and r.recipient_id=auth.uid()) then raise exception 'Score challenge not found.' using errcode='42501'; end if;
  if result.game<>c.game or result.seed<>c.seed then raise exception 'The completed puzzle does not match this challenge.' using errcode='22023'; end if;
  result_score:=public.scored_game_seconds(result.seconds,result.hints,result.mistakes,coalesce(c.typical_seconds,100));
  update public.score_challenge_recipients set completed_stat_id=result.id,completed_at=now()
    where challenge_id=c.id and recipient_id=auth.uid() and completed_stat_id is null;
  select coalesce(name,'A friend') into player_name from public.profiles where id=auth.uid();
  outcome:=format('%s scored %s against your %s in %s.',player_name,
    (round(result_score)::integer/60)::text||':'||lpad((round(result_score)::integer%60)::text,2,'0'),c.game,
    (round(coalesce(c.scored_seconds,c.seconds))::integer/60)::text||':'||lpad((round(coalesce(c.scored_seconds,c.seconds))::integer%60)::text,2,'0'));
  insert into public.direct_messages(sender_id,recipient_id,body,system_generated,activity_type,source_stat_id)
  values(c.challenger_id,c.challenger_id,outcome,true,'score_challenge_result',result.id) on conflict do nothing;
  return jsonb_build_object('beat_score',result_score<coalesce(c.scored_seconds,c.seconds),'tied_score',result_score=coalesce(c.scored_seconds,c.seconds),
    'their_seconds',coalesce(c.scored_seconds,c.seconds),'your_seconds',result_score);
end;
$$;


--
-- Name: circles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.circles (
    id bigint NOT NULL,
    name text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    emoji text DEFAULT '⭐'::text NOT NULL,
    timezone text
);


--
-- Name: create_circle(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_circle(circle_name text, circle_emoji text DEFAULT '⭐'::text) RETURNS public.circles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare result public.circles;
begin
  if not public.is_available_player(auth.uid()) then
    raise exception 'Your account must be active and approved first.' using errcode='42501';
  end if;
  if exists(
    select 1 from public.profiles profile
    where profile.id=auth.uid() and coalesce(profile.hidden_from_others,false)
  ) then
    raise exception 'Hidden players cannot create circles.' using errcode='42501';
  end if;
  if nullif(btrim(circle_name),'') is null then
    raise exception 'Circle name is required.' using errcode='22023';
  end if;

  -- The circle's day boundary comes from whoever created it. Members abroad
  -- all play the same shared round on the same shared day.
  insert into public.circles(name,emoji,created_by,timezone)
  values(
    btrim(circle_name),
    coalesce(nullif(btrim(circle_emoji),''),'⭐'),
    auth.uid(),
    (select profile.timezone from public.profiles profile where profile.id=auth.uid())
  )
  returning * into result;

  insert into public.circle_members(circle_id,user_id,can_approve_rewards)
  values(result.id,auth.uid(),true);
  return result;
end;
$$;


--
-- Name: create_score_challenge(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_score_challenge(target_stat_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  source_result public.game_stats;
  eligibility jsonb;
  created_challenge_id bigint;
  recipients integer:=0;
  challenger_name text;
  game_label text;
begin
  select * into source_result from public.game_stats where id=target_stat_id;
  if not found or source_result.user_id is distinct from auth.uid() then raise exception 'Game result not found.' using errcode='42501'; end if;
  if source_result.game not in ('hive','binary','gridly','minisudoku') or nullif(source_result.seed,'') is null then
    raise exception 'This result cannot be challenged.' using errcode='22023';
  end if;
  eligibility:=public.get_score_challenge_eligibility(target_stat_id);
  if not coalesce((eligibility->>'eligible')::boolean,false) then
    raise exception 'Beat my score is available after a result that beats the typical time or your circle.' using errcode='22023';
  end if;

  insert into public.score_challenges(source_stat_id,challenger_id,game,seed,generator_version,generator_config,day_index,seconds,hints,mistakes,typical_seconds,scored_seconds)
  values(source_result.id,source_result.user_id,source_result.game,source_result.seed,source_result.generator_version,source_result.generator_config,
    source_result.day_index,source_result.seconds,source_result.hints,source_result.mistakes,
    (eligibility->>'typical_seconds')::numeric,(eligibility->>'scored_seconds')::numeric)
  on conflict(source_stat_id) do update set source_stat_id=excluded.source_stat_id
  returning id into created_challenge_id;

  insert into public.score_challenge_recipients(challenge_id,recipient_id)
  select distinct created_challenge_id,other_member.user_id
  from public.circle_members mine join public.circle_members other_member on other_member.circle_id=mine.circle_id
  join public.profiles profile on profile.id=other_member.user_id
  where mine.user_id=auth.uid() and other_member.user_id<>auth.uid()
    and profile.account_deleted_at is null and coalesce(profile.is_blocked,false)=false
    and coalesce(profile.hidden_from_others,false)=false and coalesce(profile.is_approved,true)=true
  on conflict do nothing;
  get diagnostics recipients=row_count;

  select coalesce(name,'A friend') into challenger_name from public.profiles where id=auth.uid();
  game_label:=case source_result.game when 'hive' then 'Hive' when 'binary' then 'Twist' when 'gridly' then 'Gridly' when 'minisudoku' then 'Sudoku' else initcap(replace(source_result.game,'_',' ')) end;
  insert into public.direct_messages(sender_id,recipient_id,body,system_generated,activity_type,source_stat_id)
  select recipient_id,recipient_id,format('%s set a %s score of %s. Can you beat it?',challenger_name,game_label,
    (round((eligibility->>'scored_seconds')::numeric)::integer/60)::text||':'||lpad((round((eligibility->>'scored_seconds')::numeric)::integer%60)::text,2,'0')),
    true,'score_challenge',source_result.id
  from public.score_challenge_recipients where score_challenge_recipients.challenge_id=created_challenge_id
  on conflict do nothing;

  select count(*)::integer into recipients from public.score_challenge_recipients where score_challenge_recipients.challenge_id=created_challenge_id;
  return jsonb_build_object('challenge_id',created_challenge_id,'recipient_count',recipients,'already_sent',false);
end;
$$;


--
--
-- Name: decide_circle_invitation(bigint, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decide_circle_invitation(target_invitation_id bigint, accept_invitation boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  item public.circle_invitations;
begin
  select * into item from public.circle_invitations
  where id=target_invitation_id and invited_user_id=auth.uid() and status='pending'
  for update;
  if not found then raise exception 'Invitation is no longer available.'; end if;

  if accept_invitation then
    if exists(
      select 1 from public.circle_member_blocks
      where circle_id=item.circle_id and user_id=auth.uid()
    ) then raise exception 'You cannot join this circle.'; end if;
    insert into public.circle_members(circle_id,user_id)
    values(item.circle_id,auth.uid())
    on conflict do nothing;
  end if;

  update public.circle_invitations
  set status=case when accept_invitation then 'accepted' else 'declined' end,
      decided_at=now()
  where id=item.id;
  update public.direct_messages
  set read_at=coalesce(read_at,now())
  where activity_type='circle_invitation'
    and source_stat_id=item.id
    and recipient_id=auth.uid();
end;
$$;


--
-- Name: decide_circle_join_request(bigint, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decide_circle_join_request(request_id bigint, approve boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r public.circle_join_requests; owner_id uuid;
begin
  select * into r from public.circle_join_requests where id=request_id and status='pending' for update;
  if not found then raise exception 'Request is no longer pending'; end if;
  select created_by into owner_id from public.circles where id=r.circle_id;
  if owner_id<>auth.uid() and not public.is_admin(auth.uid()) then
    raise exception 'Only the circle owner or an app administrator can decide this request';
  end if;
  if approve then
    if exists(select 1 from public.circle_member_blocks where circle_id=r.circle_id and user_id=r.user_id) then
      raise exception 'This player is blocked from the circle.';
    end if;
    if exists(select 1 from public.profiles where id=r.user_id and coalesce(hidden_from_others,false)) then
      raise exception 'Hidden players cannot join circles';
    end if;
    insert into public.circle_members(circle_id,user_id) values(r.circle_id,r.user_id) on conflict do nothing;
  end if;
  update public.circle_join_requests set
    status=case when approve then 'approved' else 'declined' end,
    decided_at=now(),decided_by=auth.uid(),user_seen_at=null
  where id=request_id;
end;
$$;


--
-- Name: delete_managed_circle(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_managed_circle(target_circle_id bigint, expected_circle_name text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  target_circle public.circles;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  select * into target_circle from public.circles where id=target_circle_id for update;
  if not found then raise exception 'Circle not found.'; end if;
  if auth.uid()<>target_circle.created_by and not public.is_admin(auth.uid()) then
    raise exception 'Only the circle owner or an app administrator can delete this circle.' using errcode='42501';
  end if;
  if btrim(coalesce(expected_circle_name,''))<>target_circle.name then
    raise exception 'Enter the exact circle name to confirm deletion.';
  end if;

  delete from public.circles where id=target_circle_id;
end;
$$;


--
-- Name: delete_reward(bigint, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_reward(target_reward_id bigint, force boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare rw rewards;
begin
  select * into rw from rewards where id=target_reward_id;
  if not found then raise exception 'Reward not found'; end if;
  if not public.is_circle_organiser(rw.circle_id,auth.uid()) then
    raise exception 'Only this circle''s organiser can do that.' using errcode='42501';
  end if;
  if exists(select 1 from reward_redemptions where reward_id=target_reward_id) then
    if not force then
      raise exception 'This item has redemption history and can''t be deleted — deactivate it instead.';
    end if;
    delete from reward_redemptions where reward_id=target_reward_id;
  end if;
  delete from rewards where id=target_reward_id;
end; $$;


--
-- Name: dispute_redemption(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dispute_redemption(target_id bigint, reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare red reward_redemptions;
begin
  select * into red from reward_redemptions where id=target_id and player_id=auth.uid() for update;
  if not found then raise exception 'Redemption not found'; end if;
  if red.status<>'fulfilled' then raise exception 'Only a completed reward can be flagged.'; end if;
  if nullif(trim(reason),'') is null then raise exception 'A reason is required'; end if;
  update reward_redemptions set status='disputed',dispute_reason=reason,disputed_at=now() where id=target_id;
end; $$;


--
-- Name: enforce_circle_challenge_reward_cap(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_circle_challenge_reward_cap() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if coalesce(new.reward_points,0) not between 0 and 50 then
    raise exception 'A circle challenge winner''s prize must be between 0 and 50 points.';
  end if;
  return new;
end;
$$;


--
-- Name: ensure_circle_challenge_rounds(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_circle_challenge_rounds(target_challenge_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  challenge public.circle_weekly_challenges;
begin
  select *
  into challenge
  from public.circle_weekly_challenges
  where id=target_challenge_id;

  if not found
     or coalesce(cardinality(challenge.game_ids),0)=0
     or coalesce(cardinality(challenge.active_days),0)=0 then
    return;
  end if;

  insert into public.circle_challenge_rounds(
    challenge_id,challenge_date,game,round_number
  )
  select
    challenge.id,
    challenge.week_start+(scheduled.iso_day-1),
    coalesce(
      (
        select result.game
        from public.game_stats result
        where result.circle_challenge_id=challenge.id
          and result.mode='challenge'
          and result.challenge_date=challenge.week_start+(scheduled.iso_day-1)
          and result.game=any(challenge.game_ids)
        order by result.completed_at,result.id
        limit 1
      ),
      challenge.game_ids[
        ((scheduled.ordinality::integer-1)%cardinality(challenge.game_ids))+1
      ]
    ),
    scheduled.ordinality::integer
  from (
    select
      selected_day.iso_day,
      row_number() over(order by selected_day.iso_day) as ordinality
    from (
      select distinct unnest(challenge.active_days) as iso_day
    ) selected_day
    where selected_day.iso_day between 1 and 7
  ) scheduled
  on conflict(challenge_id,challenge_date) do nothing;
end;
$$;


--
-- Name: player_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_progress (
    player_id uuid NOT NULL,
    available_points bigint DEFAULT 0 NOT NULL,
    lifetime_points bigint DEFAULT 0 NOT NULL,
    current_level integer DEFAULT 1 NOT NULL,
    current_streak integer DEFAULT 0 NOT NULL,
    longest_streak integer DEFAULT 0 NOT NULL,
    last_completed_date date,
    streak_protected_through date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    challenge_current_streak integer DEFAULT 0 NOT NULL,
    challenge_longest_streak integer DEFAULT 0 NOT NULL,
    challenge_last_completed_date date,
    challenge_penalty_for_date date,
    CONSTRAINT player_progress_available_points_check CHECK ((available_points >= 0)),
    CONSTRAINT player_progress_lifetime_points_check CHECK ((lifetime_points >= 0))
);


--
-- Name: ensure_player_progress(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_player_progress(uid uuid) RETURNS public.player_progress
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare p player_progress;
begin
  insert into player_progress(player_id) values (uid) on conflict do nothing;
  select * into p from player_progress where player_id = uid;
  return p;
end;
$$;


--
-- Name: finalize_circle_challenge(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finalize_circle_challenge(target_challenge_id bigint) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  challenge public.circle_weekly_challenges;
  required_rounds integer;
  member_count integer;
  finisher_count integer;
  deadline date;
  winner_id uuid;
  winner_stat_id bigint;
  winner_name text;
  circle_name text;
  award_created bigint;
  existing_winner uuid;
  winning_score integer;
  -- Named apart from the circle_weekly_challenges.loser_id column it is
  -- written to. Sharing the name forced the UPDATE below to disambiguate with
  -- finalize_circle_challenge.loser_id, and when that block-label reference
  -- failed to resolve, Postgres read it as a table and raised "missing
  -- FROM-clause entry for table finalize_circle_challenge" — taking down every
  -- caller of finalize_due_circle_challenges() with it.
  losing_player_id uuid;
  loser_name text;
  prize_label text;
begin
  select *
  into challenge
  from public.circle_weekly_challenges
  where id=target_challenge_id
  for update;

  if not found then
    return null;
  end if;

  select award.player_id
  into existing_winner
  from public.circle_challenge_reward_awards award
  where award.challenge_id=challenge.id
  order by award.awarded_at,award.id
  limit 1;

  if challenge.closed_at is not null then
    return existing_winner;
  end if;
  if existing_winner is not null then
    update public.circle_weekly_challenges
    set closed_at=coalesce(closed_at,now()),updated_at=now()
    where id=challenge.id;
    return existing_winner;
  end if;

  perform public.ensure_circle_challenge_rounds(challenge.id);

  select count(*),max(round_item.challenge_date)
  into required_rounds,deadline
  from public.circle_challenge_rounds round_item
  where round_item.challenge_id=challenge.id;

  select count(*)
  into member_count
  from public.circle_members member
  where member.circle_id=challenge.circle_id;

  select count(*)
  into finisher_count
  from public.circle_challenge_member_totals(challenge.id) totals
  where totals.rounds_played=required_rounds;

  if required_rounds=0
     or (
       public.circle_today(challenge.circle_id)<=deadline
       and (member_count=0 or finisher_count<member_count)
     ) then
    return null;
  end if;

  select totals.member_id,totals.last_stat_id,totals.challenge_score
  into winner_id,winner_stat_id,winning_score
  from public.circle_challenge_member_totals(challenge.id) totals
  where totals.rounds_played>0
  order by
    totals.challenge_score desc,
    totals.rounds_played desc,
    totals.total_hints,
    totals.total_mistakes,
    totals.adjusted_seconds,
    totals.finished_at,
    totals.member_id
  limit 1;

  if winner_id is null then
    update public.circle_weekly_challenges
    set closed_at=now(),updated_at=now()
    where id=challenge.id;
    return null;
  end if;

  insert into public.circle_challenge_reward_awards(
    challenge_id,player_id,points
  )
  values(
    challenge.id,
    winner_id,
    case when challenge.reward_type='points'
      then greatest(challenge.reward_points,0)
      else 0
    end
  )
  on conflict(challenge_id,player_id) do nothing
  returning id into award_created;

  if award_created is null then
    update public.circle_weekly_challenges
    set closed_at=coalesce(closed_at,now()),updated_at=now()
    where id=challenge.id;
    return winner_id;
  end if;

  if challenge.reward_type='points' and challenge.reward_points>0 then
    perform public.ensure_player_progress(winner_id);
    update public.player_progress
    set
      available_points=available_points+challenge.reward_points,
      lifetime_points=lifetime_points+challenge.reward_points,
      current_level=public.points_level(lifetime_points+challenge.reward_points),
      updated_at=now()
    where player_id=winner_id;
  end if;

  insert into public.points_transactions(
    player_id,points,reason_code,metadata,created_by
  )
  values(
    winner_id,
    case when challenge.reward_type='points'
      then greatest(challenge.reward_points,0)
      else 0
    end,
    'TEAM_CHALLENGE_WINNER',
    jsonb_build_object(
      'circle_id',challenge.circle_id,
      'circle_challenge_id',challenge.id,
      'week_start',challenge.week_start,
      'reward_points',case when challenge.reward_type='points'
        then greatest(challenge.reward_points,0)
        else 0
      end,
      'reward_label',case when challenge.reward_type='prize'
        then challenge.reward_label
        else null
      end
    ),
    winner_id
  );

  select coalesce(nullif(btrim(profile.name),''),'A teammate')
  into winner_name
  from public.profiles profile
  where profile.id=winner_id;

  select circle.name
  into circle_name
  from public.circles circle
  where circle.id=challenge.circle_id;

  -- Last place decides a forfeit, and is worth recording either way so the
  -- circle can see how the week actually finished. A one-player challenge has
  -- no loser.
  losing_player_id := public.circle_challenge_last_place(challenge.id);
  if losing_player_id = winner_id then
    losing_player_id := null;
  end if;
  select coalesce(nullif(btrim(profile.name),''),'Someone')
  into loser_name
  from public.profiles profile
  where profile.id=losing_player_id;

  prize_label := coalesce(nullif(btrim(challenge.reward_label),''),'the prize');

  insert into public.direct_messages(
    sender_id,recipient_id,body,system_generated,activity_type,source_stat_id
  )
  select
    winner_id,
    member.user_id,
    case
      -- A real thing the loser owes. Everyone is told who settles it with
      -- whom, because the app cannot hand over a bathroom clean itself.
      when challenge.reward_type='prize' and challenge.reward_goes_to='loser' and losing_player_id is not null then
        case
          when member.user_id=losing_player_id then
            format(
              '🏆 %s won %s. You finished last, so %s is on you — sort it out between you.',
              winner_name,
              coalesce(challenge.title,circle_name,'the circle challenge'),
              prize_label
            )
          when member.user_id=winner_id then
            format(
              '🏆 You won %s. %s finished last and owes you %s — sort it out between you.',
              coalesce(challenge.title,circle_name,'the circle challenge'),
              loser_name,
              prize_label
            )
          else
            format(
              '🏆 %s won %s. %s finished last and owes %s.',
              winner_name,
              coalesce(challenge.title,circle_name,'the circle challenge'),
              loser_name,
              prize_label
            )
        end
      when member.user_id=winner_id and challenge.reward_type='points' then
        format(
          '🏆 You won %s and earned the %s-point winner''s prize!',
          coalesce(challenge.title,circle_name,'the circle challenge'),
          challenge.reward_points
        )
      when member.user_id=winner_id then
        format(
          '🏆 You won %s — your prize is %s. The circle settles this outside the app.',
          coalesce(challenge.title,circle_name,'the circle challenge'),
          prize_label
        )
      when challenge.reward_type='points' then
        format(
          '🏆 %s won %s and earned the %s-point winner''s prize.',
          winner_name,
          coalesce(challenge.title,circle_name,'the circle challenge'),
          challenge.reward_points
        )
      else
        format(
          '🏆 %s won %s — prize: %s. The circle settles this outside the app.',
          winner_name,
          coalesce(challenge.title,circle_name,'the circle challenge'),
          prize_label
        )
    end,
    true,
    'circle_challenge_winner',
    winner_stat_id
  from public.circle_members member
  where member.circle_id=challenge.circle_id
  on conflict do nothing;

  update public.circle_weekly_challenges
  set closed_at=now(),loser_id=losing_player_id,updated_at=now()
  where id=challenge.id;

  return winner_id;
end;
$$;


--
-- Name: finalize_due_circle_challenges(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finalize_due_circle_challenges() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  due_challenge record;
  finalised_count integer:=0;
begin
  if not public.is_approved_user(auth.uid()) then
    return 0;
  end if;

  for due_challenge in
    select distinct challenge.id
    from public.circle_members membership
    join public.circle_weekly_challenges challenge
      on challenge.circle_id=membership.circle_id
    where membership.user_id=auth.uid()
      and challenge.closed_at is null
      and public.circle_today(challenge.circle_id)>(
        challenge.week_start+
        (select max(day_number)-1 from unnest(challenge.active_days) day_number)
      )
  loop
    perform public.finalize_circle_challenge(due_challenge.id);
    finalised_count:=finalised_count+1;
  end loop;

  return finalised_count;
end;
$$;


--
--
-- Name: get_circle_ideas_to_vote_on(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_circle_ideas_to_vote_on() RETURNS TABLE(id bigint, circle_id bigint, circle_name text, name text, description text, image_url text, points_cost bigint, created_by uuid, creator_name text, creator_icon text, approve_count integer, required_count integer, my_vote text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select rw.id, rw.circle_id, c.name::text, rw.name::text, rw.description::text,
    rw.image_url::text, rw.points_cost, rw.created_by, creator.name::text, creator.icon::text,
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='approve'),
    (floor((select count(*)::int from circle_members m where m.circle_id=rw.circle_id)::numeric/2)+1)::int,
    (select ra.decision from reward_approvals ra where ra.reward_id=rw.id and ra.approver_id=auth.uid()),
    rw.created_at
  from rewards rw
  join circles c on c.id=rw.circle_id
  join profiles creator on creator.id=rw.created_by
  where rw.status='pending'
    and exists(select 1 from circle_members where circle_id=rw.circle_id and user_id=auth.uid())
  order by rw.created_at desc;
$$;


--
-- Name: get_my_active_circle_challenges(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_active_circle_challenges() RETURNS TABLE(challenge_id bigint, circle_id bigint, circle_name text, circle_emoji text, challenge_title text, game_ids text[], active_days integer[], reward_points integer, reward_type text, reward_label text, active_today boolean, is_locked boolean, repeats_weekly boolean, series_weeks integer, occurrence_number integer, reward_goes_to text, closes_on date, stake_reward_id bigint, stake_reward_name text, stake_split_method text, stake_accepted boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.finalize_due_circle_challenges();

  return query
  select
    challenge.id,
    circle.id,
    circle.name::text,
    coalesce(circle.emoji,'⭐')::text,
    coalesce(nullif(btrim(challenge.title),''),'Weekly challenge')::text,
    challenge.game_ids,
    challenge.active_days,
    challenge.reward_points,
    challenge.reward_type,
    challenge.reward_label,
    extract(isodow from public.circle_today(circle.id))::integer=any(challenge.active_days),
    (
      challenge.locked_at is not null
      or exists(
        select 1
        from public.circle_challenge_starts challenge_start
        where challenge_start.challenge_id=challenge.id
      )
      or exists(
        select 1
        from public.game_stats result
        where result.circle_challenge_id=challenge.id
      )
    ),
    challenge.repeats_weekly,
    challenge.series_weeks,
    challenge.occurrence_number,
    challenge.reward_goes_to,
    challenge.week_start+
      (select max(day_number)-1 from unnest(challenge.active_days) day_number),
    challenge.stake_reward_id,
    stake_reward.name::text,
    challenge.stake_split_method,
    exists(
      select 1 from public.circle_challenge_stake_acceptances a
      where a.challenge_id=challenge.id and a.user_id=auth.uid()
    )
  from public.circle_members membership
  join public.circles circle on circle.id=membership.circle_id
  join public.circle_weekly_challenges challenge
    on challenge.circle_id=circle.id
   and challenge.week_start=public.circle_week_start(circle.id)
  left join public.rewards stake_reward on stake_reward.id=challenge.stake_reward_id
  where membership.user_id=auth.uid()
    and public.is_approved_user(auth.uid())
    and challenge.closed_at is null
  order by circle.name,challenge.created_at,challenge.id;
end;
$$;


--
-- Name: get_my_circle_challenge_history(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_circle_challenge_history(history_limit_in integer DEFAULT 30) RETURNS TABLE(challenge_id bigint, circle_id bigint, circle_name text, circle_emoji text, challenge_title text, week_start date, closed_at timestamp with time zone, game_ids text[], active_days integer[], reward_points integer, reward_type text, reward_label text, winner_id uuid, winner_name text, winner_icon text, entry_count integer, finisher_count integer, current_user_finished boolean, repeats_weekly boolean, series_weeks integer, occurrence_number integer, reward_goes_to text, loser_id uuid, loser_name text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.finalize_due_circle_challenges();

  return query
  select
    challenge.id,
    circle.id,
    circle.name::text,
    coalesce(circle.emoji,'⭐')::text,
    coalesce(nullif(btrim(challenge.title),''),'Weekly challenge')::text,
    challenge.week_start,
    challenge.closed_at,
    challenge.game_ids,
    challenge.active_days,
    challenge.reward_points,
    challenge.reward_type,
    challenge.reward_label,
    award.player_id,
    winner.name::text,
    winner.icon::text,
    coalesce(progress.entry_count,0)::integer,
    coalesce(progress.finisher_count,0)::integer,
    coalesce(progress.current_user_finished,false),
    challenge.repeats_weekly,
    challenge.series_weeks,
    challenge.occurrence_number,
    challenge.reward_goes_to,
    challenge.loser_id,
    loser.name::text
  from public.circle_members membership
  join public.circles circle on circle.id=membership.circle_id
  join public.circle_weekly_challenges challenge
    on challenge.circle_id=circle.id
  left join lateral (
    select item.player_id,item.awarded_at
    from public.circle_challenge_reward_awards item
    where item.challenge_id=challenge.id
    order by item.awarded_at,item.id
    limit 1
  ) award on true
  left join public.profiles winner on winner.id=award.player_id
  left join public.profiles loser on loser.id=challenge.loser_id
  left join lateral (
    select
      count(*) filter(where totals.games_completed>0)::integer as entry_count,
      count(*) filter(
        where totals.games_completed=cardinality(challenge.game_ids)
      )::integer as finisher_count,
      coalesce(
        bool_or(
          totals.games_completed=cardinality(challenge.game_ids)
        ) filter(where totals.user_id=auth.uid()),
        false
      ) as current_user_finished
    from (
      select
        member.user_id,
        count(distinct result.game) filter(
          where result.game=any(challenge.game_ids)
        ) as games_completed
      from public.circle_members member
      left join public.game_stats result
        on result.user_id=member.user_id
       and result.circle_challenge_id=challenge.id
       and result.mode='challenge'
      where member.circle_id=challenge.circle_id
      group by member.user_id
    ) totals
  ) progress on true
  where membership.user_id=auth.uid()
    and public.is_approved_user(auth.uid())
    and challenge.closed_at is not null
  order by challenge.closed_at desc,challenge.week_start desc,challenge.id desc
  limit least(greatest(coalesce(history_limit_in,30),1),100);
end;
$$;


--
-- Name: get_my_circle_challenge_lifecycle(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_circle_challenge_lifecycle() RETURNS TABLE(challenge_id bigint, member_count integer, finished_count integer, current_user_finished boolean, winner_id uuid, winner_name text, winner_icon text, awarded_at timestamp with time zone, closed_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.finalize_due_circle_challenges();

  return query
  with my_challenges as (
    select challenge.id,challenge.circle_id,challenge.game_ids,challenge.closed_at
    from public.circle_members membership
    join public.circle_weekly_challenges challenge
      on challenge.circle_id=membership.circle_id
     and challenge.week_start=public.circle_week_start(membership.circle_id)
    where membership.user_id=auth.uid()
      and public.is_approved_user(auth.uid())
  ),
  member_progress as (
    select
      challenge.id as challenge_id,
      member.user_id,
      count(distinct result.game) filter(
        where result.game=any(challenge.game_ids)
      )=cardinality(challenge.game_ids) as finished
    from my_challenges challenge
    join public.circle_members member on member.circle_id=challenge.circle_id
    left join public.game_stats result
      on result.user_id=member.user_id
     and result.circle_challenge_id=challenge.id
     and result.mode='challenge'
    group by challenge.id,challenge.game_ids,member.user_id
  )
  select
    challenge.id,
    count(progress.user_id)::integer,
    count(*) filter(where progress.finished)::integer,
    coalesce(
      bool_or(progress.finished) filter(where progress.user_id=auth.uid()),
      false
    ),
    award.player_id,
    winner.name::text,
    winner.icon::text,
    award.awarded_at,
    challenge.closed_at
  from my_challenges challenge
  join member_progress progress on progress.challenge_id=challenge.id
  left join lateral (
    select item.player_id,item.awarded_at
    from public.circle_challenge_reward_awards item
    where item.challenge_id=challenge.id
    order by item.awarded_at,item.id
    limit 1
  ) award on true
  left join public.profiles winner on winner.id=award.player_id
  group by
    challenge.id,
    challenge.closed_at,
    award.player_id,
    award.awarded_at,
    winner.name,
    winner.icon
  order by challenge.id;
end;
$$;


--
-- Name: get_my_circle_rosters(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_circle_rosters() RETURNS TABLE(circle_id bigint, user_id uuid, member_name text, member_icon text, member_mood text, is_owner boolean, show_stats_to_others boolean, can_approve_rewards boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    membership.circle_id,
    membership.user_id,
    profile.name::text,
    profile.icon::text,
    profile.mood::text,
    (circle.created_by=membership.user_id),
    profile.show_stats_to_others,
    membership.can_approve_rewards
  from public.circle_members membership
  join public.circles circle on circle.id=membership.circle_id
  join public.profiles profile on profile.id=membership.user_id
  where (
    public.is_admin(auth.uid())
    or exists(
      select 1
      from public.circle_members mine
      where mine.circle_id=membership.circle_id
        and mine.user_id=auth.uid()
    )
  )
    and coalesce(profile.hidden_from_others,false)=false
    and profile.account_deleted_at is null
  order by
    membership.circle_id,
    (circle.created_by=membership.user_id) desc,
    profile.name;
$$;


--
-- Name: get_my_managed_circle_blocks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_managed_circle_blocks() RETURNS TABLE(circle_id bigint, user_id uuid, member_name text, member_icon text, blocked_at timestamp with time zone, reason text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select block.circle_id,block.user_id,profile.name::text,profile.icon::text,block.blocked_at,block.reason
  from public.circle_member_blocks block
  join public.circles circle on circle.id=block.circle_id
  join public.profiles profile on profile.id=block.user_id
  where (public.is_admin(auth.uid()) or circle.created_by=auth.uid())
    and coalesce(profile.hidden_from_others,false)=false
    and profile.account_deleted_at is null
  order by block.blocked_at desc;
$$;


--
-- Name: get_my_pending_circle_invitations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_pending_circle_invitations() RETURNS TABLE(invitation_id bigint, circle_id bigint, circle_name text, circle_emoji text, invited_by uuid, inviter_name text, inviter_icon text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select i.id,c.id,c.name::text,c.emoji::text,i.invited_by,p.name::text,p.icon::text,i.created_at
  from public.circle_invitations i
  join public.circles c on c.id=i.circle_id
  join public.profiles p on p.id=i.invited_by
  where i.invited_user_id=auth.uid() and i.status='pending'
  order by i.created_at desc;
$$;


--
-- Name: get_my_pending_invited_players(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_pending_invited_players() RETURNS TABLE(user_id uuid, player_name text, player_icon text, invited_email text, invited_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  select distinct on (profile.id)
    profile.id,
    profile.name,
    profile.icon,
    lower(auth_user.email),
    invitation.created_at
  from public.app_email_invitations invitation
  join auth.users auth_user
    on lower(auth_user.email)=lower(invitation.invitee_email)
  join public.profiles profile
    on profile.id=auth_user.id
  where invitation.inviter_id=auth.uid()
    and coalesce(profile.is_admin,false)=false
    and coalesce(profile.is_approved,false)=false
    and coalesce(profile.is_blocked,false)=false
    and coalesce(profile.hidden_from_others,false)=false
    and profile.account_deleted_at is null
  order by profile.id,invitation.created_at desc;
$$;


--
--
-- Name: get_my_reward_circles(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_reward_circles() RETURNS TABLE(circle_id bigint, circle_name text, can_approve boolean, member_count integer, approver_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select c.id,c.name::text,
    coalesce(cm.can_approve_rewards,is_admin(auth.uid())),
    (select count(*)::int from circle_members m where m.circle_id=c.id),
    (select count(*)::int from circle_members m where m.circle_id=c.id and m.can_approve_rewards=true)
  from circles c
  left join circle_members cm on cm.circle_id=c.id and cm.user_id=auth.uid()
  where cm.user_id is not null or is_admin(auth.uid())
  order by c.name;
$$;


--
-- Name: get_my_reward_proposals(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_reward_proposals() RETURNS TABLE(id bigint, circle_id bigint, circle_name text, name text, description text, image_url text, reward_type text, is_physical boolean, points_cost bigint, status text, approve_count integer, required_count integer, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select rw.id, rw.circle_id, c.name::text, rw.name::text, rw.description::text,
    rw.image_url::text, rw.reward_type, rw.is_physical, rw.points_cost, rw.status,
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='approve'),
    (floor((select count(*)::int from circle_members m where m.circle_id=rw.circle_id)::numeric/2)+1)::int,
    rw.created_at
  from rewards rw
  join circles c on c.id=rw.circle_id
  where rw.created_by=auth.uid()
  order by rw.created_at desc;
$$;


--
-- Name: get_organiser_active_rewards(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_organiser_active_rewards() RETURNS TABLE(id bigint, reward_id bigint, reward_name text, circle_id bigint, circle_name text, player_id uuid, player_name text, player_icon text, points_cost bigint, status text, cancellation_requested_at timestamp with time zone, requested_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select red.id, rw.id, rw.name::text, rw.circle_id, c.name::text,
    red.player_id, player.name::text, player.icon::text, red.points_cost,
    red.status, red.cancellation_requested_at, red.requested_at
  from reward_redemptions red
  join rewards rw on rw.id=red.reward_id
  join circles c on c.id=rw.circle_id
  join profiles player on player.id=red.player_id
  where red.status in ('requested','approved')
    and public.is_circle_organiser(rw.circle_id,auth.uid())
  order by red.cancellation_requested_at desc nulls last, red.requested_at desc;
$$;


--
-- Name: get_organiser_attention_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_organiser_attention_count() RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    (select count(*)::int from rewards rw
       where rw.status='suggested' and public.is_circle_organiser(rw.circle_id,auth.uid()))
    +
    (select count(*)::int from reward_redemptions red
       join rewards rw on rw.id=red.reward_id
       where red.cancellation_requested_at is not null
         and red.status='requested'
         and public.is_circle_organiser(rw.circle_id,auth.uid()));
$$;


--
--
-- Name: get_organiser_new_ideas(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_organiser_new_ideas() RETURNS TABLE(id bigint, circle_id bigint, circle_name text, name text, description text, image_url text, reward_type text, is_physical boolean, status text, points_cost bigint, created_by uuid, creator_name text, creator_icon text, approve_count integer, required_count integer, has_history boolean, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select rw.id, rw.circle_id, c.name::text, rw.name::text, rw.description::text,
    rw.image_url::text, rw.reward_type, rw.is_physical, rw.status, rw.points_cost,
    rw.created_by, creator.name::text, creator.icon::text,
    (select count(*)::int from reward_approvals ra where ra.reward_id=rw.id and ra.decision='approve'),
    (floor((select count(*)::int from circle_members m where m.circle_id=rw.circle_id)::numeric/2)+1)::int,
    exists(select 1 from reward_redemptions red where red.reward_id=rw.id),
    rw.created_at
  from rewards rw
  join circles c on c.id=rw.circle_id
  join profiles creator on creator.id=rw.created_by
  where rw.status in ('suggested','pending')
    and public.is_circle_organiser(rw.circle_id,auth.uid())
  order by rw.created_at desc;
$$;


--
--
--
-- Name: get_personal_challenge_standings(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_personal_challenge_standings(start_date_in date, end_date_in date) RETURNS TABLE(result_user_id uuid, game text, challenge_date date, seconds integer, mistakes integer, hints integer, correct_count integer, total_count integer, zip_backtracked_cells integer, zip_required_moves integer, completed_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    gs.user_id,
    gs.game,
    gs.challenge_date,
    gs.seconds,
    gs.mistakes,
    gs.hints,
    -- The browser scores the personal challenge itself, so it needs the same
    -- accuracy inputs circle_challenge_daily_score() gets on the server.
    gs.correct_count,
    gs.total_count,
    gs.zip_backtracked_cells,
    gs.zip_required_moves,
    gs.completed_at
  from public.game_stats gs
  join public.profiles profile on profile.id=gs.user_id
  where public.is_approved_user(auth.uid())
    and gs.mode='challenge'
    and gs.circle_challenge_id is null
    and gs.challenge_date between start_date_in and end_date_in
    and (
      gs.user_id=auth.uid()
      or (
        coalesce(profile.show_stats_to_others,false)=true
        and coalesce(profile.hidden_from_others,false)=false
        and public.can_view_user(gs.user_id)
      )
    )
  order by gs.challenge_date,gs.completed_at,gs.id
$$;


--
-- Name: get_public_player_game_summary(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_player_game_summary() RETURNS TABLE(player_id uuid, games_played bigint, challenge_games bigint, practice_games bigint, favourite_game text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with eligible_games as (
    select
      gs.user_id,
      gs.game,
      gs.mode,
      gs.id
    from public.game_stats gs
    join public.profiles profile on profile.id=gs.user_id
    left join public.points_transactions transaction
      on transaction.game_stat_id=gs.id
     and transaction.reason_code='GAME_COMPLETED'
    where auth.uid() is not null
      and public.can_view_user(gs.user_id)
      -- can_view_user() covers hidden and deleted accounts only; it also backs
      -- chat continuity, where is_private must not apply. Community standings
      -- are discovery, so private players are excluded here — except from
      -- their own view of the leaderboard.
      and (
        coalesce(profile.is_private,false)=false
        or profile.id=auth.uid()
      )
      and coalesce(
        profile.account_deleted_at,
        'infinity'::timestamptz
      )='infinity'::timestamptz
      and coalesce(profile.is_blocked,false)=false
      and (
        gs.mode='challenge'
        or coalesce(transaction.points,0)>0
      )
  ),
  totals as (
    select
      user_id,
      count(*)::bigint as games_played,
      count(*) filter(where mode='challenge')::bigint as challenge_games,
      count(*) filter(where mode='practice')::bigint as practice_games
    from eligible_games
    group by user_id
  ),
  favourites as (
    select user_id,game
    from (
      select
        user_id,
        game,
        row_number() over(
          partition by user_id
          order by count(*) desc,game
        ) as position
      from eligible_games
      group by user_id,game
    ) ranked
    where position=1
  )
  select
    totals.user_id,
    totals.games_played,
    totals.challenge_games,
    totals.practice_games,
    favourites.game
  from totals
  left join favourites on favourites.user_id=totals.user_id;
$$;


--
-- Name: get_public_player_progress(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_player_progress() RETURNS TABLE(player_id uuid, lifetime_points bigint, current_level integer, current_streak integer, longest_streak integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    progress.player_id,
    progress.lifetime_points,
    progress.current_level,
    progress.challenge_current_streak,
    progress.challenge_longest_streak
  from public.player_progress progress
  join public.profiles profile on profile.id=progress.player_id
  where auth.uid() is not null
    and public.can_view_user(progress.player_id)
    -- Private players are excluded from community standings; see
    -- get_public_player_game_summary() for why can_view_user() is not enough.
    and (
      coalesce(profile.is_private,false)=false
      or profile.id=auth.uid()
    )
    and coalesce(
      profile.account_deleted_at,
      'infinity'::timestamptz
    )='infinity'::timestamptz
    and coalesce(profile.is_blocked,false)=false;
$$;


--
-- Name: get_my_played_score_challenges(bigint[]); Type: FUNCTION; Schema: public; Owner: -
--

-- Which of these "Beat my score" invitations the caller has already played.
-- The chat bubble used to show a live "Play now" button on every one of them
-- and only discovered the duplicate after the tap, via an alert. One batched
-- lookup lets the list render the finished ones as already played instead.
CREATE FUNCTION public.get_my_played_score_challenges(source_stat_ids bigint[]) RETURNS TABLE(source_stat_id bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select challenge.source_stat_id
  from public.score_challenges challenge
  join public.score_challenge_recipients recipient
    on recipient.challenge_id=challenge.id
  where recipient.recipient_id=auth.uid()
    and recipient.completed_stat_id is not null
    and challenge.source_stat_id=any(source_stat_ids)
$$;


--
-- Name: get_score_challenge(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_score_challenge(target_source_stat_id bigint) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object('id',c.id,'source_stat_id',c.source_stat_id,'challenger_id',c.challenger_id,
    'challenger_name',coalesce(p.name,'A friend'),'game',c.game,'seed',c.seed,'generator_version',c.generator_version,
    'generator_config',c.generator_config,'day_index',c.day_index,'seconds',c.seconds,
    'scored_seconds',coalesce(c.scored_seconds,c.seconds),'completed_stat_id',r.completed_stat_id)
  from public.score_challenges c join public.profiles p on p.id=c.challenger_id
  join public.score_challenge_recipients r on r.challenge_id=c.id and r.recipient_id=auth.uid()
  where c.source_stat_id=target_source_stat_id
$$;


--
-- Name: get_score_challenge_eligibility(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_score_challenge_eligibility(target_stat_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  source_result public.game_stats;
  benchmark public.game_time_benchmarks;
  source_score numeric;
  recipient_count integer:=0;
  supported_result boolean:=false;
  benchmark_ready boolean:=false;
  beats_typical boolean:=false;
  seed_best numeric;
  beats_seed_best boolean:=true;
begin
  select * into source_result
  from public.game_stats
  where id=target_stat_id;

  if not found or source_result.user_id is distinct from auth.uid() then
    raise exception 'Game result not found.' using errcode='42501';
  end if;

  supported_result:=source_result.game in ('hive','binary','gridly','minisudoku')
    and nullif(source_result.seed,'') is not null;

  select count(distinct other_member.user_id)::integer
  into recipient_count
  from public.circle_members mine
  join public.circle_members other_member
    on other_member.circle_id=mine.circle_id
  join public.profiles profile
    on profile.id=other_member.user_id
  where mine.user_id=source_result.user_id
    and other_member.user_id<>source_result.user_id
    and profile.account_deleted_at is null
    and coalesce(profile.is_blocked,false)=false
    and coalesce(profile.hidden_from_others,false)=false
    and coalesce(profile.is_approved,true)=true;

  benchmark:=public.refresh_game_time_benchmark(
    source_result.game,
    source_result.day_index,
    source_result.mode
  );
  source_score:=public.scored_game_seconds(
    source_result.seconds,
    source_result.hints,
    source_result.mistakes,
    benchmark.effective_seconds
  );

  -- Hints and mistakes are already priced into source_score, so a hint-heavy
  -- win has to be that much faster on the clock to clear the bar.
  benchmark_ready:=benchmark.clean_sample_count>=6;
  beats_typical:=source_score<benchmark.effective_seconds;

  -- The best time anyone has already dared the circle with on this exact
  -- board. Your own earlier challenge counts too: re-posting a worse run of a
  -- puzzle you already challenged on is the same nonsense.
  select min(coalesce(existing.scored_seconds, existing.seconds))
  into seed_best
  from public.score_challenges existing
  where existing.game=source_result.game
    and existing.seed=source_result.seed
    and existing.day_index=source_result.day_index
    and existing.source_stat_id<>target_stat_id;

  if seed_best is not null then
    beats_seed_best:=source_score<seed_best;
  end if;

  return jsonb_build_object(
    'eligible',supported_result and recipient_count>0 and beats_typical and beats_seed_best,
    'supported_result',supported_result,
    'recipient_count',recipient_count,
    'typical_seconds',benchmark.effective_seconds,
    'scored_seconds',source_score,
    'benchmark_ready',benchmark_ready,
    'faster_than_typical',beats_typical,
    'meets_quality_bar',beats_typical,
    'seed_best_seconds',seed_best,
    'beats_seed_best',beats_seed_best,
    'circle_best',false,
    'comparable_players',0
  );
end;
$$;

--
-- Name: replay_puzzle_seed; Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replay_puzzle_seed(source_result public.game_stats)
returns text
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    nullif(source_result.seed,''),
    case
      -- Geo/Zoom challenge rounds have always been deterministic, but older
      -- results did not persist that derived seed in game_stats. Reconstruct
      -- exactly the same seed ChallengeGate supplied to the game.
      when source_result.mode='challenge' and source_result.challenge_date is not null then
        source_result.game || '-' || source_result.challenge_date::text ||
        case
          when source_result.circle_challenge_id is not null
            then '-circle-' || source_result.circle_challenge_id::text
          else ''
        end
      else null
    end
  )
$$;

--
-- Name: get_replayable_puzzle; Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_replayable_puzzle(target_stat_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  source_result public.game_stats;
  resolved_seed text;
  allowed boolean:=false;
begin
  select * into source_result
  from public.game_stats
  where id=target_stat_id;

  if not found then
    raise exception 'Puzzle result not found.' using errcode='P0002';
  end if;

  resolved_seed:=public.replay_puzzle_seed(source_result);
  if source_result.game not in ('hive','binary','gridly','minisudoku','geo','zoom')
     or nullif(resolved_seed,'') is null then
    raise exception 'This game result cannot be replayed as the exact same puzzle.' using errcode='22023';
  end if;

  allowed:=source_result.user_id=auth.uid()
    or exists (
      select 1
      from public.direct_messages dm
      where dm.recipient_id=auth.uid()
        and dm.source_stat_id=source_result.id
        and dm.activity_type='puzzle_share'
    );

  if not allowed then
    raise exception 'This puzzle was not shared with you.' using errcode='42501';
  end if;

  return jsonb_build_object(
    'source_stat_id',source_result.id,
    'game',source_result.game,
    'day_index',source_result.day_index,
    'seed',resolved_seed
  );
end;
$$;

--
-- Name: share_puzzle_with_circles; Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.share_puzzle_with_circles(target_stat_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  source_result public.game_stats;
  resolved_seed text;
  sender_name text;
  game_label text;
  eligible_count integer:=0;
  sent_count integer:=0;
begin
  select * into source_result
  from public.game_stats
  where id=target_stat_id;

  if not found or source_result.user_id is distinct from auth.uid() then
    raise exception 'Puzzle result not found.' using errcode='42501';
  end if;

  resolved_seed:=public.replay_puzzle_seed(source_result);
  if source_result.game not in ('hive','binary','gridly','minisudoku','geo','zoom')
     or nullif(resolved_seed,'') is null then
    raise exception 'This game result cannot be shared as the exact same puzzle.' using errcode='22023';
  end if;

  select coalesce(nullif(trim(name),''),'Someone')
  into sender_name
  from public.profiles
  where id=auth.uid();
  sender_name:=coalesce(sender_name,'Someone');

  game_label:=case source_result.game
    when 'hive' then 'Hive'
    when 'binary' then 'Twist'
    when 'gridly' then 'Gridly'
    when 'minisudoku' then 'Sudoku'
    when 'geo' then 'Geo'
    when 'zoom' then 'Zoom'
    else source_result.game
  end;

  with recipients as (
    select distinct other_member.user_id
    from public.circle_members mine
    join public.circle_members other_member
      on other_member.circle_id=mine.circle_id
    join public.profiles profile
      on profile.id=other_member.user_id
    where mine.user_id=auth.uid()
      and other_member.user_id<>auth.uid()
      and profile.account_deleted_at is null
      and coalesce(profile.is_blocked,false)=false
      and coalesce(profile.hidden_from_others,false)=false
      and coalesce(profile.is_approved,true)=true
  )
  select count(*)::integer into eligible_count from recipients;

  with recipients as (
    select distinct other_member.user_id
    from public.circle_members mine
    join public.circle_members other_member
      on other_member.circle_id=mine.circle_id
    join public.profiles profile
      on profile.id=other_member.user_id
    where mine.user_id=auth.uid()
      and other_member.user_id<>auth.uid()
      and profile.account_deleted_at is null
      and coalesce(profile.is_blocked,false)=false
      and coalesce(profile.hidden_from_others,false)=false
      and coalesce(profile.is_approved,true)=true
  ), inserted as (
    insert into public.direct_messages (
      sender_id,
      recipient_id,
      body,
      system_generated,
      activity_type,
      source_stat_id
    )
    select
      auth.uid(),
      recipients.user_id,
      sender_name || ' shared a ' || game_label || ' puzzle. Try the exact same game. [[puzzle:' || source_result.id || ']]',
      true,
      'puzzle_share',
      source_result.id
    from recipients
    where not exists (
      select 1
      from public.direct_messages existing
      where existing.sender_id=auth.uid()
        and existing.recipient_id=recipients.user_id
        and existing.activity_type='puzzle_share'
        and existing.source_stat_id=source_result.id
    )
    returning id
  )
  select count(*)::integer into sent_count from inserted;

  return jsonb_build_object(
    'recipient_count',eligible_count,
    'sent_count',sent_count,
    'source_stat_id',source_result.id
  );
end;
$$;


--
--
-- Name: has_social_unlock(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_social_unlock(uid uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.is_admin(uid) or exists(
    select 1
    from public.player_progress progress
    where progress.player_id=uid
      and (coalesce(progress.current_level,1)>=2 or coalesce(progress.lifetime_points,0)>=500)
  )
$$;


--
-- Name: invite_player_to_circle(uuid, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invite_player_to_circle(target_user_id uuid, target_circle_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  invitation_id bigint;
  inviter_name text;
  circle_name text;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.circle_members
    where circle_id=target_circle_id and user_id=auth.uid()
  ) then
    raise exception 'Only circle members can invite players.' using errcode='42501';
  end if;
  if target_user_id=auth.uid() then raise exception 'You are already on this circle.'; end if;
  if exists(
    select 1 from public.circle_members
    where circle_id=target_circle_id and user_id=target_user_id
  ) then raise exception 'This player is already on the circle.'; end if;
  if exists(
    select 1 from public.circle_member_blocks
    where circle_id=target_circle_id and user_id=target_user_id
  ) then raise exception 'This player cannot be invited to the circle.'; end if;
  if not exists(
    select 1 from public.profiles
    where id=target_user_id
      and account_deleted_at is null
      and coalesce(is_blocked,false)=false
      and coalesce(is_approved,false)=true
      and coalesce(is_private,false)=false
      and coalesce(hidden_from_others,false)=false
  ) then raise exception 'This player is not available for invitations.'; end if;

  insert into public.circle_invitations(circle_id,invited_user_id,invited_by)
  values(target_circle_id,target_user_id,auth.uid())
  on conflict(circle_id,invited_user_id) where status='pending'
  do update set invited_by=excluded.invited_by,created_at=now()
  returning id into invitation_id;

  select name into inviter_name from public.profiles where id=auth.uid();
  select name into circle_name from public.circles where id=target_circle_id;

  delete from public.direct_messages
  where activity_type='circle_invitation'
    and source_stat_id=invitation_id
    and recipient_id=target_user_id;
  insert into public.direct_messages(
    sender_id,recipient_id,body,system_generated,activity_type,source_stat_id
  ) values(
    auth.uid(),target_user_id,
    format('💌 %s invited you to join %s. Tap to respond.',coalesce(inviter_name,'A player'),coalesce(circle_name,'a circle')),
    true,'circle_invitation',invitation_id
  );
end;
$$;


--
-- Name: is_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin(uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((select p.is_admin from public.profiles p where p.id = uid), false);
$$;


--
-- Name: is_approved_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_approved_user(uid uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists(
    select 1 from public.profiles p
    where p.id=uid
      and p.account_deleted_at is null
      and coalesce(p.is_blocked,false)=false
      and (p.is_admin=true or p.is_approved=true)
  )
$$;


--
-- Name: is_available_player(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_available_player(uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists(
    select 1
    from public.profiles profile
    where profile.id=uid
      and profile.account_deleted_at is null
      and coalesce(profile.hidden_from_others,false)=false
      and coalesce(profile.is_blocked,false)=false
      and (profile.is_admin=true or profile.is_approved=true)
  );
$$;


--
-- Name: is_circle_organiser(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_circle_organiser(target_circle_id bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select auth.uid() is not null and exists(
    select 1
    from public.circles c
    where c.id=target_circle_id
      and c.created_by=auth.uid()
  );
$$;


--
-- Name: is_circle_organiser(bigint, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_circle_organiser(target_circle_id bigint, uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.is_admin(uid) or exists(
    select 1 from circles where id=target_circle_id and created_by=uid
  );
$$;


--
-- Name: is_circle_reward_approver(bigint, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_circle_reward_approver(target_circle_id bigint, uid uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select public.is_admin(uid) or exists(
    select 1 from circle_members where circle_id=target_circle_id and user_id=uid and can_approve_rewards=true
  );
$$;


--
-- Name: is_reward_manager(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_reward_manager(uid uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select public.is_admin(uid) or public.is_reward_steward(uid);
$$;


--
-- Name: is_reward_steward(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_reward_steward(uid uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select coalesce((select is_reward_steward from profiles where id=uid),false);
$$;


--
-- Name: is_user_hidden(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_user_hidden(target_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((
    select
      coalesce(profile.hidden_from_others,false)
      or profile.account_deleted_at is not null
    from public.profiles profile
    where profile.id=target_user_id
  ),true);
$$;


--
-- Name: is_user_incognito(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_user_incognito(target_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((
    select p.incognito_mode
    from public.profiles p
    where p.id = target_user_id
  ), false);
$$;


--
-- Name: leave_circle(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.leave_circle(target_circle_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare was_owner boolean; next_owner uuid;
begin
  if not public.is_approved_user(auth.uid()) then raise exception 'Your account must be approved first.' using errcode='42501'; end if;
  select exists(select 1 from public.circles c where c.id=target_circle_id and c.created_by=auth.uid()) into was_owner;
  delete from public.circle_members where circle_id=target_circle_id and user_id=auth.uid();
  if not found then raise exception 'You are not a member of this circle.'; end if;

  select cm.user_id into next_owner from public.circle_members cm
  where cm.circle_id=target_circle_id order by cm.joined_at asc nulls last,cm.user_id limit 1;
  if next_owner is null then
    delete from public.circles where id=target_circle_id;
  elsif was_owner then
    update public.circles set created_by=next_owner where id=target_circle_id;
  end if;
end;
$$;


--
-- Name: list_my_available_rewards(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_my_available_rewards() RETURNS TABLE(id bigint, circle_id bigint, circle_name text, name text, description text, image_url text, points_cost bigint, stock_quantity integer, reward_type text, is_physical boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select rw.id,rw.circle_id,c.name::text,rw.name::text,rw.description::text,rw.image_url::text,rw.points_cost,rw.stock_quantity,rw.reward_type,rw.is_physical
  from rewards rw
  join circles c on c.id=rw.circle_id
  where rw.status='active' and rw.taken_at is null
    and (rw.stock_quantity is null or rw.stock_quantity>0)
    and exists(select 1 from circle_members where circle_id=rw.circle_id and user_id=auth.uid())
  order by rw.points_cost;
$$;


--
-- Name: list_organiser_active_requests(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_organiser_active_requests() RETURNS TABLE(id bigint, reward_id bigint, reward_name text, points_cost bigint, status text, cancellation_requested_at timestamp with time zone, circle_id bigint, circle_name text, player_id uuid, player_name text, player_icon text, requested_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    rr.id,
    rr.reward_id,
    rw.name as reward_name,
    rr.points_cost,
    rr.status,
    rr.cancellation_requested_at,
    rw.circle_id,
    c.name as circle_name,
    rr.player_id,
    coalesce(p.name,'Unknown player') as player_name,
    coalesce(p.icon,'🎮') as player_icon,
    rr.requested_at
  from public.reward_redemptions rr
  join public.rewards rw on rw.id=rr.reward_id
  join public.circles c on c.id=rw.circle_id
  left join public.profiles p on p.id=rr.player_id
  where rr.status in ('requested','approved')
    and public.is_circle_organiser(rw.circle_id)
  order by
    case when rr.cancellation_requested_at is not null then 0 else 1 end,
    rr.requested_at asc;
$$;


--
-- Name: list_organiser_finished_requests(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_organiser_finished_requests() RETURNS TABLE(id bigint, reward_id bigint, reward_name text, points_cost bigint, status text, dispute_reason text, circle_id bigint, circle_name text, player_id uuid, player_name text, player_icon text, requested_at timestamp with time zone, fulfilled_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    rr.id,
    rr.reward_id,
    rw.name as reward_name,
    rr.points_cost,
    rr.status,
    rr.dispute_reason,
    rw.circle_id,
    c.name as circle_name,
    rr.player_id,
    coalesce(p.name,'Unknown player') as player_name,
    coalesce(p.icon,'🎮') as player_icon,
    rr.requested_at,
    rr.fulfilled_at
  from public.reward_redemptions rr
  join public.rewards rw on rw.id=rr.reward_id
  join public.circles c on c.id=rw.circle_id
  left join public.profiles p on p.id=rr.player_id
  where rr.status in ('fulfilled','cancelled','rejected','disputed')
    and public.is_circle_organiser(rw.circle_id)
  order by coalesce(rr.fulfilled_at,rr.reviewed_at,rr.disputed_at,rr.requested_at) desc;
$$;


--
-- Name: list_organiser_ideas(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_organiser_ideas() RETURNS TABLE(id bigint, name text, description text, reward_type text, is_physical boolean, status text, circle_id bigint, circle_name text, creator_id uuid, creator_name text, creator_icon text, approve_count bigint, required_count bigint, has_history boolean, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    rw.id,
    rw.name,
    rw.description,
    rw.reward_type,
    rw.is_physical,
    rw.status,
    rw.circle_id,
    c.name as circle_name,
    rw.created_by as creator_id,
    coalesce(p.name,'Unknown player') as creator_name,
    coalesce(p.icon,'🎮') as creator_icon,
    null::bigint as approve_count,
    null::bigint as required_count,
    exists(
      select 1 from public.reward_redemptions rr where rr.reward_id=rw.id
    ) as has_history,
    rw.created_at
  from public.rewards rw
  join public.circles c on c.id=rw.circle_id
  left join public.profiles p on p.id=rw.created_by
  where rw.status in ('suggested','pending')
    and public.is_circle_organiser(rw.circle_id)
  order by
    case rw.status when 'suggested' then 0 else 1 end,
    rw.created_at desc;
$$;


--
-- Name: list_organiser_reward_catalog(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_organiser_reward_catalog() RETURNS TABLE(id bigint, name text, description text, reward_type text, is_physical boolean, points_cost bigint, stock_quantity integer, status text, circle_id bigint, circle_name text, has_history boolean, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    rw.id,
    rw.name,
    rw.description,
    rw.reward_type,
    rw.is_physical,
    rw.points_cost,
    rw.stock_quantity,
    rw.status,
    rw.circle_id,
    c.name as circle_name,
    exists(
      select 1 from public.reward_redemptions rr where rr.reward_id=rw.id
    ) as has_history,
    rw.created_at
  from public.rewards rw
  join public.circles c on c.id=rw.circle_id
  where rw.status='available'
    and public.is_circle_organiser(rw.circle_id)
  order by rw.updated_at desc nulls last,rw.created_at desc;
$$;


--
-- Name: list_reward_requests(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_reward_requests() RETURNS TABLE(id bigint, player_id uuid, player_name text, player_icon text, reward_id bigint, reward_name text, points_cost bigint, status text, player_note text, dispute_reason text, reviewed_by_name text, reviewed_by_icon text, requested_at timestamp with time zone, reviewed_at timestamp with time zone, fulfilled_at timestamp with time zone, disputed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    reviewer.name::text,
    reviewer.icon::text,
    red.requested_at,
    red.reviewed_at,
    red.fulfilled_at,
    red.disputed_at
  from reward_redemptions red
  join profiles profile on profile.id=red.player_id
  join rewards rw on rw.id=red.reward_id
  left join profiles reviewer on reviewer.id=red.reviewed_by
  where red.player_id=auth.uid() or is_reward_manager(auth.uid())
  order by red.requested_at desc;
end;
$$;


--
-- Name: mark_my_circle_request_updates_seen(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_my_circle_request_updates_seen() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
 update public.circle_join_requests set user_seen_at=now()
 where user_id=auth.uid() and status<>'pending' and user_seen_at is null;
$$;


--
-- Name: mark_my_feedback_seen(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_my_feedback_seen() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.feedback
  set user_seen_at = now()
  where user_id = auth.uid()
    and status = 'closed'
    and user_seen_at is null;
$$;


--
-- Name: mark_my_transfers_seen(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_my_transfers_seen() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.points_transactions set seen_at=now()
  where player_id=auth.uid() and reason_code='TRANSFER_RECEIVED' and seen_at is null;
$$;


--
-- Name: moderate_circle_member(bigint, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.moderate_circle_member(target_circle_id bigint, target_user_id uuid, moderation_action text, moderation_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  circle_owner uuid;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;

  select created_by into circle_owner
  from public.circles
  where id=target_circle_id
  for update;
  if not found then raise exception 'Circle not found.'; end if;

  if auth.uid()<>circle_owner and not public.is_admin(auth.uid()) then
    raise exception 'Only the circle owner or an app administrator can manage members.' using errcode='42501';
  end if;
  if target_user_id=circle_owner then
    raise exception 'The circle owner cannot be removed or blocked.';
  end if;

  if moderation_action='remove' then
    delete from public.circle_members
    where circle_id=target_circle_id and user_id=target_user_id;
    delete from public.circle_join_requests
    where circle_id=target_circle_id and user_id=target_user_id;
  elsif moderation_action='block' then
    delete from public.circle_members
    where circle_id=target_circle_id and user_id=target_user_id;
    delete from public.circle_join_requests
    where circle_id=target_circle_id and user_id=target_user_id;
    insert into public.circle_member_blocks(circle_id,user_id,blocked_by,reason)
    values(target_circle_id,target_user_id,auth.uid(),nullif(btrim(moderation_reason),''))
    on conflict(circle_id,user_id) do update set
      blocked_by=excluded.blocked_by,
      blocked_at=now(),
      reason=excluded.reason;
  elsif moderation_action='unblock' then
    delete from public.circle_member_blocks
    where circle_id=target_circle_id and user_id=target_user_id;
  else
    raise exception 'Invalid circle moderation action.';
  end if;
end;
$$;


--
-- Name: normalise_reward_rules_practice_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalise_reward_rules_practice_limit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.practice_daily_limit:=least(greatest(coalesce(new.practice_daily_limit,3),1),1000);
  return new;
end;
$$;


-- notify_admins_of_pending_profile() deliberately no longer exists. A pending
-- player was announced to admins as a direct message sent *from* that player,
-- but a pending player is by definition excluded from get_messageable_players,
-- so Chats could never render the conversation while the unread badge still
-- counted it — an approval notice that lit up the chat badge permanently and
-- could not be opened or cleared. Admin -> Players already lists everyone
-- waiting for approval, so the notice lives there instead.


--
-- Name: notify_circle_daily_challenge_completed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_circle_daily_challenge_completed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare player_name text; game_label text; notification_body text;
begin
  if new.mode is distinct from 'challenge' or new.challenge_date is null or new.circle_challenge_id is null or new.circle_id is null then return new; end if;
  select coalesce(nullif(btrim(p.name),''),'A teammate') into player_name from public.profiles p where p.id=new.user_id;
  game_label:=case lower(new.game) when 'hive' then 'Hive' when 'binary' then 'Twist' when 'gridly' then 'Gridly' when 'minisudoku' then 'Mini Sudoku' when 'geo' then 'Geo' else initcap(replace(new.game,'_',' ')) end;
  notification_body:=format('🏁 %s finished the %s circle challenge! Think you can beat them? 🎮',coalesce(player_name,'A teammate'),game_label);
  insert into public.direct_messages(sender_id,recipient_id,body,system_generated,activity_type,source_stat_id)
  select new.user_id,cm.user_id,notification_body,true,'circle_daily_challenge',new.id
  from public.circle_members cm where cm.circle_id=new.circle_id and cm.user_id<>new.user_id
  on conflict do nothing;
  return new;
end;$$;


--
-- Name: organiser_decline_idea(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.organiser_decline_idea(target_reward_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare rw rewards;
begin
  select * into rw from rewards where id=target_reward_id for update;
  if not found then raise exception 'Reward not found.'; end if;
  if not public.is_circle_organiser(rw.circle_id,auth.uid()) then
    raise exception 'Only this circle''s organiser can do that.' using errcode='42501';
  end if;
  if rw.status not in ('suggested','pending') then
    raise exception 'This idea has already been decided.';
  end if;
  update rewards set status='rejected',updated_at=now() where id=target_reward_id;
end; $$;


--
-- Name: organiser_make_reward_available(bigint, bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.organiser_make_reward_available(target_reward_id bigint, price_points_cost bigint, stock_quantity_in integer DEFAULT NULL::integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare rw rewards;
begin
  select * into rw from rewards where id=target_reward_id for update;
  if not found then raise exception 'Reward not found.'; end if;
  if not public.is_circle_organiser(rw.circle_id,auth.uid()) then
    raise exception 'Only this circle''s organiser can do that.' using errcode='42501';
  end if;
  if rw.status not in ('suggested','pending') then
    raise exception 'This idea has already been decided.';
  end if;
  if coalesce(price_points_cost,0)<=0 then raise exception 'Enter a points cost.'; end if;
  if rw.reward_type='limited' and coalesce(stock_quantity_in,0)<=0 then
    raise exception 'Enter how many are available.';
  end if;

  update rewards set
    points_cost=price_points_cost,
    stock_quantity=case when rw.reward_type='limited' then stock_quantity_in else null end,
    status='active',
    updated_at=now()
  where id=target_reward_id;
end; $$;


--
-- Name: organiser_start_vote(bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.organiser_start_vote(target_reward_id bigint, price_points_cost bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare rw rewards;
begin
  select * into rw from rewards where id=target_reward_id for update;
  if not found then raise exception 'Reward not found.'; end if;
  if not public.is_circle_organiser(rw.circle_id,auth.uid()) then
    raise exception 'Only this circle''s organiser can do that.' using errcode='42501';
  end if;
  if rw.status<>'suggested' then raise exception 'This idea has already been decided.'; end if;
  if coalesce(price_points_cost,0)<=0 then raise exception 'Enter a points cost.'; end if;

  update rewards set points_cost=price_points_cost,status='pending',updated_at=now() where id=target_reward_id;
end; $$;


--
-- Name: points_level(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.points_level(total bigint) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select greatest(1, floor(sqrt(greatest(total, 0)::numeric / 500))::int + 1);
$$;


--
-- Name: points_level(numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.points_level(total numeric) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select greatest(
    1,
    floor(sqrt(greatest(total,0) / 500))::integer + 1
  );
$$;


--
-- Name: prepare_account_deletion(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prepare_account_deletion(target_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admin only.' using errcode='42501'; end if;
  if target_user_id=auth.uid() then raise exception 'You cannot delete your own account.' using errcode='22023'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and is_admin=true) then raise exception 'Another admin cannot be deleted here.' using errcode='42501'; end if;

  perform public.strip_player_from_circles(target_user_id);

  update public.profiles set
    account_deleted_at=now(), account_deleted_by=auth.uid(),
    is_blocked=false, is_approved=false, hidden_from_others=true,
    blocked_at=null, blocked_by=null, blocked_reason=null,
    approved_at=null, approved_by=null
  where id=target_user_id;
end;
$$;


--
-- Name: strip_player_from_circles(uuid); Type: FUNCTION; Schema: public; Owner: -
--

-- Hands each circle the player owns to its longest-standing other member, or
-- deletes it when they were alone, then removes every membership and request.
-- Shared by admin deletion and self-service deletion so the two cannot drift.
CREATE FUNCTION public.strip_player_from_circles(target_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare circle_row record; replacement uuid;
begin
  for circle_row in select id from public.circles where created_by=target_user_id loop
    select member.user_id into replacement
    from public.circle_members member
    where member.circle_id=circle_row.id and member.user_id<>target_user_id
    order by member.joined_at asc nulls last, member.user_id
    limit 1;
    if replacement is null then
      delete from public.circles where id=circle_row.id;
    else
      update public.circles set created_by=replacement where id=circle_row.id;
      update public.circle_members set can_approve_rewards=true
      where circle_id=circle_row.id and user_id=replacement;
    end if;
    replacement:=null;
  end loop;

  delete from public.circle_members where user_id=target_user_id;
  delete from public.circle_join_requests where user_id=target_user_id;
  delete from public.presence where user_id=target_user_id;
end;
$$;


--
-- Name: delete_my_account(); Type: FUNCTION; Schema: public; Owner: -
--

-- App Store guideline 5.1.1(v): an account created in-app must be deletable
-- in-app. This clears the player's app data and anonymises the profile row.
-- Removing the Auth user (and its stored email / linked Google identity)
-- needs the service role, so the client calls the delete-my-account Edge
-- Function, which invokes this first.
CREATE FUNCTION public.delete_my_account() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare me uuid:=auth.uid();
begin
  if me is null then
    raise exception 'You must be signed in.' using errcode='42501';
  end if;
  if exists(select 1 from public.profiles where id=me and is_admin=true) then
    raise exception 'An administrator account cannot be deleted from the app.'
      using errcode='42501';
  end if;

  perform public.strip_player_from_circles(me);

  delete from public.direct_messages where sender_id=me or recipient_id=me;
  delete from public.player_blocks where blocker_id=me or blocked_id=me;
  delete from public.content_reports where reporter_id=me;

  update public.profiles set
    name='Deleted player',
    icon='🙂',
    mood=null,
    timezone=null,
    account_deleted_at=now(),
    account_deleted_by=me,
    is_approved=false,
    hidden_from_others=true,
    blocked_at=null, blocked_by=null, blocked_reason=null,
    approved_at=null, approved_by=null
  where id=me;
end;
$$;


--
-- Name: prepare_app_email_invitation(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prepare_app_email_invitation(target_email text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  normalized_email text:=lower(btrim(target_email));
  invitation_id bigint;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be active and approved.' using errcode='42501';
  end if;
  if normalized_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.' using errcode='22023';
  end if;
  if (
    select count(*) from public.app_email_invitations
    where inviter_id=auth.uid() and created_at>now()-interval '24 hours'
  )>=5 then
    raise exception 'You can send up to five invitations per day.' using errcode='42900';
  end if;

  insert into public.app_email_invitations(inviter_id,invitee_email)
  values(auth.uid(),normalized_email)
  returning id into invitation_id;
  return invitation_id;
end;
$_$;


--
--
-- Name: propose_reward(bigint, text, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.propose_reward(target_circle_id bigint, reward_name text, reward_description text, reward_image_url text, reward_type text DEFAULT 'reusable'::text, reward_is_physical boolean DEFAULT true) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare new_id bigint;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not (exists(select 1 from circle_members where circle_id=target_circle_id and user_id=auth.uid()) or is_admin(auth.uid())) then
    raise exception 'You are not a member of this circle.' using errcode='42501';
  end if;
  if reward_type not in ('one_time','limited','reusable') then
    raise exception 'Unknown reward type.' using errcode='22023';
  end if;
  if nullif(btrim(reward_name),'') is null then
    raise exception 'Give it a name.' using errcode='22023';
  end if;

  insert into rewards(name,description,image_url,circle_id,status,created_by,reward_type,is_physical)
  values(reward_name,reward_description,reward_image_url,target_circle_id,'suggested',auth.uid(),reward_type,coalesce(reward_is_physical,true))
  returning id into new_id;
  return new_id;
end; $$;


--
-- Name: protect_profile_security_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_profile_security_fields() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null or public.is_admin(auth.uid()) then return new; end if;
  if tg_op='INSERT' then
    new.is_admin:=false; new.is_approved:=false; new.approved_at:=null; new.approved_by:=null;
    new.hidden_from_others:=false; new.is_blocked:=false; new.blocked_at:=null; new.blocked_by:=null;
    new.blocked_reason:=null; new.account_deleted_at:=null; new.account_deleted_by:=null;
  elsif new.is_admin is distinct from old.is_admin
     or new.is_approved is distinct from old.is_approved
     or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by
     or new.hidden_from_others is distinct from old.hidden_from_others
     or new.is_blocked is distinct from old.is_blocked
     or new.blocked_at is distinct from old.blocked_at
     or new.blocked_by is distinct from old.blocked_by
     or new.blocked_reason is distinct from old.blocked_reason
     or new.account_deleted_at is distinct from old.account_deleted_at
     or new.account_deleted_by is distinct from old.account_deleted_by then
    raise exception 'Protected profile fields can only be changed by an admin.' using errcode='42501';
  end if;
  return new;
end;
$$;


--
-- Name: protect_streak(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_streak() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  p public.player_progress;
  today_date date := public.player_today(auth.uid());
  missed_date date := today_date - 1;
begin
  perform public.ensure_player_progress(auth.uid());

  select * into p
  from public.player_progress
  where player_id=auth.uid()
  for update;

  if p.challenge_current_streak<=0
    or p.challenge_last_completed_date is distinct from missed_date-1 then
    raise exception 'No missed day is available to cover';
  end if;
  if p.streak_protected_through is not null
    and p.streak_protected_through>=missed_date then
    raise exception 'This day is already covered';
  end if;
  -- A rest day is earned by a full week of play, not bought. Charging points
  -- to avoid a penalty is the same punishment wearing a different hat.
  if p.challenge_current_streak<7 then
    raise exception 'Keep a 7 day streak going to earn a rest day';
  end if;

  -- One per week. streak_protected_through already records the last one, so no
  -- extra state is needed — without this a player could alternate play day and
  -- rest day indefinitely and still collect the weekly streak bonus.
  if p.streak_protected_through is not null
    and p.streak_protected_through>missed_date-7 then
    raise exception 'You have already used a rest day this week';
  end if;

  update public.player_progress
  set
    streak_protected_through=missed_date,
    updated_at=now()
  where player_id=auth.uid();

  return jsonb_build_object(
    'balance',p.available_points,
    'protected_date',missed_date,
    'cost',0
  );
end;
$$;


--
-- Name: redeem_reward(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.redeem_reward(target_reward_id bigint, note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare rw rewards; p player_progress; red_id bigint;
begin
  select * into rw from rewards where id=target_reward_id and status='active' and taken_at is null for update;
  if not found then raise exception 'Reward unavailable'; end if;
  if not exists(select 1 from circle_members where circle_id=rw.circle_id and user_id=auth.uid()) then
    raise exception 'This reward is not available to you.' using errcode='42501';
  end if;
  if rw.stock_quantity is not null and rw.stock_quantity<=0 then raise exception 'Out of stock'; end if;
  if rw.reward_type in ('one_time','reusable') and exists(
    select 1 from reward_redemptions where reward_id=rw.id and status in ('requested','approved')
  ) then
    raise exception 'Someone else already has this in progress.';
  end if;
  perform ensure_player_progress(auth.uid());
  select * into p from player_progress where player_id=auth.uid() for update;
  if p.available_points<rw.points_cost then raise exception 'Not enough points'; end if;
  update player_progress set available_points=available_points-rw.points_cost,updated_at=now() where player_id=auth.uid();
  if rw.stock_quantity is not null then update rewards set stock_quantity=stock_quantity-1,updated_at=now() where id=rw.id; end if;
  insert into reward_redemptions(player_id,reward_id,points_cost,status,player_note)
    values(auth.uid(),rw.id,rw.points_cost,'requested',note) returning id into red_id;
  insert into points_transactions(player_id,points,reason_code,reward_id,metadata,created_by)
    values(auth.uid(),-rw.points_cost,'REWARD_REDEEMED',rw.id,jsonb_build_object('redemption_id',red_id,'reward_name',rw.name),auth.uid());
  return jsonb_build_object('redemption_id',red_id,'balance',p.available_points-rw.points_cost);
end; $$;


--
-- Name: game_time_benchmarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_time_benchmarks (
    game text NOT NULL,
    day_index integer NOT NULL,
    mode text NOT NULL,
    provisional_seconds integer NOT NULL,
    observed_median_seconds numeric,
    clean_sample_count integer DEFAULT 0 NOT NULL,
    effective_seconds numeric NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    log_mean numeric,
    log_sd numeric,
    CONSTRAINT game_time_benchmarks_day_index_check CHECK (((day_index >= 0) AND (day_index <= 6))),
    CONSTRAINT game_time_benchmarks_mode_check CHECK ((mode = ANY (ARRAY['practice'::text, 'challenge'::text]))),
    CONSTRAINT game_time_benchmarks_provisional_seconds_check CHECK (((provisional_seconds >= 5) AND (provisional_seconds <= 3600)))
);


--
-- Name: refresh_game_time_benchmark(text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_game_time_benchmark(target_game text, target_day_index integer, target_mode text) RETURNS public.game_time_benchmarks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  eligible_players integer:=0;
  qualifying_samples integer:=0;
  community_median numeric;
  pooled_players integer:=0;
  pooled_samples integer:=0;
  pooled_median numeric;
  day_weight numeric:=1;
  spread_mean numeric;
  spread_sd numeric;
  benchmark public.game_time_benchmarks;
begin
  select * into benchmark
  from public.game_time_benchmarks
  where game=target_game
    and day_index=target_day_index
    and mode=target_mode;

  if not found then
    return null;
  end if;

  -- A 90-day community median does not move between one puzzle and the next,
  -- but this used to recompute -- and write -- on every single save and every
  -- share-eligibility check, putting a 90-day scan and a row-level write lock
  -- in the hot path of finishing a game. Recompute at most hourly per
  -- (game, day, mode). To force one, age the row:
  --   update public.game_time_benchmarks set updated_at=now()-interval '1 day';
  if benchmark.updated_at>now()-interval '1 hour' then
    return benchmark;
  end if;

  -- If another session is already refreshing this row, serve the value we
  -- have rather than queueing behind its write. A player's save is never
  -- blocked by someone else's benchmark maintenance.
  if not pg_try_advisory_xact_lock(
    hashtextextended(
      format('benchmark:%s:%s:%s',target_game,target_day_index,target_mode),
      0
    )
  ) then
    return benchmark;
  end if;

  with clean as (
    select stat.user_id,stat.seconds,
      row_number() over(partition by stat.user_id order by stat.completed_at desc,stat.id desc) as recent_rank,
      count(*) over(partition by stat.user_id) as player_sample_count
    from public.game_stats stat
    where stat.game=target_game
      and stat.day_index=target_day_index
      and stat.mode=target_mode
      and stat.completed_at>=now()-interval '90 days'
      and stat.seconds between 5 and 3600
      and coalesce(stat.hints,0)=0
      and (
        -- Quiz games report an answer count, and every question is answered
        -- whatever the result, so a wrong answer costs a tap rather than
        -- minutes. Demanding a flawless round excluded them permanently: Zoom
        -- needs 9-for-9 to qualify, which is rare enough that it had no clean
        -- samples at all and could never leave its seeded guess. A hint still
        -- disqualifies a sample, because a hint genuinely shortens the clock.
        coalesce(stat.total_count,0)>0
        or coalesce(stat.mistakes,0)=0
      )
  ), player_medians as (
    select user_id,
      count(*)::integer as sample_count,
      percentile_cont(0.5) within group(order by seconds) as median_seconds
    from clean
    where player_sample_count>=2 and recent_rank<=5
    group by user_id
  )
  select count(*)::integer,
    coalesce(sum(sample_count),0)::integer,
    percentile_cont(0.5) within group(order by median_seconds)
  into eligible_players,qualifying_samples,community_median
  from player_medians;

  -- The sample set above is per weekday, and that is what actually starved
  -- these benchmarks: a daily challenge offers each weekday once a week, so
  -- qualifying needs two players with two clean results each on the SAME
  -- weekday -- a fortnight of flawless play per weekday, per game. Gridly has
  -- 15 clean results spread over 7 weekdays: about 2 per day, against the 4
  -- required. Lowering the player bar alone would not have helped.
  --
  -- So when a weekday cannot qualify on its own, fall back to the same
  -- calculation pooled across every weekday, then scale the result back onto
  -- this weekday using the seeded Mon->Sun ramp. That uses all 15 samples
  -- instead of 2, and keeps the intended difficulty curve rather than paying
  -- every weekday the same time.
  if eligible_players<2 then
    with clean as (
      select stat.user_id,stat.seconds,
        row_number() over(partition by stat.user_id order by stat.completed_at desc,stat.id desc) as recent_rank,
        count(*) over(partition by stat.user_id) as player_sample_count
      from public.game_stats stat
      where stat.game=target_game
        and stat.mode=target_mode
        and stat.completed_at>=now()-interval '90 days'
        and stat.seconds between 5 and 3600
        and coalesce(stat.hints,0)=0
        and (
          coalesce(stat.total_count,0)>0
          or coalesce(stat.mistakes,0)=0
        )
    ), player_medians as (
      select user_id,
        count(*)::integer as sample_count,
        percentile_cont(0.5) within group(order by seconds) as median_seconds
      from clean
      where player_sample_count>=2 and recent_rank<=10
      group by user_id
    )
    select count(*)::integer,
      coalesce(sum(sample_count),0)::integer,
      percentile_cont(0.5) within group(order by median_seconds)
    into pooled_players,pooled_samples,pooled_median
    from player_medians;

    -- This weekday's share of the game's seeded ramp. Sunday stays harder than
    -- Monday because the provisional values say so, not because of thin data.
    select case
      when coalesce(avg(other.provisional_seconds),0)>0
        then benchmark.provisional_seconds/avg(other.provisional_seconds)
      else 1
    end
    into day_weight
    from public.game_time_benchmarks other
    where other.game=target_game
      and other.mode=target_mode;

    if pooled_players>=2 and pooled_median is not null then
      eligible_players:=pooled_players;
      qualifying_samples:=pooled_samples;
      community_median:=pooled_median*coalesce(day_weight,1);
    end if;
  end if;

  -- The score is now counted in spreads, not ratios, so the benchmark has to
  -- carry the spread as well as the middle. Measured over ln(effective
  -- seconds) -- the clock divided by the share of answers that were right --
  -- and pooled across weekdays, because per-weekday samples are far too thin
  -- to estimate a standard deviation from.
  select avg(ln(value)),stddev_samp(ln(value))
  into spread_mean,spread_sd
  from (
    select public.effective_round_seconds(
      stat.seconds,stat.hints,stat.mistakes,
      coalesce(nullif(benchmark.effective_seconds,0),100),
      stat.correct_count,stat.total_count
    ) as value
    from public.game_stats stat
    where stat.game=target_game
      and stat.mode=target_mode
      and stat.completed_at>=now()-interval '90 days'
      and stat.seconds between 5 and 3600
  ) sample;

  update public.game_time_benchmarks current_benchmark
  set observed_median_seconds=case when eligible_players>=2 then community_median else null end,
      clean_sample_count=case when eligible_players>=2 then qualifying_samples else 0 end,
      -- effective_seconds carries no CHECK of its own, and it is a divisor in
      -- every score. Hold it to the same 5..3600 range provisional_seconds is
      -- constrained to, so a thin or skewed sample cannot round it to zero.
      effective_seconds=case
        when eligible_players>=2 and community_median is not null
          then greatest(5,least(3600,round(community_median)))
        else current_benchmark.provisional_seconds
      end,
      -- Below a usable sample a standard deviation is noise; leave it null
      -- and circle_challenge_daily_score() falls back to the ratio rule.
      log_mean=case when spread_sd is not null and spread_sd>0.01 then spread_mean else null end,
      log_sd=case when spread_sd is not null and spread_sd>0.01 then spread_sd else null end,
      updated_at=now()
  where current_benchmark.game=target_game
    and current_benchmark.day_index=target_day_index
    and current_benchmark.mode=target_mode
  returning * into benchmark;

  return benchmark;
end;
$$;


--
-- Name: reject_hidden_animal_rush_player(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_hidden_animal_rush_player() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.left_at is null and public.is_user_hidden(new.user_id) then
    raise exception 'This player is not available for live games.'
      using errcode='42501';
  end if;
  return new;
end;
$$;


--
--
-- Name: reopen_feedback_item(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reopen_feedback_item(target_feedback_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin only.' using errcode='42501';
  end if;
  update public.feedback
  set status='open',admin_comment=null,closed_at=null,user_seen_at=null
  where id=target_feedback_id and deleted_at is null;
  if not found then raise exception 'Feedback not found.'; end if;

  delete from public.direct_messages
  where activity_type='feedback_completed'
    and source_stat_id=target_feedback_id;
end;
$$;


--
-- Name: request_cancel_redemption(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_cancel_redemption(target_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare red reward_redemptions;
begin
  select * into red from reward_redemptions where id=target_id and player_id=auth.uid() for update;
  if not found then raise exception 'Redemption not found'; end if;
  if red.status<>'requested' then
    raise exception 'This can no longer be cancelled directly — it''s already %.', red.status;
  end if;
  update reward_redemptions set cancellation_requested_at=now() where id=target_id;
end; $$;


--
-- Name: request_circle_join(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_circle_join(target_circle_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if exists(select 1 from public.profiles where id=auth.uid() and coalesce(hidden_from_others,false)) then
    raise exception 'Hidden players cannot join circles';
  end if;
  if exists(select 1 from public.circle_member_blocks where circle_id=target_circle_id and user_id=auth.uid()) then
    raise exception 'You cannot request access to this circle.';
  end if;
  if exists(select 1 from public.circle_members where circle_id=target_circle_id and user_id=auth.uid()) then
    raise exception 'You are already a member';
  end if;
  delete from public.circle_join_requests where circle_id=target_circle_id and user_id=auth.uid() and status<>'pending';
  insert into public.circle_join_requests(circle_id,user_id,status)
  values(target_circle_id,auth.uid(),'pending')
  on conflict do nothing;
end;
$$;


--
-- Name: require_approved_actor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.require_approved_actor() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account is waiting for admin approval.' using errcode='42501';
  end if;
  return new;
end;
$$;


--
-- Name: resolve_cancellation(bigint, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_cancellation(target_id bigint, approve boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare red reward_redemptions; rw rewards;
begin
  select * into red from reward_redemptions where id=target_id for update;
  if not found then raise exception 'Redemption not found'; end if;
  select * into rw from rewards where id=red.reward_id;
  if not (public.is_reward_manager(auth.uid()) or public.is_circle_organiser(rw.circle_id,auth.uid())) then
    raise exception 'Only this circle''s organiser can do that.' using errcode='42501';
  end if;
  if red.cancellation_requested_at is null then raise exception 'No cancellation was requested.'; end if;
  if red.status<>'requested' then raise exception 'This request is already %', red.status; end if;

  if approve then
    update player_progress set available_points=available_points+red.points_cost,updated_at=now() where player_id=red.player_id;
    insert into points_transactions(player_id,points,reason_code,reward_id,metadata,created_by)
      values(red.player_id,red.points_cost,'REWARD_REFUND',red.reward_id,jsonb_build_object('redemption_id',red.id),auth.uid());
    update rewards set stock_quantity=stock_quantity+1 where id=red.reward_id and stock_quantity is not null;
    update reward_redemptions set status='cancelled',reviewed_by=auth.uid(),reviewed_at=now() where id=target_id;
  else
    update reward_redemptions set cancellation_requested_at=null where id=target_id;
  end if;
end; $$;


--
-- Name: retire_unavailable_player_messages(); Type: FUNCTION; Schema: public; Owner: -
--

-- Deleting an account and banning a player are both permanent, so neither may
-- leave unread notifications sitting in someone's badge forever. A player
-- blocking another player is deliberately NOT handled here: that is reversible
-- and the direct_messages select policy already hides those rows both ways.
--
-- Marked read rather than deleted — content_reports references these rows, so
-- removing them would destroy the evidence behind a moderation report.
CREATE FUNCTION public.retire_unavailable_player_messages() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if (old.account_deleted_at is null and new.account_deleted_at is not null)
     or (coalesce(old.is_blocked,false)=false and coalesce(new.is_blocked,false)=true) then
    update public.direct_messages
    set read_at=coalesce(read_at,now())
    where sender_id=new.id and read_at is null;
  end if;
  return new;
end;
$$;


--
-- Name: review_redemption(bigint, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.review_redemption(target_id bigint, new_status text, admin_note_in text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare red reward_redemptions; rw rewards;
begin
  select * into red from reward_redemptions where id=target_id for update;
  if not found then raise exception 'Redemption not found'; end if;
  select * into rw from rewards where id=red.reward_id;
  if not (public.is_reward_manager(auth.uid()) or public.is_circle_organiser(rw.circle_id,auth.uid())) then
    raise exception 'Only this circle''s organiser can do that.' using errcode='42501';
  end if;
  if new_status not in ('approved','declined','fulfilled') then raise exception 'Invalid status'; end if;
  if red.status not in ('requested','approved','disputed') then
    raise exception 'This request is already %', red.status;
  end if;
  if new_status='declined' and red.status not in ('declined','cancelled') then
    update player_progress set available_points=available_points+red.points_cost,updated_at=now() where player_id=red.player_id;
    insert into points_transactions(player_id,points,reason_code,reward_id,metadata,created_by)
      values(red.player_id,red.points_cost,'REWARD_REFUND',red.reward_id,jsonb_build_object('redemption_id',red.id),auth.uid());
    update rewards set stock_quantity=stock_quantity+1 where id=red.reward_id and stock_quantity is not null;
  end if;
  if new_status='fulfilled' and rw.reward_type='one_time' then
    update rewards set taken_at=now() where id=rw.id;
  end if;
  update reward_redemptions set status=new_status,admin_note=admin_note_in,reviewed_by=auth.uid(),reviewed_at=now(),
    fulfilled_at=case when new_status='fulfilled' then now() else fulfilled_at end,
    dispute_reason=case when new_status='fulfilled' then null else dispute_reason end,
    disputed_at=case when new_status='fulfilled' then null else disputed_at end,
    cancellation_requested_at=case when new_status='fulfilled' then null else cancellation_requested_at end
    where id=target_id;
end; $$;


--
--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    name text NOT NULL,
    icon text DEFAULT '🙂'::text,
    is_private boolean DEFAULT false NOT NULL,
    mood text,
    is_admin boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    hidden_from_others boolean DEFAULT false NOT NULL,
    default_mode text DEFAULT 'challenge'::text NOT NULL,
    show_stats_to_others boolean DEFAULT true NOT NULL,
    week_starts_on integer DEFAULT 1 NOT NULL,
    timezone text,
    is_approved boolean DEFAULT false NOT NULL,
    approved_at timestamp with time zone,
    approved_by uuid,
    is_blocked boolean DEFAULT false NOT NULL,
    blocked_at timestamp with time zone,
    blocked_by uuid,
    blocked_reason text,
    account_deleted_at timestamp with time zone,
    account_deleted_by uuid,
    auth_deleted_at timestamp with time zone,
    theme_preference text DEFAULT 'system'::text NOT NULL,
    incognito_mode boolean DEFAULT false NOT NULL,
    is_reward_steward boolean DEFAULT false NOT NULL,
    CONSTRAINT profiles_default_mode_check CHECK ((default_mode = ANY (ARRAY['challenge'::text, 'practice'::text]))),
    CONSTRAINT profiles_theme_preference_check CHECK ((theme_preference = ANY (ARRAY['system'::text, 'light'::text, 'dark'::text])))
);


--
-- Name: save_my_profile(text, text, boolean, text, text, boolean, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_my_profile(profile_name text DEFAULT NULL::text, profile_icon text DEFAULT NULL::text, profile_is_private boolean DEFAULT NULL::boolean, profile_mood text DEFAULT NULL::text, profile_default_mode text DEFAULT NULL::text, profile_show_stats boolean DEFAULT NULL::boolean, profile_week_starts_on integer DEFAULT NULL::integer, profile_theme_preference text DEFAULT NULL::text) RETURNS public.profiles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result public.profiles;
  clean_name text := nullif(btrim(profile_name),'');
begin
  if auth.uid() is null then raise exception 'You must be signed in.' using errcode='42501'; end if;
  if profile_name is not null and clean_name is null then raise exception 'Name is required.' using errcode='22023'; end if;
  if profile_default_mode is not null and profile_default_mode not in ('practice','challenge') then raise exception 'Invalid default mode.' using errcode='22023'; end if;
  if profile_week_starts_on is not null and profile_week_starts_on not in (0,1) then raise exception 'Invalid week start.' using errcode='22023'; end if;
  if profile_theme_preference is not null and profile_theme_preference not in ('system','light','dark') then raise exception 'Invalid theme preference.' using errcode='22023'; end if;

  if clean_name is not null and exists(
    select 1 from public.profiles p
    where p.id<>auth.uid() and p.account_deleted_at is null and lower(btrim(p.name))=lower(clean_name)
  ) then
    raise exception 'That player name is already taken. Choose another one.' using errcode='23505';
  end if;

  if not exists(select 1 from public.profiles where id=auth.uid()) and clean_name is null then
    raise exception 'Name is required.' using errcode='22023';
  end if;

  insert into public.profiles(id,name,icon,is_private,mood,default_mode,show_stats_to_others,week_starts_on,theme_preference,is_admin,is_approved)
  values(auth.uid(),clean_name,coalesce(nullif(profile_icon,''),'🙂'),coalesce(profile_is_private,false),nullif(btrim(profile_mood),''),coalesce(profile_default_mode,'challenge'),coalesce(profile_show_stats,true),coalesce(profile_week_starts_on,1),coalesce(profile_theme_preference,'system'),false,false)
  on conflict(id) do update set
    name=coalesce(clean_name,public.profiles.name),
    icon=coalesce(nullif(profile_icon,''),public.profiles.icon),
    is_private=coalesce(profile_is_private,public.profiles.is_private),
    mood=case when profile_mood is null then public.profiles.mood else nullif(btrim(profile_mood),'') end,
    default_mode=coalesce(profile_default_mode,public.profiles.default_mode),
    show_stats_to_others=coalesce(profile_show_stats,public.profiles.show_stats_to_others),
    week_starts_on=coalesce(profile_week_starts_on,public.profiles.week_starts_on),
    theme_preference=coalesce(profile_theme_preference,public.profiles.theme_preference)
  returning * into result;
  return result;
exception when unique_violation then
  raise exception 'That player name is already taken. Choose another one.' using errcode='23505';
end;
$$;


--
-- Name: scored_game_seconds(integer, integer, integer, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scored_game_seconds(elapsed_seconds integer, hint_count integer, mistake_count integer, typical_seconds numeric) RETURNS numeric
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  select greatest(coalesce(elapsed_seconds,0),0)::numeric
    + greatest(coalesce(hint_count,0),0)::numeric
      * greatest(coalesce(typical_seconds,1),1) * 0.20
    + greatest(coalesce(mistake_count,0),0)::numeric
      * greatest(coalesce(typical_seconds,1),1) * 0.10
$$;


--
--
-- Name: send_direct_message(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.send_direct_message(target_recipient_id uuid, message_body text) RETURNS TABLE(id bigint, sender_id uuid, recipient_id uuid, body text, created_at timestamp with time zone, read_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
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
  if public.is_blocked_between(current_sender_id,target_recipient_id) then
    raise exception 'You can no longer message this player.' using errcode='42501';
  end if;
  -- Messaging is scoped to people you already share a circle with, so the app
  -- has no stranger-contact surface. Admins stay reachable either way: users
  -- need a way to contact support about content they have reported.
  if not public.is_admin(current_sender_id)
     and not public.is_admin(target_recipient_id)
     and not public.players_share_circle(current_sender_id,target_recipient_id) then
    raise exception 'You can only message players in one of your circles.'
      using errcode='42501';
  end if;

  return query
  insert into public.direct_messages as message(sender_id,recipient_id,body)
  values(current_sender_id,target_recipient_id,cleaned_body)
  returning message.id,message.sender_id,message.recipient_id,message.body,message.created_at,message.read_at;
end;
$$;


--
-- Name: set_circle_challenge_stake(bigint, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_circle_challenge_stake(target_challenge_id bigint, target_reward_id bigint, split_method text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare challenge public.circle_weekly_challenges;
begin
  select * into challenge from public.circle_weekly_challenges where id=target_challenge_id for update;
  if not found then raise exception 'Challenge not found.'; end if;
  if not exists(select 1 from public.circles where id=challenge.circle_id and created_by=auth.uid()) then
    raise exception 'Only the circle owner can set a stake.' using errcode='42501';
  end if;
  if challenge.locked_at is not null or challenge.closed_at is not null then
    raise exception 'This challenge is already in progress and is locked.' using errcode='55000';
  end if;
  if split_method not in ('equal','ranked') then raise exception 'Invalid split method.'; end if;
  if not exists(select 1 from public.rewards where id=target_reward_id and status='active' and circle_id=challenge.circle_id) then
    raise exception 'Choose an approved item that belongs to this circle.';
  end if;

  update public.circle_weekly_challenges set
    stake_reward_id=target_reward_id,
    stake_split_method=split_method,
    reward_type='points',
    reward_points=0,
    reward_label=null,
    updated_at=now()
  where id=target_challenge_id;

  delete from public.circle_challenge_stake_acceptances where challenge_id=target_challenge_id;
end; $$;


--
--
-- Name: set_circle_weekly_challenge(bigint, text[], integer[], integer, text, text, bigint, text, boolean, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_circle_weekly_challenge(target_circle_id bigint, selected_games text[], selected_days integer[], reward_points_in integer DEFAULT 0, reward_type_in text DEFAULT 'points'::text, reward_label_in text DEFAULT NULL::text, target_challenge_id bigint DEFAULT NULL::bigint, challenge_title_in text DEFAULT NULL::text, repeat_weekly_in boolean DEFAULT NULL::boolean, duration_weeks_in integer DEFAULT NULL::integer, reward_goes_to_in text DEFAULT 'winner'::text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  current_challenge public.circle_weekly_challenges;
  result_id bigint;
  series_key bigint;
  week_offset integer;
  clean_games text[];
  clean_days integer[];
  clean_title text:=nullif(btrim(challenge_title_in),'');
  clean_reward_type text:=coalesce(nullif(btrim(reward_type_in),''),'points');
  clean_goes_to text:=case
    when coalesce(nullif(btrim(reward_type_in),''),'points')='prize'
      and btrim(coalesce(reward_goes_to_in,''))='loser'
    then 'loser' else 'winner' end;
  clean_duration integer;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not exists(
    select 1
    from public.circles
    where id=target_circle_id and created_by=auth.uid()
  ) then
    raise exception 'Only the circle owner can manage challenges.' using errcode='42501';
  end if;
  if repeat_weekly_in is null then
    raise exception 'Choose whether this challenge runs once or repeats weekly.';
  end if;

  clean_duration:=case
    when repeat_weekly_in then coalesce(duration_weeks_in,0)
    else 1
  end;

  if repeat_weekly_in and clean_duration not between 2 and 52 then
    raise exception 'Choose a repeat duration between 2 and 52 weeks.';
  end if;

  select array_agg(game order by first_position)
  into clean_games
  from (
    select game,min(selected.ordinality) as first_position
    from unnest(selected_games) with ordinality selected(game,ordinality)
    where game in ('hive','binary','gridly','minisudoku','geo','zoom')
    group by game
  ) valid_games;

  select array_agg(distinct day order by day)
  into clean_days
  from unnest(selected_days) day
  where day between 1 and 7;

  if coalesce(cardinality(clean_games),0)=0 then
    raise exception 'Choose at least one game.';
  end if;
  if coalesce(cardinality(clean_days),0)=0 then
    raise exception 'Choose at least one playing day.';
  end if;
  if clean_title is null then
    raise exception 'Enter a challenge name.';
  end if;
  if char_length(clean_title)>60 then
    raise exception 'Challenge names can be up to 60 characters.';
  end if;
  if coalesce(reward_points_in,0) not between 0 and 50 then
    raise exception 'A circle challenge winner''s prize must be between 0 and 50 points.';
  end if;
  if clean_reward_type not in ('points','prize') then
    raise exception 'Invalid reward type.';
  end if;
  if clean_reward_type='prize'
     and nullif(btrim(reward_label_in),'') is null then
    raise exception 'Enter the prize.';
  end if;

  if target_challenge_id is not null then
    select *
    into current_challenge
    from public.circle_weekly_challenges
    where id=target_challenge_id
      and circle_id=target_circle_id
      and week_start=public.circle_week_start(target_circle_id)
      and closed_at is null
    for update;

    if not found then
      raise exception 'Challenge not found.';
    end if;
    if current_challenge.locked_at is not null
       or exists(
         select 1
         from public.circle_challenge_starts
         where challenge_id=current_challenge.id
       )
       or exists(
         select 1
         from public.game_stats
         where circle_challenge_id=current_challenge.id
       ) then
      update public.circle_weekly_challenges
      set locked_at=coalesce(locked_at,now())
      where id=current_challenge.id;
      raise exception 'This challenge is already in progress and is locked.'
        using errcode='55000';
    end if;

    series_key:=coalesce(current_challenge.series_id,current_challenge.id);

    if exists(
      select 1
      from public.circle_weekly_challenges future_challenge
      where future_challenge.series_id=series_key
        and future_challenge.week_start>=public.circle_week_start(target_circle_id)
        and (
          future_challenge.locked_at is not null
          or exists(
            select 1
            from public.circle_challenge_starts future_start
            where future_start.challenge_id=future_challenge.id
          )
          or exists(
            select 1
            from public.game_stats future_result
            where future_result.circle_challenge_id=future_challenge.id
          )
        )
    ) then
      raise exception 'A scheduled week in this series has already started.'
        using errcode='55000';
    end if;

    delete from public.circle_weekly_challenges
    where series_id=series_key
      and week_start>=public.circle_week_start(target_circle_id);
  else
    series_key:=null;
  end if;

  for week_offset in 0..clean_duration-1 loop
    if (
      select count(*)
      from public.circle_weekly_challenges
      where circle_id=target_circle_id
        and week_start=public.circle_week_start(target_circle_id)+(week_offset*7)
    )>=10 then
      raise exception 'A circle can create up to 10 challenges in any week.';
    end if;

    insert into public.circle_weekly_challenges(
      circle_id,
      week_start,
      title,
      game_ids,
      active_days,
      reward_points,
      reward_type,
      reward_label,
      reward_goes_to,
      locked_at,
      created_by,
      series_id,
      repeats_weekly,
      series_weeks,
      occurrence_number,
      closed_at
    )
    values(
      target_circle_id,
      public.circle_week_start(target_circle_id)+(week_offset*7),
      clean_title,
      clean_games,
      clean_days,
      case when clean_reward_type='points'
        then greatest(coalesce(reward_points_in,0),0)
        else 0
      end,
      clean_reward_type,
      case when clean_reward_type='prize'
        then nullif(btrim(reward_label_in),'')
        else null
      end,
      clean_goes_to,
      null,
      auth.uid(),
      series_key,
      repeat_weekly_in,
      clean_duration,
      week_offset+1,
      null
    )
    returning id into result_id;

    if series_key is null then
      series_key:=result_id;
      update public.circle_weekly_challenges
      set series_id=series_key
      where id=result_id;
    end if;

    if week_offset=0 then
      target_challenge_id:=result_id;
    end if;
  end loop;

  return target_challenge_id;
end;
$$;


--
-- Name: set_release_note_hidden(bigint, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_release_note_hidden(target_release_note_id bigint, hidden boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only administrators can change release-note visibility';
  end if;

  update public.release_notes
  set is_hidden = hidden
  where id = target_release_note_id;

  if not found then
    raise exception 'Release note % was not found', target_release_note_id;
  end if;
end;
$$;


--
-- Name: set_user_approval(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_user_approval(target_user_id uuid, approved boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin only.' using errcode='42501';
  end if;
  if target_user_id=auth.uid() and approved=false then
    raise exception 'You cannot revoke your own approval.' using errcode='22023';
  end if;
  update public.profiles
  set is_approved=approved,
      approved_at=case when approved then now() else null end,
      approved_by=case when approved then auth.uid() else null end
  where id=target_user_id and is_admin=false;
end;
$$;


--
-- Name: set_user_hidden(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_user_hidden(target_user_id uuid, hidden boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) then
    update public.profiles set hidden_from_others = hidden where id = target_user_id;
  end if;
end;
$$;


--
-- Name: set_user_reward_steward(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_user_reward_steward(target_user_id uuid, steward boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin only.' using errcode='42501';
  end if;
  update public.profiles set is_reward_steward=steward where id=target_user_id;
end; $$;


--
-- Name: start_circle_challenge_game(bigint, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_circle_challenge_game(target_challenge_id bigint, target_game text, target_challenge_date date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  challenge public.circle_weekly_challenges;
  assigned_round public.circle_challenge_rounds;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.'
      using errcode='42501';
  end if;

  select *
  into challenge
  from public.circle_weekly_challenges
  where id=target_challenge_id;

  if not found then
    raise exception 'Circle challenge not found.' using errcode='22023';
  end if;
  if challenge.closed_at is not null then
    raise exception 'This circle challenge is finished.' using errcode='55000';
  end if;
  if not exists(
    select 1
    from public.circle_members member
    where member.circle_id=challenge.circle_id
      and member.user_id=auth.uid()
  ) then
    raise exception 'You are not a member of this circle.' using errcode='42501';
  end if;
  -- A staked challenge splits the cost of an item between the players; a prize
  -- challenge hands a real-world obligation to the winner or the loser. Both
  -- commit a player to something the app cannot enforce and cannot undo, so
  -- both need that player's agreement before they play. Points challenges award
  -- in-app points and put nobody on the hook, so they stay ungated.
  if (challenge.stake_reward_id is not null or challenge.reward_type='prize')
    and not exists(
      select 1 from public.circle_challenge_stake_acceptances a
      where a.challenge_id=challenge.id and a.user_id=auth.uid()
    ) then
    raise exception 'Accept what this challenge puts at stake before playing today''s round.' using errcode='42501';
  end if;
  if target_challenge_date is distinct from public.circle_today(challenge.circle_id) then
    raise exception 'Circle challenge rounds can only be played on their scheduled day.'
      using errcode='22023';
  end if;

  perform public.ensure_circle_challenge_rounds(challenge.id);

  select *
  into assigned_round
  from public.circle_challenge_rounds
  where challenge_id=challenge.id
    and challenge_date=target_challenge_date;

  if not found then
    raise exception 'This circle challenge has no round scheduled today.'
      using errcode='22023';
  end if;
  if assigned_round.game is distinct from target_game then
    raise exception 'Today''s assigned game is %.',assigned_round.game
      using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format(
        'circle-challenge-round:%s:%s:%s',
        challenge.id,
        auth.uid(),
        target_challenge_date
      ),
      0
    )
  );

  if exists(
    select 1
    from public.game_stats result
    where result.circle_challenge_id=challenge.id
      and result.user_id=auth.uid()
      and result.challenge_date=target_challenge_date
  ) then
    raise exception 'You already completed today''s challenge round.'
      using errcode='23505';
  end if;

  insert into public.circle_challenge_starts(
    challenge_id,player_id,game,challenge_date
  )
  values(
    challenge.id,auth.uid(),assigned_round.game,target_challenge_date
  )
  on conflict do nothing;

  update public.circle_weekly_challenges
  set locked_at=coalesce(locked_at,now())
  where id=challenge.id;
end;
$$;


--
-- Name: sync_circle_challenge_rounds(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_circle_challenge_rounds() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op='UPDATE'
     and (
       old.week_start is distinct from new.week_start
       or old.game_ids is distinct from new.game_ids
       or old.active_days is distinct from new.active_days
     )
     and not exists(
       select 1 from public.circle_challenge_starts
       where challenge_id=new.id
     )
     and not exists(
       select 1 from public.game_stats
       where circle_challenge_id=new.id
     ) then
    delete from public.circle_challenge_rounds
    where challenge_id=new.id;
  end if;

  perform public.ensure_circle_challenge_rounds(new.id);
  return new;
end;
$$;


--
-- Name: toggle_direct_message_reaction(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.toggle_direct_message_reaction(target_message_id bigint, reaction_in text) RETURNS TABLE(result_user_id uuid, result_reaction text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  current_user_id uuid:=auth.uid();
  existing_reaction text;
  selected_reaction text;
begin
  if not public.is_approved_user(current_user_id) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if reaction_in not in ('like','dislike','love') then
    raise exception 'Invalid message reaction.' using errcode='22023';
  end if;
  if not exists (
    select 1
    from public.direct_messages dm
    where dm.id=target_message_id
      and current_user_id in (dm.sender_id,dm.recipient_id)
  ) then
    raise exception 'Message not found.' using errcode='42501';
  end if;

  select dmr.reaction into existing_reaction
  from public.direct_message_reactions dmr
  where dmr.message_id=target_message_id
    and dmr.user_id=current_user_id;

  if existing_reaction=reaction_in then
    delete from public.direct_message_reactions dmr
    where dmr.message_id=target_message_id
      and dmr.user_id=current_user_id;
    selected_reaction:=null;
  else
    insert into public.direct_message_reactions as dmr(message_id,user_id,reaction)
    values(target_message_id,current_user_id,reaction_in)
    on conflict(message_id,user_id) do update set
      reaction=excluded.reaction,
      updated_at=now();
    selected_reaction:=reaction_in;
  end if;

  return query select current_user_id,selected_reaction;
end;
$$;


--
-- Name: toggle_release_note_reaction(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.toggle_release_note_reaction(target_release_note_id bigint, target_reaction text) RETURNS TABLE(user_reaction text, up_count bigint, down_count bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  current_user_id uuid := auth.uid();
  existing_reaction text;
begin
  if current_user_id is null then
    raise exception 'You must be signed in to react';
  end if;

  if target_reaction not in ('up', 'down') then
    raise exception 'Invalid reaction';
  end if;

  if not exists (
    select 1 from public.release_notes n
    where n.id = target_release_note_id
      and (n.is_hidden = false or public.is_admin(current_user_id))
  ) then
    raise exception 'Release note not found';
  end if;

  select r.reaction
    into existing_reaction
  from public.release_note_reactions r
  where r.release_note_id = target_release_note_id
    and r.user_id = current_user_id;

  if existing_reaction = target_reaction then
    delete from public.release_note_reactions
    where release_note_id = target_release_note_id
      and user_id = current_user_id;
    existing_reaction := null;
  elsif existing_reaction is null then
    insert into public.release_note_reactions (release_note_id, user_id, reaction)
    values (target_release_note_id, current_user_id, target_reaction);
    existing_reaction := target_reaction;
  else
    update public.release_note_reactions
    set reaction = target_reaction
    where release_note_id = target_release_note_id
      and user_id = current_user_id;
    existing_reaction := target_reaction;
  end if;

  return query
  select
    existing_reaction,
    count(*) filter (where r.reaction = 'up')::bigint,
    count(*) filter (where r.reaction = 'down')::bigint
  from public.release_note_reactions r
  where r.release_note_id = target_release_note_id
    and public.can_view_user(r.user_id);
end;
$$;


--
-- Name: transfer_circle_ownership(bigint, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transfer_circle_ownership(target_circle_id bigint, new_owner_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare circle_owner uuid;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  select created_by into circle_owner from public.circles where id=target_circle_id for update;
  if not found then raise exception 'Circle not found.'; end if;
  if auth.uid()<>circle_owner and not public.is_admin(auth.uid()) then
    raise exception 'Only the circle owner or an app administrator can transfer ownership.' using errcode='42501';
  end if;
  if not exists(select 1 from public.circle_members where circle_id=target_circle_id and user_id=new_owner_user_id) then
    raise exception 'That person is not a member of this circle.';
  end if;
  if new_owner_user_id=circle_owner then
    raise exception 'That person already owns this circle.';
  end if;

  update public.circles set created_by=new_owner_user_id where id=target_circle_id;
  update public.circle_members set can_approve_rewards=true where circle_id=target_circle_id and user_id=new_owner_user_id;
end; $$;


--
-- Name: transfer_points(uuid, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transfer_points(target_player_id uuid, amount bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: update_challenge_streak_from_game(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_challenge_streak_from_game() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  played_date date;
  p public.player_progress;
  next_streak integer;
begin
  if new.mode is distinct from 'challenge' then
    return new;
  end if;

  played_date := coalesce(
    new.challenge_date,
    (new.completed_at at time zone public.resolve_timezone(
      (select profile.timezone from public.profiles profile where profile.id=new.user_id)
    ))::date
  );

  perform public.ensure_player_progress(new.user_id);
  select * into p
  from public.player_progress
  where player_id = new.user_id
  for update;

  if p.challenge_last_completed_date is not null
     and p.challenge_last_completed_date < played_date - 1 then
    perform public.apply_challenge_streak_break(new.user_id, played_date - 1);
    select * into p
    from public.player_progress
    where player_id = new.user_id
    for update;
  end if;

  if p.challenge_last_completed_date = played_date then
    return new;
  elsif p.challenge_last_completed_date = played_date - 1 then
    next_streak := p.challenge_current_streak + 1;
  else
    next_streak := 1;
  end if;

  update public.player_progress
  set challenge_current_streak = next_streak,
      challenge_longest_streak = greatest(challenge_longest_streak, next_streak),
      challenge_last_completed_date = played_date,
      updated_at = now()
  where player_id = new.user_id;

  return new;
end;
$$;


--
--
-- Name: validate_circle_challenge_attempt(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_circle_challenge_attempt() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  challenge public.circle_weekly_challenges;
  assigned_round public.circle_challenge_rounds;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.'
      using errcode='42501';
  end if;
  if new.user_id is distinct from auth.uid() then
    raise exception 'You can only save your own result.' using errcode='42501';
  end if;
  if new.mode is distinct from 'challenge'
     or new.circle_challenge_id is null then
    return new;
  end if;

  select *
  into challenge
  from public.circle_weekly_challenges
  where id=new.circle_challenge_id;

  if not found then
    raise exception 'Circle challenge not found.';
  end if;
  if challenge.closed_at is not null then
    raise exception 'This circle challenge is finished.' using errcode='55000';
  end if;
  if new.circle_id is distinct from challenge.circle_id then
    raise exception 'Circle challenge does not match the selected circle.';
  end if;
  if not exists(
    select 1
    from public.circle_members member
    where member.circle_id=challenge.circle_id
      and member.user_id=new.user_id
  ) then
    raise exception 'You are not a member of this circle.';
  end if;

  perform public.ensure_circle_challenge_rounds(challenge.id);

  select *
  into assigned_round
  from public.circle_challenge_rounds
  where challenge_id=challenge.id
    and challenge_date=new.challenge_date;

  if not found
     or assigned_round.game is distinct from new.game then
    raise exception 'This is not the game assigned to that challenge round.';
  end if;
  if not exists(
    select 1
    from public.circle_challenge_starts challenge_start
    where challenge_start.challenge_id=challenge.id
      and challenge_start.player_id=new.user_id
      and challenge_start.game=assigned_round.game
      and challenge_start.challenge_date=assigned_round.challenge_date
  ) then
    raise exception 'Start this circle challenge from the challenge screen first.'
      using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format(
        'circle-challenge-round:%s:%s:%s',
        challenge.id,
        new.user_id,
        new.challenge_date
      ),
      0
    )
  );

  if exists(
    select 1
    from public.game_stats result
    where result.circle_challenge_id=challenge.id
      and result.user_id=new.user_id
      and result.challenge_date=new.challenge_date
      and result.id is distinct from new.id
  ) then
    raise exception 'You already completed this challenge round.'
      using errcode='23505';
  end if;

  update public.circle_weekly_challenges
  set locked_at=coalesce(locked_at,now())
  where id=challenge.id;

  return new;
end;
$$;


--
-- Name: validate_circle_challenge_games(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_circle_challenge_games() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if exists (
    select 1
    from unnest(coalesce(new.game_ids, array[]::text[])) selected(game_id)
    left join public.game_config config
      on config.game_id = selected.game_id
    where coalesce(config.challenge_enabled, false) = false
  ) then
    raise exception 'One or more selected games are not available in Challenges.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;


--
-- Name: validate_game_stat_actor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_game_stat_actor() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if new.user_id is distinct from auth.uid() then
    raise exception 'You can only save your own result.' using errcode='42501';
  end if;
  if new.circle_challenge_id is null then new.circle_id:=null; end if;

  -- seconds, hints and mistakes all arrive from the browser and drive points,
  -- benchmarks and standings. Reject the physically impossible rather than
  -- trusting the client; the bounds are deliberately wide so ordinary play is
  -- never refused.
  if new.seconds is null or new.seconds < 1 or new.seconds > 86400 then
    raise exception 'That result has an implausible time.' using errcode='22023';
  end if;
  if coalesce(new.hints,0) < 0 or coalesce(new.hints,0) > 1000
     or coalesce(new.mistakes,0) < 0 or coalesce(new.mistakes,0) > 1000 then
    raise exception 'That result has an implausible hint or mistake count.'
      using errcode='22023';
  end if;

  if new.mode='challenge' then
    -- game_stats_one_challenge_per_day is a partial unique index on
    -- (user_id, game, challenge_date). NULLs compare as distinct, so a
    -- challenge row without a date sidesteps the once-per-day rule entirely.
    if new.challenge_date is null then
      raise exception 'A challenge result must record which day it belongs to.'
        using errcode='22023';
    end if;

    -- Circle rounds are already pinned to their scheduled day by
    -- validate_circle_challenge_attempt, but the personal challenge had no
    -- date bound at all: a crafted insert could claim a week of unplayed days
    -- and the streak milestone built on them. Allow the catch-up the UI
    -- offers (any earlier day of the current week) plus a day of slack for
    -- players whose local date runs ahead of Sydney.
    if new.challenge_date < public.player_today(new.user_id) - 7
       or new.challenge_date > public.player_today(new.user_id) + 1 then
      raise exception 'Challenge results can only be saved for the current week.'
        using errcode='22023';
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: vote_on_reward(bigint, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vote_on_reward(target_reward_id bigint, approve boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare rw rewards; member_count int; approve_count int; required_count int;
begin
  select * into rw from rewards where id=target_reward_id for update;
  if not found then raise exception 'Reward not found.'; end if;
  if rw.status<>'pending' then raise exception 'This idea is not open for voting.'; end if;
  if not exists(select 1 from circle_members where circle_id=rw.circle_id and user_id=auth.uid()) then
    raise exception 'You are not a member of this circle.' using errcode='42501';
  end if;

  insert into reward_approvals(reward_id,approver_id,decision)
  values(target_reward_id,auth.uid(),case when approve then 'approve' else 'reject' end)
  on conflict(reward_id,approver_id) do update set decision=excluded.decision;

  select count(*) into member_count from circle_members where circle_id=rw.circle_id;
  select count(*) into approve_count from reward_approvals where reward_id=target_reward_id and decision='approve';
  required_count:=floor(member_count::numeric/2)+1;

  if approve_count>=required_count then
    update rewards set status='active',updated_at=now() where id=target_reward_id;
  end if;
end; $$;


--
-- Name: animal_rush_attempt_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.animal_rush_attempt_history (
    id bigint NOT NULL,
    room_id uuid,
    match_number integer NOT NULL,
    round_number integer NOT NULL,
    difficulty text NOT NULL,
    target_animal text NOT NULL,
    selected_animal text NOT NULL,
    correct boolean NOT NULL,
    reaction_ms integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    colour_mode text,
    CONSTRAINT animal_rush_attempt_history_colour_mode_check CHECK (((colour_mode IS NULL) OR (colour_mode = ANY (ARRAY['uniform'::text, 'individual'::text, 'mixed'::text])))),
    CONSTRAINT animal_rush_attempt_history_difficulty_check CHECK ((difficulty = ANY (ARRAY['easy'::text, 'standard'::text, 'hard'::text])))
);


--
-- Name: animal_rush_attempt_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.animal_rush_attempt_history ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.animal_rush_attempt_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: animal_rush_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.animal_rush_attempts (
    room_id uuid NOT NULL,
    round_number integer NOT NULL,
    user_id uuid NOT NULL,
    selected_animal text NOT NULL,
    correct boolean NOT NULL,
    reaction_ms integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT animal_rush_attempts_reaction_ms_check CHECK ((reaction_ms >= 0)),
    CONSTRAINT animal_rush_attempts_round_number_check CHECK ((round_number > 0)),
    CONSTRAINT animal_rush_attempts_selected_animal_check CHECK ((selected_animal = ANY (ARRAY['fox'::text, 'panda'::text, 'owl'::text, 'rabbit'::text, 'lion'::text, 'frog'::text])))
);


--
-- Name: animal_rush_match_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.animal_rush_match_results (
    id bigint NOT NULL,
    room_id uuid,
    match_number integer NOT NULL,
    user_id uuid NOT NULL,
    placement smallint NOT NULL,
    won boolean DEFAULT false NOT NULL,
    rounds_won integer DEFAULT 0 NOT NULL,
    wrong_taps integer DEFAULT 0 NOT NULL,
    cards_held integer DEFAULT 0 NOT NULL,
    safety_cards integer DEFAULT 0 NOT NULL,
    finished_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT animal_rush_match_results_cards_held_check CHECK ((cards_held >= 0)),
    CONSTRAINT animal_rush_match_results_match_number_check CHECK ((match_number > 0)),
    CONSTRAINT animal_rush_match_results_placement_check CHECK (((placement >= 1) AND (placement <= 6))),
    CONSTRAINT animal_rush_match_results_rounds_won_check CHECK ((rounds_won >= 0)),
    CONSTRAINT animal_rush_match_results_safety_cards_check CHECK ((safety_cards >= 0)),
    CONSTRAINT animal_rush_match_results_wrong_taps_check CHECK ((wrong_taps >= 0))
);


--
-- Name: animal_rush_match_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.animal_rush_match_results ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.animal_rush_match_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: animal_rush_players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.animal_rush_players (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    player_name text NOT NULL,
    player_icon text,
    safety_cards smallint DEFAULT 2 NOT NULL,
    won_cards smallint DEFAULT 0 NOT NULL,
    rounds_won integer DEFAULT 0 NOT NULL,
    wrong_taps integer DEFAULT 0 NOT NULL,
    eliminated boolean DEFAULT false NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    left_at timestamp with time zone,
    ready_at timestamp with time zone,
    clock_rtt_ms integer,
    CONSTRAINT animal_rush_players_rounds_won_check CHECK ((rounds_won >= 0)),
    CONSTRAINT animal_rush_players_safety_cards_check CHECK (((safety_cards >= 0) AND (safety_cards <= 2))),
    CONSTRAINT animal_rush_players_won_cards_check CHECK ((won_cards >= 0)),
    CONSTRAINT animal_rush_players_wrong_taps_check CHECK ((wrong_taps >= 0))
);


--
-- Name: app_email_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_email_invitations (
    id bigint NOT NULL,
    inviter_id uuid NOT NULL,
    invitee_email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone
);


--
-- Name: app_email_invitations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.app_email_invitations ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.app_email_invitations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: challenge_reset_point_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenge_reset_point_credits (
    id bigint NOT NULL,
    player_id uuid NOT NULL,
    game text NOT NULL,
    challenge_date date NOT NULL,
    points_transaction_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: challenge_reset_point_credits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.challenge_reset_point_credits ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.challenge_reset_point_credits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: circle_challenge_reward_awards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.circle_challenge_reward_awards (
    id bigint NOT NULL,
    challenge_id bigint NOT NULL,
    player_id uuid NOT NULL,
    points integer NOT NULL,
    awarded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT team_challenge_reward_awards_points_check CHECK ((points >= 0))
);


--
-- Name: circle_challenge_rounds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.circle_challenge_rounds (
    challenge_id bigint NOT NULL,
    challenge_date date NOT NULL,
    game text NOT NULL,
    round_number integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT circle_challenge_rounds_game_check CHECK ((game = ANY (ARRAY['hive'::text, 'binary'::text, 'gridly'::text, 'minisudoku'::text, 'geo'::text, 'zoom'::text]))),
    CONSTRAINT team_challenge_rounds_round_number_check CHECK (((round_number >= 1) AND (round_number <= 7)))
);


--
-- Name: circle_challenge_stake_acceptances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.circle_challenge_stake_acceptances (
    challenge_id bigint NOT NULL,
    user_id uuid NOT NULL,
    accepted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: circle_challenge_starts; Type: TABLE; Schema: public; Owner: -
--

-- When each attempt's clock started. Re-entering a round returns the original
-- timestamp, so leaving mid-game cannot rewind the stopwatch.
CREATE TABLE public.challenge_attempt_starts (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    player_id uuid NOT NULL,
    attempt_key text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: circle_challenge_starts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.circle_challenge_starts (
    id bigint NOT NULL,
    challenge_id bigint NOT NULL,
    player_id uuid NOT NULL,
    game text NOT NULL,
    challenge_date date NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: circle_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.circle_invitations (
    id bigint NOT NULL,
    circle_id bigint NOT NULL,
    invited_user_id uuid NOT NULL,
    invited_by uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    CONSTRAINT team_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text])))
);


--
-- Name: circle_join_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.circle_join_requests (
    id bigint NOT NULL,
    circle_id bigint NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by uuid,
    user_seen_at timestamp with time zone,
    CONSTRAINT team_join_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text])))
);


--
-- Name: circle_member_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.circle_member_blocks (
    circle_id bigint NOT NULL,
    user_id uuid NOT NULL,
    blocked_by uuid,
    blocked_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text
);


--
-- Name: circle_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.circle_members (
    circle_id bigint NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now(),
    can_approve_rewards boolean DEFAULT false NOT NULL
);


--
-- Name: circle_weekly_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.circle_weekly_challenges (
    id bigint NOT NULL,
    circle_id bigint NOT NULL,
    week_start date NOT NULL,
    game_ids text[] DEFAULT ARRAY['hive'::text, 'binary'::text, 'gridly'::text, 'minisudoku'::text, 'geo'::text, 'zoom'::text] NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    active_days integer[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7] NOT NULL,
    reward_points integer DEFAULT 50 NOT NULL,
    locked_at timestamp with time zone,
    reward_type text DEFAULT 'points'::text NOT NULL,
    reward_label text,
    title text DEFAULT 'Weekly challenge'::text NOT NULL,
    series_id bigint,
    repeats_weekly boolean DEFAULT false NOT NULL,
    series_weeks integer DEFAULT 1 NOT NULL,
    occurrence_number integer DEFAULT 1 NOT NULL,
    closed_at timestamp with time zone,
    stake_reward_id bigint,
    stake_split_method text,
    reward_goes_to text DEFAULT 'winner'::text NOT NULL,
    loser_id uuid,
    CONSTRAINT team_weekly_challenges_occurrence_number_check CHECK (((occurrence_number >= 1) AND (occurrence_number <= series_weeks))),
    CONSTRAINT team_weekly_challenges_reward_points_check CHECK (((reward_points >= 0) AND (reward_points <= 50))),
    CONSTRAINT team_weekly_challenges_reward_type_check CHECK ((reward_type = ANY (ARRAY['points'::text, 'prize'::text]))),
    CONSTRAINT team_weekly_challenges_series_weeks_check CHECK (((series_weeks >= 1) AND (series_weeks <= 52))),
    CONSTRAINT circle_weekly_challenges_reward_goes_to_check CHECK ((reward_goes_to = ANY (ARRAY['winner'::text, 'loser'::text]))),
    CONSTRAINT team_weekly_challenges_stake_split_method_check CHECK (((stake_split_method IS NULL) OR (stake_split_method = ANY (ARRAY['equal'::text, 'ranked'::text]))))
);


--
-- Name: direct_message_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.direct_message_reactions (
    message_id bigint NOT NULL,
    user_id uuid NOT NULL,
    reaction text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT direct_message_reactions_reaction_check CHECK ((reaction = ANY (ARRAY['like'::text, 'dislike'::text, 'love'::text])))
);


--
-- Name: direct_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.direct_messages (
    id bigint NOT NULL,
    sender_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    system_generated boolean DEFAULT false NOT NULL,
    activity_type text,
    source_stat_id bigint,
    CONSTRAINT direct_messages_body_length_check CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 1000))),
    CONSTRAINT direct_messages_not_to_self CHECK (((sender_id <> recipient_id) OR system_generated))
);


--
-- Name: direct_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.direct_messages ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.direct_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: player_blocks; Type: TABLE; Schema: public; Owner: -
--

-- Player-to-player blocking, distinct from profiles.is_blocked (an admin
-- suspending an account) and circle_member_blocks (an organiser removing
-- someone from one circle). App Store guideline 1.2 requires that any app
-- with user-generated content lets a user block another user directly.
CREATE TABLE public.player_blocks (
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT player_blocks_not_self CHECK ((blocker_id <> blocked_id))
);


--
-- Name: content_reports; Type: TABLE; Schema: public; Owner: -
--

-- Guideline 1.2 also requires a reporting mechanism with a timely response.
-- Reports are visible to app admins only; the reporter can see their own.
CREATE TABLE public.content_reports (
    id bigint NOT NULL,
    reporter_id uuid NOT NULL,
    reported_user_id uuid,
    message_id bigint,
    reason text NOT NULL,
    details text,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    CONSTRAINT content_reports_details_length CHECK (((details IS NULL) OR (char_length(btrim(details)) <= 1000))),
    CONSTRAINT content_reports_reason_check CHECK ((reason = ANY (ARRAY['abuse'::text, 'harassment'::text, 'spam'::text, 'sexual'::text, 'other'::text]))),
    CONSTRAINT content_reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'actioned'::text, 'dismissed'::text]))),
    CONSTRAINT content_reports_target_present CHECK (((reported_user_id IS NOT NULL) OR (message_id IS NOT NULL)))
);


--
-- Name: content_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.content_reports ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.content_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback (
    id bigint NOT NULL,
    user_id uuid,
    title text NOT NULL,
    description text,
    status text DEFAULT 'open'::text NOT NULL,
    admin_comment text,
    created_at timestamp with time zone DEFAULT now(),
    closed_at timestamp with time zone,
    deleted_at timestamp with time zone,
    updated_at timestamp with time zone,
    user_seen_at timestamp with time zone
);


--
-- Name: feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.feedback ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.feedback_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: feedback_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback_votes (
    feedback_id bigint NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: game_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_config (
    game_id text NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    available boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    hint_cooldown_base integer DEFAULT 0 NOT NULL,
    hint_cooldown_per_day integer DEFAULT 0 NOT NULL,
    zip_path_style text DEFAULT 'solid'::text NOT NULL,
    zip_grid_sizes integer[] DEFAULT ARRAY[7, 7, 7, 7, 7, 7, 7] NOT NULL,
    zip_checkpoint_counts integer[] DEFAULT ARRAY[4, 6, 8, 10, 12, 14, 16] NOT NULL,
    zip_wall_counts integer[] DEFAULT ARRAY[0, 1, 2, 3, 5, 6, 7] NOT NULL,
    zip_black_hole_counts integer[] DEFAULT ARRAY[0, 0, 0, 0, 0, 0, 0] NOT NULL,
    zip_tunnel_pair_counts integer[] DEFAULT ARRAY[0, 0, 0, 0, 0, 1, 1] NOT NULL,
    challenge_enabled boolean DEFAULT false NOT NULL,
    rush_spin_seconds integer DEFAULT 14 NOT NULL,
    CONSTRAINT game_config_rush_spin_seconds_check CHECK (((rush_spin_seconds >= 0) AND (rush_spin_seconds <= 120))),
    CONSTRAINT game_config_zip_black_hole_counts_check CHECK (((cardinality(zip_black_hole_counts) = 7) AND (0 <= ALL (zip_black_hole_counts)) AND (20 >= ALL (zip_black_hole_counts)))),
    CONSTRAINT game_config_zip_checkpoint_counts_check CHECK (((cardinality(zip_checkpoint_counts) = 7) AND (2 <= ALL (zip_checkpoint_counts)) AND (30 >= ALL (zip_checkpoint_counts)))),
    CONSTRAINT game_config_zip_grid_sizes_check CHECK (((cardinality(zip_grid_sizes) = 7) AND (4 <= ALL (zip_grid_sizes)) AND (9 >= ALL (zip_grid_sizes)))),
    CONSTRAINT game_config_zip_path_style_check CHECK ((zip_path_style = ANY (ARRAY['solid'::text, 'rainbow'::text]))),
    CONSTRAINT game_config_zip_tunnel_pair_counts_check CHECK (((cardinality(zip_tunnel_pair_counts) = 7) AND (0 <= ALL (zip_tunnel_pair_counts)) AND (4 >= ALL (zip_tunnel_pair_counts)))),
    CONSTRAINT game_config_zip_wall_counts_check CHECK (((cardinality(zip_wall_counts) = 7) AND (0 <= ALL (zip_wall_counts)) AND (30 >= ALL (zip_wall_counts))))
);


--
-- Name: game_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_stats (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    game text NOT NULL,
    day_index integer NOT NULL,
    seconds integer NOT NULL,
    mistakes integer DEFAULT 0 NOT NULL,
    hints integer DEFAULT 0 NOT NULL,
    mode text DEFAULT 'practice'::text NOT NULL,
    challenge_date date,
    difficulty_rating integer,
    completed_at timestamp with time zone DEFAULT now(),
    circle_challenge_id bigint,
    circle_id bigint,
    correct_count integer,
    total_count integer,
    rounds_nailed integer,
    zip_backtracked_cells integer,
    zip_required_moves integer,
    seed text,
    generator_version text,
    generator_config jsonb,
    CONSTRAINT game_stats_correct_count_nonnegative CHECK (((correct_count IS NULL) OR (correct_count >= 0))),
    CONSTRAINT game_stats_correct_within_total CHECK (((correct_count IS NULL) OR (total_count IS NULL) OR (correct_count <= total_count))),
    CONSTRAINT game_stats_rounds_nailed_nonnegative CHECK (((rounds_nailed IS NULL) OR (rounds_nailed >= 0))),
    CONSTRAINT game_stats_total_count_positive CHECK (((total_count IS NULL) OR (total_count > 0))),
    CONSTRAINT game_stats_zip_backtracked_cells_nonnegative CHECK (((zip_backtracked_cells IS NULL) OR (zip_backtracked_cells >= 0))),
    CONSTRAINT game_stats_zip_required_moves_positive CHECK (((zip_required_moves IS NULL) OR (zip_required_moves > 0)))
);


--
-- Name: COLUMN game_stats.seed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_stats.seed IS 'Deterministic puzzle-attempt seed used to reproduce the exact board or quiz.';


--
-- Name: COLUMN game_stats.generator_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_stats.generator_version IS 'Version of the game generator that interpreted seed and generator_config.';


--
-- Name: COLUMN game_stats.generator_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.game_stats.generator_config IS 'Immutable generation settings needed to reproduce the completed puzzle.';


--
-- Name: game_stats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.game_stats ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.game_stats_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: points_economy_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.points_economy_versions (
    version text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: points_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.points_transactions (
    id bigint NOT NULL,
    player_id uuid NOT NULL,
    points bigint NOT NULL,
    reason_code text NOT NULL,
    game_stat_id bigint,
    related_player_id uuid,
    reward_id bigint,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    seen_at timestamp with time zone,
    CONSTRAINT points_transactions_admin_adjustment_range CHECK (((reason_code <> 'ADMIN_ADJUSTMENT'::text) OR ((points >= '-5000'::integer) AND (points <= 5000))))
);


--
-- Name: points_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.points_transactions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.points_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pokes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pokes (
    id bigint NOT NULL,
    from_user uuid,
    to_user uuid NOT NULL,
    message text,
    created_at timestamp with time zone DEFAULT now(),
    seen boolean DEFAULT false NOT NULL
);


--
-- Name: pokes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pokes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pokes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: presence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.presence (
    user_id uuid NOT NULL,
    game text,
    last_seen timestamp with time zone DEFAULT now(),
    mode text,
    CONSTRAINT presence_mode_check CHECK (((mode IS NULL) OR (mode = ANY (ARRAY['challenge'::text, 'practice'::text, 'live'::text]))))
);


--
-- Name: release_note_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.release_note_reactions (
    release_note_id bigint NOT NULL,
    user_id uuid NOT NULL,
    reaction text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT release_note_reactions_reaction_check CHECK ((reaction = ANY (ARRAY['up'::text, 'down'::text])))
);


--
-- Name: release_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.release_notes (
    id bigint NOT NULL,
    title text NOT NULL,
    body text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    external_id text,
    version text,
    is_hidden boolean DEFAULT false NOT NULL
);


--
-- Name: release_notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.release_notes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.release_notes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: reward_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward_approvals (
    id bigint NOT NULL,
    reward_id bigint NOT NULL,
    approver_id uuid NOT NULL,
    decision text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reward_approvals_decision_check CHECK ((decision = ANY (ARRAY['approve'::text, 'reject'::text])))
);


--
-- Name: reward_approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.reward_approvals ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.reward_approvals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: reward_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward_redemptions (
    id bigint NOT NULL,
    player_id uuid NOT NULL,
    reward_id bigint NOT NULL,
    points_cost bigint NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    player_note text,
    admin_note text,
    reviewed_by uuid,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    fulfilled_at timestamp with time zone,
    dispute_reason text,
    disputed_at timestamp with time zone,
    cancellation_requested_at timestamp with time zone,
    CONSTRAINT reward_redemptions_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'approved'::text, 'declined'::text, 'fulfilled'::text, 'disputed'::text, 'cancelled'::text])))
);


--
-- Name: reward_redemptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.reward_redemptions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.reward_redemptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: reward_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward_rules (
    id bigint NOT NULL,
    name text DEFAULT 'Default'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    base_points integer DEFAULT 6 NOT NULL,
    no_hint_bonus integer DEFAULT 0 NOT NULL,
    no_mistake_bonus integer DEFAULT 0 NOT NULL,
    hint_penalty integer DEFAULT 2 NOT NULL,
    mistake_penalty integer DEFAULT 1 NOT NULL,
    fast_time_bonus integer DEFAULT 2 NOT NULL,
    average_time_bonus integer DEFAULT 1 NOT NULL,
    challenge_bonus integer DEFAULT 0 NOT NULL,
    streak_daily_bonus integer DEFAULT 0 NOT NULL,
    streak_bonus_cap integer DEFAULT 70 NOT NULL,
    minimum_points integer DEFAULT 2 NOT NULL,
    maximum_points integer DEFAULT 15 NOT NULL,
    practice_daily_limit integer DEFAULT 3 NOT NULL,
    streak_protection_cost integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    streak_weekly_bonus integer DEFAULT 100 NOT NULL,
    practice_points_percent integer DEFAULT 50 NOT NULL,
    day_points_step integer DEFAULT 1 NOT NULL,
    daily_points_cap integer DEFAULT 40 NOT NULL,
    CONSTRAINT reward_rules_average_time_bonus_range CHECK (((average_time_bonus >= 0) AND (average_time_bonus <= 200))),
    CONSTRAINT reward_rules_base_points_range CHECK (((base_points >= 0) AND (base_points <= 500))),
    CONSTRAINT reward_rules_challenge_bonus_range CHECK (((challenge_bonus >= 0) AND (challenge_bonus <= 200))),
    CONSTRAINT reward_rules_day_points_step_range CHECK (((day_points_step >= 1) AND (day_points_step <= 50))),
    CONSTRAINT reward_rules_fast_time_bonus_range CHECK (((fast_time_bonus >= 0) AND (fast_time_bonus <= 200))),
    CONSTRAINT reward_rules_hint_penalty_range CHECK (((hint_penalty >= 0) AND (hint_penalty <= 200))),
    CONSTRAINT reward_rules_maximum_points_range CHECK (((maximum_points >= 0) AND (maximum_points <= 1000))),
    CONSTRAINT reward_rules_minimum_points_range CHECK (((minimum_points >= 0) AND (minimum_points <= 500))),
    CONSTRAINT reward_rules_mistake_penalty_range CHECK (((mistake_penalty >= 0) AND (mistake_penalty <= 200))),
    CONSTRAINT reward_rules_no_hint_bonus_range CHECK (((no_hint_bonus >= 0) AND (no_hint_bonus <= 200))),
    CONSTRAINT reward_rules_no_mistake_bonus_range CHECK (((no_mistake_bonus >= 0) AND (no_mistake_bonus <= 200))),
    CONSTRAINT reward_rules_points_order CHECK ((maximum_points >= minimum_points)),
    CONSTRAINT reward_rules_practice_points_percent_range CHECK (((practice_points_percent >= 10) AND (practice_points_percent <= 90))),
    CONSTRAINT reward_rules_streak_bonus_cap_range CHECK (((streak_bonus_cap >= 0) AND (streak_bonus_cap <= 500))),
    CONSTRAINT reward_rules_streak_daily_bonus_range CHECK (((streak_daily_bonus >= 0) AND (streak_daily_bonus <= 200))),
    CONSTRAINT reward_rules_streak_protection_cost_range CHECK (((streak_protection_cost >= 0) AND (streak_protection_cost <= 5000))),
    CONSTRAINT reward_rules_streak_weekly_bonus_range CHECK (((streak_weekly_bonus >= 0) AND (streak_weekly_bonus <= 500)))
);


--
-- Name: reward_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.reward_rules ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.reward_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: rewards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rewards (
    id bigint NOT NULL,
    name text NOT NULL,
    description text,
    image_url text,
    points_cost bigint,
    stock_quantity integer,
    requires_approval boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    circle_id bigint NOT NULL,
    reward_type text DEFAULT 'reusable'::text NOT NULL,
    is_physical boolean DEFAULT true NOT NULL,
    taken_at timestamp with time zone,
    CONSTRAINT rewards_points_cost_check CHECK (((points_cost IS NULL) OR (points_cost > 0))),
    CONSTRAINT rewards_reward_type_check CHECK ((reward_type = ANY (ARRAY['one_time'::text, 'limited'::text, 'reusable'::text]))),
    CONSTRAINT rewards_status_check CHECK ((status = ANY (ARRAY['suggested'::text, 'pending'::text, 'active'::text, 'rejected'::text]))),
    CONSTRAINT rewards_stock_quantity_check CHECK (((stock_quantity IS NULL) OR (stock_quantity >= 0)))
);


--
-- Name: rewards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.rewards ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.rewards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: score_challenge_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.score_challenge_recipients (
    challenge_id bigint NOT NULL,
    recipient_id uuid NOT NULL,
    completed_stat_id bigint,
    completed_at timestamp with time zone
);


--
-- Name: score_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.score_challenges (
    id bigint NOT NULL,
    source_stat_id bigint NOT NULL,
    challenger_id uuid NOT NULL,
    game text NOT NULL,
    seed text NOT NULL,
    generator_version text,
    generator_config jsonb,
    day_index integer NOT NULL,
    seconds integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    hints integer DEFAULT 0 NOT NULL,
    mistakes integer DEFAULT 0 NOT NULL,
    typical_seconds numeric,
    scored_seconds numeric,
    CONSTRAINT score_challenges_game_check CHECK ((game = ANY (ARRAY['hive'::text, 'binary'::text, 'gridly'::text, 'minisudoku'::text]))),
    CONSTRAINT score_challenges_seconds_check CHECK ((seconds >= 0))
);


--
-- Name: score_challenges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.score_challenges ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.score_challenges_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: team_challenge_reward_awards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.circle_challenge_reward_awards ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.team_challenge_reward_awards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: team_challenge_starts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.circle_challenge_starts ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.team_challenge_starts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: team_invitations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.circle_invitations ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.team_invitations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: team_join_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.circle_join_requests ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.team_join_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: team_weekly_challenges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.circle_weekly_challenges ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.team_weekly_challenges_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: teams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.circles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.teams_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_section_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_section_views (
    user_id uuid NOT NULL,
    section text NOT NULL,
    viewed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: animal_rush_attempt_history animal_rush_attempt_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_attempt_history
    ADD CONSTRAINT animal_rush_attempt_history_pkey PRIMARY KEY (id);


--
-- Name: animal_rush_attempts animal_rush_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_attempts
    ADD CONSTRAINT animal_rush_attempts_pkey PRIMARY KEY (room_id, round_number, user_id);


--
-- Name: animal_rush_match_results animal_rush_match_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_match_results
    ADD CONSTRAINT animal_rush_match_results_pkey PRIMARY KEY (id);


--
-- Name: animal_rush_match_results animal_rush_match_results_room_id_match_number_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_match_results
    ADD CONSTRAINT animal_rush_match_results_room_id_match_number_user_id_key UNIQUE (room_id, match_number, user_id);


--
-- Name: animal_rush_players animal_rush_players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_players
    ADD CONSTRAINT animal_rush_players_pkey PRIMARY KEY (room_id, user_id);


--
-- Name: animal_rush_rooms animal_rush_rooms_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_rooms
    ADD CONSTRAINT animal_rush_rooms_code_key UNIQUE (code);


--
-- Name: animal_rush_rooms animal_rush_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_rooms
    ADD CONSTRAINT animal_rush_rooms_pkey PRIMARY KEY (id);


--
-- Name: app_email_invitations app_email_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_email_invitations
    ADD CONSTRAINT app_email_invitations_pkey PRIMARY KEY (id);


--
-- Name: challenge_reset_point_credits challenge_reset_point_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_reset_point_credits
    ADD CONSTRAINT challenge_reset_point_credits_pkey PRIMARY KEY (id);


--
-- Name: challenge_reset_point_credits challenge_reset_point_credits_points_transaction_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_reset_point_credits
    ADD CONSTRAINT challenge_reset_point_credits_points_transaction_id_key UNIQUE (points_transaction_id);


--
-- Name: direct_message_reactions direct_message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_message_reactions
    ADD CONSTRAINT direct_message_reactions_pkey PRIMARY KEY (message_id, user_id);


--
-- Name: direct_messages direct_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_messages
    ADD CONSTRAINT direct_messages_pkey PRIMARY KEY (id);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: feedback_votes feedback_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_votes
    ADD CONSTRAINT feedback_votes_pkey PRIMARY KEY (feedback_id, user_id);


--
-- Name: game_config game_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_config
    ADD CONSTRAINT game_config_pkey PRIMARY KEY (game_id);


--
-- Name: game_stats game_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_stats
    ADD CONSTRAINT game_stats_pkey PRIMARY KEY (id);


--
-- Name: game_time_benchmarks game_time_benchmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_time_benchmarks
    ADD CONSTRAINT game_time_benchmarks_pkey PRIMARY KEY (game, day_index, mode);


--
-- Name: player_progress player_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_progress
    ADD CONSTRAINT player_progress_pkey PRIMARY KEY (player_id);


--
-- Name: points_economy_versions points_economy_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_economy_versions
    ADD CONSTRAINT points_economy_versions_pkey PRIMARY KEY (version);


--
-- Name: points_transactions points_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_pkey PRIMARY KEY (id);


--
-- Name: pokes pokes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pokes
    ADD CONSTRAINT pokes_pkey PRIMARY KEY (id);


--
-- Name: presence presence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presence
    ADD CONSTRAINT presence_pkey PRIMARY KEY (user_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: release_note_reactions release_note_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_note_reactions
    ADD CONSTRAINT release_note_reactions_pkey PRIMARY KEY (release_note_id, user_id);


--
-- Name: release_notes release_notes_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_notes
    ADD CONSTRAINT release_notes_external_id_key UNIQUE (external_id);


--
-- Name: release_notes release_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_notes
    ADD CONSTRAINT release_notes_pkey PRIMARY KEY (id);


--
-- Name: reward_approvals reward_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_approvals
    ADD CONSTRAINT reward_approvals_pkey PRIMARY KEY (id);


--
-- Name: reward_approvals reward_approvals_reward_id_approver_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_approvals
    ADD CONSTRAINT reward_approvals_reward_id_approver_id_key UNIQUE (reward_id, approver_id);


--
-- Name: reward_redemptions reward_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_redemptions
    ADD CONSTRAINT reward_redemptions_pkey PRIMARY KEY (id);


--
-- Name: reward_rules reward_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_rules
    ADD CONSTRAINT reward_rules_pkey PRIMARY KEY (id);


--
-- Name: rewards rewards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rewards
    ADD CONSTRAINT rewards_pkey PRIMARY KEY (id);


--
-- Name: score_challenge_recipients score_challenge_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_challenge_recipients
    ADD CONSTRAINT score_challenge_recipients_pkey PRIMARY KEY (challenge_id, recipient_id);


--
-- Name: score_challenges score_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_challenges
    ADD CONSTRAINT score_challenges_pkey PRIMARY KEY (id);


--
-- Name: score_challenges score_challenges_source_stat_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_challenges
    ADD CONSTRAINT score_challenges_source_stat_id_key UNIQUE (source_stat_id);


--
-- Name: circle_challenge_reward_awards team_challenge_reward_awards_challenge_id_player_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_challenge_reward_awards
    ADD CONSTRAINT team_challenge_reward_awards_challenge_id_player_id_key UNIQUE (challenge_id, player_id);


--
-- Name: circle_challenge_reward_awards team_challenge_reward_awards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_challenge_reward_awards
    ADD CONSTRAINT team_challenge_reward_awards_pkey PRIMARY KEY (id);


--
-- Name: circle_challenge_rounds team_challenge_rounds_challenge_id_round_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_challenge_rounds
    ADD CONSTRAINT team_challenge_rounds_challenge_id_round_number_key UNIQUE (challenge_id, round_number);


--
-- Name: circle_challenge_rounds team_challenge_rounds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_challenge_rounds
    ADD CONSTRAINT team_challenge_rounds_pkey PRIMARY KEY (challenge_id, challenge_date);


--
-- Name: circle_challenge_stake_acceptances team_challenge_stake_acceptances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_challenge_stake_acceptances
    ADD CONSTRAINT team_challenge_stake_acceptances_pkey PRIMARY KEY (challenge_id, user_id);


--
-- Name: circle_challenge_starts team_challenge_starts_challenge_id_player_id_game_challenge_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_challenge_starts
    ADD CONSTRAINT team_challenge_starts_challenge_id_player_id_game_challenge_key UNIQUE (challenge_id, player_id, game, challenge_date);


--
-- Name: circle_challenge_starts team_challenge_starts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_challenge_starts
    ADD CONSTRAINT team_challenge_starts_pkey PRIMARY KEY (id);


--
-- Name: circle_invitations team_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_invitations
    ADD CONSTRAINT team_invitations_pkey PRIMARY KEY (id);


--
-- Name: circle_join_requests team_join_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_join_requests
    ADD CONSTRAINT team_join_requests_pkey PRIMARY KEY (id);


--
-- Name: circle_join_requests team_join_requests_team_id_user_id_status_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_join_requests
    ADD CONSTRAINT team_join_requests_team_id_user_id_status_key UNIQUE (circle_id, user_id, status);


--
-- Name: circle_member_blocks team_member_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_member_blocks
    ADD CONSTRAINT team_member_blocks_pkey PRIMARY KEY (circle_id, user_id);


--
-- Name: circle_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (circle_id, user_id);


--
-- Name: circle_weekly_challenges team_weekly_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_weekly_challenges
    ADD CONSTRAINT team_weekly_challenges_pkey PRIMARY KEY (id);


--
-- Name: circles teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circles
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: user_section_views user_section_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_section_views
    ADD CONSTRAINT user_section_views_pkey PRIMARY KEY (user_id, section);


--
-- Name: animal_rush_attempt_history_colour_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX animal_rush_attempt_history_colour_idx ON public.animal_rush_attempt_history USING btree (colour_mode, correct, created_at);


--
-- Name: animal_rush_attempt_history_mode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX animal_rush_attempt_history_mode_idx ON public.animal_rush_attempt_history USING btree (difficulty, correct, created_at);


--
-- Name: animal_rush_attempts_room_round_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX animal_rush_attempts_room_round_idx ON public.animal_rush_attempts USING btree (room_id, round_number, created_at);


--
-- Name: animal_rush_players_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX animal_rush_players_user_idx ON public.animal_rush_players USING btree (user_id, joined_at DESC);


--
-- Name: app_email_invitations_rate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_email_invitations_rate_idx ON public.app_email_invitations USING btree (inviter_id, created_at DESC);


--
-- Name: challenge_reset_point_credits_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX challenge_reset_point_credits_lookup_idx ON public.challenge_reset_point_credits USING btree (player_id, game, challenge_date, id);


--
-- Name: direct_messages_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX direct_messages_conversation_idx ON public.direct_messages USING btree (sender_id, recipient_id, created_at DESC);


--
-- Name: direct_messages_feedback_completed_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX direct_messages_feedback_completed_once_idx ON public.direct_messages USING btree (activity_type, source_stat_id, recipient_id) WHERE ((activity_type = 'feedback_completed'::text) AND (source_stat_id IS NOT NULL));


--
-- Name: direct_messages_team_challenge_full_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX direct_messages_team_challenge_full_once_idx ON public.direct_messages USING btree (activity_type, source_stat_id, recipient_id) WHERE ((activity_type = 'team_challenge_completed'::text) AND (source_stat_id IS NOT NULL));


--
-- Name: direct_messages_team_challenge_winner_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX direct_messages_team_challenge_winner_once_idx ON public.direct_messages USING btree (activity_type, source_stat_id, recipient_id) WHERE ((activity_type = 'team_challenge_winner'::text) AND (source_stat_id IS NOT NULL));


--
-- Name: direct_messages_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX direct_messages_unread_idx ON public.direct_messages USING btree (recipient_id, created_at DESC) WHERE (read_at IS NULL);


--
-- Name: game_stats_challenge_streak_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_stats_challenge_streak_lookup ON public.game_stats USING btree (user_id, challenge_date DESC) WHERE (mode = 'challenge'::text);


--
-- Name: game_stats_clean_benchmark_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_stats_clean_benchmark_idx ON public.game_stats USING btree (game, day_index, mode, completed_at) WHERE ((seconds > 0) AND (hints = 0) AND (mistakes = 0));


--
-- Name: game_stats_one_challenge_per_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX game_stats_one_challenge_per_scope ON public.game_stats USING btree (user_id, game, challenge_date, COALESCE(circle_challenge_id, (0)::bigint)) WHERE (mode = 'challenge'::text);


--
-- Name: points_one_award_per_game; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX points_one_award_per_game ON public.points_transactions USING btree (game_stat_id) WHERE ((game_stat_id IS NOT NULL) AND (reason_code = 'GAME_COMPLETED'::text));


--
-- Name: points_transactions_player_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX points_transactions_player_date ON public.points_transactions USING btree (player_id, created_at DESC);


--
-- Name: profiles_active_name_unique_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_active_name_unique_ci ON public.profiles USING btree (lower(btrim(name))) WHERE (account_deleted_at IS NULL);


--
-- Name: reward_rules_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reward_rules_one_active ON public.reward_rules USING btree (is_active) WHERE (is_active = true);


--
-- Name: score_challenge_recipients_player_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX score_challenge_recipients_player_idx ON public.score_challenge_recipients USING btree (recipient_id, completed_at, challenge_id);


--
-- Name: team_challenge_rounds_game_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_challenge_rounds_game_idx ON public.circle_challenge_rounds USING btree (challenge_id, game, challenge_date);


--
-- Name: team_invitations_one_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX team_invitations_one_pending_idx ON public.circle_invitations USING btree (circle_id, invited_user_id) WHERE (status = 'pending'::text);


--
-- Name: team_weekly_challenges_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_weekly_challenges_history_idx ON public.circle_weekly_challenges USING btree (circle_id, closed_at DESC, week_start DESC);


--
-- Name: team_weekly_challenges_series_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_weekly_challenges_series_idx ON public.circle_weekly_challenges USING btree (series_id, week_start, occurrence_number);


--
-- Name: team_weekly_challenges_team_week_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_weekly_challenges_team_week_idx ON public.circle_weekly_challenges USING btree (circle_id, week_start, created_at);


--
-- Name: animal_rush_attempts animal_rush_archive_attempt_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER animal_rush_archive_attempt_trigger AFTER INSERT ON public.animal_rush_attempts FOR EACH ROW EXECUTE FUNCTION public.animal_rush_archive_attempt();


--
-- Name: game_stats award_completed_circle_challenge_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER award_completed_circle_challenge_trigger AFTER INSERT ON public.game_stats FOR EACH ROW EXECUTE FUNCTION public.award_completed_circle_challenge();


--
-- Name: circle_weekly_challenges circle_challenge_reward_cap_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER circle_challenge_reward_cap_trigger BEFORE INSERT OR UPDATE OF reward_points ON public.circle_weekly_challenges FOR EACH ROW EXECUTE FUNCTION public.enforce_circle_challenge_reward_cap();


--
-- Name: game_stats game_stats_attach_reset_challenge_credit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER game_stats_attach_reset_challenge_credit AFTER INSERT ON public.game_stats FOR EACH ROW EXECUTE FUNCTION public.attach_reset_challenge_credit();


--
-- Name: game_stats game_stats_notify_circle_daily_challenge; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER game_stats_notify_circle_daily_challenge AFTER INSERT ON public.game_stats FOR EACH ROW EXECUTE FUNCTION public.notify_circle_daily_challenge_completed();


--
-- Name: game_stats game_stats_update_challenge_streak; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER game_stats_update_challenge_streak AFTER INSERT ON public.game_stats FOR EACH ROW WHEN ((new.mode = 'challenge'::text)) EXECUTE FUNCTION public.update_challenge_streak_from_game();


--
-- Name: profiles profiles_clear_hidden_user_presence; Type: TRIGGER; Schema: public; Owner: -
--

-- reject_hidden_animal_rush_player_trigger keeps hidden players from joining a
-- round, but nothing removed one who was hidden mid-game: clear_hidden_user_presence
-- existed for exactly that and was never attached to anything.
CREATE TRIGGER profiles_clear_hidden_user_presence AFTER UPDATE OF hidden_from_others ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.clear_hidden_user_presence();


--
-- Name: profiles profiles_retire_unavailable_player_messages; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_retire_unavailable_player_messages AFTER UPDATE OF account_deleted_at, is_blocked ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.retire_unavailable_player_messages();


--
-- Name: profiles protect_profile_security_fields_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER protect_profile_security_fields_trigger BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_security_fields();


--
-- Name: animal_rush_players reject_hidden_animal_rush_player_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reject_hidden_animal_rush_player_trigger BEFORE INSERT OR UPDATE OF user_id, left_at ON public.animal_rush_players FOR EACH ROW EXECUTE FUNCTION public.reject_hidden_animal_rush_player();


--
-- Name: circle_join_requests require_approved_actor_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER require_approved_actor_trigger BEFORE INSERT ON public.circle_join_requests FOR EACH ROW EXECUTE FUNCTION public.require_approved_actor();


--
-- Name: feedback require_approved_actor_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER require_approved_actor_trigger BEFORE INSERT ON public.feedback FOR EACH ROW EXECUTE FUNCTION public.require_approved_actor();


--
-- Name: feedback_votes require_approved_actor_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER require_approved_actor_trigger BEFORE INSERT ON public.feedback_votes FOR EACH ROW EXECUTE FUNCTION public.require_approved_actor();


--
-- Name: game_stats require_approved_actor_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER require_approved_actor_trigger BEFORE INSERT ON public.game_stats FOR EACH ROW EXECUTE FUNCTION public.require_approved_actor();


--
-- Name: pokes require_approved_actor_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER require_approved_actor_trigger BEFORE INSERT ON public.pokes FOR EACH ROW EXECUTE FUNCTION public.require_approved_actor();


--
-- Name: presence require_approved_actor_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER require_approved_actor_trigger BEFORE INSERT ON public.presence FOR EACH ROW EXECUTE FUNCTION public.require_approved_actor();


--
-- Name: reward_rules reward_rules_normalise_practice_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reward_rules_normalise_practice_limit BEFORE INSERT OR UPDATE OF practice_daily_limit ON public.reward_rules FOR EACH ROW EXECUTE FUNCTION public.normalise_reward_rules_practice_limit();


--
-- Name: circle_weekly_challenges sync_circle_challenge_rounds_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_circle_challenge_rounds_trigger AFTER INSERT OR UPDATE ON public.circle_weekly_challenges FOR EACH ROW EXECUTE FUNCTION public.sync_circle_challenge_rounds();


--
-- Name: game_stats validate_circle_challenge_attempt_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_circle_challenge_attempt_trigger BEFORE INSERT ON public.game_stats FOR EACH ROW EXECUTE FUNCTION public.validate_circle_challenge_attempt();


--
-- Name: circle_weekly_challenges validate_circle_challenge_games_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_circle_challenge_games_trigger BEFORE INSERT OR UPDATE OF game_ids ON public.circle_weekly_challenges FOR EACH ROW EXECUTE FUNCTION public.validate_circle_challenge_games();


--
-- Name: game_stats validate_game_stat_actor_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_game_stat_actor_trigger BEFORE INSERT ON public.game_stats FOR EACH ROW EXECUTE FUNCTION public.validate_game_stat_actor();


--
-- Name: animal_rush_attempt_history animal_rush_attempt_history_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_attempt_history
    ADD CONSTRAINT animal_rush_attempt_history_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.animal_rush_rooms(id) ON DELETE SET NULL;


--
-- Name: animal_rush_attempts animal_rush_attempts_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_attempts
    ADD CONSTRAINT animal_rush_attempts_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.animal_rush_rooms(id) ON DELETE CASCADE;


--
-- Name: animal_rush_attempts animal_rush_attempts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_attempts
    ADD CONSTRAINT animal_rush_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: animal_rush_match_results animal_rush_match_results_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_match_results
    ADD CONSTRAINT animal_rush_match_results_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.animal_rush_rooms(id) ON DELETE SET NULL;


--
-- Name: animal_rush_match_results animal_rush_match_results_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_match_results
    ADD CONSTRAINT animal_rush_match_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: animal_rush_players animal_rush_players_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_players
    ADD CONSTRAINT animal_rush_players_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.animal_rush_rooms(id) ON DELETE CASCADE;


--
-- Name: animal_rush_players animal_rush_players_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_players
    ADD CONSTRAINT animal_rush_players_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: animal_rush_rooms animal_rush_rooms_host_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_rooms
    ADD CONSTRAINT animal_rush_rooms_host_user_id_fkey FOREIGN KEY (host_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: animal_rush_rooms animal_rush_rooms_round_winner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_rooms
    ADD CONSTRAINT animal_rush_rooms_round_winner_id_fkey FOREIGN KEY (round_winner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: animal_rush_rooms animal_rush_rooms_winner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animal_rush_rooms
    ADD CONSTRAINT animal_rush_rooms_winner_user_id_fkey FOREIGN KEY (winner_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: app_email_invitations app_email_invitations_inviter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_email_invitations
    ADD CONSTRAINT app_email_invitations_inviter_id_fkey FOREIGN KEY (inviter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: challenge_reset_point_credits challenge_reset_point_credits_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_reset_point_credits
    ADD CONSTRAINT challenge_reset_point_credits_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: challenge_reset_point_credits challenge_reset_point_credits_points_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_reset_point_credits
    ADD CONSTRAINT challenge_reset_point_credits_points_transaction_id_fkey FOREIGN KEY (points_transaction_id) REFERENCES public.points_transactions(id) ON DELETE CASCADE;


--
-- Name: direct_message_reactions direct_message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_message_reactions
    ADD CONSTRAINT direct_message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.direct_messages(id) ON DELETE CASCADE;


--
-- Name: direct_message_reactions direct_message_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_message_reactions
    ADD CONSTRAINT direct_message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: direct_messages direct_messages_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_messages
    ADD CONSTRAINT direct_messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: direct_messages direct_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_messages
    ADD CONSTRAINT direct_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: feedback feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: feedback_votes feedback_votes_feedback_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_votes
    ADD CONSTRAINT feedback_votes_feedback_id_fkey FOREIGN KEY (feedback_id) REFERENCES public.feedback(id) ON DELETE CASCADE;


--
-- Name: feedback_votes feedback_votes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_votes
    ADD CONSTRAINT feedback_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: game_stats game_stats_team_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_stats
    ADD CONSTRAINT game_stats_team_challenge_id_fkey FOREIGN KEY (circle_challenge_id) REFERENCES public.circle_weekly_challenges(id) ON DELETE SET NULL;


--
-- Name: game_stats game_stats_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_stats
    ADD CONSTRAINT game_stats_team_id_fkey FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE SET NULL;


--
-- Name: game_stats game_stats_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_stats
    ADD CONSTRAINT game_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: player_progress player_progress_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_progress
    ADD CONSTRAINT player_progress_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: points_transactions points_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: points_transactions points_transactions_game_stat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_game_stat_id_fkey FOREIGN KEY (game_stat_id) REFERENCES public.game_stats(id) ON DELETE SET NULL;


--
-- Name: points_transactions points_transactions_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: points_transactions points_transactions_related_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_related_player_id_fkey FOREIGN KEY (related_player_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: points_transactions points_transactions_reward_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_reward_id_fkey FOREIGN KEY (reward_id) REFERENCES public.rewards(id) ON DELETE SET NULL;


--
-- Name: pokes pokes_from_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pokes
    ADD CONSTRAINT pokes_from_user_fkey FOREIGN KEY (from_user) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: pokes pokes_to_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pokes
    ADD CONSTRAINT pokes_to_user_fkey FOREIGN KEY (to_user) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: presence presence_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presence
    ADD CONSTRAINT presence_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: release_note_reactions release_note_reactions_release_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_note_reactions
    ADD CONSTRAINT release_note_reactions_release_note_id_fkey FOREIGN KEY (release_note_id) REFERENCES public.release_notes(id) ON DELETE CASCADE;


--
-- Name: release_note_reactions release_note_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_note_reactions
    ADD CONSTRAINT release_note_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: release_notes release_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_notes
    ADD CONSTRAINT release_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: reward_approvals reward_approvals_approver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_approvals
    ADD CONSTRAINT reward_approvals_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: reward_approvals reward_approvals_reward_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_approvals
    ADD CONSTRAINT reward_approvals_reward_id_fkey FOREIGN KEY (reward_id) REFERENCES public.rewards(id) ON DELETE CASCADE;


--
-- Name: reward_redemptions reward_redemptions_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_redemptions
    ADD CONSTRAINT reward_redemptions_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: reward_redemptions reward_redemptions_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_redemptions
    ADD CONSTRAINT reward_redemptions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: reward_redemptions reward_redemptions_reward_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_redemptions
    ADD CONSTRAINT reward_redemptions_reward_id_fkey FOREIGN KEY (reward_id) REFERENCES public.rewards(id) ON DELETE RESTRICT;


--
-- Name: reward_rules reward_rules_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_rules
    ADD CONSTRAINT reward_rules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: rewards rewards_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rewards
    ADD CONSTRAINT rewards_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: rewards rewards_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rewards
    ADD CONSTRAINT rewards_team_id_fkey FOREIGN KEY (circle_id) REFERENCES public.circles(id);


--
-- Name: score_challenge_recipients score_challenge_recipients_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_challenge_recipients
    ADD CONSTRAINT score_challenge_recipients_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.score_challenges(id) ON DELETE CASCADE;


--
-- Name: score_challenge_recipients score_challenge_recipients_completed_stat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_challenge_recipients
    ADD CONSTRAINT score_challenge_recipients_completed_stat_id_fkey FOREIGN KEY (completed_stat_id) REFERENCES public.game_stats(id) ON DELETE SET NULL;


--
-- Name: score_challenge_recipients score_challenge_recipients_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_challenge_recipients
    ADD CONSTRAINT score_challenge_recipients_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: score_challenges score_challenges_challenger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_challenges
    ADD CONSTRAINT score_challenges_challenger_id_fkey FOREIGN KEY (challenger_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: score_challenges score_challenges_source_stat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_challenges
    ADD CONSTRAINT score_challenges_source_stat_id_fkey FOREIGN KEY (source_stat_id) REFERENCES public.game_stats(id) ON DELETE CASCADE;


--
-- Name: circle_challenge_reward_awards team_challenge_reward_awards_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_challenge_reward_awards
    ADD CONSTRAINT team_challenge_reward_awards_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.circle_weekly_challenges(id) ON DELETE CASCADE;


--
-- Name: circle_challenge_reward_awards team_challenge_reward_awards_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_challenge_reward_awards
    ADD CONSTRAINT team_challenge_reward_awards_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: circle_challenge_rounds team_challenge_rounds_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_challenge_rounds
    ADD CONSTRAINT team_challenge_rounds_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.circle_weekly_challenges(id) ON DELETE CASCADE;


--
-- Name: circle_challenge_stake_acceptances team_challenge_stake_acceptances_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_challenge_stake_acceptances
    ADD CONSTRAINT team_challenge_stake_acceptances_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.circle_weekly_challenges(id) ON DELETE CASCADE;


--
-- Name: circle_challenge_stake_acceptances team_challenge_stake_acceptances_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_challenge_stake_acceptances
    ADD CONSTRAINT team_challenge_stake_acceptances_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: circle_challenge_starts team_challenge_starts_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_challenge_starts
    ADD CONSTRAINT team_challenge_starts_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.circle_weekly_challenges(id) ON DELETE CASCADE;


--
-- Name: circle_challenge_starts team_challenge_starts_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_challenge_starts
    ADD CONSTRAINT team_challenge_starts_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: circle_invitations team_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_invitations
    ADD CONSTRAINT team_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: circle_invitations team_invitations_invited_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_invitations
    ADD CONSTRAINT team_invitations_invited_user_id_fkey FOREIGN KEY (invited_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: circle_invitations team_invitations_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_invitations
    ADD CONSTRAINT team_invitations_team_id_fkey FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;


--
-- Name: circle_join_requests team_join_requests_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_join_requests
    ADD CONSTRAINT team_join_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: circle_join_requests team_join_requests_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_join_requests
    ADD CONSTRAINT team_join_requests_team_id_fkey FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;


--
-- Name: circle_join_requests team_join_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_join_requests
    ADD CONSTRAINT team_join_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: circle_member_blocks team_member_blocks_blocked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_member_blocks
    ADD CONSTRAINT team_member_blocks_blocked_by_fkey FOREIGN KEY (blocked_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: circle_member_blocks team_member_blocks_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_member_blocks
    ADD CONSTRAINT team_member_blocks_team_id_fkey FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;


--
-- Name: circle_member_blocks team_member_blocks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_member_blocks
    ADD CONSTRAINT team_member_blocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: circle_members team_members_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_members
    ADD CONSTRAINT team_members_team_id_fkey FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;


--
-- Name: circle_members team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_members
    ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: circle_weekly_challenges team_weekly_challenges_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_weekly_challenges
    ADD CONSTRAINT team_weekly_challenges_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: circle_weekly_challenges team_weekly_challenges_stake_reward_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_weekly_challenges
    ADD CONSTRAINT team_weekly_challenges_stake_reward_id_fkey FOREIGN KEY (stake_reward_id) REFERENCES public.rewards(id);


--
-- Name: circle_weekly_challenges team_weekly_challenges_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circle_weekly_challenges
    ADD CONSTRAINT team_weekly_challenges_team_id_fkey FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;


--
-- Name: circles teams_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.circles
    ADD CONSTRAINT teams_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: user_section_views user_section_views_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_section_views
    ADD CONSTRAINT user_section_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: release_notes admins can delete release notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins can delete release notes" ON public.release_notes FOR DELETE USING (public.is_admin(auth.uid()));


--
-- Name: game_config admins can insert game config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins can insert game config" ON public.game_config FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));


--
-- Name: release_notes admins can post release notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins can post release notes" ON public.release_notes FOR INSERT WITH CHECK (public.is_admin(auth.uid()));


--
-- Name: feedback admins can update feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins can update feedback" ON public.feedback FOR UPDATE USING (public.is_admin(auth.uid()));


--
-- Name: game_config admins can update game config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins can update game config" ON public.game_config FOR UPDATE USING (public.is_admin(auth.uid()));


--
-- Name: game_time_benchmarks admins manage benchmarks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins manage benchmarks" ON public.game_time_benchmarks USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));


--
-- Name: reward_rules admins manage rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins manage rules" ON public.reward_rules USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));


--
-- Name: animal_rush_match_results animal rush results follow stats privacy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "animal rush results follow stats privacy" ON public.animal_rush_match_results FOR SELECT USING ((public.can_view_user(user_id) AND ((user_id = auth.uid()) OR public.is_admin(auth.uid()) OR COALESCE(( SELECT profile.show_stats_to_others
   FROM public.profiles profile
  WHERE (profile.id = animal_rush_match_results.user_id)), false))));


--
-- Name: animal_rush_attempt_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.animal_rush_attempt_history ENABLE ROW LEVEL SECURITY;

--
-- Name: animal_rush_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.animal_rush_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: animal_rush_match_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.animal_rush_match_results ENABLE ROW LEVEL SECURITY;

--
-- Name: animal_rush_players; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.animal_rush_players ENABLE ROW LEVEL SECURITY;

--
-- Name: animal_rush_rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.animal_rush_rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: app_email_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_email_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: circles approved visible users create teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "approved visible users create teams" ON public.circles FOR INSERT TO authenticated WITH CHECK (((created_by = auth.uid()) AND public.is_available_player(auth.uid()) AND (NOT (EXISTS ( SELECT 1
   FROM public.profiles profile
  WHERE ((profile.id = auth.uid()) AND COALESCE(profile.hidden_from_others, false)))))));


--
-- Name: feedback authors can update open feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authors can update open feedback" ON public.feedback FOR UPDATE USING (((auth.uid() = user_id) AND (status = 'open'::text) AND (deleted_at IS NULL))) WITH CHECK (((auth.uid() = user_id) AND (status = 'open'::text) AND (deleted_at IS NULL)));


--
-- Name: pokes available users can send a poke; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "available users can send a poke" ON public.pokes FOR INSERT TO authenticated WITH CHECK (((auth.uid() = from_user) AND public.is_available_player(from_user) AND public.is_available_player(to_user) AND public.can_view_user(from_user) AND public.can_view_user(to_user)));


--
-- Name: direct_messages available users can send direct messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "available users can send direct messages" ON public.direct_messages FOR INSERT TO authenticated WITH CHECK (((auth.uid() = sender_id) AND (sender_id <> recipient_id) AND public.is_available_player(sender_id) AND public.is_available_player(recipient_id) AND (NOT public.is_blocked_between(sender_id, recipient_id)) AND (public.is_admin(sender_id) OR public.is_admin(recipient_id) OR public.players_share_circle(sender_id, recipient_id))));


--
-- Name: game_time_benchmarks benchmarks readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "benchmarks readable" ON public.game_time_benchmarks FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: challenge_reset_point_credits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.challenge_reset_point_credits ENABLE ROW LEVEL SECURITY;

--
-- Name: direct_message_reactions chat participants add own message reactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "chat participants add own message reactions" ON public.direct_message_reactions FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.direct_messages dm
  WHERE ((dm.id = direct_message_reactions.message_id) AND ((auth.uid() = dm.sender_id) OR (auth.uid() = dm.recipient_id)))))));


--
-- Name: direct_message_reactions chat participants remove own message reactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "chat participants remove own message reactions" ON public.direct_message_reactions FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: direct_message_reactions chat participants update own message reactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "chat participants update own message reactions" ON public.direct_message_reactions FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: direct_message_reactions chat participants view message reactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "chat participants view message reactions" ON public.direct_message_reactions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.direct_messages dm
  WHERE ((dm.id = direct_message_reactions.message_id) AND ((auth.uid() = dm.sender_id) OR (auth.uid() = dm.recipient_id))))));


--
-- Name: rewards circle members and admins view rewards; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "circle members and admins view rewards" ON public.rewards FOR SELECT USING ((public.is_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.circle_members
  WHERE ((circle_members.circle_id = rewards.circle_id) AND (circle_members.user_id = auth.uid()))))));


--
-- Name: reward_approvals circle members can view approvals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "circle members can view approvals" ON public.reward_approvals FOR SELECT USING ((public.is_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM (public.rewards rw
     JOIN public.circle_members cm ON ((cm.circle_id = rw.circle_id)))
  WHERE ((rw.id = reward_approvals.reward_id) AND (cm.user_id = auth.uid()))))));


--
-- Name: rewards circle reward approvers update rewards; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "circle reward approvers update rewards" ON public.rewards FOR UPDATE USING (public.is_circle_reward_approver(circle_id, auth.uid())) WITH CHECK (public.is_circle_reward_approver(circle_id, auth.uid()));


--
-- Name: circle_challenge_reward_awards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.circle_challenge_reward_awards ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_challenge_rounds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.circle_challenge_rounds ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_challenge_stake_acceptances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.circle_challenge_stake_acceptances ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_challenge_starts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.challenge_attempt_starts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "players view their own attempt starts" ON public.challenge_attempt_starts FOR SELECT TO authenticated USING (((player_id = auth.uid()) OR public.is_admin(auth.uid())));

CREATE UNIQUE INDEX challenge_attempt_starts_unique ON public.challenge_attempt_starts USING btree (player_id, attempt_key);

ALTER TABLE ONLY public.challenge_attempt_starts
    ADD CONSTRAINT challenge_attempt_starts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.challenge_attempt_starts
    ADD CONSTRAINT challenge_attempt_starts_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.circle_challenge_starts ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.circle_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_join_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.circle_join_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_member_blocks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.circle_member_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.circle_members ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_weekly_challenges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.circle_weekly_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: circles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.circles ENABLE ROW LEVEL SECURITY;

--
-- Name: direct_message_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.direct_message_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: direct_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: feedback feedback follows author visibility; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "feedback follows author visibility" ON public.feedback FOR SELECT USING (public.can_view_user(user_id));


--
-- Name: feedback_votes feedback votes follow voter visibility; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "feedback votes follow voter visibility" ON public.feedback_votes FOR SELECT USING ((public.can_view_user(user_id) AND (EXISTS ( SELECT 1
   FROM public.feedback f
  WHERE ((f.id = feedback_votes.feedback_id) AND public.can_view_user(f.user_id))))));


--
-- Name: feedback_votes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feedback_votes ENABLE ROW LEVEL SECURITY;

--
-- Name: game_config game config is publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "game config is publicly readable" ON public.game_config FOR SELECT USING (true);


--
-- Name: game_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_config ENABLE ROW LEVEL SECURITY;

--
-- Name: game_stats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_stats ENABLE ROW LEVEL SECURITY;

--
-- Name: game_time_benchmarks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_time_benchmarks ENABLE ROW LEVEL SECURITY;

--
-- Name: circle_invitations invitation participants can view; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invitation participants can view" ON public.circle_invitations FOR SELECT TO authenticated USING ((public.can_view_user(invited_user_id) AND public.can_view_user(invited_by) AND ((invited_user_id = auth.uid()) OR (invited_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.circle_members membership
  WHERE ((membership.circle_id = circle_invitations.circle_id) AND (membership.user_id = auth.uid())))))));


--
-- Name: circle_join_requests join requests visible to requester and team owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "join requests visible to requester and team owner" ON public.circle_join_requests FOR SELECT USING ((public.can_view_user(user_id) AND ((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.circles team
  WHERE ((team.id = circle_join_requests.circle_id) AND ((team.created_by = auth.uid()) OR public.is_admin(auth.uid()))))))));


--
-- Name: animal_rush_attempts members read animal rush attempts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read animal rush attempts" ON public.animal_rush_attempts FOR SELECT USING ((public.animal_rush_is_member(room_id, auth.uid()) AND public.can_view_user(user_id)));


--
-- Name: animal_rush_players members read animal rush players; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read animal rush players" ON public.animal_rush_players FOR SELECT USING ((public.animal_rush_is_member(room_id, auth.uid()) AND public.can_view_user(user_id)));


--
-- Name: animal_rush_rooms members read animal rush rooms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read animal rush rooms" ON public.animal_rush_rooms FOR SELECT USING ((public.animal_rush_is_member(id, auth.uid()) AND public.can_view_user(host_user_id) AND ((winner_user_id IS NULL) OR public.can_view_user(winner_user_id))));


--
-- Name: direct_messages participants can read direct messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "participants can read direct messages" ON public.direct_messages FOR SELECT TO authenticated USING (((((COALESCE(system_generated, false) = true) AND (auth.uid() = recipient_id)) OR ((COALESCE(system_generated, false) = false) AND ((auth.uid() = sender_id) OR (auth.uid() = recipient_id)))) AND (EXISTS ( SELECT 1
   FROM public.profiles sender
  WHERE ((sender.id = direct_messages.sender_id) AND (COALESCE(sender.hidden_from_others, false) = false)))) AND (EXISTS ( SELECT 1
   FROM public.profiles recipient
  WHERE ((recipient.id = direct_messages.recipient_id) AND (COALESCE(recipient.hidden_from_others, false) = false)))) AND (NOT public.is_blocked_between(sender_id, recipient_id))));


--
-- Name: player_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.player_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: app_email_invitations players view own email invitations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "players view own email invitations" ON public.app_email_invitations FOR SELECT TO authenticated USING ((inviter_id = auth.uid()));


--
-- Name: circle_challenge_reward_awards players view own team challenge rewards; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "players view own team challenge rewards" ON public.circle_challenge_reward_awards FOR SELECT TO authenticated USING (((player_id = auth.uid()) OR public.is_admin(auth.uid())));


--
-- Name: circle_challenge_starts players view relevant team challenge starts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "players view relevant team challenge starts" ON public.circle_challenge_starts FOR SELECT TO authenticated USING (((player_id = auth.uid()) OR public.is_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM (public.circle_weekly_challenges c
     JOIN public.circles t ON ((t.id = c.circle_id)))
  WHERE ((c.id = circle_challenge_starts.challenge_id) AND (t.created_by = auth.uid()))))));


--
-- Name: points_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.points_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: pokes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pokes ENABLE ROW LEVEL SECURITY;

--
-- Name: pokes pokes follow player visibility; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "pokes follow player visibility" ON public.pokes FOR SELECT USING ((((auth.uid() = to_user) OR (auth.uid() = from_user)) AND public.can_view_user(from_user) AND public.can_view_user(to_user)));


--
-- Name: presence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.presence ENABLE ROW LEVEL SECURITY;

--
-- Name: presence presence follows player visibility; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "presence follows player visibility" ON public.presence FOR SELECT USING ((public.can_view_user(user_id) AND (NOT public.is_user_incognito(user_id))));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles are readable unless hidden; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles are readable unless hidden" ON public.profiles FOR SELECT USING (public.can_view_user(id));


--
-- Name: player_progress progress visible to owner or admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "progress visible to owner or admin" ON public.player_progress FOR SELECT USING (((player_id = auth.uid()) OR public.is_admin(auth.uid())));


--
-- Name: direct_messages recipients can mark direct messages read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "recipients can mark direct messages read" ON public.direct_messages FOR UPDATE TO authenticated USING ((auth.uid() = recipient_id)) WITH CHECK ((auth.uid() = recipient_id));


--
-- Name: reward_redemptions redemptions owner or manager; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "redemptions owner or manager" ON public.reward_redemptions FOR SELECT USING (((player_id = auth.uid()) OR public.is_reward_manager(auth.uid())));


--
-- Name: release_note_reactions release note reactions follow player visibility; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "release note reactions follow player visibility" ON public.release_note_reactions FOR SELECT USING (public.can_view_user(user_id));


--
-- Name: release_note_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.release_note_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: release_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.release_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: reward_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reward_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: reward_redemptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reward_redemptions ENABLE ROW LEVEL SECURITY;

--
-- Name: reward_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reward_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: rewards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rewards ENABLE ROW LEVEL SECURITY;

--
-- Name: reward_rules rules readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "rules readable" ON public.reward_rules FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: score_challenge_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.score_challenge_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: score_challenges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.score_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: game_stats stats follow player and stats visibility; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "stats follow player and stats visibility" ON public.game_stats FOR SELECT USING ((public.can_view_user(user_id) AND ((user_id = auth.uid()) OR public.is_admin(auth.uid()) OR COALESCE(( SELECT p.show_stats_to_others
   FROM public.profiles p
  WHERE (p.id = game_stats.user_id)), false))));


--
-- Name: circle_member_blocks team managers view blocks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "team managers view blocks" ON public.circle_member_blocks FOR SELECT TO authenticated USING ((public.can_view_user(user_id) AND (public.is_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.circles team
  WHERE ((team.id = circle_member_blocks.circle_id) AND (team.created_by = auth.uid())))))));


--
-- Name: circle_challenge_stake_acceptances team members can view stake acceptances; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "team members can view stake acceptances" ON public.circle_challenge_stake_acceptances FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.circle_weekly_challenges c
     JOIN public.circle_members m ON ((m.circle_id = c.circle_id)))
  WHERE ((c.id = circle_challenge_stake_acceptances.challenge_id) AND (m.user_id = auth.uid())))));


--
-- Name: circle_weekly_challenges team members can view weekly challenges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "team members can view weekly challenges" ON public.circle_weekly_challenges FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.circle_members tm
  WHERE ((tm.circle_id = circle_weekly_challenges.circle_id) AND (tm.user_id = auth.uid())))));


--
-- Name: circle_members team membership follows player visibility; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "team membership follows player visibility" ON public.circle_members FOR SELECT USING (public.can_view_user(user_id));


--
-- Name: circle_join_requests team owner decides join requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "team owner decides join requests" ON public.circle_join_requests FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM public.circles t
  WHERE ((t.id = circle_join_requests.circle_id) AND (t.created_by = auth.uid())))) OR (auth.uid() = user_id)));


--
-- Name: circle_challenge_rounds team_challenge_rounds_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_challenge_rounds_select ON public.circle_challenge_rounds FOR SELECT TO authenticated USING ((public.is_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM (public.circle_weekly_challenges challenge
     JOIN public.circle_members member ON ((member.circle_id = challenge.circle_id)))
  WHERE ((challenge.id = circle_challenge_rounds.challenge_id) AND (member.user_id = auth.uid()))))));


--
-- Name: circles teams are publicly readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "teams are publicly readable" ON public.circles FOR SELECT USING (true);


--
-- Name: points_transactions transactions visible to owner or admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "transactions visible to owner or admin" ON public.points_transactions FOR SELECT USING (((player_id = auth.uid()) OR public.is_admin(auth.uid())));


--
-- Name: user_section_views; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_section_views ENABLE ROW LEVEL SECURITY;

--
-- Name: release_note_reactions users can change their own reaction; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can change their own reaction" ON public.release_note_reactions FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: pokes users can mark their own incoming pokes seen; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can mark their own incoming pokes seen" ON public.pokes FOR UPDATE USING ((auth.uid() = to_user));


--
-- Name: release_note_reactions users can react; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can react" ON public.release_note_reactions FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: release_note_reactions users can remove their own reaction; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can remove their own reaction" ON public.release_note_reactions FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: feedback_votes users can remove their own vote; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can remove their own vote" ON public.feedback_votes FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: circle_members users can remove themselves from a team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can remove themselves from a team" ON public.circle_members FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: pokes users can send a poke; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can send a poke" ON public.pokes FOR INSERT WITH CHECK (((auth.uid() = from_user) AND public.can_view_user(from_user) AND public.can_view_user(to_user) AND (NOT public.is_user_incognito(to_user))));


--
-- Name: feedback users can submit feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can submit feedback" ON public.feedback FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: feedback_votes users can vote; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can vote" ON public.feedback_votes FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: presence users delete their own presence; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users delete their own presence" ON public.presence FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: profiles users insert their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users insert their own profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = id));


--
-- Name: game_stats users insert their own stats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users insert their own stats" ON public.game_stats FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: presence users insert visible presence; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users insert visible presence" ON public.presence FOR INSERT WITH CHECK (((auth.uid() = user_id) AND (NOT public.is_user_incognito(auth.uid()))));


--
-- Name: user_section_views users manage own section views; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users manage own section views" ON public.user_section_views TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: circle_join_requests users request team membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users request team membership" ON public.circle_join_requests FOR INSERT WITH CHECK (((auth.uid() = user_id) AND (NOT (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND COALESCE(p.hidden_from_others, false)))))));


--
-- Name: profiles users update their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users update their own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = id));


--
-- Name: presence users update visible presence; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users update visible presence" ON public.presence FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK (((auth.uid() = user_id) AND (NOT public.is_user_incognito(auth.uid()))));


--
-- Name: release_notes visible release notes are readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "visible release notes are readable" ON public.release_notes FOR SELECT TO authenticated USING (((is_hidden = false) OR public.is_admin(auth.uid())));


--
-- Name: player_blocks / content_reports; Type: CONSTRAINT, INDEX, POLICY
--

ALTER TABLE ONLY public.player_blocks
    ADD CONSTRAINT player_blocks_pkey PRIMARY KEY (blocker_id, blocked_id);
ALTER TABLE ONLY public.player_blocks
    ADD CONSTRAINT player_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.player_blocks
    ADD CONSTRAINT player_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX player_blocks_blocked_idx ON public.player_blocks USING btree (blocked_id);

ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.direct_messages(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX content_reports_triage_idx ON public.content_reports USING btree (status, created_at DESC);

ALTER TABLE public.player_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

-- Reads only. Every write goes through a SECURITY DEFINER RPC, so leaving
-- INSERT/UPDATE/DELETE without a policy denies direct table writes.
CREATE POLICY "players read their own blocks" ON public.player_blocks FOR SELECT TO authenticated USING (((blocker_id = auth.uid()) OR public.is_admin(auth.uid())));
CREATE POLICY "reporters and admins read reports" ON public.content_reports FOR SELECT TO authenticated USING (((reporter_id = auth.uid()) OR public.is_admin(auth.uid())));


--
-- Name: FUNCTION ACLs; Type: ACL; Schema: public; Owner: -
--

-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, which
-- would expose these to the anon role. Every SECURITY DEFINER function is
-- revoked and then granted only to authenticated, and helpers that exist only
-- to be called by another definer function are not granted at all.
--
-- NOTE: this export was taken without privileges, so the rest of the schema's
-- functions have no ACL recorded here even though the deployed database has
-- them. Re-export including privileges to close that gap.

REVOKE ALL ON FUNCTION public.resolve_timezone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.player_today(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.circle_today(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.circle_week_start(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_timezone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.challenge_benchmark_seconds(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.circle_challenge_daily_score(text, date, integer, integer, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.circle_challenge_member_totals(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_circle_challenge(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_circle_challenge_standings(bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.admin_reset_all_stats(text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_all_stats(text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.begin_challenge_attempt(text, date, bigint, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.circle_challenge_last_place(bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.get_messageable_players() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_messageable_players() TO authenticated;
REVOKE ALL ON FUNCTION public.can_continue_conversation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_continue_conversation(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_unread_message_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unread_message_counts() TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_played_score_challenges(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_played_score_challenges(bigint[]) TO authenticated;
REVOKE ALL ON FUNCTION public.players_share_circle(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_blocked_between(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.strip_player_from_circles(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_player(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unblock_player(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_blocked_players() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.report_content(uuid, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_content_reports() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_resolve_content_report(bigint, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_circle_challenge_standings(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_timezone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.block_player(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_player(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_blocked_players() TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_content(uuid, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_content_reports() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_content_report(bigint, text) TO authenticated;


--
-- PostgreSQL database dump complete
--
