# Apple Guideline 1.2 implementation and submission handoff

Prepared 16 September 2026. Changes are local only. No deployment, commit, push, Supabase db push, migration application, or manual production data changes were performed.

## 1. What already existed

- Email OTP registration/sign-in, Apple, Google, passkey, and dedicated App Review credential access.
- Public landing, Support and Privacy pages with routing guards for native startup and auth/deep-link URLs; support@imbored.au.
- Direct messages, fixed message reactions and generated pokes; profiles, Circles, challenge titles/prizes, rewards and shared feedback.
- `report_content`: authenticated, participant-checked message reporting or player reporting, with reporter, subject, message ID, reason, details and database timestamp. It already creates a block atomically with the report.
- `block_player`, `unblock_player`, a persisted block list, and server interaction/visibility rules.
- A chat-header safety menu, Safety & account settings, an admin Reports queue, report resolution/dismissal, administrator account blocking and account deletion.
- No separate external developer alert was needed: safety reports already feed the administrator moderation queue. No email or push notification to developers has been added.

## 2. What was missing

Mandatory explicit Terms acceptance before every sign-in method; a public Terms/EULA page; current-version account consent records and a gate for existing sessions; shared pre-submission filtering with database enforcement; a message-specific report action; removal of reported messages in the admin queue; immediate clearing of cached chat/presence/poke content on block; and clear public 24-hour moderation wording.

## 3. Changes implemented

- An unchecked consent checkbox and Terms/Privacy links precede authentication. The auth fieldset and provider controls are disabled until selected, and all underlying sign-in/OTP verification handlers enforce consent, including App Review access. Signing out or losing the session resets consent.
- Web links open in another tab; native links use Capacitor Browser so the app remains open.
- A Terms gate reads the authenticated account's current consent record. Missing acceptance prompts the user; a current record allows entry across devices. Consent from the active sign-in screen is recorded automatically after authentication. A full-page OAuth redirect loses that in-memory consent, so a user without a server record is asked to confirm it after returning; there is no local-storage shortcut or prechecked box.
- Blocked/deleted account handling takes precedence over the Terms gate. Acceptance cannot change account approval, blocking, deletion or admin status, and its RPC rejects blocked/deleted profiles.
- Shared text checks run before outgoing Supabase REST submissions. Chat also checks before optimistic display and preserves a rejected draft. A new migration installs validation triggers covering direct writes and RPCs.
- Message-level three-dot menus use the existing report RPC with the message ID. Labels explicitly say Report & Block. Plain Block and existing Unblock remain.
- Successful blocking clears the open chat immediately, closes it, removes cached online/poke entries and refreshes mounted social data readers.
- Reports preserve a private message snapshot. Report reading is restricted to administrators. Admins can replace reported message content with `[Removed by moderation]`, while retaining evidence in the report.
- The admin queue shows explicit status and timestamps, marks reports older than 24 hours, and lists open reports oldest first. Removal leaves a report open for the account decision; blocking the offending account uses the existing administration function and resolves the report as actioned.
- Terms, Support and public navigation expose the contact and moderation policy.

## 4. Terms URL

https://imbored.au/terms — implemented locally, not published by this work. Existing public routing guards also preserve `/support`, `/privacy`, OAuth query/hash callbacks, puzzle links and challenge links. Native navigation never selects a public website page at startup.

## 5. New migration

`supabase/migrations/202609161200_ugc_terms_and_moderation.sql`

Existing migrations and the exported schema were not edited. This repository intentionally leaves pending migrations out of the schema snapshot until application.

## 6. Required database and release steps (not performed)

1. Review the new migration. Validate it against a non-production database with the existing schema and preceding migrations present. It uses a transaction, adds `account_terms_acceptances`, `accept_current_terms`, text-validation functions/triggers, a report snapshot column/trigger, an admin removal RPC, and an updated admin queue reader/policy.
2. After that validation and a separately authorized release, execute the exact migration file once through the normal migration process or the Supabase SQL editor. No backfill or manual consent insertion is required. Existing users must consent themselves. Do not publish the new client ahead of this migration: the gate intentionally stays closed if the consent APIs fail.
3. Verify with two test players and one existing administrator: own consent can be read but not written directly; another account's consent is inaccessible; ordinary accounts cannot read report records; invalid UGC fails through both RPC and direct REST writes; blocked/deleted accounts cannot accept; report-and-block creates both records atomically; removal changes the message while preserving report evidence.
4. Publish the website only when authorized so `/terms`, `/support`, and `/privacy` are available before the native release. No new environment variables, third-party moderation service, scheduled jobs or Edge Function deployment are required.
5. For the release build, use the existing native asset sync/package process and test on a physical device. The local Xcode compilation performed here did not synchronize the new web bundle into the native project.
6. Assign a human to check the existing admin Reports queue often enough to meet the 24-hour target and monitor support@imbored.au. No background SLA or developer-email automation was added.
7. Record the physical-device video below, attach it in App Store Connect, and then use the prepared notes/reply. Do not claim the updated build or video has been submitted before doing those steps.

## 7. Exact report/block flows

- **Message:** account menu → Chats → conversation → three dots beside an incoming non-system message → **Report message & block** → choose reason → optional details → **Report & Block**. The existing RPC saves reporter, sender, message ID, category, details and timestamp and blocks the sender in one transaction. The chat closes and its messages are cleared immediately.
- **Player:** conversation header → three dots → **Report & Block** → reason/details → **Report & Block**. Creates a player report and block in the same transaction.
- **Plain block:** conversation header → three dots → **Block this player** → confirmation. Does not create a meaningless abuse report.
- **Unblock:** account menu → **Safety & account** → blocked players → **Unblock**. A report remains in the moderation queue after an unblock.

## 8. Exact filtering scope and logic

`src/lib/textModeration.js` contains the authoritative JavaScript patterns; the migration contains matching individual PostgreSQL patterns. Both normalize compatibility characters, lowercase, remove zero-width characters U+200B–U+200F/U+FEFF and normalize curly apostrophes.

Rules match whole-word severe profanity/slurs (including `fuck*`, `motherfuck*`, `cunt*`, `kurva`, `kokot*` and the explicitly enumerated racial/homophobic slurs); pornographic and sexual-abuse phrases; direct threats such as “I will kill you”, “I'll rape you” and “kill yourself”; repeated “buy now”/“free money”/“click here” phrases; five consecutive HTTP(S) links; or 30 repeated characters. The exact literals are reviewable in the helper and migration. Ordinary words like “kill”, “shoot”, “beat”, “assassin”, normal game discussion, names with incidental substrings, ordinary links and emoji remain allowed.

The client checks relevant fields on outgoing JSON POST/PATCH/PUT requests, including profile name/mood/icon, chat body, Circle name/emoji, challenge title/prize, reward name/description/notes, feedback title/description/admin comment, poke message, and Animal Rush player text. Private reports are deliberately excluded so users can quote abusive evidence. Fixed reactions have no user-entered text. Database triggers cover `direct_messages`, `profiles`, `circles`, `circle_weekly_challenges`, `rewards`, `feedback`, `pokes`, `animal_rush_players`, and `reward_redemptions`. Only changed text is validated on updates, allowing existing abusive content to be moderated or accounts suspended without a text-filter failure.

Rejected content gets a friendly error and is not submitted to the network or saved. These are deterministic first-party text rules, not semantic/image moderation or a complete multilingual classifier; reports and human moderation remain necessary. Existing historical content is not automatically scanned or removed.

## 9. Administrator moderation flow

Sign in as an existing administrator → account menu → **Reports** → **Needs review**. Inspect reporter, reported player, original message/context, reason, details, creation time and status. For a message violation, choose **Remove message**, then **Block player** to suspend the offending account and mark the report actioned. Use **Mark handled** for a completed manual action, or **Dismiss** for a non-violation. Account deletion remains available through the existing administrator account tools. The original message snapshot remains private to moderators; removing a message does not erase the evidence or automatically dismiss the report.

## 10. Files changed

- `docs/apple-review-guideline-1-2.md`
- `src/AdminReports.jsx`
- `src/App.jsx`
- `src/Chat.jsx`
- `src/ChatSafetyMenu.jsx`
- `src/Login.jsx`
- `src/PublicLanding.jsx`
- `src/PublicPrivacy.jsx`
- `src/PublicSupport.jsx`
- `src/PublicTerms.jsx`
- `src/TermsGate.jsx`
- `src/components/AppReviewAccess.jsx`
- `src/components/TermsConsent.jsx`
- `src/lib/AuthContext.jsx`
- `src/lib/pokes.js`
- `src/lib/publicLanding.js`
- `src/lib/realtimeRefresh.js`
- `src/lib/supabase.js`
- `src/lib/terms.js`
- `src/lib/textModeration.js`
- `src/lib/ugcSafety.test.js`
- `src/lib/useOnlinePlayers.js`
- `src/main.jsx`
- `supabase/migrations/202609161200_ugc_terms_and_moderation.sql`

## 11. Verification results

- `npm test`: **254 passed, 0 failed**, including schema/RPC contracts, new consent/filter/report/block/admin/public-route tests and existing Twist (`binary`) regression tests.
- `npm run build`: **passed**. Existing duplicate-key warnings in `src/lib/i18n.jsx` and large-bundle warnings remain.
- `git diff --check`: **passed**.
- Xcode Debug simulator compilation: **BUILD SUCCEEDED**, using `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,id=45FDA79C-787C-4366-974E-5D07B76934CD' -derivedDataPath /tmp/imbored-ugc-derived CODE_SIGNING_ALLOWED=NO build`.
- Native routing is covered by regression tests. Simulator runtime interaction and a physical-device recording were not performed. The native compilation validates the existing native shell; use the normal asset sync before a device test of the changed UI.
- The migration was not executed. SQL/security contracts were inspected and asserted in tests, not verified against a running database. Staging verification remains required.

## 12. Physical-device recording steps

Use an actual iPhone with the updated, synchronized build after the separately authorized migration/website release. Use dedicated test players with a shared Circle and a pre-existing harmless chat message; do not send real abusive content just to make the video.

1. Start iOS Screen Recording. Show the device launching imBored, signed out.
2. Pause on the visible unchecked Terms checkbox. Show that Apple, Google, email OTP, passkey (when supported), and App Review access are disabled.
3. Open **Terms of Use**. Show the zero-tolerance list, suspension/removal policy, reporting/blocking instructions, 24-hour target and support email. Close the browser; open **Privacy Policy**, then return.
4. Tick **I agree to the Terms of Use and Privacy Policy**. Show sign-in controls becoming enabled. Sign in with the dedicated review credentials or another test method, keeping credentials/code out of the recording. Complete any current-Terms confirmation after an OAuth redirect.
5. Open account menu → **Chats** → a test conversation. Tap the three dots beside an incoming message. Choose **Report message & block**, choose a category, add “App Review demonstration using a test account”, then **Report & Block**.
6. Show that the conversation closes and the player/content disappears from the available chat list.
7. Open **Safety & account** and show the persisted blocked player. If demonstrating plain Block on the same player, unblock them first; alternatively use a second test player.
8. Open the test player's conversation → header three dots → **Block this player** → confirmation. Show the conversation disappearing and the block appearing in settings. Optionally show the player-level **Report & Block** option before blocking.
9. Stop recording. Attach the physical-device recording to the review response. Separately verify the test report is visible in the admin queue, then handle the clearly labelled demonstration report appropriately.

## 13. App Review Notes — paste after release verification

imBored requires explicit agreement to the Terms of Use and Privacy Policy before registration or sign-in. On the initial sign-in screen, all authentication options are disabled until the unchecked agreement box is selected. The links open the public Terms/EULA (https://imbored.au/terms) and Privacy Policy (https://imbored.au/privacy). Existing signed-in users without current acceptance are prompted before continuing.

The Terms state zero tolerance for objectionable content and abusive users. Text filtering runs before submission and is enforced in the database for shared text, including chat, profiles, Circles, Challenges, rewards and feedback.

To report a message: account menu → Chats → open a conversation → three-dot menu beside an incoming message → Report message & block → select a reason → Report & Block. To report a player, use the three-dot menu in the conversation header → Report & Block. Reporting creates a private moderation report and blocks the player immediately, clearing their chat. A separate Block this player option is also available in the header menu. Blocked players can be managed under Safety & account.

Safety reports reach the administrator Reports queue. We review valid safety reports as quickly as possible, targeting within 24 hours, and act on violations by removing offending content and suspending or removing offending users. Public support: https://imbored.au/support. Contact: support@imbored.au.

Use the dedicated review credentials supplied in App Store Connect through App Review access, after accepting the Terms. The attached physical-device recording demonstrates Terms acceptance, message reporting, and blocking.

## 14. Reply to Apple's rejection — paste after attaching the recording

Thank you for the feedback on Guideline 1.2. We have added mandatory Terms/EULA acceptance before every registration or sign-in method, with an explicit zero-tolerance policy for objectionable content and abusive users. We have added pre-submission and database text filtering, message-level Report & Block controls, and moderation tools to remove reported messages. Report & Block immediately hides the chat, persists the block and creates a private report for developer review. Valid safety reports are reviewed as quickly as possible, targeting within 24 hours, with violating content removed and offending users suspended or removed. Our published contact is support@imbored.au at https://imbored.au/support, and the Terms are at https://imbored.au/terms. We have attached a recording made on a physical iPhone demonstrating the Terms, report and block flows. Detailed navigation instructions are included in App Review Notes.
