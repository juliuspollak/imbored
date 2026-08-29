-- A grace period exists for players who still need to finish. Once every
-- eligible participant has completed every ranked round there is nothing left
-- to wait for, so the occurrence can become final immediately.

create or replace function public.circle_challenge_all_eligible_players_complete(target_challenge_id bigint)
returns boolean
language sql
stable
security definer
set search_path='public'
as $$
  with challenge_info as (
    select challenge.id,challenge.circle_id,challenge.stake_reward_id,challenge.reward_type
    from public.circle_weekly_challenges challenge
    where challenge.id=target_challenge_id
  ), eligible_players as (
    select member.user_id
    from challenge_info challenge
    join public.circle_members member on member.circle_id=challenge.circle_id
    where (
      challenge.stake_reward_id is null and coalesce(challenge.reward_type,'')<>'prize'
    ) or exists(
      select 1
      from public.circle_challenge_stake_acceptances acceptance
      where acceptance.challenge_id=challenge.id and acceptance.user_id=member.user_id
    )
  ), required_rounds as (
    select round_item.challenge_date,round_item.game
    from public.circle_challenge_rounds round_item
    where round_item.challenge_id=target_challenge_id
  )
  select exists(select 1 from eligible_players)
    and exists(select 1 from required_rounds)
    and not exists(
      select 1
      from eligible_players player
      cross join required_rounds round_item
      where not exists(
        select 1
        from public.game_stats result
        where result.circle_challenge_id=target_challenge_id
          and result.user_id=player.user_id
          and result.mode='challenge'
          and result.challenge_date=round_item.challenge_date
          and result.game=round_item.game
      )
    )
$$;
revoke all on function public.circle_challenge_all_eligible_players_complete(bigint) from public,anon,authenticated;

-- A persisted close is authoritative. This also makes history/standings show a
-- genuinely completed occurrence as final even if its time-based grace cutoff
-- has not yet elapsed.
create or replace function public.circle_challenge_round_state(
  target_challenge_id bigint,target_challenge_date date,at_time timestamptz default now()
) returns text language plpgsql stable security definer set search_path='public' as $$
declare local_now timestamp; zone text; challenge_closed_at timestamptz;
begin
  select public.resolve_timezone(circle.timezone),challenge.closed_at
  into zone,challenge_closed_at
  from public.circle_weekly_challenges challenge
  join public.circles circle on circle.id=challenge.circle_id
  where challenge.id=target_challenge_id;

  if zone is null then return 'final'; end if;
  if challenge_closed_at is not null then return 'final'; end if;

  local_now:=timezone(zone,at_time);
  return case
    when local_now<target_challenge_date::timestamp then 'scheduled'
    when local_now<(target_challenge_date+1)::timestamp then 'open'
    when local_now<(target_challenge_date+2)::timestamp then 'grace'
    else 'final'
  end;
end $$;
revoke all on function public.circle_challenge_round_state(bigint,date,timestamptz) from public,anon,authenticated;

-- Keep the existing mature award/message finalizer. The grace cutoff still
-- finalizes incomplete occurrences, while a fully completed occurrence can
-- finalize immediately.
create or replace function public.finalize_circle_challenge(target_challenge_id bigint) returns uuid
language plpgsql security definer set search_path='public' as $$
declare last_round date;
begin
  perform public.ensure_circle_challenge_rounds(target_challenge_id);
  select max(challenge_date) into last_round
  from public.circle_challenge_rounds
  where challenge_id=target_challenge_id;

  if last_round is null then return null; end if;

  if public.circle_challenge_round_state(target_challenge_id,last_round)<>'final'
    and not public.circle_challenge_all_eligible_players_complete(target_challenge_id)
  then
    return null;
  end if;

  return public.finalize_circle_challenge_after_grace(target_challenge_id);
end $$;
revoke all on function public.finalize_circle_challenge(bigint) from public,anon,authenticated;

-- Repair already-open occurrences that are currently sitting in grace even
-- though every eligible participant has finished. No game result is changed.
do $$
declare item record;
begin
  for item in
    select challenge.id
    from public.circle_weekly_challenges challenge
    where challenge.closed_at is null
      and public.circle_challenge_all_eligible_players_complete(challenge.id)
  loop
    perform public.finalize_circle_challenge(item.id);
  end loop;
end $$;
