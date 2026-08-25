-- Keep the persisted game id `binary`, but finish the customer-facing rename
-- in server-generated Messages and notifications. Existing generated messages
-- are updated too so old copy does not remain visible in chat history.
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
    execute replace(function_definition, '''Twist''', '''Binary''');
  end loop;
end;
$$;

update public.direct_messages
set body=replace(body,'Twist','Binary')
where system_generated=true and body like '%Twist%';
