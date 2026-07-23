# v68

## Requested
- Challenge mode's weekly-calendar screen now renders inside the same rounded white panel (shadow, border, heading treatment) used by the actual game screens, so it matches Practice mode's look and feel instead of sitting as loose rows on the grey page background.
- Points transfers now notify the recipient: a badge appears under the account bubble on login, the "My progress" menu item gets its own "· new" badge, and My Progress shows a dismissible banner naming who sent the points and how many. Clears automatically once My Progress has been opened.

## Also fixed while reviewing
- Added a top-level React error boundary (`src/ErrorBoundary.jsx`) plus a per-game one — a crash in one puzzle no longer white-screens the whole app; it now drops the player back to Home with a "Try again" option.
- Code-split all five games and the less-frequent screens (Teams, Stats, Progress, Feedback, What's New, Admin*) via `React.lazy`/`Suspense` — first-load bundle dropped from ~675KB to ~433KB.
- Fixed an unguarded `JSON.parse` on localStorage in the completed-feedback notification hook that could throw on corrupted data.
- Restored pinch-to-zoom (removed `user-scalable=no`/`maximum-scale=1.0`) — disabling it is a WCAG 1.4.4 accessibility violation for low-vision users.
- Fixed the account-bubble notification dot to show the count relevant to the viewer's role (open tickets for admins, their own updates for everyone else) instead of always showing the admin count.
- Menu items in the account dropdown are now keyed by a stable id instead of their (sometimes badge-dependent) label, so a badge count changing no longer replays that item's pop-in animation.
