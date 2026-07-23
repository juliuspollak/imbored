-- Adds user-controlled statistics privacy.
-- Run once in Supabase Dashboard -> SQL Editor.
--
-- When show_stats_to_others is false, game_stats are visible only to:
--   1. the player who owns them, and
--   2. administrators.
-- Hidden-user privacy continues to take priority as well.

alter table public.profiles
  add column if not exists show_stats_to_others boolean not null default true;

drop policy if exists "stats are publicly readable" on public.game_stats;
drop policy if exists "stats follow player visibility" on public.game_stats;
drop policy if exists "stats follow player and stats visibility" on public.game_stats;

create policy "stats follow player and stats visibility"
on public.game_stats for select
using (
  public.can_view_user(user_id)
  and (
    user_id = auth.uid()
    or public.is_admin(auth.uid())
    or coalesce((
      select p.show_stats_to_others
      from public.profiles p
      where p.id = user_id
    ), false)
  )
);
