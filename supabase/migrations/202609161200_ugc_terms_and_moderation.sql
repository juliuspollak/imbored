-- Review and apply separately; this migration does not backfill consent.
begin;
create table public.account_terms_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  terms_accepted_at timestamptz not null default now(),
  primary key (user_id, terms_version)
);
alter table public.account_terms_acceptances enable row level security;
revoke all on public.account_terms_acceptances from anon, authenticated;
grant select on public.account_terms_acceptances to authenticated;
create policy "Read own Terms acceptance" on public.account_terms_acceptances
  for select to authenticated using (user_id = auth.uid());

create or replace function public.accept_current_terms(accepted_version text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501'; end if;
  if accepted_version is distinct from '2026-09-16' then raise exception 'Please accept the current Terms.' using errcode='22023'; end if;
  if exists(select 1 from public.profiles where id=auth.uid() and (is_blocked or account_deleted_at is not null)) then
    raise exception 'This account is unavailable.' using errcode='42501';
  end if;
  insert into public.account_terms_acceptances(user_id, terms_version) values(auth.uid(), accepted_version)
  on conflict do nothing;
end;
$$;
revoke all on function public.accept_current_terms(text) from public;
grant execute on function public.accept_current_terms(text) to authenticated;

-- Database triggers cover RPCs, direct REST writes, and older clients alike.
-- Only changed text is checked so moderation/security updates can clean up old content.
create or replace function public.ugc_text_rejected(value text) returns boolean
language sql immutable set search_path = public as $$
  select exists (select 1 from unnest(array[
    $pattern$\y(fuck\w*|motherfuck\w*|cunt\w*|kurva|kokot\w*|nigg(er|a)s?|fagg?ots?|kikes?|chinks?)\y$pattern$,
    $pattern$\y(porn\w*|suck my (dick|cock)|send nudes|child porn\w*|sex with (a |an )?(child|children|minor|kids|underage)|rape you|raping you)\y$pattern$,
    $pattern$\y((i will|i'll|i'm going to|im going to|i am going to) (kill|murder|rape) (you|u)|kill yourself|go kill yourself|kys)\y$pattern$,
    $pattern$\y(buy now|free money|click here)\y[\s\S]*\y(buy now|free money|click here)\y$pattern$,
    $pattern$(https?://\S+\s*){5,}$pattern$,
    $pattern$(.)\1{29,}$pattern$
  ]) as rules(pattern) where
    lower(translate(normalize(coalesce(value, ''), NFKC), U&'\2019\200B\200C\200D\200E\200F\FEFF', chr(39))) ~ rules.pattern);
$$;

create or replace function public.enforce_ugc_text() returns trigger
language plpgsql set search_path = public as $$
declare field_name text;
begin
  foreach field_name in array TG_ARGV loop
    if TG_OP='UPDATE' then
      if (to_jsonb(new)->>field_name) is not distinct from (to_jsonb(old)->>field_name) then continue; end if;
    end if;
    if public.ugc_text_rejected(to_jsonb(new)->>field_name) then
      raise exception 'Please edit this text. Abusive, threatening, sexually explicit or spam content is not allowed.' using errcode='22023';
    end if;
  end loop;
  return new;
end;
$$;
create trigger moderate_ugc_text before insert or update on public.direct_messages
  for each row execute function public.enforce_ugc_text('body');
create trigger moderate_ugc_text before insert or update on public.profiles
  for each row execute function public.enforce_ugc_text('name', 'mood', 'icon');
create trigger moderate_ugc_text before insert or update on public.circles
  for each row execute function public.enforce_ugc_text('name', 'emoji');
create trigger moderate_ugc_text before insert or update on public.circle_weekly_challenges
  for each row execute function public.enforce_ugc_text('title', 'reward_label');
create trigger moderate_ugc_text before insert or update on public.rewards
  for each row execute function public.enforce_ugc_text('name', 'description');
create trigger moderate_ugc_text before insert or update on public.feedback
  for each row execute function public.enforce_ugc_text('title', 'description', 'admin_comment');
create trigger moderate_ugc_text before insert or update on public.pokes
  for each row execute function public.enforce_ugc_text('message');
create trigger moderate_ugc_text before insert or update on public.animal_rush_players
  for each row execute function public.enforce_ugc_text('player_name', 'player_icon');
create trigger moderate_ugc_text before insert or update on public.reward_redemptions
  for each row execute function public.enforce_ugc_text('player_note', 'admin_note', 'dispute_reason');

-- Preserve report context privately before removing the publicly visible message.
alter table public.content_reports add column message_snapshot text;
drop policy "reporters and admins read reports" on public.content_reports;
create policy "Only admins read safety reports" on public.content_reports
  for select to authenticated using (public.is_admin(auth.uid()));
create or replace function public.capture_report_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.message_id is not null then
    select body into new.message_snapshot from public.direct_messages
      where id=new.message_id and recipient_id=auth.uid();
  end if;
  return new;
end;
$$;
create trigger capture_report_message before insert on public.content_reports
  for each row execute function public.capture_report_message();

create or replace function public.admin_remove_reported_message(target_report_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare target_message bigint;
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admin only.' using errcode='42501'; end if;
  select message_id into target_message from public.content_reports where id=target_report_id;
  if target_message is null then raise exception 'No message attached to this report.' using errcode='22023'; end if;
  update public.content_reports r set message_snapshot=coalesce(r.message_snapshot, m.body)
    from public.direct_messages m where r.message_id=target_message and m.id=target_message;
  update public.direct_messages set body='[Removed by moderation]' where id=target_message;
  -- Keep the report open until the moderator also considers account suspension.
end;
$$;
revoke all on function public.admin_remove_reported_message(bigint) from public;
grant execute on function public.admin_remove_reported_message(bigint) to authenticated;
create or replace function public.admin_list_content_reports() RETURNS TABLE(id bigint, reason text, details text, status text, created_at timestamp with time zone, reporter_name text, reported_name text, reported_user_id uuid, message_body text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    report.id, report.reason, report.details, report.status, report.created_at,
    reporter.name::text, reported.name::text, report.reported_user_id,
    coalesce(report.message_snapshot, message.body)::text
  from public.content_reports report
  left join public.profiles reporter on reporter.id=report.reporter_id
  left join public.profiles reported on reported.id=report.reported_user_id
  left join public.direct_messages message on message.id=report.message_id
  where public.is_admin(auth.uid())
  order by (report.status='open') desc, report.created_at asc
$$;
commit;
