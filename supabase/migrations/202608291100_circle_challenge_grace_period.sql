-- Circle rounds remain ranked for the scheduled local day plus one complete
-- 24-hour grace day. The Circle timezone owns both boundaries.

create or replace function public.circle_challenge_round_state(
  target_challenge_id bigint,target_challenge_date date,at_time timestamptz default now()
) returns text language plpgsql stable security definer set search_path='public' as $$
declare local_now timestamp; zone text;
begin
  select public.resolve_timezone(circle.timezone) into zone
  from public.circle_weekly_challenges challenge join public.circles circle on circle.id=challenge.circle_id
  where challenge.id=target_challenge_id;
  if zone is null then return 'final'; end if;
  local_now:=timezone(zone,at_time);
  return case
    when local_now<target_challenge_date::timestamp then 'scheduled'
    when local_now<(target_challenge_date+1)::timestamp then 'open'
    when local_now<(target_challenge_date+2)::timestamp then 'grace'
    else 'final'
  end;
end $$;
revoke all on function public.circle_challenge_round_state(bigint,date,timestamptz) from public,anon,authenticated;

create or replace function public.circle_challenge_round_cutoff(target_challenge_id bigint,target_challenge_date date)
returns timestamptz language sql stable security definer set search_path='public' as $$
  select ((target_challenge_date+2)::timestamp at time zone public.resolve_timezone(circle.timezone))
  from public.circle_weekly_challenges challenge join public.circles circle on circle.id=challenge.circle_id
  where challenge.id=target_challenge_id
$$;
revoke all on function public.circle_challenge_round_cutoff(bigint,date) from public,anon,authenticated;

create function public.get_my_circle_challenge_round_states(target_challenge_id bigint)
returns table(challenge_date date,game text,round_number integer,round_state text,closes_at timestamptz)
language plpgsql security definer set search_path='public' as $$
begin
  if not public.is_approved_user(auth.uid()) or not exists(
    select 1 from public.circle_weekly_challenges challenge
    where challenge.id=target_challenge_id and (
      exists(select 1 from public.circle_members member where member.circle_id=challenge.circle_id and member.user_id=auth.uid())
      or exists(select 1 from public.game_stats result where result.circle_challenge_id=challenge.id and result.user_id=auth.uid())
    )
  ) then raise exception 'Circle challenge not found.' using errcode='42501'; end if;
  perform public.ensure_circle_challenge_rounds(target_challenge_id);
  return query select round_item.challenge_date,round_item.game,round_item.round_number,
    public.circle_challenge_round_state(target_challenge_id,round_item.challenge_date),
    public.circle_challenge_round_cutoff(target_challenge_id,round_item.challenge_date)
  from public.circle_challenge_rounds round_item where round_item.challenge_id=target_challenge_id order by round_item.round_number;
end $$;
revoke all on function public.get_my_circle_challenge_round_states(bigint) from public,anon;
grant execute on function public.get_my_circle_challenge_round_states(bigint) to authenticated;

-- Keep the mature award/message implementation, but put the authoritative
-- grace guard in front of every existing caller (trigger and scheduled RPC).
alter function public.finalize_circle_challenge(bigint) rename to finalize_circle_challenge_after_grace;
create function public.finalize_circle_challenge(target_challenge_id bigint) returns uuid
language plpgsql security definer set search_path='public' as $$
declare last_round date;
begin
  perform public.ensure_circle_challenge_rounds(target_challenge_id);
  select max(challenge_date) into last_round from public.circle_challenge_rounds where challenge_id=target_challenge_id;
  if last_round is null or public.circle_challenge_round_state(target_challenge_id,last_round)<>'final' then return null; end if;
  return public.finalize_circle_challenge_after_grace(target_challenge_id);
end $$;
revoke all on function public.finalize_circle_challenge(bigint) from public,anon,authenticated;
revoke all on function public.finalize_circle_challenge_after_grace(bigint) from public,anon,authenticated;

-- Replace the scheduled-day-only starter. It still validates membership,
-- stake acceptance, exact assigned game/date and duplicate attempts; only the
-- authoritative open/grace states can create a ranked start.
alter function public.start_circle_challenge_game(bigint,text,date) rename to start_circle_challenge_game_scheduled_day_only;
create function public.start_circle_challenge_game(target_challenge_id bigint,target_game text,target_challenge_date date) returns void
language plpgsql security definer set search_path='public' as $$
declare challenge public.circle_weekly_challenges; assigned_round public.circle_challenge_rounds; state text;
begin
  if not public.is_approved_user(auth.uid()) then raise exception 'Your account must be approved first.' using errcode='42501'; end if;
  select * into challenge from public.circle_weekly_challenges where id=target_challenge_id;
  if not found then raise exception 'Circle challenge not found.' using errcode='22023'; end if;
  if challenge.closed_at is not null then raise exception 'This circle challenge is finished.' using errcode='55000'; end if;
  if not exists(select 1 from public.circle_members member where member.circle_id=challenge.circle_id and member.user_id=auth.uid()) then raise exception 'You are not a member of this circle.' using errcode='42501'; end if;
  if (challenge.stake_reward_id is not null or challenge.reward_type='prize') and not exists(
    select 1 from public.circle_challenge_stake_acceptances acceptance where acceptance.challenge_id=challenge.id and acceptance.user_id=auth.uid()
  ) then raise exception 'Accept what this challenge puts at stake before playing this round.' using errcode='42501'; end if;
  perform public.ensure_circle_challenge_rounds(challenge.id);
  select * into assigned_round from public.circle_challenge_rounds
  where challenge_id=challenge.id and challenge_date=target_challenge_date;
  if not found then raise exception 'This date is not a scheduled Circle challenge round.' using errcode='22023'; end if;
  if assigned_round.game is distinct from target_game then raise exception 'The assigned game is %.',assigned_round.game using errcode='22023'; end if;
  state:=public.circle_challenge_round_state(challenge.id,target_challenge_date);
  if state not in ('open','grace') then raise exception 'Ranked play for this Circle challenge round is closed.' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(hashtextextended(format('circle-challenge-round:%s:%s:%s',challenge.id,auth.uid(),target_challenge_date),0));
  if exists(select 1 from public.game_stats result where result.circle_challenge_id=challenge.id and result.user_id=auth.uid() and result.challenge_date=target_challenge_date) then raise exception 'You already completed this challenge round.' using errcode='23505'; end if;
  insert into public.circle_challenge_starts(challenge_id,player_id,game,challenge_date)
  values(challenge.id,auth.uid(),assigned_round.game,target_challenge_date) on conflict do nothing;
  update public.circle_weekly_challenges set locked_at=coalesce(locked_at,now()) where id=challenge.id;
end $$;
revoke all on function public.start_circle_challenge_game(bigint,text,date) from public,anon;
grant execute on function public.start_circle_challenge_game(bigint,text,date) to authenticated;
revoke all on function public.start_circle_challenge_game_scheduled_day_only(bigint,text,date) from public,anon,authenticated;

-- A Sunday round is in grace on Monday, after the active-week RPC has moved
-- to the next occurrence. Return those cross-week occurrences without
-- changing the established active RPC's record signature.
create function public.get_my_grace_circle_challenges() returns setof jsonb
language plpgsql security definer set search_path='public' as $$
begin
  if not public.is_approved_user(auth.uid()) then return; end if;
  return query
  select jsonb_build_object(
    'challenge_id',challenge.id,'circle_id',circle.id,'circle_name',circle.name,
    'circle_emoji',coalesce(circle.emoji,'⭐'),'challenge_title',coalesce(nullif(btrim(challenge.title),''),'Weekly challenge'),
    'week_start',challenge.week_start,'game_ids',challenge.game_ids,'active_days',challenge.active_days,
    'reward_points',challenge.reward_points,'reward_type',challenge.reward_type,'reward_label',challenge.reward_label,
    'repeats_weekly',challenge.repeats_weekly,'series_weeks',challenge.series_weeks,'occurrence_number',challenge.occurrence_number,
    'reward_goes_to',challenge.reward_goes_to,'stake_reward_id',challenge.stake_reward_id,
    'stake_split_method',challenge.stake_split_method,
    'stake_accepted',exists(select 1 from public.circle_challenge_stake_acceptances acceptance where acceptance.challenge_id=challenge.id and acceptance.user_id=auth.uid())
  )
  from public.circle_members membership
  join public.circle_weekly_challenges challenge on challenge.circle_id=membership.circle_id
  join public.circles circle on circle.id=challenge.circle_id
  where membership.user_id=auth.uid() and challenge.closed_at is null
    and challenge.week_start<>public.circle_week_start(circle.id)
    and exists(
      select 1 from public.circle_challenge_rounds round_item
      where round_item.challenge_id=challenge.id
        and public.circle_challenge_round_state(challenge.id,round_item.challenge_date)='grace'
    );
end $$;
revoke all on function public.get_my_grace_circle_challenges() from public,anon;
grant execute on function public.get_my_grace_circle_challenges() to authenticated;

-- Direct table inserts are the result-write path. Recheck the same rule here
-- so a stale or custom client cannot submit ranked results after the cutoff.
create function public.enforce_circle_challenge_result_window() returns trigger
language plpgsql security definer set search_path='public' as $$
begin
  if new.mode<>'challenge' or new.circle_challenge_id is null then return new; end if;
  if new.user_id<>auth.uid() or not exists(
    select 1 from public.circle_weekly_challenges challenge
    join public.circle_challenge_rounds round_item on round_item.challenge_id=challenge.id
    where challenge.id=new.circle_challenge_id and challenge.circle_id=new.circle_id
      and challenge.closed_at is null and round_item.challenge_date=new.challenge_date
      and round_item.game=new.game
      and public.circle_challenge_round_state(challenge.id,round_item.challenge_date) in ('open','grace')
      and exists(select 1 from public.circle_members member where member.circle_id=challenge.circle_id and member.user_id=new.user_id)
  ) then raise exception 'Ranked play for this Circle challenge round is closed.' using errcode='55000'; end if;
  return new;
end $$;
revoke all on function public.enforce_circle_challenge_result_window() from public,anon,authenticated;
drop trigger if exists game_stats_enforce_circle_challenge_window on public.game_stats;
create trigger game_stats_enforce_circle_challenge_window before insert on public.game_stats
for each row execute function public.enforce_circle_challenge_result_window();
