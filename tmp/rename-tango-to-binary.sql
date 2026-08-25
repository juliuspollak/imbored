-- Rename the game id 'tango' -> 'binary' (display name: Twist).
--
-- The id is generic on purpose. 'Tango' is LinkedIn's brand for this puzzle;
-- the puzzle itself is public-domain Takuzu/Binairo. Naming the id after the
-- genre rather than the marketing means a future rename is a label change in
-- two files, not another data migration.
--
-- ORDER MATTERS. Three CHECK constraints still list 'tango', so the data
-- updates would be rejected if the constraints were not dropped first.

begin;

-- ---------- 1. release the constraints that pin the old id ----------
alter table public.circle_challenge_rounds
  drop constraint if exists circle_challenge_rounds_game_check;
alter table public.score_challenges
  drop constraint if exists score_challenges_game_check;

-- ---------- 2. move the data ----------
update public.game_stats             set game='binary'    where game='tango';
update public.game_config            set game_id='binary' where game_id='tango';
update public.game_time_benchmarks   set game='binary'    where game='tango';
update public.circle_challenge_rounds set game='binary'   where game='tango';
update public.score_challenges       set game='binary'    where game='tango';

-- game_ids is a text[], so the id has to be swapped inside the array.
update public.circle_weekly_challenges
set game_ids=array_replace(game_ids,'tango','binary')
where 'tango'=any(game_ids);

-- ---------- 3. restore the constraints with the new id ----------
alter table public.circle_challenge_rounds
  add constraint circle_challenge_rounds_game_check
  check (game = any (array['hive','binary','gridly','minisudoku','geo','zoom']));
alter table public.score_challenges
  add constraint score_challenges_game_check
  check (game = any (array['hive','binary','gridly','minisudoku']));

alter table public.circle_weekly_challenges
  alter column game_ids set default array['hive','binary','gridly','minisudoku','geo','zoom']::text[];

-- ---------- 4. functions that name the id in their body ----------
-- create_score_challenge
CREATE OR REPLACE FUNCTION public.create_score_challenge(target_stat_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  source_result public.game_stats;
  eligibility jsonb;
  created_challenge_id bigint;
  recipients integer:=0;
  challenger_name text;
  game_label text;
begin
  select * into source_result from public.game_stats where id=target_stat_id;
  if not found or source_result.user_id is distinct from auth.uid() then raise exception 'Game result not found.' using errcode='42501'; end if;
  if source_result.game not in ('hive','binary','gridly','minisudoku') or nullif(source_result.seed,'') is null then
    raise exception 'This result cannot be challenged.' using errcode='22023';
  end if;
  eligibility:=public.get_score_challenge_eligibility(target_stat_id);
  if not coalesce((eligibility->>'eligible')::boolean,false) then
    raise exception 'Beat my score is available after a result that beats the typical time or your circle.' using errcode='22023';
  end if;

  insert into public.score_challenges(source_stat_id,challenger_id,game,seed,generator_version,generator_config,day_index,seconds,hints,mistakes,typical_seconds,scored_seconds)
  values(source_result.id,source_result.user_id,source_result.game,source_result.seed,source_result.generator_version,source_result.generator_config,
    source_result.day_index,source_result.seconds,source_result.hints,source_result.mistakes,
    (eligibility->>'typical_seconds')::numeric,(eligibility->>'scored_seconds')::numeric)
  on conflict(source_stat_id) do update set source_stat_id=excluded.source_stat_id
  returning id into created_challenge_id;

  insert into public.score_challenge_recipients(challenge_id,recipient_id)
  select distinct created_challenge_id,other_member.user_id
  from public.circle_members mine join public.circle_members other_member on other_member.circle_id=mine.circle_id
  join public.profiles profile on profile.id=other_member.user_id
  where mine.user_id=auth.uid() and other_member.user_id<>auth.uid()
    and profile.account_deleted_at is null and coalesce(profile.is_blocked,false)=false
    and coalesce(profile.hidden_from_others,false)=false and coalesce(profile.is_approved,true)=true
  on conflict do nothing;
  get diagnostics recipients=row_count;

  select coalesce(name,'A friend') into challenger_name from public.profiles where id=auth.uid();
  game_label:=case source_result.game when 'hive' then 'Hive' when 'binary' then 'Twist' when 'gridly' then 'Gridly' when 'minisudoku' then 'Sudoku' else initcap(replace(source_result.game,'_',' ')) end;
  insert into public.direct_messages(sender_id,recipient_id,body,system_generated,activity_type,source_stat_id)
  select recipient_id,recipient_id,format('%s set a %s score of %s. Can you beat it?',challenger_name,game_label,
    (round((eligibility->>'scored_seconds')::numeric)::integer/60)::text||':'||lpad((round((eligibility->>'scored_seconds')::numeric)::integer%60)::text,2,'0')),
    true,'score_challenge',source_result.id
  from public.score_challenge_recipients where score_challenge_recipients.challenge_id=created_challenge_id
  on conflict do nothing;

  select count(*)::integer into recipients from public.score_challenge_recipients where score_challenge_recipients.challenge_id=created_challenge_id;
  return jsonb_build_object('challenge_id',created_challenge_id,'recipient_count',recipients,'already_sent',false);
end;
$$;

-- get_score_challenge_eligibility
CREATE OR REPLACE FUNCTION public.get_score_challenge_eligibility(target_stat_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  source_result public.game_stats;
  benchmark public.game_time_benchmarks;
  source_score numeric;
  recipient_count integer:=0;
  supported_result boolean:=false;
begin
  select * into source_result
  from public.game_stats
  where id=target_stat_id;

  if not found or source_result.user_id is distinct from auth.uid() then
    raise exception 'Game result not found.' using errcode='42501';
  end if;

  supported_result:=source_result.game in ('hive','binary','gridly','minisudoku')
    and nullif(source_result.seed,'') is not null;

  select count(distinct other_member.user_id)::integer
  into recipient_count
  from public.circle_members mine
  join public.circle_members other_member
    on other_member.circle_id=mine.circle_id
  join public.profiles profile
    on profile.id=other_member.user_id
  where mine.user_id=source_result.user_id
    and other_member.user_id<>source_result.user_id
    and profile.account_deleted_at is null
    and coalesce(profile.is_blocked,false)=false
    and coalesce(profile.hidden_from_others,false)=false
    and coalesce(profile.is_approved,true)=true;

  -- Preserve the performance fields consumed by existing clients without
  -- making them eligibility requirements.
  benchmark:=public.refresh_game_time_benchmark(
    source_result.game,
    source_result.day_index,
    source_result.mode
  );
  source_score:=public.scored_game_seconds(
    source_result.seconds,
    source_result.hints,
    source_result.mistakes,
    benchmark.effective_seconds
  );

  return jsonb_build_object(
    'eligible',supported_result and recipient_count>0,
    'supported_result',supported_result,
    'recipient_count',recipient_count,
    'typical_seconds',benchmark.effective_seconds,
    'scored_seconds',source_score,
    'benchmark_ready',benchmark.clean_sample_count>=6,
    'faster_than_typical',
      benchmark.clean_sample_count>=6
      and source_score<benchmark.effective_seconds,
    'circle_best',false,
    'comparable_players',0
  );
end;
$$;

-- notify_circle_daily_challenge_completed
CREATE OR REPLACE FUNCTION public.notify_circle_daily_challenge_completed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare player_name text; game_label text; notification_body text;
begin
  if new.mode is distinct from 'challenge' or new.challenge_date is null or new.circle_challenge_id is null or new.circle_id is null then return new; end if;
  select coalesce(nullif(btrim(p.name),''),'A teammate') into player_name from public.profiles p where p.id=new.user_id;
  game_label:=case lower(new.game) when 'hive' then 'Hive' when 'binary' then 'Twist' when 'gridly' then 'Gridly' when 'minisudoku' then 'Mini Sudoku' when 'geo' then 'Geo' else initcap(replace(new.game,'_',' ')) end;
  notification_body:=format('🏁 %s finished the %s circle challenge! Think you can beat them? 🎮',coalesce(player_name,'A teammate'),game_label);
  insert into public.direct_messages(sender_id,recipient_id,body,system_generated,activity_type,source_stat_id)
  select new.user_id,cm.user_id,notification_body,true,'circle_daily_challenge',new.id
  from public.circle_members cm where cm.circle_id=new.circle_id and cm.user_id<>new.user_id
  on conflict do nothing;
  return new;
end;$$;

-- set_circle_weekly_challenge
CREATE OR REPLACE FUNCTION public.set_circle_weekly_challenge(target_circle_id bigint, selected_games text[], selected_days integer[], reward_points_in integer DEFAULT 0, reward_type_in text DEFAULT 'points'::text, reward_label_in text DEFAULT NULL::text, target_challenge_id bigint DEFAULT NULL::bigint, challenge_title_in text DEFAULT NULL::text, repeat_weekly_in boolean DEFAULT NULL::boolean, duration_weeks_in integer DEFAULT NULL::integer) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  current_challenge public.circle_weekly_challenges;
  result_id bigint;
  series_key bigint;
  week_offset integer;
  clean_games text[];
  clean_days integer[];
  clean_title text:=nullif(btrim(challenge_title_in),'');
  clean_reward_type text:=coalesce(nullif(btrim(reward_type_in),''),'points');
  clean_duration integer;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if not exists(
    select 1
    from public.circles
    where id=target_circle_id and created_by=auth.uid()
  ) then
    raise exception 'Only the circle owner can manage challenges.' using errcode='42501';
  end if;
  if repeat_weekly_in is null then
    raise exception 'Choose whether this challenge runs once or repeats weekly.';
  end if;

  clean_duration:=case
    when repeat_weekly_in then coalesce(duration_weeks_in,0)
    else 1
  end;

  if repeat_weekly_in and clean_duration not between 2 and 52 then
    raise exception 'Choose a repeat duration between 2 and 52 weeks.';
  end if;

  select array_agg(game order by first_position)
  into clean_games
  from (
    select game,min(selected.ordinality) as first_position
    from unnest(selected_games) with ordinality selected(game,ordinality)
    where game in ('hive','binary','gridly','minisudoku','geo','zoom')
    group by game
  ) valid_games;

  select array_agg(distinct day order by day)
  into clean_days
  from unnest(selected_days) day
  where day between 1 and 7;

  if coalesce(cardinality(clean_games),0)=0 then
    raise exception 'Choose at least one game.';
  end if;
  if coalesce(cardinality(clean_days),0)=0 then
    raise exception 'Choose at least one playing day.';
  end if;
  if clean_title is null then
    raise exception 'Enter a challenge name.';
  end if;
  if char_length(clean_title)>60 then
    raise exception 'Challenge names can be up to 60 characters.';
  end if;
  if coalesce(reward_points_in,0) not between 0 and 50 then
    raise exception 'A circle challenge winner''s prize must be between 0 and 50 points.';
  end if;
  if clean_reward_type not in ('points','prize') then
    raise exception 'Invalid reward type.';
  end if;
  if clean_reward_type='prize'
     and nullif(btrim(reward_label_in),'') is null then
    raise exception 'Enter the prize.';
  end if;

  if target_challenge_id is not null then
    select *
    into current_challenge
    from public.circle_weekly_challenges
    where id=target_challenge_id
      and circle_id=target_circle_id
      and week_start=public.circle_week_start(target_circle_id)
      and closed_at is null
    for update;

    if not found then
      raise exception 'Challenge not found.';
    end if;
    if current_challenge.locked_at is not null
       or exists(
         select 1
         from public.circle_challenge_starts
         where challenge_id=current_challenge.id
       )
       or exists(
         select 1
         from public.game_stats
         where circle_challenge_id=current_challenge.id
       ) then
      update public.circle_weekly_challenges
      set locked_at=coalesce(locked_at,now())
      where id=current_challenge.id;
      raise exception 'This challenge is already in progress and is locked.'
        using errcode='55000';
    end if;

    series_key:=coalesce(current_challenge.series_id,current_challenge.id);

    if exists(
      select 1
      from public.circle_weekly_challenges future_challenge
      where future_challenge.series_id=series_key
        and future_challenge.week_start>=public.circle_week_start(target_circle_id)
        and (
          future_challenge.locked_at is not null
          or exists(
            select 1
            from public.circle_challenge_starts future_start
            where future_start.challenge_id=future_challenge.id
          )
          or exists(
            select 1
            from public.game_stats future_result
            where future_result.circle_challenge_id=future_challenge.id
          )
        )
    ) then
      raise exception 'A scheduled week in this series has already started.'
        using errcode='55000';
    end if;

    delete from public.circle_weekly_challenges
    where series_id=series_key
      and week_start>=public.circle_week_start(target_circle_id);
  else
    series_key:=null;
  end if;

  for week_offset in 0..clean_duration-1 loop
    if (
      select count(*)
      from public.circle_weekly_challenges
      where circle_id=target_circle_id
        and week_start=public.circle_week_start(target_circle_id)+(week_offset*7)
    )>=10 then
      raise exception 'A circle can create up to 10 challenges in any week.';
    end if;

    insert into public.circle_weekly_challenges(
      circle_id,
      week_start,
      title,
      game_ids,
      active_days,
      reward_points,
      reward_type,
      reward_label,
      locked_at,
      created_by,
      series_id,
      repeats_weekly,
      series_weeks,
      occurrence_number,
      closed_at
    )
    values(
      target_circle_id,
      public.circle_week_start(target_circle_id)+(week_offset*7),
      clean_title,
      clean_games,
      clean_days,
      case when clean_reward_type='points'
        then greatest(coalesce(reward_points_in,0),0)
        else 0
      end,
      clean_reward_type,
      case when clean_reward_type='prize'
        then nullif(btrim(reward_label_in),'')
        else null
      end,
      null,
      auth.uid(),
      series_key,
      repeat_weekly_in,
      clean_duration,
      week_offset+1,
      null
    )
    returning id into result_id;

    if series_key is null then
      series_key:=result_id;
      update public.circle_weekly_challenges
      set series_id=series_key
      where id=result_id;
    end if;

    if week_offset=0 then
      target_challenge_id:=result_id;
    end if;
  end loop;

  return target_challenge_id;
end;
$$;

notify pgrst,'reload schema';

commit;
