-- Return the tiebreak keys alongside the standings.
--
-- When every round caps at 150 the totals come out identical, and the winner
-- was then chosen by hints, then mistakes, then total time, then who finished
-- first -- none of which was returned to the client, so the standings showed
-- three players on 450 and a trophy on one of them with no explanation.
--
-- These columns are already computed by circle_challenge_member_totals(); they
-- were simply not being passed on.

drop function if exists public.get_circle_challenge_standings(bigint);

create function public.get_circle_challenge_standings(target_challenge_id bigint) RETURNS TABLE(member_id uuid, member_name text, member_icon text, standing_rank integer, challenge_score integer, rounds_played integer, rounds_total integer, is_private boolean, round_scores jsonb, total_hints integer, total_mistakes integer, adjusted_seconds bigint, finished_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with visible_challenge as (
    select item.id
    from public.circle_weekly_challenges item
    where item.id=target_challenge_id
      and (
        public.is_admin(auth.uid())
        or exists(
          select 1
          from public.circle_members member
          where member.circle_id=item.circle_id
            and member.user_id=auth.uid()
        )
      )
  )
  select
    totals.member_id,
    profile.name::text,
    profile.icon::text,
    row_number() over(
      order by
        (totals.rounds_played>0) desc,
        totals.challenge_score desc,
        totals.rounds_played desc,
        totals.total_hints,
        totals.total_mistakes,
        totals.adjusted_seconds,
        totals.finished_at,
        totals.member_id
    )::integer,
    totals.challenge_score,
    totals.rounds_played,
    totals.rounds_total,
    (
      totals.member_id<>auth.uid()
      and coalesce(profile.show_stats_to_others,false)=false
    ),
    case
      when totals.member_id<>auth.uid()
        and coalesce(profile.show_stats_to_others,false)=false
      then null
      else totals.round_scores
    end,
    -- The keys that break a tie, returned so the standings can say out loud
    -- why one player finished above another on an identical score.
    totals.total_hints,
    totals.total_mistakes,
    totals.adjusted_seconds,
    totals.finished_at
  from visible_challenge
  cross join public.circle_challenge_member_totals(visible_challenge.id) totals
  join public.profiles profile on profile.id=totals.member_id
  where profile.account_deleted_at is null
    and coalesce(profile.hidden_from_others,false)=false
$$;

revoke all on function public.get_circle_challenge_standings(bigint) from public;
grant execute on function public.get_circle_challenge_standings(bigint) to authenticated;
