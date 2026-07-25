begin;

drop policy if exists "participants can read direct messages" on public.direct_messages;
create policy "participants can read direct messages"
on public.direct_messages for select
to authenticated
using (
  (
    (coalesce(system_generated,false)=true and auth.uid()=recipient_id)
    or
    (coalesce(system_generated,false)=false and auth.uid() in (sender_id,recipient_id))
  )
  and exists (
    select 1 from public.profiles sender
    where sender.id=sender_id
      and coalesce(sender.hidden_from_others,false)=false
  )
  and exists (
    select 1 from public.profiles recipient
    where recipient.id=recipient_id
      and coalesce(recipient.hidden_from_others,false)=false
  )
);

notify pgrst,'reload schema';
commit;
