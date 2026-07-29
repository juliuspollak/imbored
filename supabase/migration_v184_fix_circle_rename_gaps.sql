-- v184: migration_v181 renamed game_stats.team_challenge_id to
-- circle_challenge_id, but three functions whose own names don't contain
-- "team" were missed by that rename and never got a matching update. Two
-- are wired to live paths:
--   - attach_reset_challenge_credit(): an AFTER INSERT trigger on
--     game_stats, so EVERY game save (practice or challenge) hit
--       record "new" has no field "team_challenge_id"
--   - get_personal_challenge_standings(): the RPC behind Home's personal
--     challenge standings, which failed with a "column does not exist"
--     error instead.
-- admin_reset_personal_challenge() is an unwired testing tool with the same
-- stale reference; fixed here too while we're at it.

create or replace function public.attach_reset_challenge_credit()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
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

create or replace function public.get_personal_challenge_standings(
  start_date_in date,
  end_date_in date
)
returns table(
  result_user_id uuid,
  game text,
  challenge_date date,
  seconds integer,
  mistakes integer,
  hints integer,
  zip_backtracked_cells integer,
  zip_required_moves integer,
  completed_at timestamptz
)
language sql
security definer
stable
set search_path=public
as $$
  select
    gs.user_id,
    gs.game,
    gs.challenge_date,
    gs.seconds,
    gs.mistakes,
    gs.hints,
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

revoke all on function public.get_personal_challenge_standings(date,date)
  from public;
grant execute on function public.get_personal_challenge_standings(date,date)
  to authenticated;

create or replace function public.admin_reset_personal_challenge(
  target_challenge_date date,
  target_game text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  removed_count integer := 0;
  reversed_reward_count integer := 0;
  reversed_points bigint := 0;
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

  return jsonb_build_object(
    'challenge_date',target_challenge_date,
    'results_removed',removed_count,
    'rewards_reversed',reversed_reward_count,
    'points_reversed',reversed_points
  );
end;
$$;

revoke all on function public.admin_reset_personal_challenge(date,text)
  from public;
grant execute on function public.admin_reset_personal_challenge(date,text)
  to authenticated;

notify pgrst,'reload schema';
