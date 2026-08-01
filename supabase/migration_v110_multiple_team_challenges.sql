begin;

alter table public.team_weekly_challenges
  add column if not exists title text not null default 'Weekly challenge';

alter table public.team_weekly_challenges
  drop constraint if exists team_weekly_challenges_team_id_week_start_key;
drop index if exists public.team_weekly_challenges_team_week_unique;

create index if not exists team_weekly_challenges_team_week_idx
on public.team_weekly_challenges(team_id,week_start,created_at);

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
  is_locked boolean
)
language sql
security definer
stable
set search_path=public
as $$
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
        select 1 from public.team_challenge_starts start
        where start.challenge_id=challenge.id
      )
      or exists(
        select 1 from public.game_stats result
        where result.team_challenge_id=challenge.id
      )
    )
  from public.team_members membership
  join public.teams team on team.id=membership.team_id
  join public.team_weekly_challenges challenge
    on challenge.team_id=team.id
   and challenge.week_start=public.current_week_start()
  where membership.user_id=auth.uid()
    and public.is_approved_user(auth.uid())
  order by team.name,challenge.created_at,challenge.id;
$$;

revoke all on function public.get_my_active_team_challenges() from public;
grant execute on function public.get_my_active_team_challenges() to authenticated;

drop function if exists public.set_team_weekly_challenge(bigint,text[]);
drop function if exists public.set_team_weekly_challenge(bigint,text[],integer[],integer);
drop function if exists public.set_team_weekly_challenge(bigint,text[],integer[],integer,text,text);
drop function if exists public.set_team_weekly_challenge(uuid,text[],integer[],integer);
drop function if exists public.set_team_weekly_challenge(uuid,text[],integer[],integer,text,text);

create function public.set_team_weekly_challenge(
  target_team_id bigint,
  selected_games text[],
  selected_days integer[],
  reward_points_in integer default 0,
  reward_type_in text default 'points',
  reward_label_in text default null,
  target_challenge_id bigint default null,
  challenge_title_in text default null
)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  current_challenge public.team_weekly_challenges;
  result_id bigint;
  clean_games text[];
  clean_days integer[];
  clean_title text:=nullif(btrim(challenge_title_in),'');
  clean_reward_type text:=coalesce(nullif(btrim(reward_type_in),''),'points');
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.teams
    where id=target_team_id and created_by=auth.uid()
  ) then
    raise exception 'Only the team owner can manage challenges.' using errcode='42501';
  end if;

  select array_agg(distinct game order by game)
  into clean_games
  from unnest(selected_games) game
  where game in ('hive','tango','gridly','minisudoku','geo');

  select array_agg(distinct day order by day)
  into clean_days
  from unnest(selected_days) day
  where day between 1 and 7;

  if coalesce(cardinality(clean_games),0)=0 then raise exception 'Choose at least one game.'; end if;
  if coalesce(cardinality(clean_days),0)=0 then raise exception 'Choose at least one playing day.'; end if;
  if clean_title is null then raise exception 'Enter a challenge name.'; end if;
  if char_length(clean_title)>60 then raise exception 'Challenge names can be up to 60 characters.'; end if;
  if coalesce(reward_points_in,0) not between 0 and 100000 then raise exception 'Reward must be between 0 and 100,000 points.'; end if;
  if clean_reward_type not in ('points','prize') then raise exception 'Invalid reward type.'; end if;
  if clean_reward_type='prize' and nullif(btrim(reward_label_in),'') is null then raise exception 'Enter the prize.'; end if;

  if target_challenge_id is not null then
    select * into current_challenge
    from public.team_weekly_challenges
    where id=target_challenge_id
      and team_id=target_team_id
      and week_start=public.current_week_start()
    for update;
    if not found then raise exception 'Challenge not found.'; end if;
    if current_challenge.locked_at is not null
       or exists(select 1 from public.team_challenge_starts where challenge_id=current_challenge.id)
       or exists(select 1 from public.game_stats where team_challenge_id=current_challenge.id) then
      update public.team_weekly_challenges
      set locked_at=coalesce(locked_at,now())
      where id=current_challenge.id;
      raise exception 'This challenge is already in progress and is locked.' using errcode='55000';
    end if;

    update public.team_weekly_challenges
    set
      title=clean_title,
      game_ids=clean_games,
      active_days=clean_days,
      reward_points=case when clean_reward_type='points' then greatest(coalesce(reward_points_in,0),0) else 0 end,
      reward_type=clean_reward_type,
      reward_label=case when clean_reward_type='prize' then nullif(btrim(reward_label_in),'') else null end,
      updated_at=now()
    where id=current_challenge.id
    returning id into result_id;
  else
    if (
      select count(*)
      from public.team_weekly_challenges
      where team_id=target_team_id
        and week_start=public.current_week_start()
    )>=10 then
      raise exception 'A team can create up to 10 challenges per week.';
    end if;

    insert into public.team_weekly_challenges(
      team_id,week_start,title,game_ids,active_days,reward_points,
      reward_type,reward_label,created_by
    )
    values(
      target_team_id,
      public.current_week_start(),
      clean_title,
      clean_games,
      clean_days,
      case when clean_reward_type='points' then greatest(coalesce(reward_points_in,0),0) else 0 end,
      clean_reward_type,
      case when clean_reward_type='prize' then nullif(btrim(reward_label_in),'') else null end,
      auth.uid()
    )
    returning id into result_id;
  end if;

  return result_id;
end;
$$;

revoke all on function public.set_team_weekly_challenge(bigint,text[],integer[],integer,text,text,bigint,text) from public;
grant execute on function public.set_team_weekly_challenge(bigint,text[],integer[],integer,text,text,bigint,text) to authenticated;

drop function if exists public.get_my_team_rosters();
create function public.get_my_team_rosters()
returns table(
  team_id bigint,
  user_id uuid,
  member_name text,
  member_icon text,
  member_mood text,
  is_owner boolean,
  show_stats_to_others boolean
)
language sql
security definer
stable
set search_path=public
as $$
  select
    membership.team_id,
    membership.user_id,
    profile.name::text,
    profile.icon::text,
    profile.mood::text,
    (team.created_by=membership.user_id),
    profile.show_stats_to_others
  from public.team_members membership
  join public.teams team on team.id=membership.team_id
  join public.profiles profile on profile.id=membership.user_id
  where (
    public.is_admin(auth.uid())
    or exists(
      select 1
      from public.team_members mine
      where mine.team_id=membership.team_id
        and mine.user_id=auth.uid()
    )
  )
    and profile.account_deleted_at is null
  order by membership.team_id,(team.created_by=membership.user_id) desc,profile.name;
$$;

revoke all on function public.get_my_team_rosters() from public;
grant execute on function public.get_my_team_rosters() to authenticated;

notify pgrst,'reload schema';
commit;
