-- v77: one-to-one player chat
-- Run once in Supabase Dashboard -> SQL Editor after deploying v77.

begin;

create table if not exists public.direct_messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint direct_messages_not_to_self check (sender_id <> recipient_id)
);

create index if not exists direct_messages_conversation_idx
  on public.direct_messages (sender_id, recipient_id, created_at desc);

create index if not exists direct_messages_unread_idx
  on public.direct_messages (recipient_id, created_at desc)
  where read_at is null;

alter table public.direct_messages enable row level security;

drop policy if exists "participants can read direct messages" on public.direct_messages;
create policy "participants can read direct messages"
on public.direct_messages for select
to authenticated
using (
  auth.uid() in (sender_id, recipient_id)
  and exists (
    select 1 from public.profiles sender
    where sender.id = sender_id
      and coalesce(sender.hidden_from_others, false) = false
  )
  and exists (
    select 1 from public.profiles recipient
    where recipient.id = recipient_id
      and coalesce(recipient.hidden_from_others, false) = false
  )
);

drop policy if exists "users can send direct messages" on public.direct_messages;
create policy "users can send direct messages"
on public.direct_messages for insert
to authenticated
with check (
  auth.uid() = sender_id
  and sender_id <> recipient_id
  and exists (
    select 1 from public.profiles sender
    where sender.id = auth.uid()
      and coalesce(sender.hidden_from_others, false) = false
  )
  and exists (
    select 1 from public.profiles recipient
    where recipient.id = recipient_id
      and coalesce(recipient.hidden_from_others, false) = false
      and coalesce(recipient.is_private, false) = false
  )
);

drop policy if exists "recipients can mark direct messages read" on public.direct_messages;
create policy "recipients can mark direct messages read"
on public.direct_messages for update
to authenticated
using (auth.uid() = recipient_id)
with check (auth.uid() = recipient_id);

grant select, insert, update on public.direct_messages to authenticated;
grant usage, select on sequence public.direct_messages_id_seq to authenticated;

-- Ask PostgREST to pick up the new table immediately.
notify pgrst, 'reload schema';

commit;
