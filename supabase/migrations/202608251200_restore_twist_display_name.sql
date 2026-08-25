-- Keep the persisted game id `binary`, while ensuring every server-generated
-- customer-facing game name is `Twist`. This also repairs system messages if
-- an environment ever received copy containing the internal name `Binary`.
do $$
declare
  function_signature regprocedure;
  function_definition text;
begin
  foreach function_signature in array array[
    'public.create_score_challenge(bigint)'::regprocedure,
    'public.share_puzzle_with_circles(bigint)'::regprocedure,
    'public.notify_circle_daily_challenge_completed()'::regprocedure
  ] loop
    function_definition:=pg_get_functiondef(function_signature);
    execute replace(function_definition, '''Binary''', '''Twist''');
  end loop;
end;
$$;

update public.direct_messages
set body=replace(body,'Binary','Twist')
where system_generated=true and body like '%Binary%';
