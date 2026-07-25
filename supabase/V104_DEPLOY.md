# v104 feedback completion notifications

Run `migration_v104_feedback_completion_notifications.sql` in the Supabase SQL
Editor.

Completing feedback then atomically creates an unread Feedback badge and a
single system chat notification for its author. Tapping the chat notification
opens Feedback. Reopening removes the stale notification; completing it again
creates a fresh unread update.

No Edge Function deployment or new secret is required.
