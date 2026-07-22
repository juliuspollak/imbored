-- One-time backfill: populates "What's New" with the history of what's
-- been built so far, since the board didn't exist for most of it. Run
-- once, after schema.sql and all other migrations.

insert into release_notes (title, body, created_at) values
('Accounts & login', 'Email code sign-in, Google sign-in, and passkey support. No passwords.', now() - interval '14 days'),
('Stats tracking', 'Every solved puzzle records your time, mistakes, and hints — visible on the Stats page.', now() - interval '13 days'),
('Teams', 'Create teams, join multiple at once, add other players, leave anytime. Private profiles can''t be added by anyone but themselves.', now() - interval '12 days'),
('Challenge mode', 'One attempt per puzzle per day, the same puzzle for everyone, locked to real calendar dates. Miss a day? Catch it up later — still one shot each.', now() - interval '10 days'),
('Mood status', 'Set a short status visible to everyone, shown next to your name.', now() - interval '9 days'),
('Post-puzzle difficulty rating', 'Tap a bar after solving to say how it felt — shows the group''s average before you even start.', now() - interval '7 days'),
('Feedback board', 'Suggest ideas, upvote others'' — admin can mark things done with a comment.', now() - interval '6 days'),
('Who''s online', 'See who else has the app open right now, and what they''re playing. Tap someone to send a poke.', now() - interval '5 days'),
('Admin tools', 'Admin can now hide a player from everyone but themselves, enforced at the database level.', now() - interval '1 days'),
('Fixed a login-breaking bug', 'A database policy had a recursion bug that could block sign-in entirely — fixed.', now());
