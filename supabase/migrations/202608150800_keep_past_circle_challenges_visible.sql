-- Past circle challenges should remain visible to people who actually took part,
-- even if they are no longer present in the circle_members row today.
--
-- The previous history RPC started from circle_members, so removing/leaving a
-- circle made the user's entire challenge history disappear from Home.  Use
-- the challenge itself as the base row and authorise history when the current
-- user is either still a member, owns the circle, or has a recorded challenge
-- result for that challenge.

DROP FUNCTION IF EXISTS public.get_my_circle_challenge_history(integer);

CREATE FUNCTION public.get_my_circle_challenge_history(history_limit_in integer DEFAULT 30)
RETURNS TABLE(
  challenge_id bigint,
  circle_id bigint,
  circle_name text,
  circle_emoji text,
  challenge_title text,
  week_start date,
  closed_at timestamp with time zone,
  game_ids text[],
  active_days integer[],
  reward_points integer,
  reward_type text,
  reward_label text,
  winner_id uuid,
  winner_name text,
  winner_icon text,
  entry_count integer,
  finisher_count integer,
  current_user_finished boolean,
  repeats_weekly boolean,
  series_weeks integer,
  occurrence_number integer,
  reward_goes_to text,
  loser_id uuid,
  loser_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  perform public.finalize_due_circle_challenges();

  return query
  select
    challenge.id,
    circle.id,
    circle.name::text,
    coalesce(circle.emoji,'⭐')::text,
    coalesce(nullif(btrim(challenge.title),''),'Weekly challenge')::text,
    challenge.week_start,
    challenge.closed_at,
    challenge.game_ids,
    challenge.active_days,
    challenge.reward_points,
    challenge.reward_type,
    challenge.reward_label,
    award.player_id,
    winner.name::text,
    winner.icon::text,
    coalesce(progress.entry_count,0)::integer,
    coalesce(progress.finisher_count,0)::integer,
    coalesce(progress.current_user_finished,false),
    challenge.repeats_weekly,
    challenge.series_weeks,
    challenge.occurrence_number,
    challenge.reward_goes_to,
    challenge.loser_id,
    loser.name::text
  from public.circle_weekly_challenges challenge
  join public.circles circle on circle.id=challenge.circle_id
  left join lateral (
    select item.player_id,item.awarded_at
    from public.circle_challenge_reward_awards item
    where item.challenge_id=challenge.id
    order by item.awarded_at,item.id
    limit 1
  ) award on true
  left join public.profiles winner on winner.id=award.player_id
  left join public.profiles loser on loser.id=challenge.loser_id
  left join lateral (
    select
      count(*) filter(where totals.games_completed>0)::integer as entry_count,
      count(*) filter(
        where totals.games_completed=cardinality(challenge.game_ids)
      )::integer as finisher_count,
      coalesce(
        bool_or(
          totals.games_completed=cardinality(challenge.game_ids)
        ) filter(where totals.user_id=auth.uid()),
        false
      ) as current_user_finished
    from (
      -- Include current circle members plus anyone with a recorded result in
      -- this challenge. This keeps historical completion counts meaningful
      -- after membership changes.
      select participant.user_id,
        count(distinct result.game) filter(
          where result.game=any(challenge.game_ids)
        ) as games_completed
      from (
        select member.user_id
        from public.circle_members member
        where member.circle_id=challenge.circle_id
        union
        select result_user.user_id
        from public.game_stats result_user
        where result_user.circle_challenge_id=challenge.id
          and result_user.mode='challenge'
      ) participant
      left join public.game_stats result
        on result.user_id=participant.user_id
       and result.circle_challenge_id=challenge.id
       and result.mode='challenge'
      group by participant.user_id
    ) totals
  ) progress on true
  where public.is_approved_user(auth.uid())
    and challenge.closed_at is not null
    and (
      exists(
        select 1
        from public.circle_members membership
        where membership.circle_id=challenge.circle_id
          and membership.user_id=auth.uid()
      )
      or circle.created_by=auth.uid()
      or exists(
        select 1
        from public.game_stats own_result
        where own_result.circle_challenge_id=challenge.id
          and own_result.user_id=auth.uid()
          and own_result.mode='challenge'
      )
    )
  order by challenge.closed_at desc,challenge.week_start desc,challenge.id desc
  limit least(greatest(coalesce(history_limit_in,30),1),100);
end;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_circle_challenge_history(integer) TO authenticated;
