begin;

-- Zoom is a selectable game in the team challenge editor. The previous
-- whitelist silently discarded it, causing saved challenges to contain fewer
-- games than the creator selected.
create or replace function public.set_team_weekly_challenge(
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
  if not exists(select 1 from public.teams where id=target_team_id and created_by=auth.uid()) then
    raise exception 'Only the team owner can manage challenges.' using errcode='42501';
  end if;

  select array_agg(distinct game order by game) into clean_games
  from unnest(selected_games) game
  where game in ('hive','tango','zip','minisudoku','geo','zoom');

  select array_agg(distinct day order by day) into clean_days
  from unnest(selected_days) day where day between 1 and 7;

  if coalesce(cardinality(clean_games),0)=0 then raise exception 'Choose at least one game.'; end if;
  if coalesce(cardinality(clean_days),0)=0 then raise exception 'Choose at least one playing day.'; end if;
  if clean_title is null then raise exception 'Enter a challenge name.'; end if;
  if char_length(clean_title)>60 then raise exception 'Challenge names can be up to 60 characters.'; end if;
  if coalesce(reward_points_in,0) not between 0 and 500 then raise exception 'Reward must be between 0 and 500 points.'; end if;
  if clean_reward_type not in ('points','prize') then raise exception 'Invalid reward type.'; end if;
  if clean_reward_type='prize' and nullif(btrim(reward_label_in),'') is null then raise exception 'Enter the prize.'; end if;

  if target_challenge_id is not null then
    select * into current_challenge from public.team_weekly_challenges
    where id=target_challenge_id and team_id=target_team_id and week_start=public.current_week_start()
    for update;
    if not found then raise exception 'Challenge not found.'; end if;
    if current_challenge.locked_at is not null
       or exists(select 1 from public.team_challenge_starts where challenge_id=current_challenge.id)
       or exists(select 1 from public.game_stats where team_challenge_id=current_challenge.id) then
      update public.team_weekly_challenges set locked_at=coalesce(locked_at,now()) where id=current_challenge.id;
      raise exception 'This challenge is already in progress and is locked.' using errcode='55000';
    end if;
    update public.team_weekly_challenges set
      title=clean_title,game_ids=clean_games,active_days=clean_days,
      reward_points=case when clean_reward_type='points' then greatest(coalesce(reward_points_in,0),0) else 0 end,
      reward_type=clean_reward_type,
      reward_label=case when clean_reward_type='prize' then nullif(btrim(reward_label_in),'') else null end,
      updated_at=now()
    where id=current_challenge.id returning id into result_id;
  else
    if (select count(*) from public.team_weekly_challenges where team_id=target_team_id and week_start=public.current_week_start())>=10 then
      raise exception 'A team can create up to 10 challenges per week.';
    end if;
    insert into public.team_weekly_challenges(
      team_id,week_start,title,game_ids,active_days,reward_points,reward_type,reward_label,created_by
    ) values (
      target_team_id,public.current_week_start(),clean_title,clean_games,clean_days,
      case when clean_reward_type='points' then greatest(coalesce(reward_points_in,0),0) else 0 end,
      clean_reward_type,case when clean_reward_type='prize' then nullif(btrim(reward_label_in),'') else null end,auth.uid()
    ) returning id into result_id;
  end if;
  return result_id;
end;
$$;

revoke all on function public.set_team_weekly_challenge(bigint,text[],integer[],integer,text,text,bigint,text) from public;
grant execute on function public.set_team_weekly_challenge(bigint,text[],integer[],integer,text,text,bigint,text) to authenticated;

notify pgrst,'reload schema';
commit;
