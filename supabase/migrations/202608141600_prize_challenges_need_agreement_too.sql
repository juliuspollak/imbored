-- Prize challenges now need each player's agreement, the same as staked ones.
--
-- A staked challenge splits the cost of an item and has always required every
-- player to accept before they can start. A prize challenge was ungated -- yet
-- "Loser owes it" commits one named person to something real (buy dinner,
-- clean the bathroom) with nothing but the circle owner's say-so, and
-- finalize_circle_challenge() then messages the whole circle telling them who
-- owes what. Whoever was on the hook never agreed to be.
--
-- Both types put a player on the hook for something the app cannot enforce or
-- undo, so both now need consent. Points challenges award in-app points and
-- put nobody on the hook, so they stay ungated.
--
-- Acceptances reuse circle_challenge_stake_acceptances unchanged: the record is
-- per (challenge, player) and holds nothing stake-specific.

create or replace function public.accept_challenge_stake(target_challenge_id bigint) RETURNS void
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

create or replace function public.start_circle_challenge_game(target_challenge_id bigint, target_game text, target_challenge_date date) RETURNS void
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
