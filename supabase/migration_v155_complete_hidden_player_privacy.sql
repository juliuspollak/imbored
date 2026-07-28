begin;

-- v155: a player hidden by an administrator is absent from community
-- surfaces for every caller, including administrators. The hidden player can
-- still read their own account, and administrators can manage hidden accounts
-- only through the narrow admin_list_players() RPC below.

create or replace function public.can_view_user(target_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path=public
as $$
  select
    target_user_id is null
    or target_user_id=auth.uid()
    or coalesce((
      select
        coalesce(profile.hidden_from_others,false)=false
        and profile.account_deleted_at is null
      from public.profiles profile
      where profile.id=target_user_id
    ),false);
$$;

revoke all on function public.can_view_user(uuid) from public;
grant execute on function public.can_view_user(uuid) to authenticated;

-- This is the single intentional administrative exception. It is used only
-- by Admin > Players so hidden accounts can be shown again or moderated.
create or replace function public.admin_list_players()
returns table(
  id uuid,
  name text,
  icon text,
  is_private boolean,
  is_admin boolean,
  hidden_from_others boolean,
  is_approved boolean,
  is_blocked boolean,
  account_deleted_at timestamptz,
  auth_deleted_at timestamptz
)
language plpgsql
security definer
stable
set search_path=public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin only.' using errcode='42501';
  end if;

  return query
  select
    profile.id,
    profile.name::text,
    profile.icon::text,
    profile.is_private,
    profile.is_admin,
    profile.hidden_from_others,
    profile.is_approved,
    profile.is_blocked,
    profile.account_deleted_at,
    profile.auth_deleted_at
  from public.profiles profile
  order by profile.name;
end;
$$;

revoke all on function public.admin_list_players() from public;
grant execute on function public.admin_list_players() to authenticated;

-- Security-definer social actions cannot rely on profile RLS internally.
create or replace function public.is_available_player(uid uuid)
returns boolean
language sql
security definer
stable
set search_path=public
as $$
  select exists(
    select 1
    from public.profiles profile
    where profile.id=uid
      and profile.account_deleted_at is null
      and coalesce(profile.hidden_from_others,false)=false
      and coalesce(profile.is_blocked,false)=false
      and (profile.is_admin=true or profile.is_approved=true)
  );
$$;

revoke all on function public.is_available_player(uuid) from public;
grant execute on function public.is_available_player(uuid) to authenticated;

-- Remove the former administrator bypass from direct interactions.
drop policy if exists "users see pokes they sent or received" on public.pokes;
drop policy if exists "pokes follow player visibility" on public.pokes;
create policy "pokes follow player visibility"
on public.pokes for select
using (
  auth.uid() in (to_user,from_user)
  and public.can_view_user(from_user)
  and public.can_view_user(to_user)
);

-- Existing team requests and invitations must not reveal a hidden UUID or
-- identity to the other participant or a team manager.
drop policy if exists "join requests visible to requester and team owner"
on public.team_join_requests;
create policy "join requests visible to requester and team owner"
on public.team_join_requests for select
using (
  public.can_view_user(user_id)
  and (
    auth.uid()=user_id
    or exists(
      select 1
      from public.teams team
      where team.id=team_id
        and (
          team.created_by=auth.uid()
          or public.is_admin(auth.uid())
        )
    )
  )
);

drop policy if exists "team managers view blocks"
on public.team_member_blocks;
create policy "team managers view blocks"
on public.team_member_blocks for select to authenticated
using (
  public.can_view_user(user_id)
  and (
    public.is_admin(auth.uid())
    or exists(
      select 1
      from public.teams team
      where team.id=team_member_blocks.team_id
        and team.created_by=auth.uid()
    )
  )
);

drop policy if exists "invitation participants can view"
on public.team_invitations;
create policy "invitation participants can view"
on public.team_invitations for select to authenticated
using (
  public.can_view_user(invited_user_id)
  and public.can_view_user(invited_by)
  and (
    invited_user_id=auth.uid()
    or invited_by=auth.uid()
    or exists(
      select 1
      from public.team_members membership
      where membership.team_id=team_invitations.team_id
        and membership.user_id=auth.uid()
    )
  )
);

-- The current roster signature includes the player's stats-sharing choice.
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
    and coalesce(profile.hidden_from_others,false)=false
    and profile.account_deleted_at is null
  order by
    membership.team_id,
    (team.created_by=membership.user_id) desc,
    profile.name;
$$;

revoke all on function public.get_my_team_rosters() from public;
grant execute on function public.get_my_team_rosters() to authenticated;

create or replace function public.get_my_managed_team_blocks()
returns table(
  team_id bigint,
  user_id uuid,
  member_name text,
  member_icon text,
  blocked_at timestamptz,
  reason text
)
language sql
security definer
stable
set search_path=public
as $$
  select
    block.team_id,
    block.user_id,
    profile.name::text,
    profile.icon::text,
    block.blocked_at,
    block.reason
  from public.team_member_blocks block
  join public.teams team on team.id=block.team_id
  join public.profiles profile on profile.id=block.user_id
  where (
    public.is_admin(auth.uid())
    or team.created_by=auth.uid()
  )
    and coalesce(profile.hidden_from_others,false)=false
    and profile.account_deleted_at is null
  order by block.blocked_at desc;
$$;

revoke all on function public.get_my_managed_team_blocks() from public;
grant execute on function public.get_my_managed_team_blocks() to authenticated;

create or replace function public.get_my_pending_team_invitations()
returns table(
  invitation_id bigint,
  team_id bigint,
  team_name text,
  team_emoji text,
  invited_by uuid,
  inviter_name text,
  inviter_icon text,
  created_at timestamptz
)
language sql
security definer
stable
set search_path=public
as $$
  select
    invitation.id,
    team.id,
    team.name::text,
    team.emoji::text,
    invitation.invited_by,
    inviter.name::text,
    inviter.icon::text,
    invitation.created_at
  from public.team_invitations invitation
  join public.teams team on team.id=invitation.team_id
  join public.profiles inviter on inviter.id=invitation.invited_by
  where invitation.invited_user_id=auth.uid()
    and invitation.status='pending'
    and coalesce(inviter.hidden_from_others,false)=false
    and inviter.account_deleted_at is null
  order by invitation.created_at desc;
$$;

revoke all on function public.get_my_pending_team_invitations() from public;
grant execute on function public.get_my_pending_team_invitations() to authenticated;

create or replace function public.get_my_pending_invited_players()
returns table(
  user_id uuid,
  player_name text,
  player_icon text,
  invited_email text,
  invited_at timestamptz
)
language sql
security definer
set search_path=public,auth
stable
as $$
  select distinct on (profile.id)
    profile.id,
    profile.name,
    profile.icon,
    lower(auth_user.email),
    invitation.created_at
  from public.app_email_invitations invitation
  join auth.users auth_user
    on lower(auth_user.email)=lower(invitation.invitee_email)
  join public.profiles profile
    on profile.id=auth_user.id
  where invitation.inviter_id=auth.uid()
    and coalesce(profile.is_admin,false)=false
    and coalesce(profile.is_approved,false)=false
    and coalesce(profile.is_blocked,false)=false
    and coalesce(profile.hidden_from_others,false)=false
    and profile.account_deleted_at is null
  order by profile.id,invitation.created_at desc;
$$;

revoke all on function public.get_my_pending_invited_players() from public;
grant execute on function public.get_my_pending_invited_players() to authenticated;

-- SECURITY DEFINER challenge summaries previously bypassed profile RLS and
-- could reveal a hidden member as a participant or winner.
drop function if exists public.get_my_team_challenge_lifecycle();
create function public.get_my_team_challenge_lifecycle()
returns table(
  challenge_id bigint,
  member_count integer,
  finished_count integer,
  current_user_finished boolean,
  winner_id uuid,
  winner_name text,
  winner_icon text,
  awarded_at timestamptz,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.finalize_due_team_challenges();

  return query
  with my_challenges as (
    select challenge.id,challenge.team_id,challenge.closed_at
    from public.team_members membership
    join public.team_weekly_challenges challenge
      on challenge.team_id=membership.team_id
     and challenge.week_start=public.current_week_start()
    where membership.user_id=auth.uid()
      and public.is_approved_user(auth.uid())
  ),
  member_progress as (
    select
      challenge.id as challenge_id,
      member.user_id,
      count(distinct result.challenge_date)=
        count(distinct round_item.challenge_date) as finished
    from my_challenges challenge
    join public.team_members member on member.team_id=challenge.team_id
    join public.profiles member_profile
      on member_profile.id=member.user_id
     and coalesce(member_profile.hidden_from_others,false)=false
     and member_profile.account_deleted_at is null
    join public.team_challenge_rounds round_item
      on round_item.challenge_id=challenge.id
    left join public.game_stats result
      on result.user_id=member.user_id
     and result.team_challenge_id=challenge.id
     and result.mode='challenge'
     and result.challenge_date=round_item.challenge_date
     and result.game=round_item.game
    group by challenge.id,member.user_id
  )
  select
    challenge.id,
    count(progress.user_id)::integer,
    count(*) filter(where progress.finished)::integer,
    coalesce(
      bool_or(progress.finished) filter(where progress.user_id=auth.uid()),
      false
    ),
    award.player_id,
    winner.name::text,
    winner.icon::text,
    award.awarded_at,
    challenge.closed_at
  from my_challenges challenge
  join member_progress progress on progress.challenge_id=challenge.id
  left join lateral (
    select item.player_id,item.awarded_at
    from public.team_challenge_reward_awards item
    join public.profiles award_profile on award_profile.id=item.player_id
    where item.challenge_id=challenge.id
      and coalesce(award_profile.hidden_from_others,false)=false
      and award_profile.account_deleted_at is null
    order by item.awarded_at,item.id
    limit 1
  ) award on true
  left join public.profiles winner on winner.id=award.player_id
  group by
    challenge.id,
    challenge.closed_at,
    award.player_id,
    award.awarded_at,
    winner.name,
    winner.icon
  order by challenge.id;
end;
$$;

revoke all on function public.get_my_team_challenge_lifecycle() from public;
grant execute on function public.get_my_team_challenge_lifecycle()
to authenticated;

create or replace function public.get_my_team_challenge_history(
  history_limit_in integer default 30
)
returns table(
  challenge_id bigint,
  team_id bigint,
  team_name text,
  team_emoji text,
  challenge_title text,
  week_start date,
  closed_at timestamptz,
  game_ids text[],
  active_days integer[],
  reward_points integer,
  reward_type text,
  reward_label text,
  winner_id uuid,
  winner_name text,
  winner_icon text,
  entry_count integer,
  finisher_count integer,
  current_user_finished boolean,
  repeats_weekly boolean,
  series_weeks integer,
  occurrence_number integer
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
    challenge.week_start,
    challenge.closed_at,
    challenge.game_ids,
    challenge.active_days,
    challenge.reward_points,
    challenge.reward_type,
    challenge.reward_label,
    award.player_id,
    winner.name::text,
    winner.icon::text,
    coalesce(progress.entry_count,0)::integer,
    coalesce(progress.finisher_count,0)::integer,
    coalesce(progress.current_user_finished,false),
    challenge.repeats_weekly,
    challenge.series_weeks,
    challenge.occurrence_number
  from public.team_members membership
  join public.teams team on team.id=membership.team_id
  join public.team_weekly_challenges challenge
    on challenge.team_id=team.id
  left join lateral (
    select item.player_id,item.awarded_at
    from public.team_challenge_reward_awards item
    join public.profiles award_profile on award_profile.id=item.player_id
    where item.challenge_id=challenge.id
      and coalesce(award_profile.hidden_from_others,false)=false
      and award_profile.account_deleted_at is null
    order by item.awarded_at,item.id
    limit 1
  ) award on true
  left join public.profiles winner on winner.id=award.player_id
  left join lateral (
    select
      count(*) filter(where totals.rounds_played>0)::integer as entry_count,
      count(*) filter(
        where totals.rounds_played=totals.required_rounds
      )::integer as finisher_count,
      coalesce(
        bool_or(
          totals.rounds_played=totals.required_rounds
        ) filter(where totals.user_id=auth.uid()),
        false
      ) as current_user_finished
    from (
      select
        member.user_id,
        count(distinct result.challenge_date)::integer as rounds_played,
        count(distinct round_item.challenge_date)::integer as required_rounds
      from public.team_members member
      join public.profiles member_profile
        on member_profile.id=member.user_id
       and coalesce(member_profile.hidden_from_others,false)=false
       and member_profile.account_deleted_at is null
      cross join public.team_challenge_rounds round_item
      left join public.game_stats result
        on result.user_id=member.user_id
       and result.team_challenge_id=challenge.id
       and result.mode='challenge'
       and result.challenge_date=round_item.challenge_date
       and result.game=round_item.game
      where member.team_id=challenge.team_id
        and round_item.challenge_id=challenge.id
      group by member.user_id
    ) totals
  ) progress on true
  where membership.user_id=auth.uid()
    and public.is_approved_user(auth.uid())
    and challenge.closed_at is not null
  order by
    challenge.closed_at desc,
    challenge.week_start desc,
    challenge.id desc
  limit least(greatest(coalesce(history_limit_in,30),1),100);
end;
$$;

revoke all on function public.get_my_team_challenge_history(integer)
from public;
grant execute on function public.get_my_team_challenge_history(integer)
to authenticated;

-- Live Animal Rush rows can contain copied names and icons, so filter the
-- player/attempt rows themselves rather than relying on a profile join.
drop policy if exists "members read animal rush rooms"
on public.animal_rush_rooms;
create policy "members read animal rush rooms"
on public.animal_rush_rooms for select
using (
  public.animal_rush_is_member(id,auth.uid())
  and public.can_view_user(host_user_id)
  and (
    winner_user_id is null
    or public.can_view_user(winner_user_id)
  )
);

drop policy if exists "members read animal rush players"
on public.animal_rush_players;
create policy "members read animal rush players"
on public.animal_rush_players for select
using (
  public.animal_rush_is_member(room_id,auth.uid())
  and public.can_view_user(user_id)
);

drop policy if exists "members read animal rush attempts"
on public.animal_rush_attempts;
create policy "members read animal rush attempts"
on public.animal_rush_attempts for select
using (
  public.animal_rush_is_member(room_id,auth.uid())
  and public.can_view_user(user_id)
);

create or replace function public.reject_hidden_animal_rush_player()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.left_at is null and public.is_user_hidden(new.user_id) then
    raise exception 'This player is not available for live games.'
      using errcode='42501';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_hidden_animal_rush_player() from public;

drop trigger if exists reject_hidden_animal_rush_player_trigger
on public.animal_rush_players;
create trigger reject_hidden_animal_rush_player_trigger
before insert or update of user_id,left_at
on public.animal_rush_players
for each row execute function public.reject_hidden_animal_rush_player();

-- Hiding a player who is already in a live room must also remove that copied
-- identity from the active roster. Setting left_at remains allowed by the
-- guard above; attempts to rejoin with left_at=null are rejected.
create or replace function public.clear_hidden_user_presence()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.hidden_from_others
    and new.hidden_from_others is distinct from old.hidden_from_others
  then
    delete from public.presence where user_id=new.id;
    update public.animal_rush_players
    set left_at=coalesce(left_at,clock_timestamp()),
        eliminated=true
    where user_id=new.id
      and left_at is null;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_hidden_user_presence() from public;

notify pgrst,'reload schema';
commit;
