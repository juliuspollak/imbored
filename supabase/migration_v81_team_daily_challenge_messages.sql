begin;

alter table public.direct_messages
  add column if not exists system_generated boolean not null default false,
  add column if not exists activity_type text,
  add column if not exists source_stat_id bigint;

create unique index if not exists direct_messages_team_challenge_once_idx
  on public.direct_messages (source_stat_id, recipient_id)
  where source_stat_id is not null
    and activity_type = 'team_daily_challenge';

create or replace function public.notify_team_daily_challenge_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  player_name text;
  game_label text;
  notification_body text;
begin
  if new.mode is distinct from 'challenge'
     or new.challenge_date is null then
    return new;
  end if;

  select coalesce(nullif(btrim(p.name), ''), 'A teammate')
    into player_name
  from public.profiles p
  where p.id = new.user_id;

  game_label := case lower(new.game)
    when 'queens' then 'Queens'
    when 'tango' then 'Tango'
    when 'zip' then 'Zip'
    when 'minisudoku' then 'Mini Sudoku'
    when 'geo' then 'Geo'
    else initcap(replace(new.game, '_', ' '))
  end;

  notification_body := format(
    '🏁 %s finished today''s %s challenge! Think you can beat them? 🎮',
    coalesce(player_name, 'A teammate'),
    game_label
  );

  insert into public.direct_messages (
    sender_id,
    recipient_id,
    body,
    system_generated,
    activity_type,
    source_stat_id
  )
  select distinct
    new.user_id,
    teammate.user_id,
    notification_body,
    true,
    'team_daily_challenge',
    new.id
  from public.team_members mine
  join public.team_members teammate
    on teammate.team_id = mine.team_id
   and teammate.user_id <> new.user_id
  where mine.user_id = new.user_id
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists game_stats_notify_team_daily_challenge
  on public.game_stats;

create trigger game_stats_notify_team_daily_challenge
after insert on public.game_stats
for each row
execute function public.notify_team_daily_challenge_completed();

notify pgrst, 'reload schema';

commit;
