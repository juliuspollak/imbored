-- PHASE 3 SERVER PUSH. Review and apply manually; do not deploy automatically.
alter table public.notification_preferences
  add column if not exists chat_messages_enabled boolean not null default true,
  add column if not exists pokes_enabled boolean not null default true;

alter table public.push_device_registrations
  add column if not exists apns_environment text not null default 'production'
    check (apns_environment in ('production','sandbox')),
  add column if not exists is_active boolean not null default true,
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidation_reason text;

drop function if exists public.register_native_push_device(text,text,text,text);
create function public.register_native_push_device(
  installation_id_in text, platform_in text, device_token_in text,
  timezone_in text default null, apns_environment_in text default 'production'
) returns void language plpgsql security definer set search_path='public' as $$
declare clean_installation text:=nullif(btrim(installation_id_in),''); clean_token text:=nullif(btrim(device_token_in),'');
begin
  if auth.uid() is null then raise exception 'You must be signed in.' using errcode='42501'; end if;
  if platform_in<>'ios' or apns_environment_in not in ('production','sandbox') then raise exception 'Unsupported push target.' using errcode='22023'; end if;
  if clean_installation is null or char_length(clean_installation) not between 8 and 200 then raise exception 'Invalid installation identifier.' using errcode='22023'; end if;
  if clean_token is null or char_length(clean_token) not between 16 and 512 then raise exception 'Invalid device token.' using errcode='22023'; end if;
  delete from public.push_device_registrations where user_id=auth.uid() and platform=platform_in and device_token=clean_token and installation_id<>clean_installation;
  insert into public.push_device_registrations(user_id,installation_id,platform,device_token,timezone,apns_environment,is_active,invalidated_at,invalidation_reason)
  values(auth.uid(),clean_installation,platform_in,clean_token,public.resolve_timezone(timezone_in),apns_environment_in,true,null,null)
  on conflict(platform,installation_id) do update set user_id=excluded.user_id,device_token=excluded.device_token,timezone=excluded.timezone,
    apns_environment=excluded.apns_environment,is_active=true,invalidated_at=null,invalidation_reason=null,updated_at=now(),last_seen_at=now()
  where push_device_registrations.user_id=auth.uid() or push_device_registrations.device_token=excluded.device_token;
  if not found then raise exception 'This installation is already registered with another device token.' using errcode='23505'; end if;
end $$;
revoke all on function public.register_native_push_device(text,text,text,text,text) from public;
grant execute on function public.register_native_push_device(text,text,text,text,text) to authenticated;

create table public.notification_events (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('chat_message','poke','circle_challenge','competition_update')),
  title text not null,
  body text not null,
  route_data jsonb not null default '{}'::jsonb,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  check (char_length(event_key) between 3 and 240),
  check (char_length(title) between 1 and 80),
  check (char_length(body) between 1 and 180),
  check (jsonb_typeof(route_data)='object'),
  check (octet_length(route_data::text)<=512)
);

create table public.notification_deliveries (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.notification_events(id) on delete cascade,
  device_registration_id bigint not null references public.push_device_registrations(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sending','sent','retry','failed','invalid_token')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  claim_token uuid,
  apns_id text,
  last_status integer,
  last_reason text,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(event_id,device_registration_id),
  check (attempt_count between 0 and 5),
  check ((status='sending')=(claim_token is not null and claimed_at is not null and lease_expires_at is not null))
);

create index notification_events_ready_idx on public.notification_events(available_at,id) where processed_at is null;
create index notification_deliveries_retry_idx on public.notification_deliveries(next_attempt_at,id) where status in ('pending','retry');
alter table public.notification_events enable row level security;
alter table public.notification_deliveries enable row level security;
-- No client policies: service_role bypasses RLS. Authenticated users cannot inspect the outbox or device tokens.

create or replace function public.valid_notification_route_data(kind_in text,route_data_in jsonb) returns boolean
language sql immutable set search_path='public' as $$
  select case
    when jsonb_typeof(route_data_in)<>'object' or octet_length(route_data_in::text)>512 then false
    when kind_in in ('chat_message','poke') then
      route_data_in ? 'route' and route_data_in->>'route'='chat'
      and route_data_in ? 'playerId'
      and (select bool_and(key in ('route','playerId')) from jsonb_object_keys(route_data_in) key)
      and (route_data_in->>'playerId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    when kind_in in ('circle_challenge','competition_update') then
      route_data_in ? 'route' and route_data_in->>'route'='circle'
      and route_data_in ? 'circleId' and (route_data_in->>'circleId') ~ '^[1-9][0-9]*$'
      and (not route_data_in ? 'challengeId' or (route_data_in->>'challengeId') ~ '^[1-9][0-9]*$')
      and (select bool_and(key in ('route','circleId','challengeId')) from jsonb_object_keys(route_data_in) key)
    else false end;
$$;
revoke all on function public.valid_notification_route_data(text,jsonb) from public,anon,authenticated;

alter table public.notification_events add constraint notification_events_route_data_valid
check (public.valid_notification_route_data(kind,route_data));

create or replace function public.enqueue_notification_event(
  event_key_in text, recipient_id_in uuid, actor_id_in uuid, kind_in text,
  title_in text, body_in text, route_data_in jsonb default '{}'::jsonb,
  available_at_in timestamptz default now()
) returns bigint language plpgsql security definer set search_path='public' as $$
declare inserted_id bigint;
begin
  if recipient_id_in is null or actor_id_in=recipient_id_in then return null; end if;
  if actor_id_in is not null and public.is_blocked_between(actor_id_in,recipient_id_in) then return null; end if;
  if not public.valid_notification_route_data(kind_in,route_data_in) then raise exception 'Invalid notification route metadata.' using errcode='22023'; end if;
  insert into public.notification_events(event_key,recipient_id,actor_id,kind,title,body,route_data,available_at)
  values(event_key_in,recipient_id_in,actor_id_in,kind_in,left(title_in,80),left(body_in,180),coalesce(route_data_in,'{}'),available_at_in)
  on conflict(event_key) do nothing returning id into inserted_id;
  return inserted_id;
end $$;
revoke all on function public.enqueue_notification_event(text,uuid,uuid,text,text,text,jsonb,timestamptz) from public,anon,authenticated;

create or replace function public.queue_social_push_event() returns trigger language plpgsql security definer set search_path='public' as $$
declare actor_name text; enabled boolean;
begin
  if tg_table_name='direct_messages' then
    select coalesce(name,'A player') into actor_name from public.profiles where id=new.sender_id;
    if coalesce(new.system_generated,false) then return new; end if;
    select coalesce(chat_messages_enabled,true) into enabled from public.notification_preferences where user_id=new.recipient_id;
    if coalesce(enabled,true) then perform public.enqueue_notification_event(
      'chat:'||new.id,new.recipient_id,new.sender_id,'chat_message','New message',actor_name||' sent you a message',
      jsonb_build_object('route','chat','playerId',new.sender_id)); end if;
  else
    select coalesce(name,'A player') into actor_name from public.profiles where id=new.from_user;
    select coalesce(pokes_enabled,true) into enabled from public.notification_preferences where user_id=new.to_user;
    if coalesce(enabled,true) then perform public.enqueue_notification_event(
      'poke:'||new.id,new.to_user,new.from_user,'poke','You got a poke',actor_name||' poked you',
      jsonb_build_object('route','chat','playerId',new.from_user)); end if;
  end if;
  return new;
end $$;
revoke all on function public.queue_social_push_event() from public,anon,authenticated;

drop trigger if exists direct_messages_queue_push on public.direct_messages;
create trigger direct_messages_queue_push after insert on public.direct_messages for each row execute function public.queue_social_push_event();
drop trigger if exists pokes_queue_push on public.pokes;
create trigger pokes_queue_push after insert on public.pokes for each row execute function public.queue_social_push_event();

create or replace function public.claim_push_deliveries(batch_size integer default 10)
returns table(delivery_id bigint,claim_token uuid,attempt_count integer,device_id bigint,device_token text,apns_environment text,event_id bigint,kind text,title text,body text,route_data jsonb)
language plpgsql security definer set search_path='public' as $$
begin
  insert into public.notification_deliveries(event_id,device_registration_id)
  select event.id,device.id from public.notification_events event
  join public.push_device_registrations device on device.user_id=event.recipient_id and device.is_active
  where event.processed_at is null and event.available_at<=now()
  on conflict do nothing;
  -- Fan-out has now been evaluated even when the recipient has no active
  -- devices. Marking it processed prevents an empty event being scanned on
  -- every future worker run.
  update public.notification_events event set processed_at=now()
  where event.processed_at is null and event.available_at<=now();
  -- A fifth worker crash cannot be retried, but it must still leave the lease
  -- in an explicit terminal state rather than a permanent `sending` row.
  update public.notification_deliveries delivery set status='failed',last_reason='LeaseExpiredAfterMaxAttempts',
    claimed_at=null,lease_expires_at=null,claim_token=null,updated_at=now()
  where delivery.status='sending' and delivery.lease_expires_at<=now() and delivery.attempt_count>=5;
  return query
  with claimed as (
    select delivery.id from public.notification_deliveries delivery
    where (
      (delivery.status in ('pending','retry') and delivery.next_attempt_at<=now())
      or (delivery.status='sending' and delivery.lease_expires_at<=now())
    ) and delivery.attempt_count<5 -- MAX_ATTEMPTS = 5
    order by delivery.id for update skip locked limit greatest(1,least(coalesce(batch_size,10),50))
  ), updated as (
    update public.notification_deliveries delivery set status='sending',attempt_count=attempt_count+1,
      claimed_at=now(),lease_expires_at=now()+interval '3 minutes',claim_token=gen_random_uuid(),updated_at=now()
    from claimed where delivery.id=claimed.id returning delivery.*
  ) select updated.id,updated.claim_token,updated.attempt_count,device.id,device.device_token,device.apns_environment,event.id,event.kind,event.title,event.body,event.route_data
    from updated join public.push_device_registrations device on device.id=updated.device_registration_id
    join public.notification_events event on event.id=updated.event_id;
end $$;
revoke all on function public.claim_push_deliveries(integer) from public,anon,authenticated;
grant execute on function public.claim_push_deliveries(integer) to service_role;

create or replace function public.finish_push_delivery(delivery_id_in bigint,claim_token_in uuid,status_in text,http_status_in integer,reason_in text,apns_id_in text default null)
returns text language plpgsql security definer set search_path='public' as $$
declare target_device bigint; final_status text;
begin
  if status_in not in ('sent','retry','failed','invalid_token') then raise exception 'Invalid delivery status.'; end if;
  final_status:=case when status_in='retry' and (select attempt_count>=5 from public.notification_deliveries where id=delivery_id_in and claim_token=claim_token_in) then 'failed' else status_in end;
  update public.notification_deliveries set status=final_status,last_status=http_status_in,last_reason=left(coalesce(reason_in,'Unknown'),160),apns_id=apns_id_in,
    sent_at=case when final_status='sent' then now() else sent_at end,
    next_attempt_at=case when final_status='retry' then now()+(interval '30 seconds'*power(2,greatest(0,attempt_count-1))) else next_attempt_at end,
    claimed_at=null,lease_expires_at=null,claim_token=null,updated_at=now()
  where id=delivery_id_in and status='sending' and claim_token=claim_token_in
  returning device_registration_id into target_device;
  if not found then return null; end if;
  if final_status='invalid_token' then update public.push_device_registrations set is_active=false,invalidated_at=now(),invalidation_reason=left(coalesce(reason_in,'InvalidToken'),160),updated_at=now() where id=target_device; end if;
  return final_status;
end $$;
revoke all on function public.finish_push_delivery(bigint,uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.finish_push_delivery(bigint,uuid,text,integer,text,text) to service_role;
