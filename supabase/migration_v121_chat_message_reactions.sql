begin;

create table if not exists public.direct_message_reactions (
  message_id bigint not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('like','dislike','love')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (message_id,user_id)
);

alter table public.direct_message_reactions enable row level security;

drop policy if exists "chat participants view message reactions" on public.direct_message_reactions;
create policy "chat participants view message reactions"
on public.direct_message_reactions for select to authenticated
using (
  exists (
    select 1 from public.direct_messages dm
    where dm.id=message_id
      and auth.uid() in (dm.sender_id,dm.recipient_id)
  )
);

drop policy if exists "chat participants add own message reactions" on public.direct_message_reactions;
create policy "chat participants add own message reactions"
on public.direct_message_reactions for insert to authenticated
with check (
  user_id=auth.uid()
  and exists (
    select 1 from public.direct_messages dm
    where dm.id=message_id
      and auth.uid() in (dm.sender_id,dm.recipient_id)
  )
);

drop policy if exists "chat participants update own message reactions" on public.direct_message_reactions;
create policy "chat participants update own message reactions"
on public.direct_message_reactions for update to authenticated
using (user_id=auth.uid())
with check (user_id=auth.uid());

drop policy if exists "chat participants remove own message reactions" on public.direct_message_reactions;
create policy "chat participants remove own message reactions"
on public.direct_message_reactions for delete to authenticated
using (user_id=auth.uid());

create or replace function public.toggle_direct_message_reaction(
  target_message_id bigint,
  reaction_in text
)
returns table(user_id uuid,reaction text)
language plpgsql
security definer
set search_path=public
as $$
declare
  current_user_id uuid:=auth.uid();
  existing_reaction text;
  selected_reaction text;
begin
  if not public.is_approved_user(current_user_id) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if reaction_in not in ('like','dislike','love') then
    raise exception 'Invalid message reaction.' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.direct_messages dm
    where dm.id=target_message_id
      and current_user_id in (dm.sender_id,dm.recipient_id)
  ) then
    raise exception 'Message not found.' using errcode='42501';
  end if;

  select r.reaction into existing_reaction
  from public.direct_message_reactions r
  where r.message_id=target_message_id and r.user_id=current_user_id;

  if existing_reaction=reaction_in then
    delete from public.direct_message_reactions
    where message_id=target_message_id and user_id=current_user_id;
    selected_reaction:=null;
  else
    insert into public.direct_message_reactions(message_id,user_id,reaction)
    values(target_message_id,current_user_id,reaction_in)
    on conflict(message_id,user_id) do update set
      reaction=excluded.reaction,
      updated_at=now();
    selected_reaction:=reaction_in;
  end if;

  return query select current_user_id,selected_reaction;
end;
$$;

revoke all on function public.toggle_direct_message_reaction(bigint,text) from public;
grant execute on function public.toggle_direct_message_reaction(bigint,text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.direct_message_reactions;
exception when duplicate_object then null;
end $$;

notify pgrst,'reload schema';
commit;
