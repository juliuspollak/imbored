-- Player Stats leaderboard data fix.
-- Lifetime points, level and streak are community standings fields.
-- Spendable wallet points and transaction history remain private.
create or replace function public.get_public_player_progress()
returns table (
  player_id uuid,
  lifetime_points bigint,
  current_level integer,
  current_streak integer,
  longest_streak integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    progress.player_id,
    progress.lifetime_points,
    progress.current_level,
    progress.current_streak,
    progress.longest_streak
  from public.player_progress progress
  join public.profiles profile on profile.id = progress.player_id
  where auth.uid() is not null
    and public.can_view_user(progress.player_id)
    and coalesce(profile.account_deleted_at, 'infinity'::timestamptz) = 'infinity'::timestamptz
    and coalesce(profile.is_blocked, false) = false;
$$;

revoke all on function public.get_public_player_progress() from public;
grant execute on function public.get_public_player_progress() to authenticated;
