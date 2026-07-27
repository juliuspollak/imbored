-- Fix hard-reset level calculation type v132
--
-- PostgreSQL returns numeric from SUM(bigint). V131 now casts that aggregate
-- before calling points_level(bigint). This overload also repairs databases
-- where the original V131 function has already been installed, without
-- requiring the migration to be edited or rolled back.

create or replace function public.points_level(total numeric)
returns integer
language sql
immutable
as $$
  select greatest(
    1,
    floor(sqrt(greatest(total,0) / 500))::integer + 1
  );
$$;

grant execute on function public.points_level(numeric) to authenticated;
