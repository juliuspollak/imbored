-- Repair live-schema drift after the push outbox SQL was applied against an
-- older notification_deliveries table. This migration does not claim, send,
-- or otherwise change notification rows.

alter table public.notification_deliveries
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists claim_token uuid;

-- The live table predates lease claiming, so make its status constraint match
-- the worker contract as part of the same repair.
alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_status_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_status_check
  check (status in ('pending','sending','sent','retry','failed','invalid_token'));

do $$
begin
  if exists (select 1 from public.notification_deliveries where status='sending') then
    raise exception 'Cannot add the delivery lease invariant while legacy sending rows exist; inspect them manually first.';
  end if;
end $$;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_sending_lease_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_sending_lease_check
  check ((status='sending')=(claim_token is not null and claimed_at is not null and lease_expires_at is not null));

-- Make the new columns visible to PostgREST immediately after manual apply.
notify pgrst,'reload schema';
