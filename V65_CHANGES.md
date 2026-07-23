# v65 changes

- Zip no longer counts normal route exploration, backtracking, or alternative-path testing as mistakes.
- Replaced the Zip snake face with a clean high-contrast drag handle.
- Fixed Zip solved overlay layering and hides checkpoint numbers after completion.
- Replaced old Home icon+text navigation on updated screens with a compact back arrow.
- Restyled challenge headings to match game title typography.
- Constrained in-game Back and Practice/Challenge controls to the centred game width on large Windows screens.
- Feedback authors can edit their own open items.
- Closing feedback creates an in-app notification badge for its author until Feedback is opened.
- Added Monday/Sunday week-start setting to My Profile and challenge calendar ordering.

Run `supabase/migration_v65_feedback_week_start.sql` before deploying this version.
