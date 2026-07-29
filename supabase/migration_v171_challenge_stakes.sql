-- v171: Challenge stakes — attach an approved reward item to a team weekly
-- challenge; each player must individually accept the split before they can
-- play. The app never moves money, only records who agreed to what.
-- Run after v170.

begin;

alter table public.team_weekly_challenges add column if not exists stake_reward_id bigint references public.rewards(id);
alter table public.team_weekly_challenges add column if not exists stake_split_method text;
alter table public.team_weekly_challenges drop constraint if exists team_weekly_challenges_stake_split_method_check;
alter table public.team_weekly_challenges add constraint team_weekly_challenges_stake_split_method_check
  check (stake_split_method is null or stake_split_method in ('equal','ranked'));

create table if not exists public.team_challenge_stake_acceptances (
  challenge_id bigint not null references public.team_weekly_challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  accepted_at timestamptz not null default now(),
  primary key (challenge_id,user_id)
);
alter table public.team_challenge_stake_acceptances enable row level security;
drop policy if exists "team members can view stake acceptances" on public.team_challenge_stake_acceptances;
create policy "team members can view stake acceptances" on public.team_challenge_stake_acceptances
  for select using (
    exists(
      select 1 from public.team_weekly_challenges c
      join public.team_members m on m.team_id=c.team_id
      where c.id=team_challenge_stake_acceptances.challenge_id and m.user_id=auth.uid()
    )
  );

create or replace function public.set_team_challenge_stake(
  target_challenge_id bigint,
  target_reward_id bigint,
  split_method text
) returns void language plpgsql security definer set search_path=public as $$
declare challenge public.team_weekly_challenges;
begin
  select * into challenge from public.team_weekly_challenges where id=target_challenge_id for update;
  if not found then raise exception 'Challenge not found.'; end if;
  if not exists(select 1 from public.teams where id=challenge.team_id and created_by=auth.uid()) then
    raise exception 'Only the team owner can set a stake.' using errcode='42501';
  end if;
  if challenge.locked_at is not null or challenge.closed_at is not null then
    raise exception 'This challenge is already in progress and is locked.' using errcode='55000';
  end if;
  if split_method not in ('equal','ranked') then raise exception 'Invalid split method.'; end if;
  if not exists(select 1 from public.rewards where id=target_reward_id and status='active') then
    raise exception 'Choose an approved item.';
  end if;

  update public.team_weekly_challenges set
    stake_reward_id=target_reward_id,
    stake_split_method=split_method,
    reward_type='points',
    reward_points=0,
    reward_label=null,
    updated_at=now()
  where id=target_challenge_id;

  delete from public.team_challenge_stake_acceptances where challenge_id=target_challenge_id;
end; $$;
revoke all on function public.set_team_challenge_stake(bigint,bigint,text) from public;
grant execute on function public.set_team_challenge_stake(bigint,bigint,text) to authenticated;

create or replace function public.accept_challenge_stake(target_challenge_id bigint)
returns void language plpgsql security definer set search_path=public as $$
declare challenge public.team_weekly_challenges;
begin
  select * into challenge from public.team_weekly_challenges where id=target_challenge_id;
  if not found then raise exception 'Challenge not found.'; end if;
  if challenge.stake_reward_id is null then raise exception 'This challenge has no stake to accept.'; end if;
  if not exists(select 1 from public.team_members where team_id=challenge.team_id and user_id=auth.uid()) then
    raise exception 'You are not a member of this team.' using errcode='42501';
  end if;
  insert into public.team_challenge_stake_acceptances(challenge_id,user_id) values(target_challenge_id,auth.uid())
  on conflict do nothing;
end; $$;
revoke all on function public.accept_challenge_stake(bigint) from public;
grant execute on function public.accept_challenge_stake(bigint) to authenticated;

-- ---------- get_my_active_team_challenges: surface stake info ----------
-- Identical to migration_v118_team_challenge_weekly_rollover.sql's definition
-- with three new output columns appended.
drop function if exists public.get_my_active_team_challenges();
create function public.get_my_active_team_challenges()
returns table(
  challenge_id bigint,
  team_id bigint,
  team_name text,
  team_emoji text,
  challenge_title text,
  game_ids text[],
  active_days integer[],
  reward_points integer,
  reward_type text,
  reward_label text,
  active_today boolean,
  is_locked boolean,
  repeats_weekly boolean,
  series_weeks integer,
  occurrence_number integer,
  closes_on date,
  stake_reward_id bigint,
  stake_reward_name text,
  stake_split_method text,
  stake_accepted boolean
)
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.finalize_due_team_challenges();

  return query
  select
    challenge.id,
    team.id,
    team.name::text,
    coalesce(team.emoji,'⭐')::text,
    coalesce(nullif(btrim(challenge.title),''),'Weekly challenge')::text,
    challenge.game_ids,
    challenge.active_days,
    challenge.reward_points,
    challenge.reward_type,
    challenge.reward_label,
    extract(isodow from public.app_today())::integer=any(challenge.active_days),
    (
      challenge.locked_at is not null
      or exists(
        select 1
        from public.team_challenge_starts challenge_start
        where challenge_start.challenge_id=challenge.id
      )
      or exists(
        select 1
        from public.game_stats result
        where result.team_challenge_id=challenge.id
      )
    ),
    challenge.repeats_weekly,
    challenge.series_weeks,
    challenge.occurrence_number,
    challenge.week_start+
      (select max(day_number)-1 from unnest(challenge.active_days) day_number),
    challenge.stake_reward_id,
    stake_reward.name::text,
    challenge.stake_split_method,
    exists(
      select 1 from public.team_challenge_stake_acceptances a
      where a.challenge_id=challenge.id and a.user_id=auth.uid()
    )
  from public.team_members membership
  join public.teams team on team.id=membership.team_id
  join public.team_weekly_challenges challenge
    on challenge.team_id=team.id
   and challenge.week_start=public.current_week_start()
  left join public.rewards stake_reward on stake_reward.id=challenge.stake_reward_id
  where membership.user_id=auth.uid()
    and public.is_approved_user(auth.uid())
    and challenge.closed_at is null
  order by team.name,challenge.created_at,challenge.id;
end;
$$;

revoke all on function public.get_my_active_team_challenges() from public;
grant execute on function public.get_my_active_team_challenges() to authenticated;

-- ---------- start_team_challenge_game: gate on stake acceptance ----------
-- Identical to migration_v120_daily_team_challenge_rounds.sql's definition
-- with one new check inserted after the team-membership check.
create or replace function public.start_team_challenge_game(
  target_challenge_id bigint,
  target_game text,
  target_challenge_date date
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  challenge public.team_weekly_challenges;
  assigned_round public.team_challenge_rounds;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.'
      using errcode='42501';
  end if;

  select *
  into challenge
  from public.team_weekly_challenges
  where id=target_challenge_id;

  if not found then
    raise exception 'Team challenge not found.' using errcode='22023';
  end if;
  if challenge.closed_at is not null then
    raise exception 'This team challenge is finished.' using errcode='55000';
  end if;
  if not exists(
    select 1
    from public.team_members member
    where member.team_id=challenge.team_id
      and member.user_id=auth.uid()
  ) then
    raise exception 'You are not a member of this team.' using errcode='42501';
  end if;
  if challenge.stake_reward_id is not null and not exists(
    select 1 from public.team_challenge_stake_acceptances a
    where a.challenge_id=challenge.id and a.user_id=auth.uid()
  ) then
    raise exception 'Accept this challenge''s stake before playing today''s round.' using errcode='42501';
  end if;
  if target_challenge_date is distinct from public.app_today() then
    raise exception 'Team challenge rounds can only be played on their scheduled day.'
      using errcode='22023';
  end if;

  perform public.ensure_team_challenge_rounds(challenge.id);

  select *
  into assigned_round
  from public.team_challenge_rounds
  where challenge_id=challenge.id
    and challenge_date=target_challenge_date;

  if not found then
    raise exception 'This team challenge has no round scheduled today.'
      using errcode='22023';
  end if;
  if assigned_round.game is distinct from target_game then
    raise exception 'Today''s assigned game is %.',assigned_round.game
      using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format(
        'team-challenge-round:%s:%s:%s',
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
    where result.team_challenge_id=challenge.id
      and result.user_id=auth.uid()
      and result.challenge_date=target_challenge_date
  ) then
    raise exception 'You already completed today''s challenge round.'
      using errcode='23505';
  end if;

  insert into public.team_challenge_starts(
    challenge_id,player_id,game,challenge_date
  )
  values(
    challenge.id,auth.uid(),assigned_round.game,target_challenge_date
  )
  on conflict do nothing;

  update public.team_weekly_challenges
  set locked_at=coalesce(locked_at,now())
  where id=challenge.id;
end;
$$;

revoke all on function public.start_team_challenge_game(bigint,text,date) from public;
grant execute on function public.start_team_challenge_game(bigint,text,date) to authenticated;

notify pgrst,'reload schema';
commit;
