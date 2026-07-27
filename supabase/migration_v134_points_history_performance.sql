-- Keep the Progress page's bounded, newest-first history lookup fast as the
-- points ledger grows. The id suffix gives rows with equal timestamps a stable
-- order and lets Postgres satisfy both ORDER BY columns from the index.
create index if not exists points_transactions_player_created_id
  on public.points_transactions(player_id, created_at desc, id desc);

-- Transfer history is filtered separately from the general activity preview.
create index if not exists points_transactions_player_reason_created_id
  on public.points_transactions(player_id, created_at desc, id desc)
  where reason_code in ('TRANSFER_RECEIVED', 'TRANSFER_SENT');
