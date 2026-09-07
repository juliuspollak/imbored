-- Public App Store accounts become usable as soon as onboarding creates their
-- profile. is_approved remains as a compatibility flag because many existing
-- RPCs use it together with blocked/deleted state to identify active accounts.

alter table public.profiles
  alter column is_approved set default true;

create or replace function public.protect_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null or public.is_admin(auth.uid()) then return new; end if;
  if tg_op='INSERT' then
    new.is_admin:=false;
    new.is_approved:=true;
    new.approved_at:=now();
    new.approved_by:=null;
    new.hidden_from_others:=false; new.is_blocked:=false; new.blocked_at:=null; new.blocked_by:=null;
    new.blocked_reason:=null; new.account_deleted_at:=null; new.account_deleted_by:=null;
  elsif new.is_admin is distinct from old.is_admin
     or new.is_approved is distinct from old.is_approved
     or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by
     or new.hidden_from_others is distinct from old.hidden_from_others
     or new.is_blocked is distinct from old.is_blocked
     or new.blocked_at is distinct from old.blocked_at
     or new.blocked_by is distinct from old.blocked_by
     or new.blocked_reason is distinct from old.blocked_reason
     or new.account_deleted_at is distinct from old.account_deleted_at
     or new.account_deleted_by is distinct from old.account_deleted_by then
    raise exception 'Protected profile fields can only be changed by an admin.' using errcode='42501';
  end if;
  return new;
end;
$$;

-- Backfill only accounts whose sole restriction is the retired approval gate.
update public.profiles
set is_approved=true,
    approved_at=coalesce(approved_at,now()),
    approved_by=null
where is_admin=false
  and is_approved=false
  and coalesce(is_blocked,false)=false
  and account_deleted_at is null;

-- Restoring a moderated account makes it a normal active account again. A
-- block still wins in is_approved_user() while it remains in force.
create or replace function public.admin_set_user_block(target_user_id uuid, blocked boolean, reason text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admin only.' using errcode='42501'; end if;
  if target_user_id=auth.uid() then raise exception 'You cannot block your own account.' using errcode='22023'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and is_admin=true) then raise exception 'Another admin cannot be blocked here.' using errcode='42501'; end if;
  update public.profiles set
    is_blocked=blocked,
    blocked_at=case when blocked then now() else null end,
    blocked_by=case when blocked then auth.uid() else null end,
    blocked_reason=case when blocked then nullif(btrim(reason),'') else null end,
    is_approved=case when blocked then is_approved else true end,
    approved_at=case when not blocked then coalesce(approved_at,now()) else approved_at end,
    approved_by=case when not blocked and approved_at is null then auth.uid() else approved_by end
  where id=target_user_id and account_deleted_at is null;
end;
$$;
