-- v203: retain the deterministic seed for every puzzle result so an exact
-- completed puzzle can later be replayed in a direct challenge.
alter table public.game_stats
  add column if not exists seed text,
  add column if not exists generator_version text,
  add column if not exists generator_config jsonb;

comment on column public.game_stats.seed is
  'Deterministic puzzle-attempt seed used to reproduce the exact board or quiz.';

comment on column public.game_stats.generator_version is
  'Version of the game generator that interpreted seed and generator_config.';

comment on column public.game_stats.generator_config is
  'Immutable generation settings needed to reproduce the completed puzzle.';
