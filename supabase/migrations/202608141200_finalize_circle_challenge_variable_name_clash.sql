-- Fixes: ERROR "missing FROM-clause entry for table finalize_circle_challenge"
--
-- finalize_circle_challenge() declared a plpgsql variable named loser_id, the
-- same name as the circle_weekly_challenges column it is written to. The final
-- UPDATE therefore disambiguated the value side as
-- finalize_circle_challenge.loser_id, relying on the function name working as
-- the outer block's label. Where that reference does not resolve, Postgres
-- falls back to reading it as a table qualifier and raises the error above.
--
-- The blast radius was wide because get_my_circle_challenge_history() and the
-- circle lifecycle RPCs all call finalize_due_circle_challenges() first: one
-- unresolvable reference failed the whole query, so the Circles page errored
-- and past circle challenges silently vanished from the challenge page.
--
-- Renaming the variable removes the ambiguity, so no qualification is needed.

create or replace function public.finalize_circle_challenge(target_challenge_id bigint) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  challenge public.circle_weekly_challenges;
  required_rounds integer;
  member_count integer;
  finisher_count integer;
  deadline date;
  winner_id uuid;
  winner_stat_id bigint;
  winner_name text;
  circle_name text;
  award_created bigint;
  existing_winner uuid;
  winning_score integer;
  -- Named apart from the circle_weekly_challenges.loser_id column it is
  -- written to. Sharing the name forced the UPDATE below to disambiguate with
  -- finalize_circle_challenge.loser_id, and when that block-label reference
  -- failed to resolve, Postgres read it as a table and raised "missing
  -- FROM-clause entry for table finalize_circle_challenge" — taking down every
  -- caller of finalize_due_circle_challenges() with it.
  losing_player_id uuid;
  loser_name text;
  prize_label text;
begin
  select *
  into challenge
  from public.circle_weekly_challenges
  where id=target_challenge_id
  for update;

  if not found then
    return null;
  end if;

  select award.player_id
  into existing_winner
  from public.circle_challenge_reward_awards award
  where award.challenge_id=challenge.id
  order by award.awarded_at,award.id
  limit 1;

  if challenge.closed_at is not null then
    return existing_winner;
  end if;
  if existing_winner is not null then
    update public.circle_weekly_challenges
    set closed_at=coalesce(closed_at,now()),updated_at=now()
    where id=challenge.id;
    return existing_winner;
  end if;

  perform public.ensure_circle_challenge_rounds(challenge.id);

  select count(*),max(round_item.challenge_date)
  into required_rounds,deadline
  from public.circle_challenge_rounds round_item
  where round_item.challenge_id=challenge.id;

  select count(*)
  into member_count
  from public.circle_members member
  where member.circle_id=challenge.circle_id;

  select count(*)
  into finisher_count
  from public.circle_challenge_member_totals(challenge.id) totals
  where totals.rounds_played=required_rounds;

  if required_rounds=0
     or (
       public.circle_today(challenge.circle_id)<=deadline
       and (member_count=0 or finisher_count<member_count)
     ) then
    return null;
  end if;

  select totals.member_id,totals.last_stat_id,totals.challenge_score
  into winner_id,winner_stat_id,winning_score
  from public.circle_challenge_member_totals(challenge.id) totals
  where totals.rounds_played>0
  order by
    totals.challenge_score desc,
    totals.rounds_played desc,
    totals.total_hints,
    totals.total_mistakes,
    totals.adjusted_seconds,
    totals.finished_at,
    totals.member_id
  limit 1;

  if winner_id is null then
    update public.circle_weekly_challenges
    set closed_at=now(),updated_at=now()
    where id=challenge.id;
    return null;
  end if;

  insert into public.circle_challenge_reward_awards(
    challenge_id,player_id,points
  )
  values(
    challenge.id,
    winner_id,
    case when challenge.reward_type='points'
      then greatest(challenge.reward_points,0)
      else 0
    end
  )
  on conflict(challenge_id,player_id) do nothing
  returning id into award_created;

  if award_created is null then
    update public.circle_weekly_challenges
    set closed_at=coalesce(closed_at,now()),updated_at=now()
    where id=challenge.id;
    return winner_id;
  end if;

  if challenge.reward_type='points' and challenge.reward_points>0 then
    perform public.ensure_player_progress(winner_id);
    update public.player_progress
    set
      available_points=available_points+challenge.reward_points,
      lifetime_points=lifetime_points+challenge.reward_points,
      current_level=public.points_level(lifetime_points+challenge.reward_points),
      updated_at=now()
    where player_id=winner_id;
  end if;

  insert into public.points_transactions(
    player_id,points,reason_code,metadata,created_by
  )
  values(
    winner_id,
    case when challenge.reward_type='points'
      then greatest(challenge.reward_points,0)
      else 0
    end,
    'TEAM_CHALLENGE_WINNER',
    jsonb_build_object(
      'circle_id',challenge.circle_id,
      'circle_challenge_id',challenge.id,
      'week_start',challenge.week_start,
      'reward_points',case when challenge.reward_type='points'
        then greatest(challenge.reward_points,0)
        else 0
      end,
      'reward_label',case when challenge.reward_type='prize'
        then challenge.reward_label
        else null
      end
    ),
    winner_id
  );

  select coalesce(nullif(btrim(profile.name),''),'A teammate')
  into winner_name
  from public.profiles profile
  where profile.id=winner_id;

  select circle.name
  into circle_name
  from public.circles circle
  where circle.id=challenge.circle_id;

  -- Last place decides a forfeit, and is worth recording either way so the
  -- circle can see how the week actually finished. A one-player challenge has
  -- no loser.
  losing_player_id := public.circle_challenge_last_place(challenge.id);
  if losing_player_id = winner_id then
    losing_player_id := null;
  end if;
  select coalesce(nullif(btrim(profile.name),''),'Someone')
  into loser_name
  from public.profiles profile
  where profile.id=losing_player_id;

  prize_label := coalesce(nullif(btrim(challenge.reward_label),''),'the prize');

  insert into public.direct_messages(
    sender_id,recipient_id,body,system_generated,activity_type,source_stat_id
  )
  select
    winner_id,
    member.user_id,
    case
      -- A real thing the loser owes. Everyone is told who settles it with
      -- whom, because the app cannot hand over a bathroom clean itself.
      when challenge.reward_type='prize' and challenge.reward_goes_to='loser' and losing_player_id is not null then
        case
          when member.user_id=losing_player_id then
            format(
              '🏆 %s won %s. You finished last, so %s is on you — sort it out between you.',
              winner_name,
              coalesce(challenge.title,circle_name,'the circle challenge'),
              prize_label
            )
          when member.user_id=winner_id then
            format(
              '🏆 You won %s. %s finished last and owes you %s — sort it out between you.',
              coalesce(challenge.title,circle_name,'the circle challenge'),
              loser_name,
              prize_label
            )
          else
            format(
              '🏆 %s won %s. %s finished last and owes %s.',
              winner_name,
              coalesce(challenge.title,circle_name,'the circle challenge'),
              loser_name,
              prize_label
            )
        end
      when member.user_id=winner_id and challenge.reward_type='points' then
        format(
          '🏆 You won %s and earned the %s-point winner''s prize!',
          coalesce(challenge.title,circle_name,'the circle challenge'),
          challenge.reward_points
        )
      when member.user_id=winner_id then
        format(
          '🏆 You won %s — your prize is %s. The circle settles this outside the app.',
          coalesce(challenge.title,circle_name,'the circle challenge'),
          prize_label
        )
      when challenge.reward_type='points' then
        format(
          '🏆 %s won %s and earned the %s-point winner''s prize.',
          winner_name,
          coalesce(challenge.title,circle_name,'the circle challenge'),
          challenge.reward_points
        )
      else
        format(
          '🏆 %s won %s — prize: %s. The circle settles this outside the app.',
          winner_name,
          coalesce(challenge.title,circle_name,'the circle challenge'),
          prize_label
        )
    end,
    true,
    'circle_challenge_winner',
    winner_stat_id
  from public.circle_members member
  where member.circle_id=challenge.circle_id
  on conflict do nothing;

  update public.circle_weekly_challenges
  set closed_at=now(),loser_id=losing_player_id,updated_at=now()
  where id=challenge.id;

  return winner_id;
end;
$$;
