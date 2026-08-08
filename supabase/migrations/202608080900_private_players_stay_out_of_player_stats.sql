-- Player Stats leaked private players to everyone.
--
-- Both stats RPCs gated on can_view_user(), which only knows about
-- hidden_from_others and deleted accounts — is_private was never consulted.
-- So a player who went private still appeared in the community leaderboard for
-- every other player, not just for admins.
--
-- The filter belongs here rather than in can_view_user(): that helper also
-- backs chat continuity, where is_private deliberately does not apply.
--
-- A private player still sees their own row, otherwise going private would
-- erase your own standing from your own leaderboard.

create or replace function public.get_public_player_game_summary()
returns table(
  player_id uuid,
  games_played bigint,
  challenge_games bigint,
  practice_games bigint,
  favourite_game text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with eligible_games as (
    select
      gs.user_id,
      gs.game,
      gs.mode,
      gs.id
    from public.game_stats gs
    join public.profiles profile on profile.id=gs.user_id
    left join public.points_transactions transaction
      on transaction.game_stat_id=gs.id
     and transaction.reason_code='GAME_COMPLETED'
    where auth.uid() is not null
      and public.can_view_user(gs.user_id)
      and (
        coalesce(profile.is_private,false)=false
        or profile.id=auth.uid()
      )
      and coalesce(
        profile.account_deleted_at,
        'infinity'::timestamptz
      )='infinity'::timestamptz
      and coalesce(profile.is_blocked,false)=false
      and (
        gs.mode='challenge'
        or coalesce(transaction.points,0)>0
      )
  ),
  totals as (
    select
      user_id,
      count(*)::bigint as games_played,
      count(*) filter(where mode='challenge')::bigint as challenge_games,
      count(*) filter(where mode='practice')::bigint as practice_games
    from eligible_games
    group by user_id
  ),
  favourites as (
    select user_id,game
    from (
      select
        user_id,
        game,
        row_number() over(
          partition by user_id
          order by count(*) desc,game
        ) as position
      from eligible_games
      group by user_id,game
    ) ranked
    where position=1
  )
  select
    totals.user_id,
    totals.games_played,
    totals.challenge_games,
    totals.practice_games,
    favourites.game
  from totals
  left join favourites on favourites.user_id=totals.user_id;
$$;

create or replace function public.get_public_player_progress()
returns table(
  player_id uuid,
  lifetime_points bigint,
  current_level integer,
  current_streak integer,
  longest_streak integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    progress.player_id,
    progress.lifetime_points,
    progress.current_level,
    progress.challenge_current_streak,
    progress.challenge_longest_streak
  from public.player_progress progress
  join public.profiles profile on profile.id=progress.player_id
  where auth.uid() is not null
    and public.can_view_user(progress.player_id)
    and (
      coalesce(profile.is_private,false)=false
      or profile.id=auth.uid()
    )
    and coalesce(
      profile.account_deleted_at,
      'infinity'::timestamptz
    )='infinity'::timestamptz
    and coalesce(profile.is_blocked,false)=false;
$$;
