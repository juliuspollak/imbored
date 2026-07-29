-- v176: Let an approver delete their circle, and stop the same person from
-- accidentally creating two circles with the same name. Run after v175.

begin;

create or replace function public.create_guardian_circle(circle_name text)
returns bigint language plpgsql security definer set search_path=public as $$
declare new_id bigint; clean_name text:=trim(circle_name);
begin
  if nullif(clean_name,'') is null then raise exception 'Name is required'; end if;
  if exists(
    select 1 from guardian_circles c
    join guardian_circle_members m on m.circle_id=c.id
    where m.user_id=auth.uid() and lower(c.name)=lower(clean_name)
  ) then
    raise exception 'You already have a circle named "%".', clean_name;
  end if;
  insert into guardian_circles(name,created_by) values(clean_name,auth.uid()) returning id into new_id;
  insert into guardian_circle_members(circle_id,user_id,can_approve) values(new_id,auth.uid(),true);
  return new_id;
end; $$;
revoke all on function public.create_guardian_circle(text) from public;
grant execute on function public.create_guardian_circle(text) to authenticated;

create or replace function public.delete_guardian_circle(target_circle_id bigint)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not is_circle_approver(target_circle_id,auth.uid()) then
    raise exception 'Only an approver of this circle can delete it.' using errcode='42501';
  end if;
  if exists(select 1 from rewards where circle_id=target_circle_id) then
    raise exception 'This circle still has reward items — remove or reassign them first.';
  end if;
  delete from guardian_circles where id=target_circle_id;
end; $$;
revoke all on function public.delete_guardian_circle(bigint) from public;
grant execute on function public.delete_guardian_circle(bigint) to authenticated;

notify pgrst,'reload schema';
commit;
