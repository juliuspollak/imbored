-- Share/replay is deliberately separate from "Beat my score".
--
-- A puzzle share carries the source game_stats id only. The server resolves
-- the saved seed/day when the owner (or a recipient of that share) opens it,
-- so the client cannot invent a different board behind an existing share.
-- No score threshold applies and replay results are saved by the client as
-- ordinary practice results.

create or replace function public.get_replayable_puzzle(target_stat_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  source_result public.game_stats;
  allowed boolean:=false;
begin
  select * into source_result
  from public.game_stats
  where id=target_stat_id;

  if not found then
    raise exception 'Puzzle result not found.' using errcode='P0002';
  end if;

  if source_result.game not in ('hive','binary','gridly','minisudoku','geo','zoom')
     or nullif(source_result.seed,'') is null then
    raise exception 'This game cannot be replayed from a saved puzzle.' using errcode='22023';
  end if;

  allowed:=source_result.user_id=auth.uid()
    or exists (
      select 1
      from public.direct_messages dm
      where dm.recipient_id=auth.uid()
        and dm.source_stat_id=source_result.id
        and dm.activity_type='puzzle_share'
    );

  if not allowed then
    raise exception 'This puzzle was not shared with you.' using errcode='42501';
  end if;

  return jsonb_build_object(
    'source_stat_id',source_result.id,
    'game',source_result.game,
    'day_index',source_result.day_index,
    'seed',source_result.seed
  );
end;
$$;

create or replace function public.share_puzzle_with_circles(target_stat_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  source_result public.game_stats;
  sender_name text;
  game_label text;
  eligible_count integer:=0;
  sent_count integer:=0;
begin
  select * into source_result
  from public.game_stats
  where id=target_stat_id;

  if not found or source_result.user_id is distinct from auth.uid() then
    raise exception 'Puzzle result not found.' using errcode='42501';
  end if;

  if source_result.game not in ('hive','binary','gridly','minisudoku','geo','zoom')
     or nullif(source_result.seed,'') is null then
    raise exception 'This game cannot be shared as an exact puzzle.' using errcode='22023';
  end if;

  select coalesce(nullif(trim(name),''),'Someone')
  into sender_name
  from public.profiles
  where id=auth.uid();
  sender_name:=coalesce(sender_name,'Someone');

  game_label:=case source_result.game
    when 'hive' then 'Hive'
    when 'binary' then 'Twist'
    when 'gridly' then 'Gridly'
    when 'minisudoku' then 'Sudoku'
    when 'geo' then 'Geo'
    when 'zoom' then 'Zoom'
    else source_result.game
  end;

  with recipients as (
    select distinct other_member.user_id
    from public.circle_members mine
    join public.circle_members other_member
      on other_member.circle_id=mine.circle_id
    join public.profiles profile
      on profile.id=other_member.user_id
    where mine.user_id=auth.uid()
      and other_member.user_id<>auth.uid()
      and profile.account_deleted_at is null
      and coalesce(profile.is_blocked,false)=false
      and coalesce(profile.hidden_from_others,false)=false
      and coalesce(profile.is_approved,true)=true
  )
  select count(*)::integer into eligible_count from recipients;

  with recipients as (
    select distinct other_member.user_id
    from public.circle_members mine
    join public.circle_members other_member
      on other_member.circle_id=mine.circle_id
    join public.profiles profile
      on profile.id=other_member.user_id
    where mine.user_id=auth.uid()
      and other_member.user_id<>auth.uid()
      and profile.account_deleted_at is null
      and coalesce(profile.is_blocked,false)=false
      and coalesce(profile.hidden_from_others,false)=false
      and coalesce(profile.is_approved,true)=true
  ), inserted as (
    insert into public.direct_messages (
      sender_id,
      recipient_id,
      body,
      system_generated,
      activity_type,
      source_stat_id
    )
    select
      auth.uid(),
      recipients.user_id,
      sender_name || ' shared a ' || game_label || ' puzzle. Try the exact same game. [[puzzle:' || source_result.id || ']]',
      true,
      'puzzle_share',
      source_result.id
    from recipients
    where not exists (
      select 1
      from public.direct_messages existing
      where existing.sender_id=auth.uid()
        and existing.recipient_id=recipients.user_id
        and existing.activity_type='puzzle_share'
        and existing.source_stat_id=source_result.id
    )
    returning id
  )
  select count(*)::integer into sent_count from inserted;

  return jsonb_build_object(
    'recipient_count',eligible_count,
    'sent_count',sent_count,
    'source_stat_id',source_result.id
  );
end;
$$;

revoke all on function public.get_replayable_puzzle(bigint) from public;
revoke all on function public.share_puzzle_with_circles(bigint) from public;
grant execute on function public.get_replayable_puzzle(bigint) to authenticated;
grant execute on function public.share_puzzle_with_circles(bigint) to authenticated;
