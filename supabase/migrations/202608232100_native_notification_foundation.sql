create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  circle_challenges_enabled boolean not null default true,
  daily_reminder_period text not null default 'off' check (daily_reminder_period in ('off','morning','afternoon','evening')),
  competition_updates_enabled boolean not null default true,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_device_registrations (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  installation_id text not null,
  platform text not null check (platform in ('ios')),
  device_token text not null,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(platform,installation_id),
  unique(platform,device_token),
  check (char_length(installation_id) between 8 and 200),
  check (char_length(device_token) between 16 and 512)
);

alter table public.notification_preferences enable row level security;
alter table public.push_device_registrations enable row level security;

create policy "users manage their notification preferences"
on public.notification_preferences to authenticated
using (user_id=auth.uid()) with check (user_id=auth.uid());

create policy "users view their own push devices"
on public.push_device_registrations for select to authenticated
using (user_id=auth.uid());

create policy "users remove their own push devices"
on public.push_device_registrations for delete to authenticated
using (user_id=auth.uid());

create or replace function public.register_native_push_device(
  installation_id_in text,
  platform_in text,
  device_token_in text,
  timezone_in text default null
) returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  clean_installation text:=nullif(btrim(installation_id_in),'');
  clean_token text:=nullif(btrim(device_token_in),'');
begin
  if auth.uid() is null then raise exception 'You must be signed in.' using errcode='42501'; end if;
  if platform_in<>'ios' then raise exception 'Unsupported push platform.' using errcode='22023'; end if;
  if clean_installation is null or char_length(clean_installation) not between 8 and 200 then raise exception 'Invalid installation identifier.' using errcode='22023'; end if;
  if clean_token is null or char_length(clean_token) not between 16 and 512 then raise exception 'Invalid device token.' using errcode='22023'; end if;

  -- A physical installation or refreshed APNs token belongs to exactly one
  -- signed-in player. This also prevents a token remaining attached after a
  -- different player signs into the same iPhone.
  delete from public.push_device_registrations
  where platform=platform_in and (installation_id=clean_installation or device_token=clean_token)
    and user_id<>auth.uid();

  insert into public.push_device_registrations(user_id,installation_id,platform,device_token,timezone)
  values(auth.uid(),clean_installation,platform_in,clean_token,public.resolve_timezone(timezone_in))
  on conflict(platform,installation_id) do update set
    user_id=excluded.user_id,
    device_token=excluded.device_token,
    timezone=excluded.timezone,
    updated_at=now(),
    last_seen_at=now();
end;
$$;

create or replace function public.unregister_native_push_device(installation_id_in text) returns void
language sql security definer
set search_path to 'public'
as $$
  delete from public.push_device_registrations
  where user_id=auth.uid() and installation_id=nullif(btrim(installation_id_in),'');
$$;

revoke all on function public.register_native_push_device(text,text,text,text) from public;
revoke all on function public.unregister_native_push_device(text) from public;
grant execute on function public.register_native_push_device(text,text,text,text) to authenticated;
grant execute on function public.unregister_native_push_device(text) to authenticated;
