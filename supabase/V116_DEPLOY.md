# V116 calibrated time benchmarks

Run `migration_v116_calibrated_time_benchmarks.sql` once in the Supabase SQL
Editor after v115.

The migration:

- creates provisional time benchmarks for every game, weekday and mode;
- calculates the 90-day median from clean results (`hints = 0`,
  `mistakes = 0`);
- blends the provisional benchmark with real data using a prior weight of 20;
- recalibrates the relevant benchmark whenever points are awarded;
- uses the effective per-day benchmark for fast/average time bonuses and slow
  time penalties; and
- stores the benchmark, median and sample count in the points transaction
  metadata for later auditing.

No frontend environment-variable or Cloudflare setting changes are required.
