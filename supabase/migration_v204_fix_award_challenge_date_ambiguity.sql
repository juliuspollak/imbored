-- v204: Fix Challenge point awards failing because the local challenge_date
-- variable in award_game_points collided with game_stats.challenge_date.
--
-- Keep this as a forward migration because v165 may already be installed.
-- Rebuild its current function definition after making the three precise
-- identifier substitutions. Assertions make the migration fail safely if the
-- installed definition is not the expected version.

begin;

do $migration$
declare
  function_definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'public.award_game_points(bigint)'::regprocedure
  ) into function_definition;

  -- Fresh installations include the corrected v165 source already.
  if strpos(function_definition, E'\n  effective_challenge_date date;')>0
    and strpos(function_definition, E'\n  effective_challenge_date:=coalesce(')>0
    and strpos(function_definition, ')=effective_challenge_date;')>0 then
    return;
  end if;

  if strpos(function_definition, E'\n  challenge_date date;')=0
    or strpos(function_definition, E'\n  challenge_date:=coalesce(')=0
    or strpos(function_definition, ')=challenge_date;')=0 then
    raise exception
      'award_game_points has an unexpected definition; v204 was not applied';
  end if;

  updated_definition:=replace(
    function_definition,
    'challenge_date date;',
    'effective_challenge_date date;'
  );
  updated_definition:=replace(
    updated_definition,
    'challenge_date:=coalesce(',
    'effective_challenge_date:=coalesce('
  );
  updated_definition:=replace(
    updated_definition,
    ')=challenge_date;',
    ')=effective_challenge_date;'
  );

  execute updated_definition;
end;
$migration$;

revoke all on function public.award_game_points(bigint) from public;
grant execute on function public.award_game_points(bigint) to authenticated;

notify pgrst,'reload schema';

commit;
