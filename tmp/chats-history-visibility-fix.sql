-- Chats: keep existing conversations reachable.
--
-- Scoping the player list to circle-mates hid conversations with anyone you
-- no longer share a circle with, while the unread badge still counted their
-- messages — so the badge lit up with nothing to open, and the history was
-- gone. This returns those people too, flagged can_message = false: history
-- stays readable, but a NEW chat can still only be started with a circle-mate.
--
-- The return type gains a column, so the old function must be dropped first;
-- CREATE OR REPLACE cannot change a function signature.

begin;

drop function if exists public.get_messageable_players();

CREATE OR REPLACE FUNCTION public.get_messageable_players() RETURNS TABLE(id uuid, name text, icon text, mood text, is_admin boolean, can_message boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with candidate as (
    select
      profile.id,
      profile.name::text as name,
      profile.icon::text as icon,
      profile.mood::text as mood,
      profile.is_admin,
      (
        profile.is_admin=true
        or public.players_share_circle(auth.uid(),profile.id)
      ) as can_message,
      exists(
        select 1
        from public.direct_messages message
        where (message.sender_id=auth.uid() and message.recipient_id=profile.id)
           or (message.sender_id=profile.id and message.recipient_id=auth.uid())
      ) as has_history
    from public.profiles profile
    where profile.id<>auth.uid()
      and profile.account_deleted_at is null
      and coalesce(profile.is_blocked,false)=false
      and coalesce(profile.hidden_from_others,false)=false
      and (profile.is_admin=true or coalesce(profile.is_approved,false)=true)
      and (
        coalesce(profile.is_private,false)=false
        or public.is_admin(auth.uid())
      )
      and not public.is_blocked_between(auth.uid(),profile.id)
  )
  select candidate.id,candidate.name,candidate.icon,candidate.mood,
         candidate.is_admin,candidate.can_message
  from candidate
  where candidate.can_message or candidate.has_history
  order by candidate.name
$$;

revoke all on function public.get_messageable_players() from public;
grant execute on function public.get_messageable_players() to authenticated;

notify pgrst,'reload schema';

commit;
