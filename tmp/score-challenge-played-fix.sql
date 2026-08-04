-- Adds the batched lookup behind the chat bubble, so a Beat my score
-- invitation you have already played renders as played instead of showing
-- a live Play now button that then rejects the tap.
--
-- Extracted verbatim from supabase/schemas/public.sql. Safe to re-run.

begin;

CREATE OR REPLACE FUNCTION public.get_my_played_score_challenges(source_stat_ids bigint[]) RETURNS TABLE(source_stat_id bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select challenge.source_stat_id
  from public.score_challenges challenge
  join public.score_challenge_recipients recipient
    on recipient.challenge_id=challenge.id
  where recipient.recipient_id=auth.uid()
    and recipient.completed_stat_id is not null
    and challenge.source_stat_id=any(source_stat_ids)
$$;

revoke all on function public.get_my_played_score_challenges(bigint[]) from public;
grant execute on function public.get_my_played_score_challenges(bigint[]) to authenticated;

notify pgrst,'reload schema';

commit;
