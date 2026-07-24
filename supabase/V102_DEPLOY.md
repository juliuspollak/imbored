# v102 backend deployment

Run `migration_v102_approval_notifications.sql` in Supabase SQL Editor.

This creates one unread system chat notification for every admin when a player
finishes profile setup and is waiting for approval. Existing pending players
are backfilled. Opening that notification takes the admin directly to Players,
and approval removes the system conversation.

The pending-player screen itself needs no database polling: it now listens to
the existing `profiles` realtime publication added by v99.
