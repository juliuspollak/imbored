import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createModeratedFetch, moderationError, MODERATION_PATTERNS, MODERATION_MESSAGE } from './textModeration.js';
import { TERMS_VERSION, TERMS_URL, PRIVACY_URL, hasCurrentTerms, loadCurrentTerms, acceptCurrentTerms } from './terms.js';
import { shouldShowPublicTerms, shouldShowPublicSupport, shouldShowPublicPrivacy } from './publicLanding.js';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../supabase/migrations/202609161200_ugc_terms_and_moderation.sql');

test('rejects severe abuse, slurs, sexual abuse, threats and spam with normalization', () => {
  for (const text of ['fuck you', 'FUCK you', 'ｆｕｃｋ you', 'fu\u200bck you', 'you nigger', 'child porn', 'suck my dick', 'I will kill you', 'I’m going to kill you', 'kill yourself', 'free money free money', 'https://spam.test '.repeat(5), 'x'.repeat(30)]) {
    assert.equal(moderationError(text), MODERATION_MESSAGE, text);
  }
});
test('ordinary game discussion and names remain allowed', () => {
  for (const text of ['I will beat your score!', 'Killer sudoku', 'Shoot for the top score', 'Scunthorpe', 'Good game 👍', 'The assassin won', 'This puzzle is hard', 'https://imbored.au/support', 'Sex education', '🍕 Alice sent you a virtual slice of pizza']) assert.equal(moderationError(text), null, text);
});
test('moderation blocks all UGC paths before network submission, but permits normal writes and reports', async () => {
  const calls=[];
  const fetcher=createModeratedFetch(async (...args) => { calls.push(args); return new Response('{}'); });
  for (const [path, payload] of [
    ['rpc/send_direct_message', {message_body:'fuck you'}],
    ['rpc/save_my_profile', {profile_name:'fuck you'}],
    ['rpc/save_my_profile', {profile_mood:'fuck you'}],
    ['rpc/create_circle', {circle_name:'fuck you'}],
    ['rpc/save_circle_weekly_challenge_schedule', {challenge_title_in:'fuck you'}],
    ['rpc/save_circle_weekly_challenge_schedule', {reward_label_in:'fuck you'}],
    ['rpc/propose_reward', {reward_description:'fuck you'}],
    ['feedback', [{title:'fuck you'}]], ['pokes', {message:'fuck you'}],
  ]) {
    assert.equal((await fetcher(`https://example.test/rest/v1/${path}`, {method:'POST',body:JSON.stringify(payload)})).status,422);
  }
  assert.equal(calls.length,0);
  await fetcher('https://example.test/rest/v1/rpc/send_direct_message',{method:'POST',body:JSON.stringify({message_body:'Nice score!'})});
  await fetcher('https://example.test/rest/v1/rpc/report_content',{method:'POST',body:JSON.stringify({report_details:'They said fuck you'})});
  assert.equal(calls.length,2);
});
test('database uses matching filter rules on every writable UGC table', () => {
  for (const pattern of MODERATION_PATTERNS) assert.ok(migration.includes('$pattern$' + pattern.replaceAll('\\b','\\y') + '$pattern$'));
  for(const table of ['direct_messages','profiles','circles','circle_weekly_challenges','rewards','feedback','pokes','animal_rush_players','reward_redemptions']) assert.ok(migration.includes(`before insert or update on public.${table}`));
  assert.match(migration,/is not distinct from/);
});
test('all authentication paths require explicit unchecked consent, including review credentials', () => {
  const login=read('../Login.jsx'),auth=read('./AuthContext.jsx'),review=read('../components/AppReviewAccess.jsx');
  assert.match(auth,/\[termsAgreed, setTermsAgreed\] = useState\(false\)/);
  assert.match(login,/<fieldset disabled=\{!termsAgreed\}/);
  for(const name of ['signInWithEmail','signInWithAppReview','verifyCode','signInWithOAuthProvider','signInWithPasskey']) assert.match(auth,new RegExp(`async function ${name}\\([^)]*\\) \\{\\s*if \\(!termsAgreed\\)`));
  assert.match(review,/if \(!termsAgreed \|\| pending.current\) return/);
});
test('Terms links work on web and use native browser without replacing the app', () => {
  assert.equal(TERMS_URL,'https://imbored.au/terms');assert.equal(PRIVACY_URL,'https://imbored.au/privacy');
  const consent=read('../components/TermsConsent.jsx');
  assert.match(consent,/Browser.open\(\{ url \}\)/);assert.match(consent,/target="_blank"/);
});
test('acceptance is current-version, account-bound, server-timestamped and not client-writable', () => {
  assert.equal(hasCurrentTerms(null),false);
  assert.equal(hasCurrentTerms({terms_version:'old',terms_accepted_at:'2026-01-01'}),false);
  assert.equal(hasCurrentTerms({terms_version:TERMS_VERSION,terms_accepted_at:'2026-09-16'}),true);
  assert.match(migration,/primary key \(user_id, terms_version\)/);
  assert.match(migration,/terms_accepted_at timestamptz not null default now\(\)/);
  assert.match(migration,/revoke all on public.account_terms_acceptances from anon, authenticated/);
  assert.match(migration,/is_blocked or account_deleted_at is not null/);
  assert.match(read('../TermsGate.jsx'),/loadCurrentTerms\(supabase, user.id, termsAgreed\)/);
  assert.match(read('../TermsGate.jsx'),/if \(!checked \|\| busy\) return/);
  assert.match(read('../App.jsx'),/profile\?\.is_blocked \|\| profile\?\.account_deleted_at\) return <AppShell/);
});
test('message report carries ID and atomic existing report flow also blocks', () => {
  const menu=read('../ChatSafetyMenu.jsx'),schema=read('../../supabase/schemas/public.sql');
  assert.match(menu,/target_message_id: messageId/);assert.match(menu,/Report & Block/);
  assert.match(read('../Chat.jsx'),/messageId=\{item.id\}/);
  assert.match(schema,/CREATE FUNCTION public.report_content[\s\S]*insert into public.content_reports[\s\S]*insert into public.player_blocks/);
  assert.match(menu,/rpc\("block_player"/);
  assert.match(read('../AccountSafety.jsx'),/unblock_player/);
  assert.match(read('../Chat.jsx'),/setMessages\(\[\]\); setPeerAvailable\(false\); onBack\?\.\(\)/);
  assert.match(menu,/dispatchEvent\(new CustomEvent\("player-blocked"/);
});
test('admin sees report queue and can remove content, suspend and resolve; ordinary users cannot read reports', () => {
  const admin=read('../AdminReports.jsx');
  for(const name of ['admin_list_content_reports','admin_remove_reported_message','admin_resolve_content_report']) assert.ok(admin.includes(name));
  assert.match(admin,/adminAccountAction\("block"/);assert.match(admin,/report.status === "open"/);
  assert.match(migration,/Only admins read safety reports/);assert.match(migration,/if not public.is_admin\(auth.uid\(\)\)/);
  assert.match(migration,/message_snapshot=coalesce/);
});
test('terms public route preserves native startup, auth callbacks and deep links', () => {
  for(const path of ['/terms','/terms/']) assert.equal(shouldShowPublicTerms({pathname:path}),true);
  for(const args of [{native:true,pathname:'/terms'},{pathname:'/terms',search:'?code=abc'},{pathname:'/terms',hash:'#access_token=abc'},{pathname:'/challenge/1'},{pathname:'/',search:'?puzzle=42'}]) assert.equal(shouldShowPublicTerms(args),false);
  assert.equal(shouldShowPublicSupport({pathname:'/support'}),true);assert.equal(shouldShowPublicPrivacy({pathname:'/privacy'}),true);
  assert.match(read('../main.jsx'),/shouldShowPublicTerms\(publicLocation\)\) return <PublicTerms/);
});

test('existing accounts are prompted; explicit consent persists and is read on another device', async () => {
  const rows = new Map();
  const makeClient = id => ({
    from(table) {
      assert.equal(table, 'account_terms_acceptances');
      const filters={};
      return { select() { return this; }, eq(key,value) { filters[key]=value; return this; }, async maybeSingle() {
        assert.equal(filters.user_id,id); assert.equal(filters.terms_version,TERMS_VERSION);
        return {data:rows.get(id) || null};
      } };
    },
    async rpc(name,args) { assert.equal(name,'accept_current_terms'); rows.set(id,{terms_version:args.accepted_version,terms_accepted_at:'server timestamp'}); return {}; },
  });
  assert.equal(await loadCurrentTerms(makeClient('alice'),'alice'),false);
  assert.equal(rows.size,0);
  assert.equal(await loadCurrentTerms(makeClient('alice'),'alice',true),true);
  assert.equal(await loadCurrentTerms(makeClient('alice'),'alice'),true);
  assert.equal(await loadCurrentTerms(makeClient('bob'),'bob'),false);
  await assert.rejects(acceptCurrentTerms({rpc:async()=>({error:new Error('Account unavailable')})}), /Account unavailable/);
});
