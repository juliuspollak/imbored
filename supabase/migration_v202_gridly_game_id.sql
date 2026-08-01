-- V202: migrate the canonical game id from Zip to Gridly without changing
-- legacy zip_* metric/config column contracts used by existing RPC results.

begin;

alter table public.circle_challenge_rounds
  drop constraint if exists team_challenge_rounds_game_check;
alter table public.circle_challenge_rounds
  drop constraint if exists circle_challenge_rounds_game_check;

-- Preserve every configuration value, preferring the established legacy row
-- if both ids briefly existed during a mixed deployment.
delete from public.game_config
where game_id = 'gridly'
  and exists (select 1 from public.game_config where game_id = 'zip');
update public.game_config set game_id = 'gridly' where game_id = 'zip';

-- Avoid the partial daily-challenge unique index when both application
-- versions have already saved the same player's completion.
delete from public.game_stats legacy
using public.game_stats canonical
where legacy.game = 'zip'
  and canonical.game = 'gridly'
  and legacy.mode = 'challenge'
  and canonical.mode = 'challenge'
  and legacy.user_id = canonical.user_id
  and legacy.challenge_date = canonical.challenge_date;

update public.game_stats set game = 'gridly' where game = 'zip';
update public.presence set game = 'gridly' where game = 'zip';

delete from public.game_time_benchmarks
where game = 'gridly'
  and exists (select 1 from public.game_time_benchmarks where game = 'zip');
update public.game_time_benchmarks set game = 'gridly' where game = 'zip';
update public.circle_challenge_rounds set game = 'gridly' where game = 'zip';

delete from public.circle_challenge_starts legacy
using public.circle_challenge_starts canonical
where legacy.game = 'zip'
  and canonical.game = 'gridly'
  and legacy.challenge_id = canonical.challenge_id
  and legacy.player_id = canonical.player_id
  and legacy.challenge_date = canonical.challenge_date;

update public.circle_challenge_starts set game = 'gridly' where game = 'zip';
update public.challenge_reset_point_credits set game = 'gridly' where game = 'zip';

-- Replace and deduplicate ids while preserving the organiser's game order.
update public.circle_weekly_challenges challenge
set game_ids = (
  select array_agg(mapped.game_id order by mapped.first_position)
  from (
    select
      case when selected.game_id = 'zip' then 'gridly' else selected.game_id end as game_id,
      min(selected.position) as first_position
    from unnest(challenge.game_ids) with ordinality selected(game_id, position)
    group by case when selected.game_id = 'zip' then 'gridly' else selected.game_id end
  ) mapped
)
where 'zip' = any(challenge.game_ids);

alter table public.circle_weekly_challenges
  alter column game_ids
  set default array['hive','tango','gridly','minisudoku','geo','zoom']::text[];

alter table public.circle_challenge_rounds
  add constraint circle_challenge_rounds_game_check
  check (game in ('hive','tango','gridly','minisudoku','geo','zoom'));

-- Applied historical migrations do not update stored PostgreSQL functions.
-- Change only quoted game ids/display labels, leaving zip_* column contracts.
do $$
declare
  routine record;
  definition text;
begin
  for routine in
    select procedure.oid
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prokind = 'f'
      and position('''zip''' in lower(pg_get_functiondef(procedure.oid))) > 0
  loop
    definition := pg_get_functiondef(routine.oid);
    definition := replace(definition, '''zip''', '''gridly''');
    definition := replace(definition, '''Zip''', '''Gridly''');
    execute definition;
  end loop;
end;
$$;

-- Verify the persisted ID and stored-function transition before committing.
do $$
begin
  if exists (select 1 from public.game_config where game_id = 'zip')
     or exists (select 1 from public.game_stats where game = 'zip')
     or exists (select 1 from public.presence where game = 'zip')
     or exists (select 1 from public.game_time_benchmarks where game = 'zip')
     or exists (select 1 from public.circle_challenge_rounds where game = 'zip')
     or exists (select 1 from public.circle_challenge_starts where game = 'zip')
     or exists (select 1 from public.challenge_reset_point_credits where game = 'zip')
     or exists (
       select 1 from public.circle_weekly_challenges where 'zip' = any(game_ids)
     )
     or exists (
       select 1
       from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public'
         and procedure.prokind = 'f'
         and position('''zip''' in lower(pg_get_functiondef(procedure.oid))) > 0
     ) then
    raise exception 'Gridly game-id migration left legacy records behind.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
