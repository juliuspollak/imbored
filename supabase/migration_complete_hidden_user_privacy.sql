-- Complete hidden-player privacy enforcement.
-- Run once after the earlier player-hiding migration.
--
-- A hidden player's profile and all user-owned activity are visible only to:
--   1. that player, and
--   2. administrators.
-- Ordinary users cannot see the player in profiles, statistics, leaderboards,
-- presence, teams, feedback, votes, release-note reactions, or pokes.

create or replace function public.can_view_user(target_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    target_user_id is null
    or target_user_id = auth.uid()
    or public.is_admin(auth.uid())
    or coalesce((
      select p.hidden_from_others = false
      from public.profiles p
      where p.id = target_user_id
    ), false);
$$;

revoke all on function public.can_view_user(uuid) from public;
grant execute on function public.can_view_user(uuid) to authenticated;

-- Profiles
drop policy if exists "profiles are publicly readable" on public.profiles;
drop policy if exists "profiles are readable unless hidden" on public.profiles;
create policy "profiles are readable unless hidden"
on public.profiles for select
using (public.can_view_user(id));

-- Game results, totals, ratings and leaderboards
drop policy if exists "stats are publicly readable" on public.game_stats;
drop policy if exists "stats follow player visibility" on public.game_stats;
create policy "stats follow player visibility"
on public.game_stats for select
using (public.can_view_user(user_id));

-- Online / currently-playing data
drop policy if exists "presence is publicly readable" on public.presence;
drop policy if exists "presence follows player visibility" on public.presence;
create policy "presence follows player visibility"
on public.presence for select
using (public.can_view_user(user_id));

-- Team membership. The team remains visible, but the hidden member does not.
drop policy if exists "team membership is publicly readable" on public.team_members;
drop policy if exists "team membership follows player visibility" on public.team_members;
create policy "team membership follows player visibility"
on public.team_members for select
using (public.can_view_user(user_id));

-- Feedback authored by a hidden player
drop policy if exists "feedback is publicly readable" on public.feedback;
drop policy if exists "feedback follows author visibility" on public.feedback;
create policy "feedback follows author visibility"
on public.feedback for select
using (public.can_view_user(user_id));

-- Feedback votes by a hidden player must not affect public vote counts.
drop policy if exists "votes are publicly readable" on public.feedback_votes;
drop policy if exists "feedback votes follow voter visibility" on public.feedback_votes;
create policy "feedback votes follow voter visibility"
on public.feedback_votes for select
using (
  public.can_view_user(user_id)
  and exists (
    select 1
    from public.feedback f
    where f.id = feedback_id
      and public.can_view_user(f.user_id)
  )
);

-- Release-note reactions by hidden players must not affect public counts.
drop policy if exists "reactions are publicly readable" on public.release_note_reactions;
drop policy if exists "release note reactions follow player visibility" on public.release_note_reactions;
create policy "release note reactions follow player visibility"
on public.release_note_reactions for select
using (public.can_view_user(user_id));

-- Pokes are direct user-to-user actions. Once either side is hidden, ordinary
-- users must not see or create an interaction involving that player.
drop policy if exists "users see pokes they sent or received" on public.pokes;
drop policy if exists "pokes follow player visibility" on public.pokes;
create policy "pokes follow player visibility"
on public.pokes for select
using (
  public.is_admin(auth.uid())
  or (
    auth.uid() = to_user
    and public.can_view_user(from_user)
    and public.can_view_user(to_user)
  )
  or (
    auth.uid() = from_user
    and public.can_view_user(from_user)
    and public.can_view_user(to_user)
  )
);

drop policy if exists "users can send a poke" on public.pokes;
create policy "users can send a poke"
on public.pokes for insert
with check (
  auth.uid() = from_user
  and public.can_view_user(from_user)
  and public.can_view_user(to_user)
);

-- Security-definer team action must explicitly respect hidden status because
-- it bypasses table RLS internally.
create or replace function public.add_player_to_team(target_user_id uuid, target_team_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if not public.can_view_user(target_user_id) then
    raise exception 'Player is not available';
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.id = target_user_id
      and p.is_private = false
      and (p.hidden_from_others = false or public.is_admin(auth.uid()))
  ) then
    insert into public.team_members (team_id, user_id)
    values (target_team_id, target_user_id)
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.add_player_to_team(uuid, bigint) from public;
grant execute on function public.add_player_to_team(uuid, bigint) to authenticated;

-- The reaction RPC is SECURITY DEFINER, so its aggregate must apply the same
-- visibility rule explicitly instead of counting every database row.
create or replace function public.toggle_release_note_reaction(
  target_release_note_id bigint,
  target_reaction text
)
returns table (
  user_reaction text,
  up_count bigint,
  down_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  existing_reaction text;
begin
  if current_user_id is null then
    raise exception 'You must be signed in to react';
  end if;

  if target_reaction not in ('up', 'down') then
    raise exception 'Invalid reaction';
  end if;

  if not exists (
    select 1 from public.release_notes n
    where n.id = target_release_note_id
      and (n.is_hidden = false or public.is_admin(current_user_id))
  ) then
    raise exception 'Release note not found';
  end if;

  select r.reaction
    into existing_reaction
  from public.release_note_reactions r
  where r.release_note_id = target_release_note_id
    and r.user_id = current_user_id;

  if existing_reaction = target_reaction then
    delete from public.release_note_reactions
    where release_note_id = target_release_note_id
      and user_id = current_user_id;
    existing_reaction := null;
  elsif existing_reaction is null then
    insert into public.release_note_reactions (release_note_id, user_id, reaction)
    values (target_release_note_id, current_user_id, target_reaction);
    existing_reaction := target_reaction;
  else
    update public.release_note_reactions
    set reaction = target_reaction
    where release_note_id = target_release_note_id
      and user_id = current_user_id;
    existing_reaction := target_reaction;
  end if;

  return query
  select
    existing_reaction,
    count(*) filter (where r.reaction = 'up')::bigint,
    count(*) filter (where r.reaction = 'down')::bigint
  from public.release_note_reactions r
  where r.release_note_id = target_release_note_id
    and public.can_view_user(r.user_id);
end;
$$;

revoke all on function public.toggle_release_note_reaction(bigint, text) from public;
grant execute on function public.toggle_release_note_reaction(bigint, text) to authenticated;
