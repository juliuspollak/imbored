-- v185: migration_v184 fixed attach_reset_challenge_credit() (an AFTER
-- INSERT trigger) but missed a second, independent offender:
-- validate_game_stat_actor() is a BEFORE INSERT trigger on game_stats,
-- defined once in migration_v85 and never touched by migration_v181's
-- team->circle rename because its own name doesn't contain "team" either.
-- It fires before attach_reset_challenge_credit ever runs, so fixing only
-- the AFTER INSERT trigger in v184 was not enough - every game_stats
-- insert still hit:
--   record "new" has no field "team_challenge_id"

create or replace function public.validate_game_stat_actor()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_approved_user(auth.uid()) then
    raise exception 'Your account must be approved first.' using errcode='42501';
  end if;
  if new.user_id is distinct from auth.uid() then
    raise exception 'You can only save your own result.' using errcode='42501';
  end if;
  if new.circle_challenge_id is null then new.circle_id:=null; end if;
  return new;
end;
$$;

notify pgrst,'reload schema';
