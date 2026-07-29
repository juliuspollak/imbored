-- v175: Let a circle approver cancel a pending invitation they (or another
-- approver) sent. Run after v174.

begin;

alter table public.guardian_circle_invitations drop constraint if exists guardian_circle_invitations_status_check;
alter table public.guardian_circle_invitations add constraint guardian_circle_invitations_status_check
  check (status in ('pending','accepted','declined','cancelled'));

create or replace function public.cancel_circle_invitation(target_invitation_id bigint)
returns void language plpgsql security definer set search_path=public as $$
declare item guardian_circle_invitations;
begin
  select * into item from guardian_circle_invitations where id=target_invitation_id and status='pending' for update;
  if not found then raise exception 'Invitation is no longer pending.'; end if;
  if not is_circle_approver(item.circle_id,auth.uid()) then
    raise exception 'Only an approver of this circle can cancel an invitation.' using errcode='42501';
  end if;
  update guardian_circle_invitations set status='cancelled',decided_at=now() where id=item.id;
end; $$;
revoke all on function public.cancel_circle_invitation(bigint) from public;
grant execute on function public.cancel_circle_invitation(bigint) to authenticated;

notify pgrst,'reload schema';
commit;
