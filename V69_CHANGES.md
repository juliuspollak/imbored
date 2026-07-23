# v69 — bugfix round

Eight reported issues, all traced to root cause and fixed.

## 1) Poking another player did nothing
Root cause: `useOnlinePlayers.js` only filtered out `is_private` profiles, not
admin-`hidden_from_others` ones. Regular players never saw a hidden player
in the "online" widget (RLS already nulls out their embedded profile), but
**admins** can see hidden profiles by design (so they can manage them) — so
an admin-hidden player still showed up as "online" and pokeable to an admin.
Clicking poke then hit a real server-side RLS block (you can't poke someone
you can't see), but `sendPoke()` discarded that error silently, so it looked
like poking was broken in general rather than correctly blocked for one
specific hidden target.
- `useOnlinePlayers.js` now also filters `hidden_from_others`.
- `sendPoke()` / `OnlineWidget.handlePoke` now return and check the error,
  so a failed poke no longer shows a false "Poked!" confirmation.

## 2) Feedback "Save" did nothing after editing
None of Feedback.jsx's six mutating actions (submit, edit, vote, close,
reopen, delete/restore) checked the Supabase response for an error — any
failure (RLS, network, anything) looked identical to success: the UI just
silently didn't update. Added a dismissible error/success banner and proper
error checks across all six actions.

## 3) Geo shows a red square after tapping a place
The interactive SVG map shapes only disabled the outline for `:focus-visible`,
not the plain `:focus` state, so a tap could leave the browser's native
rectangular focus ring visible around the (non-rectangular) shape. `outline:
none` is now set unconditionally, with the nice blue glow reserved for real
keyboard focus only.

## 4) Tango hint doesn't say sun or moon
Confirmed: the hint only pulsed a colored border around a cell — it never
showed which symbol belonged there, even though the code already knows the
solution. Cells now show a faint ghost sun/moon icon for an empty hinted
cell, or a small corner badge for a hinted cell that already has the wrong
symbol in it.

## 5) Hint cooldown isn't enforced
Two real gaps found and fixed, though this couldn't be fully verified
without access to the live database:
- `game_config` had a SELECT and an UPDATE policy but no INSERT policy, so
  saving a setting for any game without a pre-existing config row would
  silently fail via the upsert. Added `migration_game_config_insert_policy.sql`.
- `AdminGames.jsx` never checked the upsert's error, so the admin UI looked
  successful either way. It now rolls back and reports the failure.

## 6) Practice/Challenge selection resets on refresh
Confirmed: the mode was pure in-memory React state, and on every fresh page
load it re-applied `profile.default_mode`, discarding whatever the player
had actually picked in their last session. The real last-chosen mode is now
cached per-user in localStorage and takes priority; the profile default only
seeds a brand-new session that's never made an explicit choice yet.

## 7) New-feedback balloon is hard to read on small screens
The badged menu item used `rgba(139,92,246,0.08)` — 8% opacity — as its
background, so whatever page content sat behind the floating menu showed
through and fought with the label text. Swapped for an opaque light tint.

## 8) Hidden player counted as online
Same root cause and fix as (1).
