-- Run this once in the Supabase SQL Editor.
-- Atomically adds, switches, or removes a user's release-note reaction.

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

  if not exists (select 1 from public.release_notes where id = target_release_note_id) then
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
  where r.release_note_id = target_release_note_id;
end;
$$;

revoke all on function public.toggle_release_note_reaction(bigint, text) from public;
grant execute on function public.toggle_release_note_reaction(bigint, text) to authenticated;
