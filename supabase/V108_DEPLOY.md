# v108 recipient-only system messages

Run `migration_v108_recipient_only_system_messages.sql` in the Supabase SQL
Editor.

System-generated notifications are then readable only by their recipient.
Their technical sender no longer sees them as private chat messages.

No Edge Function deployment or new secret is required.
