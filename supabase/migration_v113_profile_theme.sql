alter table public.profiles
  add column if not exists theme_preference text not null default 'system'
  check (theme_preference in ('system', 'light', 'dark'));

drop function if exists public.save_my_profile(text,text,boolean,text,text,boolean,integer);

create or replace function public.save_my_profile(
  profile_name text default null,
  profile_icon text default null,
  profile_is_private boolean default null,
  profile_mood text default null,
  profile_default_mode text default null,
  profile_show_stats boolean default null,
  profile_week_starts_on integer default null,
  profile_theme_preference text default null
)
returns public.profiles
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.profiles;
  clean_name text := nullif(btrim(profile_name),'');
begin
  if auth.uid() is null then raise exception 'You must be signed in.' using errcode='42501'; end if;
  if profile_name is not null and clean_name is null then raise exception 'Name is required.' using errcode='22023'; end if;
  if profile_default_mode is not null and profile_default_mode not in ('practice','challenge') then raise exception 'Invalid default mode.' using errcode='22023'; end if;
  if profile_week_starts_on is not null and profile_week_starts_on not in (0,1) then raise exception 'Invalid week start.' using errcode='22023'; end if;
  if profile_theme_preference is not null and profile_theme_preference not in ('system','light','dark') then raise exception 'Invalid theme preference.' using errcode='22023'; end if;

  if clean_name is not null and exists(
    select 1 from public.profiles p
    where p.id<>auth.uid() and p.account_deleted_at is null and lower(btrim(p.name))=lower(clean_name)
  ) then
    raise exception 'That player name is already taken. Choose another one.' using errcode='23505';
  end if;

  if not exists(select 1 from public.profiles where id=auth.uid()) and clean_name is null then
    raise exception 'Name is required.' using errcode='22023';
  end if;

  insert into public.profiles(id,name,icon,is_private,mood,default_mode,show_stats_to_others,week_starts_on,theme_preference,is_admin,is_approved)
  values(auth.uid(),clean_name,coalesce(nullif(profile_icon,''),'🙂'),coalesce(profile_is_private,false),nullif(btrim(profile_mood),''),coalesce(profile_default_mode,'challenge'),coalesce(profile_show_stats,true),coalesce(profile_week_starts_on,1),coalesce(profile_theme_preference,'system'),false,false)
  on conflict(id) do update set
    name=coalesce(clean_name,public.profiles.name),
    icon=coalesce(nullif(profile_icon,''),public.profiles.icon),
    is_private=coalesce(profile_is_private,public.profiles.is_private),
    mood=case when profile_mood is null then public.profiles.mood else nullif(btrim(profile_mood),'') end,
    default_mode=coalesce(profile_default_mode,public.profiles.default_mode),
    show_stats_to_others=coalesce(profile_show_stats,public.profiles.show_stats_to_others),
    week_starts_on=coalesce(profile_week_starts_on,public.profiles.week_starts_on),
    theme_preference=coalesce(profile_theme_preference,public.profiles.theme_preference)
  returning * into result;
  return result;
exception when unique_violation then
  raise exception 'That player name is already taken. Choose another one.' using errcode='23505';
end;
$$;

revoke all on function public.save_my_profile(text,text,boolean,text,text,boolean,integer,text) from public;
grant execute on function public.save_my_profile(text,text,boolean,text,text,boolean,integer,text) to authenticated;
