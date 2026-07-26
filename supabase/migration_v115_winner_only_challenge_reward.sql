-- Winner-only team challenge reward v115
-- The configured reward is a prize, not a completion bonus. Wait until every
-- current team member has completed every configured game, then award it once
-- to the player with the lowest adjusted challenge time.

create or replace function public.award_completed_team_challenge()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  c public.team_weekly_challenges;
  required_games integer;
  member_count integer;
  finisher_count integer;
  winner_id uuid;
  winner_stat_id bigint;
  winner_name text;
  team_name text;
  award_created bigint;
begin
  if new.mode is distinct from 'challenge' or new.team_challenge_id is null then
    return new;
  end if;

  select * into c
  from public.team_weekly_challenges
  where id=new.team_challenge_id;
  if not found then return new; end if;

  required_games := cardinality(c.game_ids);
  if required_games=0 then return new; end if;

  select count(*) into member_count
  from public.team_members
  where team_id=c.team_id;

  select count(*) into finisher_count
  from (
    select member.user_id
    from public.team_members member
    left join public.game_stats result
      on result.user_id=member.user_id
     and result.team_challenge_id=c.id
     and result.game=any(c.game_ids)
    where member.team_id=c.team_id
    group by member.user_id
    having count(distinct result.game)=required_games
  ) finishers;

  -- The winner is not final until the entire roster has finished.
  if member_count=0 or finisher_count<member_count then return new; end if;

  -- A hint adds 30 seconds and a mistake/reset adds 15 seconds. All players
  -- have completed the same games, so the lowest adjusted total wins.
  select ranked.user_id, ranked.last_stat_id
  into winner_id, winner_stat_id
  from (
    select
      result.user_id,
      max(result.id) as last_stat_id,
      sum(greatest(result.seconds,0)
        + greatest(result.hints,0)*30
        + greatest(result.mistakes,0)*15) as adjusted_seconds,
      sum(greatest(result.hints,0)) as total_hints,
      sum(greatest(result.mistakes,0)) as total_mistakes,
      max(result.completed_at) as finished_at
    from public.game_stats result
    where result.team_challenge_id=c.id
      and result.game=any(c.game_ids)
    group by result.user_id
    having count(distinct result.game)=required_games
    order by adjusted_seconds, total_hints, total_mistakes, finished_at, result.user_id
    limit 1
  ) ranked;

  if winner_id is null then return new; end if;

  -- One winner transaction is the authoritative idempotency guard.
  if exists(
    select 1
    from public.points_transactions pt
    where pt.reason_code='TEAM_CHALLENGE_WINNER'
      and (pt.metadata->>'team_challenge_id')::bigint=c.id
  ) then
    return new;
  end if;

  insert into public.team_challenge_reward_awards(challenge_id,player_id,points)
  values(c.id,winner_id,case when c.reward_type='points' then greatest(c.reward_points,0) else 0 end)
  on conflict(challenge_id,player_id) do nothing
  returning id into award_created;

  if award_created is null then return new; end if;

  if c.reward_type='points' and c.reward_points>0 then
    perform public.ensure_player_progress(winner_id);
    update public.player_progress
    set available_points=available_points+c.reward_points,
        lifetime_points=lifetime_points+c.reward_points,
        current_level=public.points_level(lifetime_points+c.reward_points),
        updated_at=now()
    where player_id=winner_id;

    insert into public.points_transactions(
      player_id,points,reason_code,metadata,created_by
    )
    values(
      winner_id,c.reward_points,'TEAM_CHALLENGE_WINNER',
      jsonb_build_object(
        'team_id',c.team_id,
        'team_challenge_id',c.id,
        'week_start',c.week_start,
        'reward_points',c.reward_points
      ),
      winner_id
    );
  else
    -- Record a real-prize winner without changing their points balance.
    insert into public.points_transactions(
      player_id,points,reason_code,metadata,created_by
    )
    values(
      winner_id,0,'TEAM_CHALLENGE_WINNER',
      jsonb_build_object(
        'team_id',c.team_id,
        'team_challenge_id',c.id,
        'week_start',c.week_start,
        'reward_label',c.reward_label
      ),
      winner_id
    );
  end if;

  select coalesce(nullif(btrim(profile.name),''),'A teammate')
  into winner_name
  from public.profiles profile
  where profile.id=winner_id;

  select team.name into team_name
  from public.teams team
  where team.id=c.team_id;

  insert into public.direct_messages(
    sender_id,recipient_id,body,system_generated,activity_type,source_stat_id
  )
  select
    winner_id,
    member.user_id,
    case
      when c.reward_type='points' then
        format('🏆 %s won %s and earned %s points!',winner_name,coalesce(c.title,team_name,'the team challenge'),c.reward_points)
      else
        format('🏆 %s won %s — prize: %s',winner_name,coalesce(c.title,team_name,'the team challenge'),c.reward_label)
    end,
    true,
    'team_challenge_winner',
    winner_stat_id
  from public.team_members member
  where member.team_id=c.team_id
    and member.user_id<>winner_id
  on conflict do nothing;

  return new;
end;
$$;
