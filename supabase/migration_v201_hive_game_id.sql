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

update public.game_stats set game = 'hive' where game = 'queens';
update public.presence set game = 'hive' where game = 'queens';
update public.feedback set game = 'hive' where game = 'queens';
delete from public.game_time_benchmarks
where game = 'hive'
  and exists (select 1 from public.game_time_benchmarks where game = 'queens');
update public.game_time_benchmarks set game = 'hive' where game = 'queens';
update public.circle_challenge_rounds set game = 'hive' where game = 'queens';
update public.circle_challenge_starts set game = 'hive' where game = 'queens';
update public.challenge_reset_point_credits set game = 'hive' where game = 'queens';

update public.circle_weekly_challenges
set game_ids = array(
  select case when game_id = 'queens' then 'hive' else game_id end
  from unnest(game_ids) with ordinality selected(game_id, position)
  order by position
)
where 'queens' = any(game_ids);

alter table public.circle_weekly_challenges
  alter column game_ids
  set default array['hive','tango','zip','minisudoku','geo','zoom']::text[];

alter table public.circle_challenge_rounds
  add constraint circle_challenge_rounds_game_check
  check (game in ('hive','tango','zip','minisudoku','geo','zoom'));

-- This trigger builds the player-facing completion message in the database.
create or replace function public.notify_circle_daily_challenge_completed()
returns trigger language plpgsql security definer set search_path=public as $$
declare player_name text; game_label text; notification_body text;
begin
  if new.mode is distinct from 'challenge' or new.challenge_date is null or new.circle_challenge_id is null or new.circle_id is null then return new; end if;
  select coalesce(nullif(btrim(p.name),''),'A teammate') into player_name from public.profiles p where p.id=new.user_id;
  game_label:=case lower(new.game) when 'hive' then 'Hive' when 'tango' then 'Tango' when 'zip' then 'Zip' when 'minisudoku' then 'Mini Sudoku' when 'geo' then 'Geo' else initcap(replace(new.game,'_',' ')) end;
  notification_body:=format('🏁 %s finished the %s circle challenge! Think you can beat them? 🎮',coalesce(player_name,'A teammate'),game_label);
  insert into public.direct_messages(sender_id,recipient_id,body,system_generated,activity_type,source_stat_id)
  select new.user_id,cm.user_id,notification_body,true,'circle_daily_challenge',new.id
  from public.circle_members cm where cm.circle_id=new.circle_id and cm.user_id<>new.user_id
  on conflict do nothing;
  return new;
end;$$;

notify pgrst, 'reload schema';

commit;
