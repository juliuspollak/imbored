# v153 deployment

Run `migration_v153_hidden_presence_privacy.sql` in Supabase SQL Editor.

This removes the administrator exception from the social presence policy and
immediately deletes a player's presence record when an administrator hides
that profile. Hidden profiles remain available in the dedicated administrator
screen so they can still be managed or restored.
