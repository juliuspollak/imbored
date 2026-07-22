-- Admin-only RPC used by the Games screen to reset today's challenge.
-- SECURITY DEFINER is required because normal users may only manage their
-- own stats; the function independently verifies the caller is an admin.
create or replace function public.admin_reset_daily_challenge(p_game text, p_challenge_date date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin = true
  ) then
    raise exception 'Admin access required';
  end if;

  delete from public.game_stats
  where game = p_game
    and mode = 'challenge'
    and challenge_date = p_challenge_date;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.admin_reset_daily_challenge(text, date) from public;
grant execute on function public.admin_reset_daily_challenge(text, date) to authenticated;
