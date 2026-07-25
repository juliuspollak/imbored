begin;

create table if not exists public.app_email_invitations (
  id bigint generated always as identity primary key,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_email text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists app_email_invitations_rate_idx
on public.app_email_invitations(inviter_id,created_at desc);

alter table public.app_email_invitations enable row level security;
drop policy if exists "players view own email invitations" on public.app_email_invitations;
create policy "players view own email invitations"
on public.app_email_invitations for select to authenticated
using(inviter_id=auth.uid());

create or replace function public.prepare_app_email_invitation(target_email text)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  normalized_email text:=lower(btrim(target_email));
  invitation_id bigint;
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be active and approved.' using errcode='42501';
  end if;
  if normalized_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.' using errcode='22023';
  end if;
  if (
    select count(*) from public.app_email_invitations
    where inviter_id=auth.uid() and created_at>now()-interval '24 hours'
  )>=5 then
    raise exception 'You can send up to five invitations per day.' using errcode='42900';
  end if;

  insert into public.app_email_invitations(inviter_id,invitee_email)
  values(auth.uid(),normalized_email)
  returning id into invitation_id;
  return invitation_id;
end;
$$;

revoke all on function public.prepare_app_email_invitation(text) from public;
grant execute on function public.prepare_app_email_invitation(text) to authenticated;

notify pgrst,'reload schema';
commit;
