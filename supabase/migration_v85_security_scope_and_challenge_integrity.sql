begin;

-- One application date source. All team challenge dates use Sydney time.
create or replace function public.app_today()
returns date
language sql
stable
as $$
  select (timezone('Australia/Sydney', now()))::date
$$;

grant execute on function public.app_today() to authenticated;

create or replace function public.current_week_start()
returns date
language sql
stable
as $$
  select (public.app_today() - (extract(isodow from public.app_today())::integer - 1))::date
$$;

grant execute on function public.current_week_start() to authenticated;

create or replace function public.is_approved_user(uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path=public
as $$
  select exists(
    select 1 from public.profiles p
    where p.id=uid and (p.is_admin=true or p.is_approved=true)
  )
$$;

revoke all on function public.is_approved_user(uuid) from public;
grant execute on function public.is_approved_user(uuid) to authenticated;

-- Profile writes go through a narrow RPC. Approval/admin/hidden fields are never accepted.
create or replace function public.save_my_profile(
  profile_name text default null,
  profile_icon text default null,
  profile_is_private boolean default null,
  profile_mood text default null,
  profile_default_mode text default null,
  profile_show_stats boolean default null,
  profile_week_starts_on integer default null
)
returns public.profiles
language plpgsql
security definer
set search_path=public
as $$
declare result public.profiles;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode='42501';
  end if;
  if profile_name is not null and nullif(btrim(profile_name),'') is null then
    raise exception 'Name is required.' using errcode='22023';
  end if;
  if profile_default_mode is not null and profile_default_mode not in ('practice','challenge') then
    raise exception 'Invalid default mode.' using errcode='22023';
  end if;
  if profile_week_starts_on is not null and profile_week_starts_on not in (0,1) then
    raise exception 'Invalid week start.' using errcode='22023';
  end if;

  insert into public.profiles(id,name,icon,is_private,mood,default_mode,show_stats_to_others,week_starts_on,is_admin,is_approved)
  values(
    auth.uid(),
    coalesce(nullif(btrim(profile_name),''),'Player'),
    coalesce(nullif(profile_icon,''),'🙂'),
    coalesce(profile_is_private,false),
    nullif(btrim(profile_mood),''),
    coalesce(profile_default_mode,'challenge'),
    coalesce(profile_show_stats,true),
    coalesce(profile_week_starts_on,1),
    false,
    false
  )
  on conflict(id) do update set
    name=coalesce(nullif(btrim(profile_name),''),public.profiles.name),
    icon=coalesce(nullif(profile_icon,''),public.profiles.icon),
    is_private=coalesce(profile_is_private,public.profiles.is_private),
    mood=case when profile_mood is null then public.profiles.mood else nullif(btrim(profile_mood),'') end,
    default_mode=coalesce(profile_default_mode,public.profiles.default_mode),
    show_stats_to_others=coalesce(profile_show_stats,public.profiles.show_stats_to_others),
    week_starts_on=coalesce(profile_week_starts_on,public.profiles.week_starts_on)
  returning * into result;
  return result;
end;
$$;

revoke all on function public.save_my_profile(text,text,boolean,text,text,boolean,integer) from public;
grant execute on function public.save_my_profile(text,text,boolean,text,text,boolean,integer) to authenticated;

-- Even if an old broad profile UPDATE policy remains, protected fields cannot be changed by users.
create or replace function public.protect_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null or public.is_admin(auth.uid()) then return new; end if;
  if tg_op='INSERT' then
    new.is_admin := false;
    new.is_approved := false;
    new.approved_at := null;
    new.approved_by := null;
    new.hidden_from_others := false;
  else
    if new.is_admin is distinct from old.is_admin
       or new.is_approved is distinct from old.is_approved
       or new.approved_at is distinct from old.approved_at
       or new.approved_by is distinct from old.approved_by
       or new.hidden_from_others is distinct from old.hidden_from_others then
      raise exception 'Protected profile fields can only be changed by an admin.' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_security_fields_trigger on public.profiles;
create trigger protect_profile_security_fields_trigger
before insert or update on public.profiles
for each row execute function public.protect_profile_security_fields();

-- Generic approved-user guard for player-created rows.
create or replace function public.require_approved_actor()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account is waiting for admin approval.' using errcode='42501';
  end if;
  return new;
end;
$$;

do $$
declare tbl text;
begin
  foreach tbl in array array['game_stats','presence','feedback','feedback_votes','pokes','reward_wishes','team_join_requests'] loop
    if to_regclass('public.'||tbl) is not null then
      execute format('drop trigger if exists require_approved_actor_trigger on public.%I',tbl);
      execute format('create trigger require_approved_actor_trigger before insert on public.%I for each row execute function public.require_approved_actor()',tbl);
    end if;
  end loop;
end $$;

-- Starting, not finishing, locks a team challenge.
create table if not exists public.team_challenge_starts(
  id bigint generated by default as identity primary key,
  challenge_id bigint not null references public.team_weekly_challenges(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  game text not null,
  challenge_date date not null,
  started_at timestamp with time zone not null default now(),
  unique(challenge_id,player_id,game,challenge_date)
);

alter table public.team_challenge_starts enable row level security;
drop policy if exists "players view relevant team challenge starts" on public.team_challenge_starts;
create policy "players view relevant team challenge starts"
on public.team_challenge_starts for select to authenticated
using (
  player_id=auth.uid() or public.is_admin(auth.uid()) or exists(
    select 1 from public.team_weekly_challenges c
    join public.teams t on t.id=c.team_id
    where c.id=challenge_id and t.created_by=auth.uid()
  )
);

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
declare c public.team_weekly_challenges;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  select * into c from public.team_weekly_challenges where id=target_challenge_id;
  if not found then raise exception 'Team challenge not found.' using errcode='22023'; end if;
  if not exists(select 1 from public.team_members tm where tm.team_id=c.team_id and tm.user_id=auth.uid()) then
    raise exception 'You are not a member of this team.' using errcode='42501';
  end if;
  if target_game <> all(c.game_ids) then raise exception 'This game is not included in the team challenge.' using errcode='22023'; end if;
  if target_challenge_date < c.week_start or target_challenge_date > c.week_start+6 then
    raise exception 'This challenge is outside its configured week.' using errcode='22023';
  end if;
  if extract(isodow from target_challenge_date)::integer <> all(c.active_days) then
    raise exception 'This team challenge is not scheduled for that day.' using errcode='22023';
  end if;
  if target_challenge_date > public.app_today() then raise exception 'Future challenges cannot be started.' using errcode='22023'; end if;

  insert into public.team_challenge_starts(challenge_id,player_id,game,challenge_date)
  values(c.id,auth.uid(),target_game,target_challenge_date)
  on conflict do nothing;
  update public.team_weekly_challenges set locked_at=coalesce(locked_at,now()) where id=c.id;
end;
$$;

revoke all on function public.start_team_challenge_game(bigint,text,date) from public;
grant execute on function public.start_team_challenge_game(bigint,text,date) to authenticated;

-- Setup is locked by any start or result.
create or replace function public.set_team_weekly_challenge(
  target_team_id bigint,
  selected_games text[],
  selected_days integer[],
  reward_points_in integer
)
returns bigint language plpgsql security definer set search_path=public as $$
declare result_id bigint; clean_games text[]; clean_days integer[]; existing_id bigint;
begin
  if not public.is_approved_user(auth.uid()) then raise exception 'Your account must be approved first.' using errcode='42501'; end if;
  if not exists(select 1 from public.teams t where t.id=target_team_id and t.created_by=auth.uid()) then
    raise exception 'Only this team creator can set its challenge.' using errcode='42501';
  end if;
  select array_agg(distinct g order by g) into clean_games from unnest(selected_games) g where g in ('queens','tango','zip','minisudoku','geo');
  select array_agg(distinct d order by d) into clean_days from unnest(selected_days) d where d between 1 and 7;
  if coalesce(cardinality(clean_games),0)=0 then raise exception 'Choose at least one game.'; end if;
  if coalesce(cardinality(clean_days),0)=0 then raise exception 'Choose at least one challenge day.'; end if;
  if coalesce(reward_points_in,0) not between 0 and 100000 then raise exception 'Reward must be between 0 and 100,000 points.'; end if;

  select id into existing_id from public.team_weekly_challenges where team_id=target_team_id and week_start=public.current_week_start();
  if existing_id is not null and (
      exists(select 1 from public.team_challenge_starts s where s.challenge_id=existing_id)
      or exists(select 1 from public.game_stats gs where gs.team_challenge_id=existing_id)
    ) then
    update public.team_weekly_challenges set locked_at=coalesce(locked_at,now()) where id=existing_id;
    raise exception 'This challenge is already in progress and its setup is locked.' using errcode='55000';
  end if;

  insert into public.team_weekly_challenges(team_id,week_start,game_ids,active_days,reward_points,created_by)
  values(target_team_id,public.current_week_start(),clean_games,clean_days,coalesce(reward_points_in,0),auth.uid())
  on conflict(team_id,week_start) do update set
    game_ids=excluded.game_ids,active_days=excluded.active_days,reward_points=excluded.reward_points,
    updated_at=now(),created_by=auth.uid(),locked_at=null
  returning id into result_id;
  return result_id;
end;
$$;

revoke all on function public.set_team_weekly_challenge(bigint,text[],integer[],integer) from public;
grant execute on function public.set_team_weekly_challenge(bigint,text[],integer[],integer) to authenticated;

create or replace function public.get_my_active_team_challenges()
returns table(
  challenge_id bigint,team_id bigint,team_name text,team_emoji text,game_ids text[],active_days integer[],
  reward_points integer,active_today boolean,is_locked boolean
)
language sql security definer stable set search_path=public as $$
  select twc.id,t.id,t.name,coalesce(t.emoji,'⭐'),twc.game_ids,twc.active_days,twc.reward_points,
    extract(isodow from public.app_today())::integer=any(twc.active_days),
    (twc.locked_at is not null or exists(select 1 from public.team_challenge_starts s where s.challenge_id=twc.id)
      or exists(select 1 from public.game_stats gs where gs.team_challenge_id=twc.id))
  from public.team_members tm
  join public.teams t on t.id=tm.team_id
  join public.team_weekly_challenges twc on twc.team_id=t.id and twc.week_start=public.current_week_start()
  where tm.user_id=auth.uid() and public.is_approved_user(auth.uid())
  order by t.name
$$;

grant execute on function public.get_my_active_team_challenges() to authenticated;

-- Team creator leaving transfers ownership to the earliest remaining member.
create or replace function public.leave_team(target_team_id bigint)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare was_owner boolean; next_owner uuid;
begin
  if not public.is_approved_user(auth.uid()) then raise exception 'Your account must be approved first.' using errcode='42501'; end if;
  select exists(select 1 from public.teams t where t.id=target_team_id and t.created_by=auth.uid()) into was_owner;
  delete from public.team_members where team_id=target_team_id and user_id=auth.uid();
  if not found then raise exception 'You are not a member of this team.'; end if;

  select tm.user_id into next_owner from public.team_members tm
  where tm.team_id=target_team_id order by tm.joined_at asc nulls last,tm.user_id limit 1;
  if next_owner is null then
    delete from public.teams where id=target_team_id;
  elsif was_owner then
    update public.teams set created_by=next_owner where id=target_team_id;
  end if;
end;
$$;

grant execute on function public.leave_team(bigint) to authenticated;

-- Result validation also requires a matching start and the authenticated player.
create or replace function public.validate_team_challenge_attempt()
returns trigger language plpgsql security definer set search_path=public as $$
declare c public.team_weekly_challenges;
begin
  if not public.is_approved_user(auth.uid()) then raise exception 'Your account must be approved first.' using errcode='42501'; end if;
  if new.user_id is distinct from auth.uid() then raise exception 'You can only save your own result.' using errcode='42501'; end if;
  if new.mode is distinct from 'challenge' or new.team_challenge_id is null then return new; end if;
  select * into c from public.team_weekly_challenges where id=new.team_challenge_id;
  if not found then raise exception 'Team challenge not found.'; end if;
  if new.team_id is distinct from c.team_id then raise exception 'Team challenge does not match the selected team.'; end if;
  if new.game <> all(c.game_ids) then raise exception 'This game is not included in the team challenge.'; end if;
  if new.challenge_date < c.week_start or new.challenge_date > c.week_start+6 then raise exception 'This team challenge is not available for that date.'; end if;
  if extract(isodow from new.challenge_date)::integer <> all(c.active_days) then raise exception 'This team challenge is not scheduled for that day.'; end if;
  if not exists(select 1 from public.team_members tm where tm.team_id=c.team_id and tm.user_id=new.user_id) then raise exception 'You are not a member of this team.'; end if;
  if not exists(select 1 from public.team_challenge_starts s where s.challenge_id=c.id and s.player_id=new.user_id and s.game=new.game and s.challenge_date=new.challenge_date) then
    raise exception 'Start this team challenge from the challenge screen first.' using errcode='42501';
  end if;
  update public.team_weekly_challenges set locked_at=coalesce(locked_at,now()) where id=c.id;
  return new;
end;
$$;

-- Personal results must remain personal; clients cannot attach arbitrary team IDs.
create or replace function public.validate_game_stat_actor()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not public.is_approved_user(auth.uid()) then raise exception 'Your account must be approved first.' using errcode='42501'; end if;
  if new.user_id is distinct from auth.uid() then raise exception 'You can only save your own result.' using errcode='42501'; end if;
  if new.team_challenge_id is null then new.team_id:=null; end if;
  return new;
end;
$$;

drop trigger if exists validate_game_stat_actor_trigger on public.game_stats;
create trigger validate_game_stat_actor_trigger before insert on public.game_stats
for each row execute function public.validate_game_stat_actor();

-- Send one notification when the full configured team challenge is completed.
drop trigger if exists game_stats_notify_team_daily_challenge on public.game_stats;
drop index if exists direct_messages_team_challenge_once_idx;
create unique index if not exists direct_messages_team_challenge_full_once_idx
on public.direct_messages(activity_type,source_stat_id,recipient_id)
where activity_type='team_challenge_completed' and source_stat_id is not null;

create or replace function public.award_completed_team_challenge()
returns trigger language plpgsql security definer set search_path=public as $$
declare c public.team_weekly_challenges; completed_count integer; award_created bigint; player_name text; team_name text;
begin
  if new.mode is distinct from 'challenge' or new.team_challenge_id is null then return new; end if;
  select * into c from public.team_weekly_challenges where id=new.team_challenge_id;
  if not found then return new; end if;
  select count(distinct gs.game) into completed_count from public.game_stats gs
  where gs.user_id=new.user_id and gs.team_challenge_id=c.id and gs.game=any(c.game_ids);
  if completed_count < cardinality(c.game_ids) then return new; end if;

  insert into public.team_challenge_reward_awards(challenge_id,player_id,points)
  values(c.id,new.user_id,greatest(c.reward_points,0))
  on conflict(challenge_id,player_id) do nothing returning id into award_created;
  if award_created is null then return new; end if;

  if c.reward_points>0 then
    perform public.ensure_player_progress(new.user_id);
    update public.player_progress set available_points=available_points+c.reward_points,
      lifetime_points=lifetime_points+c.reward_points,current_level=public.points_level(lifetime_points+c.reward_points),updated_at=now()
    where player_id=new.user_id;
    insert into public.points_transactions(player_id,points,reason_code,metadata,created_by)
    values(new.user_id,c.reward_points,'TEAM_CHALLENGE_COMPLETED',
      jsonb_build_object('team_id',c.team_id,'team_challenge_id',c.id,'week_start',c.week_start,'reward_points',c.reward_points),new.user_id);
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

-- Approved users only for chat RPC.
create or replace function public.send_direct_message(target_recipient_id uuid,message_body text)
returns table(id bigint,sender_id uuid,recipient_id uuid,body text,created_at timestamp with time zone,read_at timestamp with time zone)
language plpgsql security definer set search_path=public,auth as $$
declare current_sender_id uuid:=auth.uid(); cleaned_body text:=btrim(message_body);
begin
  if not public.is_approved_user(current_sender_id) then raise exception 'Your account must be approved before messaging.' using errcode='42501'; end if;
  if target_recipient_id is null or target_recipient_id=current_sender_id then raise exception 'Choose another player to message.' using errcode='22023'; end if;
  if cleaned_body is null or char_length(cleaned_body) not between 1 and 1000 then raise exception 'Message must contain 1 to 1000 characters.' using errcode='22023'; end if;
  if not public.is_approved_user(target_recipient_id) then raise exception 'This player is unavailable for messages.' using errcode='42501'; end if;
  return query insert into public.direct_messages as dm(sender_id,recipient_id,body)
  values(current_sender_id,target_recipient_id,cleaned_body)
  returning dm.id,dm.sender_id,dm.recipient_id,dm.body,dm.created_at,dm.read_at;
end;
$$;

revoke all on function public.send_direct_message(uuid,text) from public;
grant execute on function public.send_direct_message(uuid,text) to authenticated;

notify pgrst,'reload schema';
commit;
