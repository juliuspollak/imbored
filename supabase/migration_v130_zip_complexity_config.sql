-- Configurable ZIP daily complexity v130
--
-- Seven entries are stored in Monday-to-Sunday order. Existing values match
-- the former hardcoded game defaults, so applying this migration does not
-- unexpectedly change today's puzzle.

alter table public.game_config
  add column if not exists zip_grid_sizes integer[] not null
    default array[7,7,7,7,7,7,7],
  add column if not exists zip_checkpoint_counts integer[] not null
    default array[4,6,8,10,12,14,16],
  add column if not exists zip_wall_counts integer[] not null
    default array[0,1,2,3,5,6,7],
  add column if not exists zip_black_hole_counts integer[] not null
    default array[0,0,0,0,0,0,0],
  add column if not exists zip_tunnel_pair_counts integer[] not null
    default array[0,0,0,0,0,1,1];

alter table public.game_config
  drop constraint if exists game_config_zip_grid_sizes_check,
  drop constraint if exists game_config_zip_checkpoint_counts_check,
  drop constraint if exists game_config_zip_wall_counts_check,
  drop constraint if exists game_config_zip_black_hole_counts_check,
  drop constraint if exists game_config_zip_tunnel_pair_counts_check;

alter table public.game_config
  add constraint game_config_zip_grid_sizes_check
    check(cardinality(zip_grid_sizes)=7 and 4<=all(zip_grid_sizes) and 9>=all(zip_grid_sizes)),
  add constraint game_config_zip_checkpoint_counts_check
    check(cardinality(zip_checkpoint_counts)=7 and 2<=all(zip_checkpoint_counts) and 30>=all(zip_checkpoint_counts)),
  add constraint game_config_zip_wall_counts_check
    check(cardinality(zip_wall_counts)=7 and 0<=all(zip_wall_counts) and 30>=all(zip_wall_counts)),
  add constraint game_config_zip_black_hole_counts_check
    check(cardinality(zip_black_hole_counts)=7 and 0<=all(zip_black_hole_counts) and 20>=all(zip_black_hole_counts)),
  add constraint game_config_zip_tunnel_pair_counts_check
    check(cardinality(zip_tunnel_pair_counts)=7 and 0<=all(zip_tunnel_pair_counts) and 4>=all(zip_tunnel_pair_counts));
