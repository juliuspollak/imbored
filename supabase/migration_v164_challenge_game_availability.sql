begin;

alter table public.game_config
  add column if not exists challenge_enabled boolean;

insert into public.game_config(
  game_id,
  visible,
  available,
  sort_order,
  challenge_enabled
)
values
  ('hive', true, true, 0, true),
  ('tango', true, true, 1, true),
  ('zip', true, true, 2, true),
  ('minisudoku', true, true, 3, true),
  ('geo', true, true, 4, true),
  ('zoom', true, true, 5, true)
on conflict(game_id) do nothing;

update public.game_config
set challenge_enabled = game_id in (
  'hive',
  'tango',
  'zip',
  'minisudoku',
  'geo',
  'zoom'
)
where challenge_enabled is null;

alter table public.game_config
  alter column challenge_enabled set default false,
  alter column challenge_enabled set not null;

update public.game_config
set challenge_enabled = false
where game_id = 'animalrush';

create or replace function public.validate_team_challenge_games()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from unnest(coalesce(new.game_ids, array[]::text[])) selected(game_id)
    left join public.game_config config
      on config.game_id = selected.game_id
    where coalesce(config.challenge_enabled, false) = false
  ) then
    raise exception 'One or more selected games are not available in Challenges.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_team_challenge_games() from public;

drop trigger if exists validate_team_challenge_games_trigger
on public.team_weekly_challenges;

create trigger validate_team_challenge_games_trigger
before insert or update of game_ids
on public.team_weekly_challenges
for each row execute function public.validate_team_challenge_games();

notify pgrst, 'reload schema';

commit;
