-- v78: reliable direct-message sending through a secured RPC.
-- This replaces browser-side INSERT with a server-side function so profile RLS
-- and stale/duplicate INSERT policies cannot reject otherwise valid messages.

begin;

create or replace function public.send_direct_message(
    target_recipient_id uuid,
    message_body text
)
returns table (
    id bigint,
    sender_id uuid,
    recipient_id uuid,
    body text,
    created_at timestamp with time zone,
    read_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    current_sender_id uuid := auth.uid();
    cleaned_body text := btrim(message_body);
begin
    if current_sender_id is null then
        raise exception 'You must be signed in to send a message.' using errcode = '42501';
    end if;

    if target_recipient_id is null or target_recipient_id = current_sender_id then
        raise exception 'Choose another player to message.' using errcode = '22023';
    end if;

    if cleaned_body is null or char_length(cleaned_body) < 1 then
        raise exception 'Message cannot be empty.' using errcode = '22023';
    end if;

    if char_length(cleaned_body) > 1000 then
        raise exception 'Message cannot exceed 1000 characters.' using errcode = '22023';
    end if;

    if not exists (
        select 1
        from public.profiles p
        where p.id = current_sender_id
          and coalesce(p.hidden_from_others, false) = false
    ) then
        raise exception 'Your account cannot send messages.' using errcode = '42501';
    end if;

    if not exists (
        select 1
        from public.profiles p
        where p.id = target_recipient_id
          and coalesce(p.hidden_from_others, false) = false
    ) then
        raise exception 'This player is unavailable for messages.' using errcode = '42501';
    end if;

    return query
    insert into public.direct_messages as dm (sender_id, recipient_id, body)
    values (current_sender_id, target_recipient_id, cleaned_body)
    returning dm.id, dm.sender_id, dm.recipient_id, dm.body, dm.created_at, dm.read_at;
end;
$$;

revoke all on function public.send_direct_message(uuid, text) from public;
grant execute on function public.send_direct_message(uuid, text) to authenticated;

-- Direct browser inserts are no longer needed. Removing all known INSERT
-- policies prevents accidental use of the unreliable path.
drop policy if exists "users can send direct messages" on public.direct_messages;
drop policy if exists "authenticated users can send direct messages" on public.direct_messages;

revoke insert on public.direct_messages from authenticated;

grant select, update on public.direct_messages to authenticated;

notify pgrst, 'reload schema';

commit;
