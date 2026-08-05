-- Internal points-economy migration ledger. The browser application never
-- reads or writes this table, so it must not be exposed through PostgREST.
alter table public.points_economy_versions enable row level security;

-- RLS with no policies denies every client row operation. Revoke the table
-- grants as an additional safeguard; database owners and service operations
-- retain their privileged access.
revoke all on table public.points_economy_versions from anon, authenticated;
