-- Let circle owners anchor a challenge series to an explicit local-calendar week.
-- Existing set_circle_weekly_challenge callers remain supported unchanged.
create or replace function public.save_circle_weekly_challenge_schedule(
  target_circle_id bigint,
  selected_games text[],
  selected_days integer[],
  week_start_in date,
  reward_points_in integer default 0,
  reward_type_in text default 'points',
  reward_label_in text default null,
  target_challenge_id bigint default null,
  challenge_title_in text default null,
  repeat_weekly_in boolean default null,
  duration_weeks_in integer default null,
  reward_goes_to_in text default 'winner'
) returns bigint
language plpgsql security definer
set search_path to 'public'
as $$
declare
  current_challenge public.circle_weekly_challenges;
  first_result_id bigint;
  result_id bigint;
  series_key bigint;
  week_offset integer;
  clean_games text[];
  clean_days integer[];
  clean_title text:=nullif(btrim(challenge_title_in),'');
  clean_reward_type text:=coalesce(nullif(btrim(reward_type_in),''),'points');
  clean_goes_to text:=case
    when coalesce(nullif(btrim(reward_type_in),''),'points')='prize'
      and btrim(coalesce(reward_goes_to_in,''))='loser'
    then 'loser' else 'winner' end;
  clean_duration integer;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not exists(select 1 from public.circles where id=target_circle_id and created_by=auth.uid()) then
    raise exception 'Only the circle owner can manage challenges.' using errcode='42501';
  end if;
  if week_start_in is null or extract(isodow from week_start_in)<>1 then
    raise exception 'Choose a week that starts on Monday.';
  end if;
  if week_start_in<public.circle_week_start(target_circle_id) then
    raise exception 'Choose this week or a future week.';
  end if;
  if repeat_weekly_in is null then
    raise exception 'Choose whether this challenge runs once or repeats weekly.';
  end if;

  clean_duration:=case when repeat_weekly_in then coalesce(duration_weeks_in,0) else 1 end;
  if repeat_weekly_in and clean_duration not between 2 and 52 then
    raise exception 'Choose a repeat duration between 2 and 52 weeks.';
  end if;

  select array_agg(game order by first_position) into clean_games
  from (
    select game,min(selected.ordinality) as first_position
    from unnest(selected_games) with ordinality selected(game,ordinality)
    where game in ('hive','binary','gridly','minisudoku','geo','zoom')
    group by game
  ) valid_games;
  select array_agg(distinct day order by day) into clean_days
  from unnest(selected_days) day where day between 1 and 7;

  if coalesce(cardinality(clean_games),0)=0 then raise exception 'Choose at least one game.'; end if;
  if coalesce(cardinality(clean_days),0)=0 then raise exception 'Choose at least one playing day.'; end if;
  if clean_title is null then raise exception 'Enter a challenge name.'; end if;
  if char_length(clean_title)>60 then raise exception 'Challenge names can be up to 60 characters.'; end if;
  if coalesce(reward_points_in,0) not between 0 and 50 then
    raise exception 'A circle challenge winner''s prize must be between 0 and 50 points.';
  end if;
  if clean_reward_type not in ('points','prize') then raise exception 'Invalid reward type.'; end if;
  if clean_reward_type='prize' and nullif(btrim(reward_label_in),'') is null then raise exception 'Enter the prize.'; end if;

  if target_challenge_id is null and exists(
    select 1 from unnest(clean_days) day
    where week_start_in+(day-1)<public.circle_today(target_circle_id)
  ) then
    raise exception 'Choose playing days that have not passed.';
  end if;

  if target_challenge_id is not null then
    select * into current_challenge
    from public.circle_weekly_challenges
    where id=target_challenge_id and circle_id=target_circle_id and closed_at is null
    for update;
    if not found then raise exception 'Challenge not found.'; end if;
    if current_challenge.locked_at is not null
      or exists(select 1 from public.circle_challenge_starts where challenge_id=current_challenge.id)
      or exists(select 1 from public.game_stats where circle_challenge_id=current_challenge.id) then
      update public.circle_weekly_challenges set locked_at=coalesce(locked_at,now()) where id=current_challenge.id;
      raise exception 'This challenge is already in progress and is locked.' using errcode='55000';
    end if;
    series_key:=coalesce(current_challenge.series_id,current_challenge.id);
    if exists(
      select 1 from public.circle_weekly_challenges future_challenge
      where future_challenge.series_id=series_key
        and future_challenge.week_start>=current_challenge.week_start
        and (
          future_challenge.locked_at is not null
          or exists(select 1 from public.circle_challenge_starts s where s.challenge_id=future_challenge.id)
          or exists(select 1 from public.game_stats g where g.circle_challenge_id=future_challenge.id)
        )
    ) then
      raise exception 'A scheduled week in this series has already started.' using errcode='55000';
    end if;
    delete from public.circle_weekly_challenges
    where series_id=series_key and week_start>=current_challenge.week_start;
  else
    series_key:=null;
  end if;

  for week_offset in 0..clean_duration-1 loop
    if (select count(*) from public.circle_weekly_challenges
        where circle_id=target_circle_id and week_start=week_start_in+(week_offset*7))>=10 then
      raise exception 'A circle can create up to 10 challenges in any week.';
    end if;
    insert into public.circle_weekly_challenges(
      circle_id,week_start,title,game_ids,active_days,reward_points,reward_type,reward_label,
      reward_goes_to,locked_at,created_by,series_id,repeats_weekly,series_weeks,occurrence_number,closed_at
    ) values(
      target_circle_id,week_start_in+(week_offset*7),clean_title,clean_games,clean_days,
      case when clean_reward_type='points' then greatest(coalesce(reward_points_in,0),0) else 0 end,
      clean_reward_type,case when clean_reward_type='prize' then nullif(btrim(reward_label_in),'') else null end,
      clean_goes_to,null,auth.uid(),series_key,repeat_weekly_in,clean_duration,week_offset+1,null
    ) returning id into result_id;
    if series_key is null then
      series_key:=result_id;
      update public.circle_weekly_challenges set series_id=series_key where id=result_id;
    end if;
    if week_offset=0 then first_result_id:=result_id; end if;
  end loop;
  return first_result_id;
end;
$$;

revoke all on function public.save_circle_weekly_challenge_schedule(bigint,text[],integer[],date,integer,text,text,bigint,text,boolean,integer,text) from public;
grant execute on function public.save_circle_weekly_challenge_schedule(bigint,text[],integer[],date,integer,text,text,bigint,text,boolean,integer,text) to authenticated;
