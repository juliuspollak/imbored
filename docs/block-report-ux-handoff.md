# Block/report UX handoff

Local changes only. No deployment, commit, push, Supabase db push or database changes. No migration is needed for this UX update; the existing block/report RPCs are reused.

## Architecture and preserved behavior

- Personal blocks: `public.player_blocks`, keyed by `blocker_id` and `blocked_id`. The existing `block_player`, `unblock_player` and `get_my_blocked_players` RPCs manage them.
- Reports: `public.content_reports`. `report_content` inserts the report and personal block in one transaction. An error rolls back the transaction; the UI announces success only after a successful response.
- Messages: `public.direct_messages`. Blocking hides chat history through row security and `get_messageable_players`/`can_continue_conversation`; it does not delete messages. The open chat also clears its local message list and closes immediately.
- Unblock: deletes only the current user's personal block. Existing history becomes eligible to appear again when Chats reloads. A block in the opposite direction still applies, as do existing visibility and messaging restrictions. No chat history is fabricated or restored. Content removed by moderation stays removed.
- Independence: `admin_resolve_content_report` only updates report status/reviewer metadata. `unblock_player` only deletes a personal block. Neither changes the other's state. Marking Handled still does not unblock anyone; unblocking does not dismiss or resolve a report.

## User-facing changes

- A persistent success banner survives the chat closing. It can be dismissed explicitly; it does not disappear on a timer.
- The banner includes a **Blocked users** shortcut that opens Account Safety directly.
- The account menu now has a visible **Safety & account** entry. The existing section in My Profile remains available.
- Blocked users displays avatar, name, **Blocked** status and **Unblock**. No report details are shown.
- Successful unblock immediately removes the row and announces success, then broadcasts a refresh to mounted chat, presence and unread-count readers. Reads already in progress queue another refresh so they cannot drop that request. New visits load the persisted server list.
- Pending block/report requests prevent duplicate submission or closing the safety dialog. RPC errors and thrown network failures show errors without announcing success.
- Unblock actions show loading, prevent overlapping actions, preserve the row on failure, and offer a list reload after errors. Stale list responses are ignored after successful unblock.
- Safety menu controls, reason rows and unblock actions have at least 44px touch targets. Unblock labels include the player's name; success and error messages are announced accessibly. Shortcut and dismiss controls are separate buttons, not nested buttons.
- Admin Reports now explains: **Handling this report does not unblock the user. Personal blocks are managed by the person who created them.**
- New user-facing copy is provided in English and Slovak.

## Exact English copy

- Report and Block: **User reported and blocked.**
- Plain Block: **User blocked.**
- Banner guidance: **You can manage blocked users in Safety & account.**
- Successful Unblock: **User unblocked.**
- Section: **Blocked users**
- Row status: **Blocked**
- Empty state: **No blocked users**
- Management explanation: **Your blocks are separate from report status. Handling a report does not unblock anyone. Unblocking allows existing chats to reappear if no other restrictions apply; it does not restore removed messages.**

## Exact navigation

Account/avatar menu → **Safety & account** → **Blocked users** → **Unblock**.

Also available directly through **Blocked users** in the success banner, or through My Profile's existing Safety & account section.

## Verification

- `npm test`: 263 passed, 0 failed. New tests cover confirmed versus failed report/block requests, persistent confirmation placement, list presentation, unblock/removal/reread behavior, independent report and block SQL contracts, reciprocal blocks, existing-history visibility and immediate refresh wiring.
- `npm run build`: passed. Existing i18n duplicate-key and large-chunk warnings remain.
- `git diff --check`: passed.
- iOS simulator compilation: **BUILD SUCCEEDED**, using the App workspace/scheme, Debug configuration, generic iOS Simulator destination, `CODE_SIGNING_ALLOWED=NO`, and derived data in `/tmp/imbored-block-derived`. No physical-device interactions or production-backed report/unblock tests were performed. The automated persistence tests use a simulated server plus assertions against the existing SQL contracts.
- Native compilation checks the existing iOS project; it does not synchronize the new web assets. Use the existing sync/package process when preparing the physical-device build.

## Files changed

- `src/AccountSafety.jsx`
- `src/AdminReports.jsx`
- `src/App.jsx`
- `src/ChatSafetyMenu.jsx`
- `src/components/SafetyNotice.jsx`
- `src/lib/i18n.jsx`
- `src/lib/realtimeRefresh.js`
- `src/lib/useSupabaseWatchedState.js`
- `src/lib/safetyActions.js`
- `src/lib/blockManagement.test.js`
- `docs/block-report-ux-handoff.md`

## Exact physical-device recording sequence

Use an actual iPhone with the updated packaged web assets and two dedicated test players who already have a conversation. The second player must not have independently blocked the recording account. Use a harmless test message and identify the report as an App Review demonstration.

1. Start iOS Screen Recording. Open imBored → account menu → **Chats** → the test conversation.
2. Tap the three dots beside an incoming message → **Report message & block**. Select **Spam or scam**, add “App Review demonstration using test accounts”, then tap **Report & Block**.
3. Show the chat closing and the persistent **User reported and blocked.** banner, including the management guidance. Show that the conversation is absent from Chats.
4. Tap **Blocked users** in the banner. Show **Safety & account → Blocked users**, with the test person's avatar, name, **Blocked** status and **Unblock** action.
5. Tap **Unblock**. Show its loading state, then **User unblocked.** and the row disappearing. If this was the only block, show **No blocked users**.
6. Leave and reopen account menu → **Safety & account** to demonstrate that the unblocked state persists.
7. Open account menu → **Chats**. Show the old conversation returning from its existing history. Do not expect content previously removed by moderation to return.
8. Optional independent-status demonstration: report/block the test player again, have an administrator mark the report **Handled**, then refresh **Blocked users**. Show that the player remains blocked until the recording user explicitly taps **Unblock**.
9. Stop recording and attach the physical-device video to the App Review response. Handle the clearly labelled test report appropriately in the existing moderation queue.
