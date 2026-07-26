-- V118: carry team challenge configurations into each new app week.
--
-- Challenge attempts, results and winners remain attached to their original
-- challenge IDs. Only the setup is copied: the new week receives fresh IDs,
-- empty progress and an unlocked state.

begin;

create or replace function public.rollover_my_team_challenges()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  team_row record;
  source_week date;
  copied_count integer:=0;
  inserted_count integer:=0;
begin
  if not public.is_approved_user(auth.uid()) then
    return 0;
  end if;

  for team_row in
    select distinct team.id,team.created_by
    from public.team_members membership
    join public.teams team on team.id=membership.team_id
    where membership.user_id=auth.uid()
    order by team.id
  loop
    -- Several members can open Home simultaneously on Monday. Serialize the
    -- one-time copy per team so that multiple challenge rows are not cloned
    -- twice.
    perform pg_advisory_xact_lock(118,(team_row.id % 2147483647)::integer);

    if exists(
      select 1
      from public.team_weekly_challenges current_challenge
      where current_challenge.team_id=team_row.id
        and current_challenge.week_start=public.current_week_start()
    ) then
      continue;
    end if;

    select max(previous.week_start)
    into source_week
    from public.team_weekly_challenges previous
    where previous.team_id=team_row.id
      and previous.week_start<public.current_week_start();

    if source_week is null then
      continue;
    end if;

    insert into public.team_weekly_challenges(
      team_id,
      week_start,
      title,
      game_ids,
      active_days,
      reward_points,
      reward_type,
      reward_label,
      locked_at,
      created_by
    )
    select
      previous.team_id,
      public.current_week_start(),
      previous.title,
      previous.game_ids,
      previous.active_days,
      previous.reward_points,
      previous.reward_type,
      previous.reward_label,
      null,
      team_row.created_by
    from public.team_weekly_challenges previous
    where previous.team_id=team_row.id
      and previous.week_start=source_week
    order by previous.created_at,previous.id;

    get diagnostics inserted_count=row_count;
    copied_count:=copied_count+inserted_count;
  end loop;

  return copied_count;
end;
$$;

revoke all on function public.rollover_my_team_challenges() from public;
grant execute on function public.rollover_my_team_challenges() to authenticated;

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
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.rollover_my_team_challenges();

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
        select 1 from public.team_challenge_starts challenge_start
        where challenge_start.challenge_id=challenge.id
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
end;
$$;

revoke all on function public.get_my_active_team_challenges() from public;
grant execute on function public.get_my_active_team_challenges() to authenticated;

notify pgrst,'reload schema';
commit;
