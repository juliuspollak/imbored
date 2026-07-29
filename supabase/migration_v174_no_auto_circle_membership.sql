-- v174: No one should be automatically in a circle. The v170 backfill added
-- every profile to a "Default" circle (admins/stewards as approvers,
-- everyone else as plain members) so pre-existing reward items didn't need
-- re-approval. That default membership was too broad — going forward,
-- circle membership should only ever come from an explicit invite.
--
-- Keep each pre-existing item's original creator as the Default circle's
-- only remaining member, so nothing already live becomes inaccessible to
-- whoever made it, but remove everyone else's auto-added membership.
-- Run after v173.

begin;

delete from public.guardian_circle_members m
where m.circle_id in (select id from public.guardian_circles where name='Default')
  and m.user_id not in (
    select distinct rw.created_by
    from public.rewards rw
    where rw.circle_id=m.circle_id and rw.created_by is not null
  );

commit;
