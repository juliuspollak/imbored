-- Manage a repeating Circle challenge as one immutable-after-start series.
-- Apply manually in Supabase SQL Editor, after preceding migrations.
create or replace function public.update_circle_challenge_series(
  target_series_id bigint,
  duration_weeks_in integer,
  challenge_title_in text,
  selected_games text[],
  selected_days integer[],
  reward_points_in integer,
  reward_type_in text,
  reward_label_in text,
  reward_goes_to_in text
) returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  first_week public.circle_weekly_challenges%rowtype;
  template_week public.circle_weekly_challenges%rowtype;
  existing_weeks integer;
  offset_no integer;
  is_started boolean;
  games_clean text[];
  days_clean integer[];
  title_clean text;
  new_week date;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved.' using errcode='42501';
  end if;
  select * into first_week from public.circle_weekly_challenges
    where id=target_series_id and series_id=target_series_id and repeats_weekly=true
    for update;
  if not found then raise exception 'Challenge series not found.' using errcode='22023'; end if;
  if not exists(select 1 from public.circles where id=first_week.circle_id and created_by=auth.uid()) then
    raise exception 'Only the circle owner may manage this series.' using errcode='42501';
  end if;
  if duration_weeks_in not between 2 and 52 then raise exception 'Choose 2 to 52 weeks.' using errcode='22023'; end if;

  -- Lock every occurrence to serialize changes and protect results.
  perform 1 from public.circle_weekly_challenges
    where series_id=target_series_id order by week_start for update;
  select count(*) into existing_weeks from public.circle_weekly_challenges where series_id=target_series_id;
  if existing_weeks < 1 or existing_weeks > 52 then
    raise exception 'Series records are inconsistent.' using errcode='22023';
  end if;
  if exists(
    select 1 from public.circle_weekly_challenges c
    where c.series_id=target_series_id
      and (c.occurrence_number<1 or c.occurrence_number>existing_weeks
        or c.week_start<>first_week.week_start+((c.occurrence_number-1)*7))
  ) then raise exception 'Series weeks need repair before editing.' using errcode='22023'; end if;

  select exists(
    select 1 from public.circle_weekly_challenges c
    where c.series_id=target_series_id and
      (c.locked_at is not null or c.closed_at is not null
       or exists(select 1 from public.circle_challenge_starts s where s.challenge_id=c.id)
       or exists(select 1 from public.game_stats g where g.circle_challenge_id=c.id))
  ) into is_started;

  -- Once a participant begins, only duration can change. Compare with the
  -- second week (first week may skip passed weekdays on initial creation).
  select * into template_week from public.circle_weekly_challenges
    where series_id=target_series_id
    order by occurrence_number desc limit 1;

  select array_agg(game order by first_position) into games_clean from (
    select game,min(item.ordinality) first_position
    from unnest(selected_games) with ordinality item(game,ordinality)
    where game in ('hive','binary','gridly','minisudoku','geo','zoom')
    group by game
  ) valid;
  select array_agg(distinct day order by day) into days_clean
    from unnest(selected_days) day where day between 1 and 7;
  title_clean:=nullif(btrim(challenge_title_in),'');
  if title_clean is null or length(title_clean)>60
     or coalesce(cardinality(games_clean),0)=0
     or coalesce(cardinality(days_clean),0)=0
     or reward_type_in not in ('points','prize')
     or coalesce(reward_points_in,0) not between 0 and 50
     or (reward_type_in='prize' and nullif(btrim(reward_label_in),'') is null)
     or reward_goes_to_in not in ('winner','loser') then
    raise exception 'Invalid challenge settings.' using errcode='22023';
  end if;

  if is_started and (
    title_clean<>template_week.title
    or games_clean is distinct from template_week.game_ids
    or days_clean is distinct from template_week.active_days
    or reward_type_in<>template_week.reward_type
    or (reward_type_in='points' and reward_points_in<>template_week.reward_points)
    or (reward_type_in='prize' and nullif(btrim(reward_label_in),'') is distinct from template_week.reward_label)
    or (reward_type_in='prize' and reward_goes_to_in<>template_week.reward_goes_to)
  ) then
    raise exception 'Someone has started. Only series duration may change.' using errcode='55000';
  end if;

  -- Do not silently rewrite or remove stake commitments; those have their own
  -- acceptance and settlement lifecycle.
  if not is_started and exists(
    select 1 from public.circle_weekly_challenges
    where series_id=target_series_id and stake_reward_id is not null
  ) and (
    games_clean is distinct from template_week.game_ids
    or days_clean is distinct from template_week.active_days
    or title_clean<>template_week.title
    or reward_type_in<>template_week.reward_type
    or reward_points_in<>template_week.reward_points
  ) then
    raise exception 'Stake series settings cannot be changed once commitments exist.' using errcode='55000';
  end if;

  -- Shortening removes only future, untouched occurrences, never the current
  -- week, and never weeks with results, starts, rewards, or stake agreements.
  if duration_weeks_in<existing_weeks then
    if exists(
      select 1 from public.circle_weekly_challenges c
      where c.series_id=target_series_id and c.occurrence_number>duration_weeks_in
        and (c.week_start<=public.circle_week_start(first_week.circle_id)
          or c.locked_at is not null or c.closed_at is not null
          or c.stake_reward_id is not null
          or exists(select 1 from public.circle_challenge_starts s where s.challenge_id=c.id)
          or exists(select 1 from public.game_stats g where g.circle_challenge_id=c.id)
          or exists(select 1 from public.circle_challenge_reward_awards a where a.challenge_id=c.id)
          or exists(select 1 from public.circle_challenge_stake_acceptances a where a.challenge_id=c.id))
    ) then raise exception 'Cannot shorten: a removed week has started or has committed results or rewards.' using errcode='55000'; end if;
    delete from public.circle_weekly_challenges
      where series_id=target_series_id and occurrence_number>duration_weeks_in;
  end if;

  -- Before play begins, settings apply to the entire series, not one week.
  if not is_started then
    update public.circle_weekly_challenges c set
      title=title_clean,game_ids=games_clean,
      active_days=case when c.week_start=public.circle_week_start(first_week.circle_id)
        then array(select d from unnest(days_clean) d where c.week_start+(d-1)>=public.circle_today(first_week.circle_id))
        else days_clean end,
      reward_points=case when c.stake_reward_id is not null then c.reward_points
        when reward_type_in='points' then reward_points_in else 0 end,
      reward_type=case when c.stake_reward_id is not null then c.reward_type else reward_type_in end,
      reward_label=case when c.stake_reward_id is not null then c.reward_label
        when reward_type_in='prize' then nullif(btrim(reward_label_in),'') else null end,
      reward_goes_to=case when c.stake_reward_id is not null then c.reward_goes_to else reward_goes_to_in end,
      updated_at=now()
    where c.series_id=target_series_id;
  end if;

  if duration_weeks_in>existing_weeks then
    for offset_no in existing_weeks..duration_weeks_in-1 loop
      new_week:=first_week.week_start+(offset_no*7);
      if (select count(*) from public.circle_weekly_challenges where circle_id=first_week.circle_id and week_start=new_week)>=10 then
        raise exception 'Circle already has 10 challenges in a requested week.' using errcode='22023';
      end if;
      insert into public.circle_weekly_challenges(
        circle_id,week_start,title,game_ids,active_days,reward_points,reward_type,reward_label,
        reward_goes_to,locked_at,created_by,series_id,repeats_weekly,series_weeks,
        occurrence_number,closed_at,stake_reward_id,stake_split_method
      ) values (
        first_week.circle_id,new_week,
        case when is_started then template_week.title else title_clean end,
        case when is_started then template_week.game_ids else games_clean end,
        case when is_started then template_week.active_days else days_clean end,
        case when is_started then template_week.reward_points when reward_type_in='points' then reward_points_in else 0 end,
        case when is_started then template_week.reward_type else reward_type_in end,
        case when is_started then template_week.reward_label when reward_type_in='prize' then nullif(btrim(reward_label_in),'') else null end,
        case when is_started then template_week.reward_goes_to else reward_goes_to_in end,
        null,auth.uid(),target_series_id,true,duration_weeks_in,offset_no+1,null,null,null
      );
    end loop;
  end if;
  update public.circle_weekly_challenges set series_weeks=duration_weeks_in,updated_at=now()
    where series_id=target_series_id;
end;
$$;
revoke all on function public.update_circle_challenge_series(bigint,integer,text,text[],integer[],integer,text,text,text) from public;
grant execute on function public.update_circle_challenge_series(bigint,integer,text,text[],integer[],integer,text,text,text) to authenticated;
