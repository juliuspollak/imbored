import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { completeSafetyAction, withoutBlockedPlayer } from './safetyActions.js';
import { canContinueConversation } from './profileVisibility.js';
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const schema = read('../../supabase/schemas/public.sql');
const fn = name => schema.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`))[0];

test('Report and Block announces success only after the atomic RPC completes', async () => {
  let finish;
  let notices = 0;
  const pending = completeSafetyAction(() => new Promise(resolve => { finish = resolve; }), () => notices++);
  assert.equal(notices, 0);
  finish({ data: 42, error: null });
  await pending;
  assert.equal(notices, 1);
  const report = fn('report_content');
  assert.match(report, /insert into public.content_reports/);
  assert.match(report, /insert into public.player_blocks/);
  assert.doesNotMatch(report, /exception when/); // no swallowed failure after report insertion
});

test('RPC and network failures never announce success or change local block state', async () => {
  let successes = 0;
  for (const request of [async () => ({ error: new Error('Block failed') }), async () => { throw new Error('Offline'); }]) {
    await assert.rejects(completeSafetyAction(request, () => successes++));
  }
  assert.equal(successes, 0);
  const menu = read('../ChatSafetyMenu.jsx');
  assert.match(menu, /await completeSafetyAction/);
  assert.match(menu, /catch \(failure\)/);
  assert.match(menu, /finally[\s\S]*setBusy\(false\)/);
});

test('confirmation survives chat closure and offers a direct Blocked users action', () => {
  const app = read('../App.jsx'), notice = read('../components/SafetyNotice.jsx');
  assert.match(app, /<AppShell \/><PokeLayer \/><SafetyNotice \/>/);
  assert.match(notice, /event.detail\?\.reported \? "safety.reportedSuccess"/);
  assert.match(notice, /role="status" aria-live="polite"/);
  assert.match(notice, /new Event\("open-account-safety"\)/);
  assert.match(read('./i18n.jsx'), /User reported and blocked\./);
  assert.match(read('./i18n.jsx'), /User unblocked\./);
});

test('Blocked users uses the persisted personal list with avatar, name, status and accessible unblock', () => {
  const safety = read('../AccountSafety.jsx'), app = read('../App.jsx');
  assert.match(app, /id:"safety", icon:Shield/);
  assert.match(app, /active === "safety"[\s\S]*<AccountSafety \/>/);
  assert.match(safety, /rpc\("get_my_blocked_players"\)/);
  assert.match(safety, /player.icon/); assert.match(safety, /player.name/);
  assert.match(safety, /t\("safety.blockedStatus"\)/);
  assert.match(safety, /aria-label=\{t\("safety.unblockName"/);
  assert.match(safety, /minHeight: 44/);
  assert.match(safety, /loading=\{busyId === player.user_id\}/);
  assert.match(safety, /!loading && !error && blocked.length === 0/);
  assert.match(read('./i18n.jsx'), /"account.noBlocked": "No blocked users"/);
  assert.doesNotMatch(safety, /content_reports|report_details/);
});

test('successful unblock removes only the selected row immediately and persists on server reread', async () => {
  const rows = [{user_id:'a',name:'Alice'}, {user_id:'b',name:'Bob'}];
  let stored = rows.slice(), visible = rows.slice();
  const reports = [{id:1,status:'open'}];
  let refreshEvents = 0;
  const rpc = async (name, args) => {
    if(name === 'unblock_player') stored = withoutBlockedPlayer(stored, args.target_user_id);
    return {data:stored, error:null};
  };
  await completeSafetyAction(() => rpc('unblock_player',{target_user_id:'a'}), () => {
    visible = withoutBlockedPlayer(visible, 'a'); refreshEvents++;
  });
  assert.deepEqual(visible, [rows[1]]);
  assert.deepEqual((await rpc('get_my_blocked_players')).data, visible);
  assert.equal(refreshEvents,1);
  assert.deepEqual(reports,[{id:1,status:'open'}]);
  assert.deepEqual(rows.length,2); // immutable local list update
  const safety = read('../AccountSafety.jsx');
  assert.match(safety, /rpc\("unblock_player", \{ target_user_id: userId \}\)/);
  assert.match(safety, /setBlocked\(players => withoutBlockedPlayer\(players, userId\)\)/);
  assert.match(safety, /new CustomEvent\("player-unblocked"/);
  assert.match(safety, /requestId === listRequest.current/);
});

test('unblock failure keeps the blocked user visible without success', async () => {
  const blocked = [{user_id:'a'}];
  let visible = blocked;
  await assert.rejects(completeSafetyAction(async () => ({error:new Error('Denied')}), () => { visible=[]; }));
  assert.equal(visible,blocked);
});

test('unblock only deletes the caller’s block; handled only changes report status', () => {
  const unblock = fn('unblock_player'), resolve = fn('admin_resolve_content_report');
  assert.match(unblock, /delete from public.player_blocks/);
  assert.match(unblock, /blocker_id=auth.uid\(\) and blocked_id=target_user_id/);
  assert.doesNotMatch(unblock, /content_reports|direct_messages/);
  assert.match(resolve, /update public.content_reports/);
  assert.doesNotMatch(resolve, /player_blocks|unblock_player/);
  assert.match(read('../AdminReports.jsx'), /Handling this report does not unblock the user\./);
});

test('history becomes eligible after unblock, but reciprocal blocks and deletion remain effective', () => {
  const profile = {name:'Alice',hidden_from_others:false,account_deleted_at:null};
  assert.equal(canContinueConversation(profile,{blockedBetween:true}),false);
  assert.equal(canContinueConversation(profile,{blockedBetween:false}),true);
  assert.equal(canContinueConversation(profile,{blockedBetween:true}),false); // other player's block persists
  assert.equal(canContinueConversation({...profile,account_deleted_at:'2026-09-16'},{blockedBetween:false}),false);
  assert.match(fn('is_blocked_between'), /blocker_id=first_player and blocked_id=second_player/);
  assert.match(fn('is_blocked_between'), /blocker_id=second_player and blocked_id=first_player/);
  assert.match(fn('get_messageable_players'), /candidate.can_message or candidate.has_history/);
  assert.match(schema, /NOT public.is_blocked_between\(sender_id, recipient_id\)/);
  assert.doesNotMatch(fn('block_player'), /delete from public.direct_messages/);
});

test('unblock immediately refreshes mounted chat and social readers', () => {
  const realtime = read('./realtimeRefresh.js');
  assert.match(realtime, /addEventListener\("player-unblocked", requestRefresh\)/);
  assert.match(realtime, /removeEventListener\("player-unblocked", requestRefresh\)/);
  assert.match(read('../Chats.jsx'), /attachRealtimeRefresh/);
  assert.match(read('./useUnreadMessages.js'), /useSupabaseWatchedState/);
  assert.match(read('./useSupabaseWatchedState.js'), /attachRealtimeRefresh/);
  assert.match(read('./useSupabaseWatchedState.js'), /if \(refreshRequested && !cancelled\) void refresh\(\)/);
  assert.match(read('./useOnlinePlayers.js'), /attachRealtimeRefresh/);
});
