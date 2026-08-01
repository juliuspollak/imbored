-- V111: points-economy integrity fixes + the Zoom game.
--
-- THE BUG THIS CLOSES: set_team_weekly_challenge (last redefined in V110)
-- let ANY team owner — not an admin, just whoever created a team — set
-- reward_points up to 100,000 on a weekly team challenge. When a member
-- finished every game in that challenge, award_completed_team_challenge
-- credited that full amount straight into player_progress.available_points
-- and lifetime_points: the same balance used to redeem real rewards and
-- to compute level. That's a direct mint into the real currency, bypassing
-- every bound that award_game_points enforces on normal play (20-250 per
-- game). A team owner could hand themselves (or anyone) 100,000 points in
-- one self-authored "challenge" with no admin involved at all.
--
-- THE FIX: the reward a team challenge can offer is capped to the same
-- order of magnitude a single game's best-case score reaches (250), with
-- headroom for "finish everything" to feel like a real bonus (500) — not
-- a second, uncapped currency. That cap is enforced in three independent
-- places on purpose (table constraint, RPC validation, trigger clamp) so
-- a future migration that forgets one of them still can't reopen this.
--
-- Also hardens the normal per-game economy the same way (reward_rules
-- previously had no upper bound at all — an admin typo of an extra zero
-- would have applied to every game, for every player, immediately), and
-- adds the Zoom game to every game-list this project maintains.
begin;

-- ============================================================
-- 1) Close the team-challenge reward exploit
-- ============================================================

-- Clamp any existing rows before tightening the constraint, so this
-- migration can never fail on data created under the old 100,000 cap.
update public.team_weekly_challenges
set reward_points = least(reward_points, 500)
where reward_points > 500;

alter table public.team_weekly_challenges
  drop constraint if exists team_weekly_challenges_reward_points_check;
alter table public.team_weekly_challenges
  add constraint team_weekly_challenges_reward_points_check check (reward_points between 0 and 500);

alter table public.team_weekly_challenges
  alter column game_ids set default array['hive','tango','gridly','minisudoku','geo','zoom']::text[];

-- Re-validate and re-cap on every write, defense-in-depth alongside the
-- table constraint above (a constraint can be dropped by a future
-- migration by mistake; a hardcoded clamp in the function body can't).
drop function if exists public.set_team_weekly_challenge(bigint,text[],integer[],integer,text,text,bigint,text);
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
  clean_reward_points integer:=greatest(0,least(coalesce(reward_points_in,0),500));
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
  where game in ('hive','tango','gridly','minisudoku','geo','zoom');

  select array_agg(distinct day order by day)
  into clean_days
  from unnest(selected_days) day
  where day between 1 and 7;

  if coalesce(cardinality(clean_games),0)=0 then raise exception 'Choose at least one game.'; end if;
  if coalesce(cardinality(clean_days),0)=0 then raise exception 'Choose at least one playing day.'; end if;
  if clean_title is null then raise exception 'Enter a challenge name.'; end if;
  if char_length(clean_title)>60 then raise exception 'Challenge names can be up to 60 characters.'; end if;
  if coalesce(reward_points_in,0) not between 0 and 500 then raise exception 'Reward must be between 0 and 500 points — the same range a single game can score.'; end if;
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
      reward_points=case when clean_reward_type='points' then clean_reward_points else 0 end,
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
      case when clean_reward_type='points' then clean_reward_points else 0 end,
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

-- Same clamp again, right at the point the balance is actually credited —
-- so even a row that somehow bypassed both guards above (direct SQL edit,
-- a future migration that forgets the constraint) still cannot pay out
-- more than the cap.
create or replace function public.award_completed_team_challenge()
returns trigger language plpgsql security definer set search_path=public as $$
declare c public.team_weekly_challenges; completed_count integer; award_created bigint; player_name text; team_name text; capped_reward integer;
begin
  if new.mode is distinct from 'challenge' or new.team_challenge_id is null then return new; end if;
  select * into c from public.team_weekly_challenges where id=new.team_challenge_id;
  if not found then return new; end if;
  select count(distinct gs.game) into completed_count from public.game_stats gs
  where gs.user_id=new.user_id and gs.team_challenge_id=c.id and gs.game=any(c.game_ids);
  if completed_count < cardinality(c.game_ids) then return new; end if;

  capped_reward:=greatest(0,least(coalesce(c.reward_points,0),500));

  insert into public.team_challenge_reward_awards(challenge_id,player_id,points)
  values(c.id,new.user_id,capped_reward)
  on conflict(challenge_id,player_id) do nothing returning id into award_created;
  if award_created is null then return new; end if;

  if capped_reward>0 then
    perform public.ensure_player_progress(new.user_id);
    update public.player_progress set available_points=available_points+capped_reward,
      lifetime_points=lifetime_points+capped_reward,current_level=public.points_level(lifetime_points+capped_reward),updated_at=now()
    where player_id=new.user_id;
    insert into public.points_transactions(player_id,points,reason_code,metadata,created_by)
    values(new.user_id,capped_reward,'TEAM_CHALLENGE_COMPLETED',
      jsonb_build_object('team_id',c.team_id,'team_challenge_id',c.id,'week_start',c.week_start,'reward_points',capped_reward),new.user_id);
  end if;

  select coalesce(nullif(btrim(p.name),''),'A teammate') into player_name from public.profiles p where p.id=new.user_id;
  select t.name into team_name from public.teams t where t.id=c.team_id;
  insert into public.direct_messages(sender_id,recipient_id,body,system_generated,activity_type,source_stat_id)
  select new.user_id,tm.user_id,
    format('🏆 %s completed %s''s weekly challenge! Can you match them? 🎮',player_name,coalesce(team_name,'the team')),
    true,'team_challenge_completed',new.id
  from public.team_members tm where tm.team_id=c.team_id and tm.user_id<>new.user_id
  on conflict do nothing;
  return new;
end;
$$;

-- ============================================================
-- 2) Harden the normal per-game economy the same way
-- ============================================================

-- reward_rules previously had no bounds at all — nothing stopped an admin
-- (or an admin tool bug) from setting base_points/maximum_points to an
-- absurd value that would then apply to every game, for every player,
-- immediately. These bounds keep the tuning knobs generous (well above
-- anything the defaults use) while making a "100,000 points per game"
-- misconfiguration structurally impossible.
update public.reward_rules set
  base_points = least(greatest(base_points,0),500),
  no_hint_bonus = least(greatest(no_hint_bonus,0),200),
  no_mistake_bonus = least(greatest(no_mistake_bonus,0),200),
  hint_penalty = least(greatest(hint_penalty,0),200),
  mistake_penalty = least(greatest(mistake_penalty,0),200),
  fast_time_bonus = least(greatest(fast_time_bonus,0),200),
  average_time_bonus = least(greatest(average_time_bonus,0),200),
  challenge_bonus = least(greatest(challenge_bonus,0),200),
  streak_daily_bonus = least(greatest(streak_daily_bonus,0),200),
  streak_bonus_cap = least(greatest(streak_bonus_cap,0),500),
  minimum_points = least(greatest(minimum_points,0),500),
  maximum_points = greatest(least(greatest(maximum_points,0),1000), least(greatest(minimum_points,0),500)),
  practice_daily_limit = least(greatest(practice_daily_limit,1),50),
  streak_protection_cost = least(greatest(streak_protection_cost,0),5000);

alter table public.reward_rules drop constraint if exists reward_rules_base_points_range;
alter table public.reward_rules add constraint reward_rules_base_points_range check (base_points between 0 and 500);
alter table public.reward_rules drop constraint if exists reward_rules_no_hint_bonus_range;
alter table public.reward_rules add constraint reward_rules_no_hint_bonus_range check (no_hint_bonus between 0 and 200);
alter table public.reward_rules drop constraint if exists reward_rules_no_mistake_bonus_range;
alter table public.reward_rules add constraint reward_rules_no_mistake_bonus_range check (no_mistake_bonus between 0 and 200);
alter table public.reward_rules drop constraint if exists reward_rules_hint_penalty_range;
alter table public.reward_rules add constraint reward_rules_hint_penalty_range check (hint_penalty between 0 and 200);
alter table public.reward_rules drop constraint if exists reward_rules_mistake_penalty_range;
alter table public.reward_rules add constraint reward_rules_mistake_penalty_range check (mistake_penalty between 0 and 200);
alter table public.reward_rules drop constraint if exists reward_rules_fast_time_bonus_range;
alter table public.reward_rules add constraint reward_rules_fast_time_bonus_range check (fast_time_bonus between 0 and 200);
alter table public.reward_rules drop constraint if exists reward_rules_average_time_bonus_range;
alter table public.reward_rules add constraint reward_rules_average_time_bonus_range check (average_time_bonus between 0 and 200);
alter table public.reward_rules drop constraint if exists reward_rules_challenge_bonus_range;
alter table public.reward_rules add constraint reward_rules_challenge_bonus_range check (challenge_bonus between 0 and 200);
alter table public.reward_rules drop constraint if exists reward_rules_streak_daily_bonus_range;
alter table public.reward_rules add constraint reward_rules_streak_daily_bonus_range check (streak_daily_bonus between 0 and 200);
alter table public.reward_rules drop constraint if exists reward_rules_streak_bonus_cap_range;
alter table public.reward_rules add constraint reward_rules_streak_bonus_cap_range check (streak_bonus_cap between 0 and 500);
alter table public.reward_rules drop constraint if exists reward_rules_minimum_points_range;
alter table public.reward_rules add constraint reward_rules_minimum_points_range check (minimum_points between 0 and 500);
alter table public.reward_rules drop constraint if exists reward_rules_maximum_points_range;
alter table public.reward_rules add constraint reward_rules_maximum_points_range check (maximum_points between 0 and 1000);
alter table public.reward_rules drop constraint if exists reward_rules_points_order;
alter table public.reward_rules add constraint reward_rules_points_order check (maximum_points >= minimum_points);
alter table public.reward_rules drop constraint if exists reward_rules_practice_daily_limit_range;
alter table public.reward_rules add constraint reward_rules_practice_daily_limit_range check (practice_daily_limit between 1 and 50);
alter table public.reward_rules drop constraint if exists reward_rules_streak_protection_cost_range;
alter table public.reward_rules add constraint reward_rules_streak_protection_cost_range check (streak_protection_cost between 0 and 5000);

-- Same function as V60, plus one more line: an absolute ceiling that does
-- not come from reward_rules at all, so even a bug that bypassed every
-- constraint above still cannot award more than this per game.
create or replace function public.award_game_points(target_stat_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s game_stats;
  r reward_rules;
  p player_progress;
  avg_seconds numeric;
  points_total int;
  time_points int := 0;
  hint_points int := 0;
  mistake_points int := 0;
  streak_points int := 0;
  new_streak int;
  old_level int;
  new_level int;
  today_date date;
  practice_count int;
begin
  select * into s from game_stats where id = target_stat_id;
  if not found or s.user_id <> auth.uid() then raise exception 'Game result not found'; end if;

  select * into r from reward_rules where is_active = true order by id desc limit 1;
  if not found then raise exception 'No active reward rules'; end if;

  perform ensure_player_progress(s.user_id);
  select * into p from player_progress where player_id = s.user_id for update;

  if exists(select 1 from points_transactions where game_stat_id = s.id and reason_code = 'GAME_COMPLETED') then
    return jsonb_build_object('already_awarded', true, 'points_awarded', 0, 'balance', p.available_points,
      'streak', p.current_streak, 'level', p.current_level);
  end if;

  if s.mode = 'practice' then
    select count(*) into practice_count from points_transactions pt
      join game_stats gs on gs.id = pt.game_stat_id
      where pt.player_id = s.user_id and pt.reason_code = 'GAME_COMPLETED'
        and gs.mode = 'practice' and (pt.created_at at time zone 'Australia/Sydney')::date = (now() at time zone 'Australia/Sydney')::date;
    if practice_count >= r.practice_daily_limit then
      return jsonb_build_object('points_awarded', 0, 'daily_limit_reached', true, 'balance', p.available_points,
        'streak', p.current_streak, 'level', p.current_level);
    end if;
  end if;

  select avg(seconds) into avg_seconds from game_stats
    where game = s.game and mode = s.mode and id <> s.id and seconds > 0;

  if avg_seconds is not null and s.seconds <= avg_seconds * 0.8 then time_points := r.fast_time_bonus;
  elsif avg_seconds is not null and s.seconds <= avg_seconds then time_points := r.average_time_bonus;
  end if;

  if s.hints = 0 then hint_points := r.no_hint_bonus; else hint_points := -(s.hints * r.hint_penalty); end if;
  if s.mistakes = 0 then mistake_points := r.no_mistake_bonus; else mistake_points := -(s.mistakes * r.mistake_penalty); end if;

  today_date := coalesce(s.challenge_date, (s.completed_at at time zone 'Australia/Sydney')::date);
  if p.last_completed_date is null then new_streak := 1;
  elsif p.last_completed_date = today_date then new_streak := p.current_streak;
  elsif p.last_completed_date = today_date - 1 then new_streak := p.current_streak + 1;
  elsif p.streak_protected_through is not null and p.streak_protected_through >= today_date - 1 then new_streak := p.current_streak + 1;
  else new_streak := 1;
  end if;

  if p.last_completed_date is distinct from today_date then
    streak_points := least(new_streak * r.streak_daily_bonus, r.streak_bonus_cap);
  end if;

  points_total := r.base_points + time_points + hint_points + mistake_points + streak_points
    + case when s.mode = 'challenge' then r.challenge_bonus else 0 end;
  points_total := greatest(r.minimum_points, least(r.maximum_points, points_total));
  -- Absolute ceiling, independent of reward_rules (defense-in-depth).
  points_total := greatest(0, least(500, points_total));

  old_level := p.current_level;
  new_level := points_level(p.lifetime_points + points_total);

  insert into points_transactions(player_id, points, reason_code, game_stat_id, metadata, created_by)
  values (s.user_id, points_total, 'GAME_COMPLETED', s.id,
    jsonb_build_object('base', r.base_points, 'time', time_points, 'hints', hint_points,
      'mistakes', mistake_points, 'streak', streak_points,
      'challenge', case when s.mode='challenge' then r.challenge_bonus else 0 end,
      'average_seconds', avg_seconds, 'rule_id', r.id, 'total', points_total), s.user_id);

  update player_progress set
    available_points = available_points + points_total,
    lifetime_points = lifetime_points + points_total,
    current_level = new_level,
    current_streak = new_streak,
    longest_streak = greatest(longest_streak, new_streak),
    last_completed_date = greatest(coalesce(last_completed_date, today_date), today_date),
    updated_at = now()
  where player_id = s.user_id
  returning * into p;

  return jsonb_build_object('points_awarded', points_total, 'balance', p.available_points,
    'streak', p.current_streak, 'level', p.current_level, 'level_up', new_level > old_level);
end;
$$;
grant execute on function public.award_game_points(bigint) to authenticated;

-- admin_adjust_points already requires is_admin and a non-empty reason —
-- add a sane per-adjustment bound too, so a mistyped extra zero there
-- can't silently mint a huge balance either. Admins needing to award more
-- than this for something like a real-world prize should use the Rewards
-- system (points_cost is uncapped there because it's a cost the player
-- pays, not points minted into their balance).
alter table public.points_transactions drop constraint if exists points_transactions_admin_adjustment_range;
alter table public.points_transactions add constraint points_transactions_admin_adjustment_range
  check (reason_code <> 'ADMIN_ADJUSTMENT' or points between -5000 and 5000);

create or replace function public.admin_adjust_points(target_player_id uuid, amount bigint, reason text)
returns void language plpgsql security definer set search_path=public as $$
declare p player_progress;
begin
  if not is_admin(auth.uid()) then raise exception 'Admin only'; end if;
  if amount=0 or nullif(trim(reason),'') is null then raise exception 'Amount and reason are required'; end if;
  if amount < -5000 or amount > 5000 then raise exception 'Adjustment must be between -5000 and 5000 points.'; end if;
  perform ensure_player_progress(target_player_id);
  select * into p from player_progress where player_id=target_player_id for update;
  if p.available_points+amount < 0 then raise exception 'Adjustment would make balance negative'; end if;
  update player_progress set available_points=available_points+amount,
    lifetime_points=lifetime_points+greatest(amount,0), current_level=points_level(lifetime_points+greatest(amount,0)),updated_at=now()
    where player_id=target_player_id;
  insert into points_transactions(player_id,points,reason_code,metadata,created_by)
    values(target_player_id,amount,'ADMIN_ADJUSTMENT',jsonb_build_object('reason',reason),auth.uid());
end; $$;
grant execute on function public.admin_adjust_points(uuid,bigint,text) to authenticated;

-- ============================================================
-- 3) Zoom game: game_config row so it shows up with sane defaults
-- ============================================================

insert into public.game_config (game_id, visible, available, sort_order, hint_cooldown_base, hint_cooldown_per_day)
values ('zoom', true, true, 9, 0, 0)
on conflict (game_id) do nothing;

notify pgrst,'reload schema';
commit;
