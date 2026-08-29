-- The grace guard added at 11:00 prevents future early finalisation, but an
-- occurrence that was already closed by the old scheduled-day rule still has
-- closed_at, an award and winner announcements. Reopen only occurrences whose
-- last round is authoritatively OPEN/GRACE. Game scores are never changed.

do $$
declare item record;
begin
  for item in
    select challenge.id
    from public.circle_weekly_challenges challenge
    join lateral (
      select max(round_item.challenge_date) as last_round
      from public.circle_challenge_rounds round_item
      where round_item.challenge_id=challenge.id
    ) rounds on rounds.last_round is not null
    where challenge.closed_at is not null
      and public.circle_challenge_round_state(challenge.id,rounds.last_round) in ('open','grace')
  loop
    -- Reverse only the persisted winner prize created by finalisation. The
    -- ranked game_stats rows and their ordinary completion points stay intact.
    update public.player_progress progress
    set available_points=greatest(0,progress.available_points-award.points),
        lifetime_points=greatest(0,progress.lifetime_points-award.points),
        current_level=public.points_level(greatest(0,progress.lifetime_points-award.points)),
        updated_at=now()
    from public.circle_challenge_reward_awards award
    where award.challenge_id=item.id and progress.player_id=award.player_id and award.points>0;

    delete from public.points_transactions transaction_item
    where transaction_item.reason_code='TEAM_CHALLENGE_WINNER'
      and (transaction_item.metadata->>'circle_challenge_id')~'^[0-9]+$'
      and (transaction_item.metadata->>'circle_challenge_id')::bigint=item.id;

    delete from public.direct_messages message
    where message.system_generated=true
      and message.activity_type in ('circle_challenge_winner','team_challenge_winner')
      and exists(
        select 1 from public.game_stats result
        where result.id=message.source_stat_id and result.circle_challenge_id=item.id
      );

    delete from public.circle_challenge_reward_awards award where award.challenge_id=item.id;
    update public.circle_weekly_challenges challenge
    set closed_at=null,loser_id=null,updated_at=now()
    where challenge.id=item.id;
  end loop;
end $$;
