begin;

-- Repair v121: PL/pgSQL output columns are variables, so all reaction-table
-- references must be qualified to avoid "user_id is ambiguous".
drop function if exists public.toggle_direct_message_reaction(bigint,text);

create function public.toggle_direct_message_reaction(
  target_message_id bigint,
  reaction_in text
)
returns table(result_user_id uuid,result_reaction text)
language plpgsql
security definer
set search_path=public
as $$
declare
  current_user_id uuid:=auth.uid();
  existing_reaction text;
  selected_reaction text;
begin
  if not public.is_approved_user(current_user_id) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if reaction_in not in ('like','dislike','love') then
    raise exception 'Invalid message reaction.' using errcode='22023';
  end if;
  if not exists (
    select 1
    from public.direct_messages dm
    where dm.id=target_message_id
      and current_user_id in (dm.sender_id,dm.recipient_id)
  ) then
    raise exception 'Message not found.' using errcode='42501';
  end if;

  select dmr.reaction into existing_reaction
  from public.direct_message_reactions dmr
  where dmr.message_id=target_message_id
    and dmr.user_id=current_user_id;

  if existing_reaction=reaction_in then
    delete from public.direct_message_reactions dmr
    where dmr.message_id=target_message_id
      and dmr.user_id=current_user_id;
    selected_reaction:=null;
  else
    insert into public.direct_message_reactions as dmr(message_id,user_id,reaction)
    values(target_message_id,current_user_id,reaction_in)
    on conflict(message_id,user_id) do update set
      reaction=excluded.reaction,
      updated_at=now();
    selected_reaction:=reaction_in;
  end if;

  return query select current_user_id,selected_reaction;
end;
$$;

revoke all on function public.toggle_direct_message_reaction(bigint,text) from public;
grant execute on function public.toggle_direct_message_reaction(bigint,text) to authenticated;

-- A narrow leaderboard read. It bypasses game_stats RLS only to return
-- personal-challenge results that the owner has explicitly allowed others to
-- see. Hidden users and private statistics remain excluded; callers always
-- retain access to their own rows.
create or replace function public.get_personal_challenge_standings(
  start_date_in date,
  end_date_in date
)
returns table(
  result_user_id uuid,
  game text,
  challenge_date date,
  seconds integer,
  mistakes integer,
  hints integer,
  completed_at timestamptz
)
language sql
security definer
stable
set search_path=public
as $$
  select
    gs.user_id,
    gs.game,
    gs.challenge_date,
    gs.seconds,
    gs.mistakes,
    gs.hints,
    gs.completed_at
  from public.game_stats gs
  join public.profiles p on p.id=gs.user_id
  where public.is_approved_user(auth.uid())
    and gs.mode='challenge'
    and gs.team_challenge_id is null
    and gs.challenge_date between start_date_in and end_date_in
    and (
      gs.user_id=auth.uid()
      or (
        coalesce(p.show_stats_to_others,false)=true
        and coalesce(p.hidden_from_others,false)=false
        and public.can_view_user(gs.user_id)
      )
    )
  order by gs.challenge_date,gs.completed_at,gs.id
$$;

revoke all on function public.get_personal_challenge_standings(date,date) from public;
grant execute on function public.get_personal_challenge_standings(date,date) to authenticated;

notify pgrst,'reload schema';
commit;
