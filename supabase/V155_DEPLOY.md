# Deploy v155

Run `migration_v155_complete_hidden_player_privacy.sql` once in the Supabase
SQL Editor after v154.

This migration makes an administrator-hidden account absent from all player
and community surfaces, including when the viewer is an administrator. The
only exception is **Admin → Players**, which uses the dedicated
`admin_list_players()` RPC so an administrator can show or manage the account.

This does not change the player-controlled **Private profile** setting:

- **Hidden** is an administrator moderation setting. The account disappears
  from community stats, discovery, presence, teams, challenge summaries and
  live Animal Rush data.
- **Private profile** is a player choice. It hides presence and removes the
  player from discovery and invitations, but does not remove their community
  level or lifetime-points row from Player Stats.
- **Show my stats to others** separately controls detailed daily game results.

After the SQL succeeds, reload the app and verify with an administrator and a
normal player account:

1. Hide a test player in **Admin → Players**.
2. Confirm the player is absent from Player Stats, Chats, teams and online
   presence for both accounts.
3. Confirm the player remains visible only in **Admin → Players**.
4. Show the player again and confirm normal visibility returns.
