-- v203: retain the deterministic seed for every puzzle result so an exact
-- completed puzzle can later be replayed in a direct challenge.
alter table public.game_stats
  add column if not exists seed text;

comment on column public.game_stats.seed is
  'Deterministic puzzle-attempt seed used to reproduce the exact board or quiz.';
