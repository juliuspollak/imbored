# v154 deployment

Run `migration_v154_animal_rush_colour_modes.sql` in Supabase SQL Editor after
the earlier Animal Rush migrations.

This adds a room-level animal colour choice controlled by the host. The value
is stored on the live room, delivered through the existing realtime room
updates and used by every phone for both the die and cards. New attempt-history
rows also record the colour mode so reaction times can be compared later.
