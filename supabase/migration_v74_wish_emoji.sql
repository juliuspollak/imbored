-- v74: wish emoji support and updated submitted-wish editor.
alter table public.reward_wishes add column if not exists emoji text not null default '🎁';

create or replace function public.update_submitted_wish(
  target_wish_id bigint,
  new_name text,
  new_product_url text,
  new_note text,
  new_emoji text
)
returns public.reward_wishes
language plpgsql
security definer
set search_path=public
as $$
declare result public.reward_wishes;
begin
  if nullif(btrim(new_name),'') is null then
    raise exception 'Wish name is required';
  end if;

  update public.reward_wishes
  set name=btrim(new_name),
      product_url=nullif(btrim(new_product_url),''),
      note=nullif(btrim(new_note),''),
      emoji=coalesce(nullif(btrim(new_emoji),''),'🎁')
  where id=target_wish_id
    and player_id=auth.uid()
    and status='submitted'
  returning * into result;

  if not found then
    raise exception 'Only submitted wishes can be edited';
  end if;
  return result;
end;
$$;
grant execute on function public.update_submitted_wish(bigint,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
