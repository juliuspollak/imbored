-- Fix award_game_points so the configured daily_points_cap applies only to
-- Practice. Challenge awards remain subject to their per-game maximum but do
-- not consume, or get reduced by, the Practice daily allowance.
--
-- This migration patches the current function definition deliberately. It
-- fails loudly if the expected v165 block is no longer present rather than
-- silently modifying an unfamiliar future version.

begin;

do $migration$
declare
  function_ddl text;
  old_daily_cap_block text := $old$
  -- Only gameplay earnings consume the daily allowance. Winner prizes,
  -- transfers, refunds and the weekly streak milestone remain separate.
  select coalesce(sum(
    case
      when pt.metadata ? 'daily_game_points' then
        greatest(coalesce((pt.metadata->>'daily_game_points')::integer,0),0)
      else greatest(
        pt.points
          - coalesce((pt.metadata->>'weekly_streak')::integer,0),
        0
      )
    end
  ),0)::integer
  into daily_earned
  from public.points_transactions pt
  where pt.player_id=s.user_id
    and pt.reason_code='GAME_COMPLETED'
    and (pt.created_at at time zone 'Australia/Sydney')::date=award_date;

  daily_remaining:=greatest(r.daily_points_cap-daily_earned,0);
  daily_game_points:=least(capped_game_points,daily_remaining);
  daily_cap_adjustment:=daily_game_points-capped_game_points;
  daily_cap_reached:=daily_remaining=0
    or (capped_game_points>daily_game_points);
$old$;
  new_daily_cap_block text := $new$
  -- Only Practice earnings consume the daily allowance. Challenge awards,
  -- winner prizes, transfers, refunds and streak milestones remain separate.
  if s.mode='practice' then
    select coalesce(sum(
      case
        when pt.metadata ? 'daily_game_points' then
          greatest(coalesce((pt.metadata->>'daily_game_points')::integer,0),0)
        else greatest(
          pt.points
            - coalesce((pt.metadata->>'weekly_streak')::integer,0),
          0
        )
      end
    ),0)::integer
    into daily_earned
    from public.points_transactions pt
    join public.game_stats gs on gs.id=pt.game_stat_id
    where pt.player_id=s.user_id
      and pt.reason_code='GAME_COMPLETED'
      and gs.mode='practice'
      and (pt.created_at at time zone 'Australia/Sydney')::date=award_date;

    daily_remaining:=greatest(r.daily_points_cap-daily_earned,0);
    daily_game_points:=least(capped_game_points,daily_remaining);
    daily_cap_adjustment:=daily_game_points-capped_game_points;
    daily_cap_reached:=daily_remaining=0
      or (capped_game_points>daily_game_points);
  else
    daily_earned:=0;
    daily_remaining:=r.daily_points_cap;
    daily_game_points:=capped_game_points;
    daily_cap_adjustment:=0;
    daily_cap_reached:=false;
  end if;
$new$;
begin
  select pg_get_functiondef('public.award_game_points(bigint)'::regprocedure)
  into function_ddl;

  if position(old_daily_cap_block in function_ddl)=0 then
    raise exception 'award_game_points does not contain the expected v165 daily-cap block; no changes were applied';
  end if;

  function_ddl:=replace(function_ddl,old_daily_cap_block,new_daily_cap_block);
  execute function_ddl;
end;
$migration$;

-- Repair Challenge transactions that the former shared cap reduced. The
-- original uncapped award and reduction were stored in metadata, so this adds
-- only the missing difference. Changing daily_cap_adjustment to zero makes the
-- repair safe to rerun.
do $repair$
declare
  item record;
begin
  for item in
    select
      pt.id as transaction_id,
      pt.player_id,
      greatest(
        least(
          100,
          greatest(coalesce((pt.metadata->>'uncapped_game_points')::integer,0),0)
            + greatest(coalesce((pt.metadata->>'weekly_streak')::integer,0),0)
        ) - pt.points,
        0
      ) as missing_points
    from public.points_transactions pt
    join public.game_stats gs on gs.id=pt.game_stat_id
    where pt.reason_code='GAME_COMPLETED'
      and gs.mode='challenge'
      and coalesce((pt.metadata->>'daily_cap_adjustment')::integer,0)<0
    for update of pt
  loop
    if item.missing_points>0 then
      update public.points_transactions
      set
        points=points+item.missing_points,
        metadata=jsonb_set(
          jsonb_set(
            jsonb_set(metadata,'{daily_game_points}',to_jsonb(coalesce((metadata->>'uncapped_game_points')::integer,0)),true),
            '{daily_cap_adjustment}','0'::jsonb,true
          ),
          '{challenge_cap_repair}',to_jsonb(now()),true
        )
      where id=item.transaction_id;

      update public.player_progress
      set
        available_points=available_points+item.missing_points,
        lifetime_points=lifetime_points+item.missing_points,
        current_level=public.points_level(lifetime_points+item.missing_points),
        updated_at=now()
      where player_id=item.player_id;
    end if;
  end loop;
end;
$repair$;

commit;

-- Optional verification after the migration:
-- select gs.user_id,gs.id as game_stat_id,pt.points,pt.metadata->>'challenge_cap_repair' as repaired_at
-- from public.points_transactions pt
-- join public.game_stats gs on gs.id=pt.game_stat_id
-- where pt.reason_code='GAME_COMPLETED' and gs.mode='challenge'
-- order by pt.created_at desc limit 50;
