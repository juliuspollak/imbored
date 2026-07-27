-- Practice reward usage audit v126
--
-- Exposes the exact rows used by award_game_points' daily practice limit.
-- The function is deliberately limited to the signed-in player's own data.

create or replace function public.get_my_practice_reward_usage()
returns jsonb
language sql
security definer
set search_path=public
stable
as $$
  with active_rule as (
    select practice_daily_limit
    from public.reward_rules
    where is_active=true
    order by id desc
    limit 1
  ),
  rewarded as (
    select
      gs.game,
      count(*)::integer as rewarded_count,
      min(pt.created_at) as first_awarded_at,
      max(pt.created_at) as last_awarded_at
    from public.points_transactions pt
    join public.game_stats gs on gs.id=pt.game_stat_id
    where pt.player_id=auth.uid()
      and pt.reason_code='GAME_COMPLETED'
      and gs.mode='practice'
      and (pt.created_at at time zone 'Australia/Sydney')::date
        =(now() at time zone 'Australia/Sydney')::date
    group by gs.game
  )
  select jsonb_build_object(
    'date',(now() at time zone 'Australia/Sydney')::date,
    'rewarded_count',coalesce((select sum(rewarded_count) from rewarded),0),
    'daily_limit',coalesce((select practice_daily_limit from active_rule),0),
    'by_game',coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'game',game,
            'rewarded_count',rewarded_count,
            'first_awarded_at',first_awarded_at,
            'last_awarded_at',last_awarded_at
          )
          order by rewarded_count desc,game
        )
        from rewarded
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.get_my_practice_reward_usage() from public;
grant execute on function public.get_my_practice_reward_usage() to authenticated;
