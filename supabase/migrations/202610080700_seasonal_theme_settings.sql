-- Admin-controlled seasonal presentation.
-- The setting is intentionally app-wide rather than attached to a game row.
-- Public read access is safe: this table contains only presentation settings.
create table if not exists public.app_settings (
  id boolean primary key default true check (id = true),
  seasonal_theme text not null default 'off' check (seasonal_theme in ('off', 'halloween')),
  seasonal_start_date date,
  seasonal_end_date date,
  updated_at timestamptz not null default now(),
  check (seasonal_end_date is null or seasonal_start_date is null or seasonal_end_date >= seasonal_start_date)
);

insert into public.app_settings (id, seasonal_theme)
values (true, 'off')
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "app settings are readable" on public.app_settings;
create policy "app settings are readable"
on public.app_settings
for select
to anon, authenticated
using (true);

drop policy if exists "admins update app settings" on public.app_settings;
create policy "admins update app settings"
on public.app_settings
for update
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_admin = true
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_admin = true
  )
);

grant select on public.app_settings to anon, authenticated;
grant update on public.app_settings to authenticated;
