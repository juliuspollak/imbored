-- v124: reset today's personal challenge without granting completion
-- rewards twice when players replay.

create table if not exists public.challenge_reset_point_credits (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.profiles(id) on delete cascade,
  game text not null,
  challenge_date date not null,
  points_transaction_id bigint not null unique
    references public.points_transactions(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists challenge_reset_point_credits_lookup_idx
  on public.challenge_reset_point_credits(player_id,game,challenge_date,id);

alter table public.challenge_reset_point_credits enable row level security;

-- Reattach the original completion transaction before award_game_points runs.
-- The award function then sees that this replay has already been rewarded and
-- leaves both the player's balance and streak unchanged.
create or replace function public.attach_reset_challenge_credit()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  credit_id bigint;
  transaction_id bigint;
begin
  if new.mode is distinct from 'challenge'
     or new.team_challenge_id is not null
     or new.challenge_date is null then
    return new;
  end if;

  select credit.id,credit.points_transaction_id
  into credit_id,transaction_id
  from public.challenge_reset_point_credits credit
  where credit.player_id=new.user_id
    and credit.game=new.game
    and credit.challenge_date=new.challenge_date
  order by credit.id
  limit 1
  for update;

  if credit_id is null then
    return new;
  end if;

  update public.points_transactions points_entry
  set game_stat_id=new.id
  where points_entry.id=transaction_id
    and points_entry.game_stat_id is null;

  if found then
    delete from public.challenge_reset_point_credits
    where id=credit_id;
  end if;

  return new;
end;
$$;

drop trigger if exists game_stats_attach_reset_challenge_credit
  on public.game_stats;
create trigger game_stats_attach_reset_challenge_credit
after insert on public.game_stats
for each row execute function public.attach_reset_challenge_credit();

create or replace function public.admin_reset_personal_challenge(
  target_challenge_date date,
  target_game text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  removed_count integer := 0;
  preserved_count integer := 0;
begin
  if not exists (
    select 1
    from public.profiles profile
    where profile.id=auth.uid()
      and profile.is_admin=true
  ) then
    raise exception 'Admin access required' using errcode='42501';
  end if;

  if target_challenge_date is null then
    raise exception 'Challenge date is required' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format(
        'personal-challenge-reset:%s:%s',
        target_challenge_date,
        coalesce(target_game,'*')
      ),
      0
    )
  );

  insert into public.challenge_reset_point_credits(
    player_id,
    game,
    challenge_date,
    points_transaction_id
  )
  select
    result.user_id,
    result.game,
    result.challenge_date,
    points_entry.id
  from public.game_stats result
  join public.points_transactions points_entry
    on points_entry.game_stat_id=result.id
   and points_entry.reason_code='GAME_COMPLETED'
  where result.mode='challenge'
    and result.team_challenge_id is null
    and result.challenge_date=target_challenge_date
    and (target_game is null or result.game=target_game)
  on conflict(points_transaction_id) do nothing;

  get diagnostics preserved_count=row_count;

  delete from public.game_stats result
  where result.mode='challenge'
    and result.team_challenge_id is null
    and result.challenge_date=target_challenge_date
    and (target_game is null or result.game=target_game);

  get diagnostics removed_count=row_count;

  return jsonb_build_object(
    'challenge_date',target_challenge_date,
    'results_removed',removed_count,
    'rewards_preserved',preserved_count
  );
end;
$$;

revoke all on function public.admin_reset_personal_challenge(date,text)
  from public;
grant execute on function public.admin_reset_personal_challenge(date,text)
  to authenticated;

-- Keep the existing per-game admin control, now with duplicate-reward
-- protection supplied by the shared reset function.
create or replace function public.admin_reset_daily_challenge(
  p_game text,
  p_challenge_date date
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  reset_result jsonb;
begin
  reset_result := public.admin_reset_personal_challenge(
    p_challenge_date,
    p_game
  );
  return coalesce((reset_result->>'results_removed')::integer,0);
end;
$$;

revoke all on function public.admin_reset_daily_challenge(text,date)
  from public;
grant execute on function public.admin_reset_daily_challenge(text,date)
  to authenticated;

create or replace function public.admin_reset_my_challenge()
returns jsonb
language sql
security definer
set search_path=public
as $$
  select public.admin_reset_personal_challenge(public.app_today(),null)
$$;

revoke all on function public.admin_reset_my_challenge() from public;
grant execute on function public.admin_reset_my_challenge() to authenticated;
