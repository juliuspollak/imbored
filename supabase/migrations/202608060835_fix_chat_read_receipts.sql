-- Allow a signed-in recipient to mark their own incoming messages as read.
-- The Chats/Chat clients already constrain updates to recipient_id = auth.uid(),
-- but without an UPDATE policy PostgREST can return no error while affecting
-- zero rows, leaving unread badges permanently stuck.

begin;

alter table public.direct_messages enable row level security;

drop policy if exists "Recipients can mark messages read" on public.direct_messages;
create policy "Recipients can mark messages read"
on public.direct_messages
for update
to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

-- Keep the allowed column narrow even though the row policy is recipient-based.
revoke update on public.direct_messages from authenticated;
grant update (read_at) on public.direct_messages to authenticated;

notify pgrst, 'reload schema';

commit;
