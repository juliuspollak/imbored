-- True admin hard reset for personal challenges v131
--
-- The reset control is an end-to-end testing tool. Remove both the selected
-- personal challenge results and their completion rewards so replaying can
-- exercise result saving, scoring and point awards from a clean state.

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
    and result.team_challenge_id is null
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
      select player_id,sum(points) as points
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
    select player_id,sum(points) as points
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
    and result.team_challenge_id is null
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
