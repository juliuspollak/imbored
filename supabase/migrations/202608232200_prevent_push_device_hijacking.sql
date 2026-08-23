-- Corrective migration for 202608232100_native_notification_foundation.sql.
-- Never let one authenticated player take ownership by presenting only an
-- installation ID or only an APNs token belonging to somebody else. A normal
-- same-iPhone account switch may recover after a missed logout only when the
-- caller presents the exact existing installation/token pair.
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

  -- A token refresh can leave an older row for this same signed-in player.
  -- Only that player's own rows may be removed here.
  delete from public.push_device_registrations
  where user_id=auth.uid() and platform=platform_in and device_token=clean_token
    and installation_id<>clean_installation;

  insert into public.push_device_registrations(user_id,installation_id,platform,device_token,timezone)
  values(auth.uid(),clean_installation,platform_in,clean_token,public.resolve_timezone(timezone_in))
  on conflict(platform,installation_id) do update set
    user_id=excluded.user_id,
    device_token=excluded.device_token,
    timezone=excluded.timezone,
    updated_at=now(),
    last_seen_at=now()
  where push_device_registrations.user_id=auth.uid()
     or push_device_registrations.device_token=excluded.device_token;

  if not found then
    raise exception 'This installation is already registered with another device token.' using errcode='23505';
  end if;
end;
$$;

revoke all on function public.register_native_push_device(text,text,text,text) from public;
grant execute on function public.register_native_push_device(text,text,text,text) to authenticated;
