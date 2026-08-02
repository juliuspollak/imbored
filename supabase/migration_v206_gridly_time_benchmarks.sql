-- v206: Gridly is played by drawing one continuous path, so its original
-- 75–260 second provisional times were far above real completion times. The
-- old prior also counted as 20 imaginary players, keeping the displayed
-- benchmark unrealistic even after genuine results arrived.

begin;

with corrected(day_index,seconds) as (
  values (0,12),(1,14),(2,16),(3,18),(4,22),(5,26),(6,30)
)
update public.game_time_benchmarks benchmark
set provisional_seconds=corrected.seconds
from corrected
where benchmark.game='gridly'
  and benchmark.day_index=corrected.day_index;

create or replace function public.refresh_game_time_benchmark(
  target_game text,
  target_day_index integer,
  target_mode text
)
returns public.game_time_benchmarks
language plpgsql
security definer
set search_path=public
as $$
declare
  sample_count integer:=0;
  median_seconds numeric;
  benchmark public.game_time_benchmarks;
  -- Preserve the established smoothing for other games. Gridly's robust
  -- median needs only a small prior because its original estimate was wrong.
  prior_weight integer:=case when target_game='gridly' then 3 else 20 end;
begin
  select count(*),
         percentile_cont(0.5) within group(order by stat.seconds)
  into sample_count,median_seconds
  from public.game_stats stat
  where stat.game=target_game
    and stat.day_index=target_day_index
    and stat.mode=target_mode
    and stat.completed_at>=now()-interval '90 days'
    and stat.seconds between 5 and 3600
    and stat.hints=0
    and stat.mistakes=0;

  update public.game_time_benchmarks current_benchmark
  set observed_median_seconds=median_seconds,
      clean_sample_count=sample_count,
      effective_seconds=case
        when sample_count=0 or median_seconds is null
          then current_benchmark.provisional_seconds
        else round(
          (prior_weight*current_benchmark.provisional_seconds
            + sample_count*median_seconds)
          /(prior_weight+sample_count)
        )
      end,
      updated_at=now()
  where current_benchmark.game=target_game
    and current_benchmark.day_index=target_day_index
    and current_benchmark.mode=target_mode
  returning * into benchmark;

  return benchmark;
end;
$$;

do $$
declare
  item public.game_time_benchmarks;
begin
  for item in
    select * from public.game_time_benchmarks where game='gridly'
  loop
    perform public.refresh_game_time_benchmark(
      item.game,item.day_index,item.mode
    );
  end loop;
end;
$$;

revoke all on function public.refresh_game_time_benchmark(text,integer,text)
  from public;

notify pgrst,'reload schema';

commit;
