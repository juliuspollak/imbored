-- V201: finish the legacy game -> Hive rename at the persisted-ID layer.
-- This keeps player history, challenge schedules, points links and benchmark
-- data intact while changing the canonical game id to `hive`.

begin;

-- The existing round constraint must accept the new id during the data move.
alter table public.circle_challenge_rounds
  drop constraint if exists team_challenge_rounds_game_check;
alter table public.circle_challenge_rounds
  drop constraint if exists circle_challenge_rounds_game_check;

-- Preserve every configuration column, including game-specific settings.
delete from public.game_config
where game_id = 'hive'
  and exists (select 1 from public.game_config where game_id = 'queens');
update public.game_config set game_id = 'hive' where game_id = 'queens';

-- If the Hive build was deployed before this SQL, a player may have one result
-- under each id for the same daily challenge. Keep the already-canonical row
-- so the partial unique index cannot block the bulk update below.
delete from public.game_stats legacy
using public.game_stats canonical
where legacy.game = 'queens'
  and canonical.game = 'hive'
  and legacy.mode = 'challenge'
  and canonical.mode = 'challenge'
  and legacy.user_id = canonical.user_id
  and legacy.challenge_date = canonical.challenge_date;

update public.game_stats set game = 'hive' where game = 'queens';
update public.presence set game = 'hive' where game = 'queens';
delete from public.game_time_benchmarks
where game = 'hive'
  and exists (select 1 from public.game_time_benchmarks where game = 'queens');
update public.game_time_benchmarks set game = 'hive' where game = 'queens';
update public.circle_challenge_rounds set game = 'hive' where game = 'queens';

-- The starts table has a unique key containing game. Resolve the same
-- mixed-deployment case before changing the legacy rows.
delete from public.circle_challenge_starts legacy
using public.circle_challenge_starts canonical
where legacy.game = 'queens'
  and canonical.game = 'hive'
  and legacy.challenge_id = canonical.challenge_id
  and legacy.player_id = canonical.player_id
  and legacy.challenge_date = canonical.challenge_date;

update public.circle_challenge_starts set game = 'hive' where game = 'queens';
update public.challenge_reset_point_credits set game = 'hive' where game = 'queens';

update public.circle_weekly_challenges challenge
set game_ids = (
  select array_agg(mapped.game_id order by mapped.first_position)
  from (
    select
      case when selected.game_id = 'queens' then 'hive' else selected.game_id end as game_id,
      min(selected.position) as first_position
    from unnest(challenge.game_ids) with ordinality selected(game_id, position)
    group by case when selected.game_id = 'queens' then 'hive' else selected.game_id end
  ) mapped
)
where 'queens' = any(challenge.game_ids);

alter table public.circle_weekly_challenges
  alter column game_ids
  set default array['hive','tango','zip','minisudoku','geo','zoom']::text[];

alter table public.circle_challenge_rounds
  add constraint circle_challenge_rounds_game_check
  check (game in ('hive','tango','zip','gridly','minisudoku','geo','zoom'));

-- Historical migration files do not modify functions that are already stored
-- in a deployed database. Rewrite any public function that still embeds the
-- legacy identifier, preserving its current signature, body and privileges.
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
      and position('queens' in lower(pg_get_functiondef(procedure.oid))) > 0
  loop
    definition := pg_get_functiondef(routine.oid);
    definition := replace(definition, '''queens''', '''hive''');
    definition := replace(definition, '''Queens''', '''Hive''');
    execute definition;
  end loop;
end;
$$;

-- This trigger builds the player-facing completion message in the database.
create or replace function public.notify_circle_daily_challenge_completed()
returns trigger language plpgsql security definer set search_path=public as $$
declare player_name text; game_label text; notification_body text;
begin
  if new.mode is distinct from 'challenge' or new.challenge_date is null or new.circle_challenge_id is null or new.circle_id is null then return new; end if;
  select coalesce(nullif(btrim(p.name),''),'A teammate') into player_name from public.profiles p where p.id=new.user_id;
  game_label:=case lower(new.game) when 'hive' then 'Hive' when 'tango' then 'Tango' when 'zip' then 'Zip' when 'gridly' then 'Gridly' when 'minisudoku' then 'Mini Sudoku' when 'geo' then 'Geo' else initcap(replace(new.game,'_',' ')) end;
  notification_body:=format('🏁 %s finished the %s circle challenge! Think you can beat them? 🎮',coalesce(player_name,'A teammate'),game_label);
  insert into public.direct_messages(sender_id,recipient_id,body,system_generated,activity_type,source_stat_id)
  select new.user_id,cm.user_id,notification_body,true,'circle_daily_challenge',new.id
  from public.circle_members cm where cm.circle_id=new.circle_id and cm.user_id<>new.user_id
  on conflict do nothing;
  return new;
end;$$;

-- Fail atomically if any persisted legacy ids survived the conversion.
do $$
begin
  if exists (select 1 from public.game_config where game_id = 'queens')
     or exists (select 1 from public.game_stats where game = 'queens')
     or exists (select 1 from public.presence where game = 'queens')
     or exists (select 1 from public.game_time_benchmarks where game = 'queens')
     or exists (select 1 from public.circle_challenge_rounds where game = 'queens')
     or exists (select 1 from public.circle_challenge_starts where game = 'queens')
     or exists (select 1 from public.challenge_reset_point_credits where game = 'queens')
     or exists (
       select 1 from public.circle_weekly_challenges
       where 'queens' = any(game_ids)
     )
     or exists (
       select 1
       from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'public'
         and procedure.prokind = 'f'
         and position('''queens''' in lower(pg_get_functiondef(procedure.oid))) > 0
     ) then
    raise exception 'Hive game-id migration left legacy records behind.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
