-- Rewards & Progression v60
-- Run after the v59 schema/migrations.

-- ---------- Core tables ----------
create table if not exists reward_rules (
  id bigint generated always as identity primary key,
  name text not null default 'Default',
  is_active boolean not null default true,
  base_points int not null default 100,
  no_hint_bonus int not null default 20,
  no_mistake_bonus int not null default 20,
  hint_penalty int not null default 10,
  mistake_penalty int not null default 5,
  fast_time_bonus int not null default 30,
  average_time_bonus int not null default 15,
  challenge_bonus int not null default 20,
  streak_daily_bonus int not null default 10,
  streak_bonus_cap int not null default 70,
  minimum_points int not null default 20,
  maximum_points int not null default 250,
  practice_daily_limit int not null default 5,
  streak_protection_cost int not null default 250,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);

insert into reward_rules (name)
select 'Default'
where not exists (select 1 from reward_rules);

create unique index if not exists reward_rules_one_active
  on reward_rules ((is_active)) where is_active = true;

create table if not exists player_progress (
  player_id uuid primary key references profiles(id) on delete cascade,
  available_points bigint not null default 0 check (available_points >= 0),
  lifetime_points bigint not null default 0 check (lifetime_points >= 0),
  current_level int not null default 1,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  last_completed_date date,
  streak_protected_through date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists points_transactions (
  id bigint generated always as identity primary key,
  player_id uuid not null references profiles(id) on delete cascade,
  points bigint not null,
  reason_code text not null,
  game_stat_id bigint references game_stats(id) on delete set null,
  related_player_id uuid references profiles(id) on delete set null,
  reward_id bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists points_one_award_per_game
  on points_transactions(game_stat_id) where game_stat_id is not null and reason_code = 'GAME_COMPLETED';
create index if not exists points_transactions_player_date on points_transactions(player_id, created_at desc);

create table if not exists rewards (
  id bigint generated always as identity primary key,
  name text not null,
  description text,
  image_url text,
  points_cost bigint not null check (points_cost > 0),
  stock_quantity int check (stock_quantity is null or stock_quantity >= 0),
  is_active boolean not null default true,
  requires_approval boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table points_transactions
  drop constraint if exists points_transactions_reward_id_fkey;
alter table points_transactions
  add constraint points_transactions_reward_id_fkey foreign key (reward_id) references rewards(id) on delete set null;

create table if not exists reward_redemptions (
  id bigint generated always as identity primary key,
  player_id uuid not null references profiles(id) on delete cascade,
  reward_id bigint not null references rewards(id) on delete restrict,
  points_cost bigint not null,
  status text not null default 'requested' check (status in ('requested','approved','declined','fulfilled','cancelled')),
  player_note text,
  admin_note text,
  reviewed_by uuid references profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  fulfilled_at timestamptz
);

create table if not exists reward_wishes (
  id bigint generated always as identity primary key,
  player_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  product_url text,
  note text,
  points_cost bigint check (points_cost is null or points_cost > 0),
  status text not null default 'submitted' check (status in ('submitted','priced','approved','declined','redeemed')),
  admin_note text,
  reviewed_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- ---------- Helpers ----------
create or replace function points_level(total bigint)
returns int language sql immutable as $$
  select greatest(1, floor(sqrt(greatest(total, 0)::numeric / 500))::int + 1);
$$;

grant execute on function points_level(bigint) to authenticated;

create or replace function ensure_player_progress(uid uuid)
returns player_progress
language plpgsql security definer set search_path = public
as $$
declare p player_progress;
begin
  insert into player_progress(player_id) values (uid) on conflict do nothing;
  select * into p from player_progress where player_id = uid;
  return p;
end;
$$;
grant execute on function ensure_player_progress(uuid) to authenticated;

-- ---------- Award points after a saved game ----------
create or replace function award_game_points(target_stat_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s game_stats;
  r reward_rules;
  p player_progress;
  avg_seconds numeric;
  points_total int;
  time_points int := 0;
  hint_points int := 0;
  mistake_points int := 0;
  streak_points int := 0;
  new_streak int;
  old_level int;
  new_level int;
  today_date date;
  practice_count int;
begin
  select * into s from game_stats where id = target_stat_id;
  if not found or s.user_id <> auth.uid() then raise exception 'Game result not found'; end if;


  select * into r from reward_rules where is_active = true order by id desc limit 1;
  if not found then raise exception 'No active reward rules'; end if;

  perform ensure_player_progress(s.user_id);
  select * into p from player_progress where player_id = s.user_id for update;

  if exists(select 1 from points_transactions where game_stat_id = s.id and reason_code = 'GAME_COMPLETED') then
    return jsonb_build_object('already_awarded', true, 'points_awarded', 0, 'balance', p.available_points,
      'streak', p.current_streak, 'level', p.current_level);
  end if;

  if s.mode = 'practice' then
    select count(*) into practice_count from points_transactions pt
      join game_stats gs on gs.id = pt.game_stat_id
      where pt.player_id = s.user_id and pt.reason_code = 'GAME_COMPLETED'
        and gs.mode = 'practice' and (pt.created_at at time zone 'Australia/Sydney')::date = (now() at time zone 'Australia/Sydney')::date;
    if practice_count >= r.practice_daily_limit then
      return jsonb_build_object('points_awarded', 0, 'daily_limit_reached', true, 'balance', p.available_points,
        'streak', p.current_streak, 'level', p.current_level);
    end if;
  end if;

  select avg(seconds) into avg_seconds from game_stats
    where game = s.game and mode = s.mode and id <> s.id and seconds > 0;

  if avg_seconds is not null and s.seconds <= avg_seconds * 0.8 then time_points := r.fast_time_bonus;
  elsif avg_seconds is not null and s.seconds <= avg_seconds then time_points := r.average_time_bonus;
  end if;

  if s.hints = 0 then hint_points := r.no_hint_bonus; else hint_points := -(s.hints * r.hint_penalty); end if;
  if s.mistakes = 0 then mistake_points := r.no_mistake_bonus; else mistake_points := -(s.mistakes * r.mistake_penalty); end if;

  today_date := coalesce(s.challenge_date, (s.completed_at at time zone 'Australia/Sydney')::date);
  if p.last_completed_date is null then new_streak := 1;
  elsif p.last_completed_date = today_date then new_streak := p.current_streak;
  elsif p.last_completed_date = today_date - 1 then new_streak := p.current_streak + 1;
  elsif p.streak_protected_through is not null and p.streak_protected_through >= today_date - 1 then new_streak := p.current_streak + 1;
  else new_streak := 1;
  end if;

  if p.last_completed_date is distinct from today_date then
    streak_points := least(new_streak * r.streak_daily_bonus, r.streak_bonus_cap);
  end if;

  points_total := r.base_points + time_points + hint_points + mistake_points + streak_points
    + case when s.mode = 'challenge' then r.challenge_bonus else 0 end;
  points_total := greatest(r.minimum_points, least(r.maximum_points, points_total));

  old_level := p.current_level;
  new_level := points_level(p.lifetime_points + points_total);

  insert into points_transactions(player_id, points, reason_code, game_stat_id, metadata, created_by)
  values (s.user_id, points_total, 'GAME_COMPLETED', s.id,
    jsonb_build_object('base', r.base_points, 'time', time_points, 'hints', hint_points,
      'mistakes', mistake_points, 'streak', streak_points,
      'challenge', case when s.mode='challenge' then r.challenge_bonus else 0 end,
      'average_seconds', avg_seconds, 'rule_id', r.id, 'total', points_total), s.user_id);

  update player_progress set
    available_points = available_points + points_total,
    lifetime_points = lifetime_points + points_total,
    current_level = new_level,
    current_streak = new_streak,
    longest_streak = greatest(longest_streak, new_streak),
    last_completed_date = greatest(coalesce(last_completed_date, today_date), today_date),
    updated_at = now()
  where player_id = s.user_id
  returning * into p;

  return jsonb_build_object('points_awarded', points_total, 'balance', p.available_points,
    'streak', p.current_streak, 'level', p.current_level, 'level_up', new_level > old_level);
end;
$$;
grant execute on function award_game_points(bigint) to authenticated;

-- ---------- Transfers ----------
create or replace function transfer_points(target_player_id uuid, amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sender player_progress; recipient player_progress;
begin
  if amount < 10 then raise exception 'Minimum transfer is 10 points'; end if;
  if target_player_id = auth.uid() then raise exception 'You cannot transfer points to yourself'; end if;
  if not exists(select 1 from profiles where id = target_player_id and can_view_user(id)) then raise exception 'Player not available'; end if;
  perform ensure_player_progress(auth.uid()); perform ensure_player_progress(target_player_id);
  select * into sender from player_progress where player_id = auth.uid() for update;
  if sender.available_points < amount then raise exception 'Not enough points'; end if;
  select * into recipient from player_progress where player_id = target_player_id for update;
  update player_progress set available_points = available_points - amount, updated_at = now() where player_id = auth.uid();
  update player_progress set available_points = available_points + amount, updated_at = now() where player_id = target_player_id;
  insert into points_transactions(player_id, points, reason_code, related_player_id, created_by)
    values (auth.uid(), -amount, 'TRANSFER_SENT', target_player_id, auth.uid()),
           (target_player_id, amount, 'TRANSFER_RECEIVED', auth.uid(), auth.uid());
  return jsonb_build_object('balance', sender.available_points - amount);
end; $$;
grant execute on function transfer_points(uuid,bigint) to authenticated;

-- ---------- Reward redemption ----------
create or replace function redeem_reward(target_reward_id bigint, note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rw rewards; p player_progress; red_id bigint;
begin
  select * into rw from rewards where id=target_reward_id and is_active=true for update;
  if not found then raise exception 'Reward unavailable'; end if;
  if rw.stock_quantity is not null and rw.stock_quantity <= 0 then raise exception 'Out of stock'; end if;
  perform ensure_player_progress(auth.uid());
  select * into p from player_progress where player_id=auth.uid() for update;
  if p.available_points < rw.points_cost then raise exception 'Not enough points'; end if;
  update player_progress set available_points=available_points-rw.points_cost, updated_at=now() where player_id=auth.uid();
  if rw.stock_quantity is not null then update rewards set stock_quantity=stock_quantity-1, updated_at=now() where id=rw.id; end if;
  insert into reward_redemptions(player_id,reward_id,points_cost,status,player_note)
    values(auth.uid(),rw.id,rw.points_cost,case when rw.requires_approval then 'requested' else 'approved' end,note) returning id into red_id;
  insert into points_transactions(player_id,points,reason_code,reward_id,metadata,created_by)
    values(auth.uid(),-rw.points_cost,'REWARD_REDEEMED',rw.id,jsonb_build_object('redemption_id',red_id,'reward_name',rw.name),auth.uid());
  return jsonb_build_object('redemption_id',red_id,'balance',p.available_points-rw.points_cost);
end; $$;
grant execute on function redeem_reward(bigint,text) to authenticated;

create or replace function review_redemption(target_id bigint, new_status text, admin_note_in text default null)
returns void language plpgsql security definer set search_path=public as $$
declare red reward_redemptions;
begin
  if not is_admin(auth.uid()) then raise exception 'Admin only'; end if;
  if new_status not in ('approved','declined','fulfilled') then raise exception 'Invalid status'; end if;
  select * into red from reward_redemptions where id=target_id for update;
  if not found then raise exception 'Redemption not found'; end if;
  if new_status='declined' and red.status not in ('declined','cancelled') then
    update player_progress set available_points=available_points+red.points_cost,updated_at=now() where player_id=red.player_id;
    insert into points_transactions(player_id,points,reason_code,reward_id,metadata,created_by)
      values(red.player_id,red.points_cost,'REWARD_REFUND',red.reward_id,jsonb_build_object('redemption_id',red.id),auth.uid());
    update rewards set stock_quantity=stock_quantity+1 where id=red.reward_id and stock_quantity is not null;
  end if;
  update reward_redemptions set status=new_status,admin_note=admin_note_in,reviewed_by=auth.uid(),reviewed_at=now(),
    fulfilled_at=case when new_status='fulfilled' then now() else fulfilled_at end where id=target_id;
end; $$;
grant execute on function review_redemption(bigint,text,text) to authenticated;

-- ---------- Streak protection ----------
create or replace function protect_streak()
returns jsonb language plpgsql security definer set search_path=public as $$
declare p player_progress; r reward_rules; yesterday date := (now() at time zone 'Australia/Sydney')::date - 1;
begin
  perform ensure_player_progress(auth.uid());
  select * into p from player_progress where player_id=auth.uid() for update;
  select * into r from reward_rules where is_active=true limit 1;
  if p.current_streak <= 0 or p.last_completed_date <> yesterday - 1 then raise exception 'No missed streak is available to protect'; end if;
  if p.streak_protected_through is not null and p.streak_protected_through >= yesterday then raise exception 'Streak already protected'; end if;
  if p.available_points < r.streak_protection_cost then raise exception 'Not enough points'; end if;
  update player_progress set available_points=available_points-r.streak_protection_cost, streak_protected_through=yesterday, updated_at=now() where player_id=auth.uid();
  insert into points_transactions(player_id,points,reason_code,metadata,created_by)
    values(auth.uid(),-r.streak_protection_cost,'STREAK_PROTECTION',jsonb_build_object('protected_date',yesterday),auth.uid());
  return jsonb_build_object('balance',p.available_points-r.streak_protection_cost,'protected_date',yesterday);
end; $$;
grant execute on function protect_streak() to authenticated;

-- ---------- Admin adjustment ----------
create or replace function admin_adjust_points(target_player_id uuid, amount bigint, reason text)
returns void language plpgsql security definer set search_path=public as $$
declare p player_progress;
begin
  if not is_admin(auth.uid()) then raise exception 'Admin only'; end if;
  if amount=0 or nullif(trim(reason),'') is null then raise exception 'Amount and reason are required'; end if;
  perform ensure_player_progress(target_player_id);
  select * into p from player_progress where player_id=target_player_id for update;
  if p.available_points+amount < 0 then raise exception 'Adjustment would make balance negative'; end if;
  update player_progress set available_points=available_points+amount,
    lifetime_points=lifetime_points+greatest(amount,0), current_level=points_level(lifetime_points+greatest(amount,0)),updated_at=now()
    where player_id=target_player_id;
  insert into points_transactions(player_id,points,reason_code,metadata,created_by)
    values(target_player_id,amount,'ADMIN_ADJUSTMENT',jsonb_build_object('reason',reason),auth.uid());
end; $$;
grant execute on function admin_adjust_points(uuid,bigint,text) to authenticated;

-- ---------- RLS ----------
alter table reward_rules enable row level security;
alter table player_progress enable row level security;
alter table points_transactions enable row level security;
alter table rewards enable row level security;
alter table reward_redemptions enable row level security;
alter table reward_wishes enable row level security;

create policy "rules readable" on reward_rules for select using (auth.uid() is not null);
create policy "admins manage rules" on reward_rules for all using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

create policy "progress visible to owner or admin" on player_progress for select using (player_id=auth.uid() or is_admin(auth.uid()));
create policy "transactions visible to owner or admin" on points_transactions for select using (player_id=auth.uid() or is_admin(auth.uid()));

create policy "active rewards readable" on rewards for select using (is_active or is_admin(auth.uid()));
create policy "admins manage rewards" on rewards for all using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

create policy "redemptions owner or admin" on reward_redemptions for select using (player_id=auth.uid() or is_admin(auth.uid()));

create policy "wishes owner or admin" on reward_wishes for select using (player_id=auth.uid() or is_admin(auth.uid()));
create policy "players create wishes" on reward_wishes for insert with check (player_id=auth.uid());
create policy "players edit submitted wishes" on reward_wishes for update using (player_id=auth.uid() and status='submitted') with check (player_id=auth.uid());
create policy "admins manage wishes" on reward_wishes for all using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
