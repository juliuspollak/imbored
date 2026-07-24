begin;

-- One system conversation per pending player/admin pair. It is removed when
-- the player is approved, blocked, or deleted, allowing a later genuine
-- re-approval request to create a fresh notification.
create unique index if not exists direct_messages_pending_approval_once_idx
on public.direct_messages(sender_id,recipient_id,activity_type)
where activity_type='user_approval_required';

create or replace function public.notify_admins_of_pending_profile()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.is_admin=false
     and new.is_approved=false
     and coalesce(new.is_blocked,false)=false
     and new.account_deleted_at is null
     and nullif(btrim(new.name),'') is not null then
    insert into public.direct_messages(
      sender_id,
      recipient_id,
      body,
      system_generated,
      activity_type
    )
    select
      new.id,
      admin_profile.id,
      format('🛡️ %s is waiting for approval. Tap to review their account.',new.name),
      true,
      'user_approval_required'
    from public.profiles admin_profile
    where admin_profile.is_admin=true
      and admin_profile.account_deleted_at is null
      and coalesce(admin_profile.is_blocked,false)=false
      and admin_profile.id<>new.id
    on conflict(sender_id,recipient_id,activity_type)
      where activity_type='user_approval_required'
    do nothing;
  else
    delete from public.direct_messages
    where sender_id=new.id
      and activity_type='user_approval_required';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_notify_admins_of_pending_profile on public.profiles;
create trigger profiles_notify_admins_of_pending_profile
after insert or update of name,is_approved,is_blocked,account_deleted_at
on public.profiles
for each row execute function public.notify_admins_of_pending_profile();

-- Notify admins about players who were already waiting when this migration
-- was installed.
insert into public.direct_messages(
  sender_id,
  recipient_id,
  body,
  system_generated,
  activity_type
)
select
  pending_profile.id,
  admin_profile.id,
  format('🛡️ %s is waiting for approval. Tap to review their account.',pending_profile.name),
  true,
  'user_approval_required'
from public.profiles pending_profile
cross join public.profiles admin_profile
where pending_profile.is_admin=false
  and pending_profile.is_approved=false
  and coalesce(pending_profile.is_blocked,false)=false
  and pending_profile.account_deleted_at is null
  and nullif(btrim(pending_profile.name),'') is not null
  and admin_profile.is_admin=true
  and admin_profile.account_deleted_at is null
  and coalesce(admin_profile.is_blocked,false)=false
on conflict(sender_id,recipient_id,activity_type)
  where activity_type='user_approval_required'
do nothing;

notify pgrst,'reload schema';
commit;
