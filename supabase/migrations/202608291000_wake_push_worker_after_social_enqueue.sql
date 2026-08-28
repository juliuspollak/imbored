-- Wake the existing outbox worker after a social event is durably queued.
-- pg_net requests are dispatched only after the surrounding transaction
-- commits, so a failed/rolled-back message never produces an early push.
-- Store both values in Vault before applying:
--   push_worker_url    = .../functions/v1/send-push-notifications
--   push_worker_secret = the existing PUSH_WORKER_SECRET value

create or replace function public.wake_push_worker() returns void
language plpgsql security definer set search_path='public' as $$
declare worker_url text; worker_secret text;
begin
  select decrypted_secret into worker_url from vault.decrypted_secrets where name='push_worker_url' limit 1;
  select decrypted_secret into worker_secret from vault.decrypted_secrets where name='push_worker_secret' limit 1;
  if nullif(worker_url,'') is null or nullif(worker_secret,'') is null then return; end if;
  -- Dynamic SQL lets schema restore succeed before pg_net is enabled. A
  -- missing extension/configuration remains best-effort and leaves the event.
  execute 'select net.http_post(url := $1, headers := $2, body := $3)'
    using worker_url,
      jsonb_build_object('content-type','application/json','authorization','Bearer '||worker_secret),
      '{}'::jsonb;
exception when others then
  raise warning 'Push worker wake-up failed; scheduled delivery will retry (%).',sqlstate;
end $$;
revoke all on function public.wake_push_worker() from public,anon,authenticated;

create or replace function public.queue_social_push_event() returns trigger
language plpgsql security definer set search_path='public' as $$
declare actor_name text; enabled boolean; queued_event_id bigint;
begin
  if tg_table_name='direct_messages' then
    select coalesce(name,'A player') into actor_name from public.profiles where id=new.sender_id;
    if coalesce(new.system_generated,false) then return new; end if;
    select coalesce(chat_messages_enabled,true) into enabled from public.notification_preferences where user_id=new.recipient_id;
    if coalesce(enabled,true) then
      queued_event_id:=public.enqueue_notification_event(
        'chat:'||new.id,new.recipient_id,new.sender_id,'chat_message','New message',actor_name||' sent you a message',
        jsonb_build_object('route','chat','playerId',new.sender_id));
    end if;
  else
    select coalesce(name,'A player') into actor_name from public.profiles where id=new.from_user;
    select coalesce(pokes_enabled,true) into enabled from public.notification_preferences where user_id=new.to_user;
    if coalesce(enabled,true) then
      queued_event_id:=public.enqueue_notification_event(
        'poke:'||new.id,new.to_user,new.from_user,'poke','You got a poke',actor_name||' poked you',
        jsonb_build_object('route','chat','playerId',new.from_user));
    end if;
  end if;
  -- One wake-up per event, never per device. Dedupe returning null also avoids
  -- waking for a duplicate event key.
  if queued_event_id is not null then perform public.wake_push_worker(); end if;
  return new;
end $$;
revoke all on function public.queue_social_push_event() from public,anon,authenticated;
