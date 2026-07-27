# Animal Rush v149 deployment

Run `migration_v149_animal_rush_start_sequence.sql` in Supabase SQL Editor
before deploying the v149 web application.

The migration safely replaces the existing match-start function. It gives the
first round six seconds in total: a synchronised 3–2–1 match introduction,
followed by the normal three-second animal die roll. Later rounds remain
unchanged.
