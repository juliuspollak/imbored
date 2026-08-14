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
