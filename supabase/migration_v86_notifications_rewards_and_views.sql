begin;

create table if not exists public.user_section_views (
  user_id uuid not null references public.profiles(id) on delete cascade,
  section text not null,
  viewed_at timestamp with time zone not null default now(),
  primary key (user_id, section)
);
alter table public.user_section_views enable row level security;
drop policy if exists "users manage own section views" on public.user_section_views;
create policy "users manage own section views" on public.user_section_views for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.user_section_views to authenticated;

alter table public.feedback add column if not exists updated_at timestamp with time zone not null default now();

alter table public.team_weekly_challenges add column if not exists reward_type text not null default 'points';
alter table public.team_weekly_challenges add column if not exists reward_label text;
alter table public.team_weekly_challenges drop constraint if exists team_weekly_challenges_reward_type_check;
alter table public.team_weekly_challenges add constraint team_weekly_challenges_reward_type_check check (reward_type in ('points','prize'));

-- Replace the setup function so a team owner may choose points or a real-world prize.
drop function if exists public.set_team_weekly_challenge(uuid,text[],integer[],integer);
drop function if exists public.set_team_weekly_challenge(uuid,text[],integer[],integer,text,text);
create function public.set_team_weekly_challenge(
  target_team_id uuid,
  selected_games text[],
  selected_days integer[],
  reward_points_in integer default 0,
  reward_type_in text default 'points',
  reward_label_in text default null
) returns void
language plpgsql security definer set search_path=public
as $$
declare c public.team_weekly_challenges; ws date := public.current_week_start();
begin
  if not public.is_approved_user(auth.uid()) then raise exception 'Approval required'; end if;
  if not exists(select 1 from public.teams where id=target_team_id and created_by=auth.uid()) then raise exception 'Only the team creator can update this challenge'; end if;
  select * into c from public.team_weekly_challenges where team_id=target_team_id and week_start=ws;
  if c.id is not null and c.locked_at is not null then raise exception 'This challenge is already in progress'; end if;
  if coalesce(array_length(selected_games,1),0)=0 or coalesce(array_length(selected_days,1),0)=0 then raise exception 'Choose at least one game and day'; end if;
  if reward_type_in not in ('points','prize') then raise exception 'Invalid reward type'; end if;
  if reward_type_in='prize' and nullif(btrim(reward_label_in),'') is null then raise exception 'Enter the prize'; end if;
  insert into public.team_weekly_challenges(team_id,week_start,game_ids,active_days,reward_points,reward_type,reward_label,created_by)
  values(target_team_id,ws,selected_games,selected_days,case when reward_type_in='points' then greatest(reward_points_in,0) else 0 end,reward_type_in,nullif(btrim(reward_label_in),''),auth.uid())
  on conflict(team_id,week_start) do update set game_ids=excluded.game_ids,active_days=excluded.active_days,
    reward_points=excluded.reward_points,reward_type=excluded.reward_type,reward_label=excluded.reward_label,updated_at=now();
end $$;
grant execute on function public.set_team_weekly_challenge(uuid,text[],integer[],integer,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
