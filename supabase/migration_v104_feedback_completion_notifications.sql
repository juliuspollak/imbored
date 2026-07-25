begin;

create unique index if not exists direct_messages_feedback_completed_once_idx
on public.direct_messages(activity_type,source_stat_id,recipient_id)
where activity_type='feedback_completed' and source_stat_id is not null;

create or replace function public.complete_feedback(target_feedback_id bigint)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  item public.feedback;
  notification_body text;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin only.' using errcode='42501';
  end if;

  select * into item
  from public.feedback
  where id=target_feedback_id and deleted_at is null
  for update;
  if not found then raise exception 'Feedback not found.'; end if;

  update public.feedback
  set status='closed',
      admin_comment=null,
      closed_at=now(),
      user_seen_at=null
  where id=target_feedback_id;

  -- The Feedback badge is enough when an admin closes their own submission;
  -- direct_messages intentionally disallows sending a message to yourself.
  if item.user_id<>auth.uid() then
    notification_body:=format(
      '✅ Your feedback “%s” was marked done. Tap to view the update.',
      left(item.title,160)
    );
    insert into public.direct_messages(
      sender_id,recipient_id,body,system_generated,activity_type,source_stat_id
    )
    values(
      auth.uid(),item.user_id,notification_body,true,'feedback_completed',item.id
    )
    on conflict(activity_type,source_stat_id,recipient_id)
      where activity_type='feedback_completed' and source_stat_id is not null
    do update set
      sender_id=excluded.sender_id,
      body=excluded.body,
      created_at=now(),
      read_at=null;
  end if;
end;
$$;

revoke all on function public.complete_feedback(bigint) from public;
grant execute on function public.complete_feedback(bigint) to authenticated;

create or replace function public.reopen_feedback_item(target_feedback_id bigint)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin only.' using errcode='42501';
  end if;
  update public.feedback
  set status='open',admin_comment=null,closed_at=null,user_seen_at=null
  where id=target_feedback_id and deleted_at is null;
  if not found then raise exception 'Feedback not found.'; end if;

  delete from public.direct_messages
  where activity_type='feedback_completed'
    and source_stat_id=target_feedback_id;
end;
$$;

revoke all on function public.reopen_feedback_item(bigint) from public;
grant execute on function public.reopen_feedback_item(bigint) to authenticated;

notify pgrst,'reload schema';
commit;
