begin;

alter table public.profiles add column if not exists is_blocked boolean not null default false;
alter table public.profiles add column if not exists blocked_at timestamp with time zone;
alter table public.profiles add column if not exists blocked_by uuid;
alter table public.profiles add column if not exists blocked_reason text;
alter table public.profiles add column if not exists account_deleted_at timestamp with time zone;
alter table public.profiles add column if not exists account_deleted_by uuid;

-- Historical profiles must survive Auth deletion. The application still uses
-- the same UUID while the account is active; deleted profiles simply retain
-- their former UUID without an auth.users row.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid='public.profiles'::regclass
      and contype='f'
      and confrelid='auth.users'::regclass
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;

-- Resolve pre-existing active duplicates deterministically before adding the
-- case-insensitive unique index.
with ranked as (
  select id, name,
         row_number() over (partition by lower(btrim(name)) order by created_at nulls last, id) as rn
  from public.profiles
  where account_deleted_at is null
), duplicates as (
  select id, btrim(name) || ' (' || rn || ')' as new_name
  from ranked where rn > 1
)
update public.profiles p set name=d.new_name
from duplicates d where p.id=d.id;

create unique index if not exists profiles_active_name_unique_ci
on public.profiles (lower(btrim(name)))
where account_deleted_at is null;

create or replace function public.is_approved_user(uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path=public
as $$
  select exists(
    select 1 from public.profiles p
    where p.id=uid
      and p.account_deleted_at is null
      and coalesce(p.is_blocked,false)=false
      and (p.is_admin=true or p.is_approved=true)
  )
$$;

revoke all on function public.is_approved_user(uuid) from public;
grant execute on function public.is_approved_user(uuid) to authenticated;

create or replace function public.save_my_profile(
  profile_name text default null,
  profile_icon text default null,
  profile_is_private boolean default null,
  profile_mood text default null,
  profile_default_mode text default null,
  profile_show_stats boolean default null,
  profile_week_starts_on integer default null
)
returns public.profiles
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.profiles;
  clean_name text := nullif(btrim(profile_name),'');
begin
  if auth.uid() is null then raise exception 'You must be signed in.' using errcode='42501'; end if;
  if profile_name is not null and clean_name is null then raise exception 'Name is required.' using errcode='22023'; end if;
  if profile_default_mode is not null and profile_default_mode not in ('practice','challenge') then raise exception 'Invalid default mode.' using errcode='22023'; end if;
  if profile_week_starts_on is not null and profile_week_starts_on not in (0,1) then raise exception 'Invalid week start.' using errcode='22023'; end if;

  if clean_name is not null and exists(
    select 1 from public.profiles p
    where p.id<>auth.uid() and p.account_deleted_at is null and lower(btrim(p.name))=lower(clean_name)
  ) then
    raise exception 'That player name is already taken. Choose another one.' using errcode='23505';
  end if;

  if not exists(select 1 from public.profiles where id=auth.uid()) and clean_name is null then
    raise exception 'Name is required.' using errcode='22023';
  end if;

  insert into public.profiles(id,name,icon,is_private,mood,default_mode,show_stats_to_others,week_starts_on,is_admin,is_approved)
  values(auth.uid(),clean_name,coalesce(nullif(profile_icon,''),'🙂'),coalesce(profile_is_private,false),nullif(btrim(profile_mood),''),coalesce(profile_default_mode,'challenge'),coalesce(profile_show_stats,true),coalesce(profile_week_starts_on,1),false,false)
  on conflict(id) do update set
    name=coalesce(clean_name,public.profiles.name),
    icon=coalesce(nullif(profile_icon,''),public.profiles.icon),
    is_private=coalesce(profile_is_private,public.profiles.is_private),
    mood=case when profile_mood is null then public.profiles.mood else nullif(btrim(profile_mood),'') end,
    default_mode=coalesce(profile_default_mode,public.profiles.default_mode),
    show_stats_to_others=coalesce(profile_show_stats,public.profiles.show_stats_to_others),
    week_starts_on=coalesce(profile_week_starts_on,public.profiles.week_starts_on)
  returning * into result;
  return result;
exception when unique_violation then
  raise exception 'That player name is already taken. Choose another one.' using errcode='23505';
end;
$$;

revoke all on function public.save_my_profile(text,text,boolean,text,text,boolean,integer) from public;
grant execute on function public.save_my_profile(text,text,boolean,text,text,boolean,integer) to authenticated;

create or replace function public.admin_set_user_block(target_user_id uuid, blocked boolean, reason text default null)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admin only.' using errcode='42501'; end if;
  if target_user_id=auth.uid() then raise exception 'You cannot block your own account.' using errcode='22023'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and is_admin=true) then raise exception 'Another admin cannot be blocked here.' using errcode='42501'; end if;
  update public.profiles set
    is_blocked=blocked,
    blocked_at=case when blocked then now() else null end,
    blocked_by=case when blocked then auth.uid() else null end,
    blocked_reason=case when blocked then nullif(btrim(reason),'') else null end
  where id=target_user_id and account_deleted_at is null;
end;
$$;
revoke all on function public.admin_set_user_block(uuid,boolean,text) from public;
grant execute on function public.admin_set_user_block(uuid,boolean,text) to authenticated;

create or replace function public.prepare_account_deletion(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare team_row record; replacement uuid;
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admin only.' using errcode='42501'; end if;
  if target_user_id=auth.uid() then raise exception 'You cannot delete your own account.' using errcode='22023'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and is_admin=true) then raise exception 'Another admin cannot be deleted here.' using errcode='42501'; end if;

  for team_row in select id from public.teams where created_by=target_user_id loop
    select tm.user_id into replacement
    from public.team_members tm
    where tm.team_id=team_row.id and tm.user_id<>target_user_id
    order by tm.joined_at asc nulls last, tm.user_id
    limit 1;
    if replacement is null then delete from public.teams where id=team_row.id;
    else update public.teams set created_by=replacement where id=team_row.id; end if;
    replacement:=null;
  end loop;

  delete from public.team_members where user_id=target_user_id;
  delete from public.team_join_requests where user_id=target_user_id;
  delete from public.presence where user_id=target_user_id;
  update public.profiles set
    account_deleted_at=now(), account_deleted_by=auth.uid(),
    is_blocked=true, is_approved=false, hidden_from_others=true,
    blocked_at=now(), blocked_by=auth.uid(), blocked_reason='Account deleted'
  where id=target_user_id;
end;
$$;
revoke all on function public.prepare_account_deletion(uuid) from public;
grant execute on function public.prepare_account_deletion(uuid) to authenticated;


create or replace function public.protect_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null or public.is_admin(auth.uid()) then return new; end if;
  if tg_op='INSERT' then
    new.is_admin:=false; new.is_approved:=false; new.approved_at:=null; new.approved_by:=null;
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

drop trigger if exists protect_profile_security_fields_trigger on public.profiles;
create trigger protect_profile_security_fields_trigger
before insert or update on public.profiles
for each row execute function public.protect_profile_security_fields();

notify pgrst, 'reload schema';
commit;
