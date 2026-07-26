-- V117: authoritative team-challenge lifecycle and winner notifications.
--
-- A player's own completion is not the same as the challenge ending. The
-- challenge ends only after every current team member has completed every
-- configured game; only then is the winner final and the prize awarded.

begin;

create or replace function public.get_my_team_challenge_lifecycle()
returns table(
  challenge_id bigint,
  member_count integer,
  finished_count integer,
  current_user_finished boolean,
  winner_id uuid,
  winner_name text,
  winner_icon text,
  awarded_at timestamptz
)
language sql
security definer
stable
set search_path=public
as $$
  with my_challenges as (
    select challenge.id, challenge.team_id, challenge.game_ids
    from public.team_members membership
    join public.team_weekly_challenges challenge
      on challenge.team_id=membership.team_id
     and challenge.week_start=public.current_week_start()
    where membership.user_id=auth.uid()
      and public.is_approved_user(auth.uid())
  ),
  member_progress as (
    select
      challenge.id as challenge_id,
      member.user_id,
      count(distinct result.game) filter (
        where result.game=any(challenge.game_ids)
      )=cardinality(challenge.game_ids) as finished
    from my_challenges challenge
    join public.team_members member on member.team_id=challenge.team_id
    left join public.game_stats result
      on result.user_id=member.user_id
     and result.team_challenge_id=challenge.id
     and result.mode='challenge'
    group by challenge.id,challenge.game_ids,member.user_id
  )
  select
    challenge.id,
    count(progress.user_id)::integer,
    count(*) filter(where progress.finished)::integer,
    coalesce(bool_or(progress.finished) filter(where progress.user_id=auth.uid()),false),
    award.player_id,
    winner.name::text,
    winner.icon::text,
    award.awarded_at
  from my_challenges challenge
  join member_progress progress on progress.challenge_id=challenge.id
  left join lateral (
    select item.player_id,item.awarded_at
    from public.team_challenge_reward_awards item
    where item.challenge_id=challenge.id
    order by item.awarded_at,item.id
    limit 1
  ) award on true
  left join public.profiles winner on winner.id=award.player_id
  group by challenge.id,award.player_id,award.awarded_at,winner.name,winner.icon
  order by challenge.id;
$$;

revoke all on function public.get_my_team_challenge_lifecycle() from public;
grant execute on function public.get_my_team_challenge_lifecycle() to authenticated;

-- System messages may address the same user who generated the underlying
-- result. Ordinary player-authored self-messages remain forbidden.
alter table public.direct_messages
  drop constraint if exists direct_messages_not_to_self;
alter table public.direct_messages
  add constraint direct_messages_not_to_self
  check (sender_id<>recipient_id or system_generated);

create unique index if not exists direct_messages_team_challenge_winner_once_idx
on public.direct_messages(activity_type,source_stat_id,recipient_id)
where activity_type='team_challenge_winner' and source_stat_id is not null;

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
  if new.mode is distinct from 'challenge' or new.team_challenge_id is null then return new; end if;
  select * into c from public.team_weekly_challenges where id=new.team_challenge_id;
  if not found then return new; end if;

  required_games:=cardinality(c.game_ids);
  if required_games=0 then return new; end if;

  select count(*) into member_count from public.team_members where team_id=c.team_id;
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
  if member_count=0 or finisher_count<member_count then return new; end if;

  select ranked.user_id,ranked.last_stat_id into winner_id,winner_stat_id
  from (
    select
      result.user_id,
      max(result.id) as last_stat_id,
      sum(greatest(result.seconds,0)+greatest(result.hints,0)*30+greatest(result.mistakes,0)*15) as adjusted_seconds,
      sum(greatest(result.hints,0)) as total_hints,
      sum(greatest(result.mistakes,0)) as total_mistakes,
      max(result.completed_at) as finished_at
    from public.game_stats result
    where result.team_challenge_id=c.id and result.game=any(c.game_ids)
    group by result.user_id
    having count(distinct result.game)=required_games
    order by adjusted_seconds,total_hints,total_mistakes,finished_at,result.user_id
    limit 1
  ) ranked;
  if winner_id is null then return new; end if;

  if exists(
    select 1 from public.points_transactions transaction
    where transaction.reason_code='TEAM_CHALLENGE_WINNER'
      and (transaction.metadata->>'team_challenge_id')::bigint=c.id
  ) then return new; end if;

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
  end if;

  insert into public.points_transactions(player_id,points,reason_code,metadata,created_by)
  values(
    winner_id,
    case when c.reward_type='points' then greatest(c.reward_points,0) else 0 end,
    'TEAM_CHALLENGE_WINNER',
    jsonb_build_object(
      'team_id',c.team_id,
      'team_challenge_id',c.id,
      'week_start',c.week_start,
      'reward_points',case when c.reward_type='points' then greatest(c.reward_points,0) else 0 end,
      'reward_label',case when c.reward_type='prize' then c.reward_label else null end
    ),
    winner_id
  );

  select coalesce(nullif(btrim(profile.name),''),'A teammate')
    into winner_name from public.profiles profile where profile.id=winner_id;
  select team.name into team_name from public.teams team where team.id=c.team_id;

  insert into public.direct_messages(
    sender_id,recipient_id,body,system_generated,activity_type,source_stat_id
  )
  select
    winner_id,
    member.user_id,
    case
      when member.user_id=winner_id and c.reward_type='points' then
        format('🏆 You won %s and earned the %s-point winner''s prize!',coalesce(c.title,team_name,'the team challenge'),c.reward_points)
      when member.user_id=winner_id then
        format('🏆 You won %s — your prize is %s.',coalesce(c.title,team_name,'the team challenge'),c.reward_label)
      when c.reward_type='points' then
        format('🏆 %s won %s and earned the %s-point winner''s prize.',winner_name,coalesce(c.title,team_name,'the team challenge'),c.reward_points)
      else
        format('🏆 %s won %s — prize: %s.',winner_name,coalesce(c.title,team_name,'the team challenge'),c.reward_label)
    end,
    true,
    'team_challenge_winner',
    winner_stat_id
  from public.team_members member
  where member.team_id=c.team_id
  on conflict do nothing;

  return new;
end;
$$;

-- Backfill the missing winner-facing message for challenges already awarded
-- under V115. This does not alter points or choose a new winner.
insert into public.direct_messages(
  sender_id,recipient_id,body,system_generated,activity_type,source_stat_id
)
select
  award.player_id,
  award.player_id,
  case
    when challenge.reward_type='points' then
      format('🏆 You won %s and earned the %s-point winner''s prize!',challenge.title,challenge.reward_points)
    else
      format('🏆 You won %s — your prize is %s.',challenge.title,challenge.reward_label)
  end,
  true,
  'team_challenge_winner',
  result.last_stat_id
from public.team_challenge_reward_awards award
join public.team_weekly_challenges challenge on challenge.id=award.challenge_id
join lateral (
  select max(stat.id) as last_stat_id
  from public.game_stats stat
  where stat.team_challenge_id=challenge.id and stat.user_id=award.player_id
) result on result.last_stat_id is not null
where not exists(
  select 1 from public.direct_messages message
  where message.activity_type='team_challenge_winner'
    and message.source_stat_id=result.last_stat_id
    and message.recipient_id=award.player_id
)
on conflict do nothing;

notify pgrst,'reload schema';
commit;
