import { useState, useEffect, useCallback, useRef } from "react";
import {
  Ban, CalendarDays, Check, ChevronDown, Crown, Gift,
  Lock, Mail, Plus, RotateCcw, Search, Trash2,
  UserMinus, UserPlus, Users, X,
} from "lucide-react";
import BackButton from "./BackButton.jsx";
import { useAuth } from "./lib/AuthContext.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { attachRealtimeRefresh } from "./lib/realtimeRefresh.js";
import { buildCircleChallengeRounds } from "./lib/circleChallengeRounds.js";
import { useGameConfig } from "./lib/useGameConfig.js";

const BG = "#F1F3F7";
const PANEL = "#fff";
const INK = "#1B2129";
const ACCENT = "#2F6FED";
const CREAM = "#1B2129";
const CIRCLE_EMOJIS = ["🎮","🧩","🚀","🔥","⭐","🏆","🦄","🐉","🦊","🐼","🌈","⚡","💎","👑","🎯","🛸"];
const DAYS = [{id:1,label:"Mon"},{id:2,label:"Tue"},{id:3,label:"Wed"},{id:4,label:"Thu"},{id:5,label:"Fri"},{id:6,label:"Sat"},{id:7,label:"Sun"}];
const DEFAULT_GAMES = ["queens","tango","zip","minisudoku","geo","zoom"];
const GAME_LABELS = { queens:"Queens",tango:"Tango",zip:"Zip",minisudoku:"Mini Sudoku",geo:"Geo",zoom:"Zoom" };
// The configured amount is the winner's prize, separate from daily challenge
// score and from the wallet points earned for completing a puzzle.
const MAX_CHALLENGE_REWARD_POINTS = 50;

function challengeChoiceStyle(selected) {
  return {
    background:selected ? "rgba(47,111,237,.10)" : "rgba(16,24,40,.05)",
    color:selected ? ACCENT : INK,
    border:selected ? "1px solid rgba(47,111,237,.32)" : "1px solid transparent",
  };
}

function suggestEmoji(value) {
  const rules = [[/(space|star|galaxy|moon|astro)/,"🚀"],[/(fire|hot|flame)/,"🔥"],[/(king|queen|royal|crown)/,"👑"],[/(dragon)/,"🐉"],[/(fox)/,"🦊"],[/(panda)/,"🐼"],[/(rainbow|colour|color)/,"🌈"],[/(winner|champ|trophy)/,"🏆"],[/(target|aim|bull)/,"🎯"],[/(gem|diamond)/,"💎"],[/(magic|unicorn)/,"🦄"],[/(fast|bolt|lightning)/,"⚡"],[/(game|play)/,"🎮"],[/(puzzle|quiz|brain)/,"🧩"]];
  return rules.find(([pattern]) => pattern.test(value.toLowerCase()))?.[1] || "⭐";
}

const defaultChallenge = () => ({
  title:"Weekly challenge",
  games:[],
  days:[],
  reward:100,
  rewardType:"points",
  rewardLabel:"",
  schedule:null,
  durationWeeks:4,
  locked:false,
  challengeId:null,
  stakeRewardId:null,
  stakeRewardName:"",
  stakeSplitMethod:"equal",
  stakeAccepted:false,
});

export default function Circles({ onBack, initialCircleId = null, initialChallengeId = null }) {
  const { user, profile, createCircle, addPlayerToCircle, joinCircle, leaveCircle } = useAuth();
  const { config: gameConfig, loading: gameConfigLoading } = useGameConfig();
  const [circles, setCircles] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [members, setMembers] = useState([]);
  const [memberProfiles, setMemberProfiles] = useState({});
  const [requests, setRequests] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [circleBlocks, setCircleBlocks] = useState([]);
  const [circleChallenges, setCircleChallenges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [msg, setMsg] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [emailInviteOpen, setEmailInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [emailInviteBusy, setEmailInviteBusy] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("⭐");
  const [emojiTouched, setEmojiTouched] = useState(false);
  const [inviteCircle, setInviteCircle] = useState(null);
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteBusy, setInviteBusy] = useState(null);
  const [rosterCircle, setRosterCircle] = useState(null);
  const [rosterQuery, setRosterQuery] = useState("");
  const [moderationBusy, setModerationBusy] = useState(null);
  const [memberConfirm, setMemberConfirm] = useState(null); // { id, action: "owner" | "remove" | "block" }
  const [deleteCircleTarget, setDeleteCircleTarget] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [leavingCircleId, setLeavingCircleId] = useState(null);
  const [expandedChallengeId, setExpandedChallengeId] = useState(null);
  const [challengeEdits, setChallengeEdits] = useState({});
  const [myRewards, setMyRewards] = useState([]);
  const hasLoadedRef = useRef(false);
  const deepLinkAppliedRef = useRef(false);

  useEffect(() => {
    if (!supabaseReady) return;
    supabase.rpc("list_my_available_rewards").then(({ data }) => setMyRewards(data || []));
  }, []);

  async function acceptStake(challengeKey) {
    const edit = challengeFor(challengeKey);
    if (!edit.challengeId) return;
    const { error } = await supabase.rpc("accept_challenge_stake", { target_challenge_id:Number(edit.challengeId) });
    setMsg(error?.message || "Stake accepted");
    if (!error) await refresh();
  }

  const refresh = useCallback(async () => {
    if (!supabaseReady) { setLoading(false); return; }
    if (!hasLoadedRef.current) setLoading(true);
    setLoadError("");
    try {
      const results = await Promise.all([
        supabase.from("circles").select("*").order("created_at"),
        supabase.from("profiles").select("id,name,icon,mood,is_private,hidden_from_others,is_approved,account_deleted_at").order("name"),
        supabase.from("circle_members").select("circle_id,user_id"),
        supabase.from("circle_join_requests").select("*").order("requested_at",{ascending:false}),
        supabase.rpc("get_my_active_circle_challenges"),
        supabase.rpc("get_my_circle_rosters"),
        supabase.rpc("get_my_managed_circle_blocks"),
        supabase.rpc("get_my_pending_circle_invitations"),
      ]);
      const [circlesResult,profilesResult,membersResult,requestsResult,challengesResult,rosterResult,blocksResult,invitationsResult] = results;
      const criticalError = circlesResult.error || membersResult.error || challengesResult.error || rosterResult.error;
      if (criticalError) setLoadError(criticalError.message || "Some circle details could not be loaded.");
      const challenges = challengesResult.data || [];
      const mergedMembers = new Map();
      (membersResult.data || []).forEach((item) => mergedMembers.set(`${item.circle_id}:${item.user_id}`, item));
      (rosterResult.data || []).forEach((item) => mergedMembers.set(`${item.circle_id}:${item.user_id}`, { circle_id:item.circle_id,user_id:item.user_id }));
      setCircles(circlesResult.data || []);
      setProfiles(profilesResult.data || []);
      setMembers([...mergedMembers.values()]);
      setMemberProfiles(Object.fromEntries((rosterResult.data || []).map((item) => [
        `${item.circle_id}:${item.user_id}`,
        { id:item.user_id,name:item.member_name,icon:item.member_icon,mood:item.member_mood,is_owner:item.is_owner,can_approve_rewards:item.can_approve_rewards },
      ])));
      setRequests(requestsResult.data || []);
      setCircleBlocks(blocksResult.data || []);
      setInvitations(invitationsResult.data || []);
      setCircleChallenges(challenges);
      setChallengeEdits((previous) => {
        const next = { ...previous };
        challenges.forEach((item) => {
          next[String(item.challenge_id)] = {
            title:item.challenge_title || "Weekly challenge",
            games:item.game_ids || DEFAULT_GAMES,
            days:item.active_days || [1,2,3,4,5,6,7],
            reward:Number(item.reward_points ?? 100),
            rewardType:item.stake_reward_id ? "stake" : (item.reward_type || "points"),
            rewardLabel:item.reward_label || "",
            schedule:item.repeats_weekly ? "repeat" : "once",
            durationWeeks:Number(item.series_weeks || 1),
            locked:!!item.is_locked,
            challengeId:item.challenge_id,
            stakeRewardId:item.stake_reward_id || null,
            stakeRewardName:item.stake_reward_name || "",
            stakeSplitMethod:item.stake_split_method || "equal",
            stakeAccepted:!!item.stake_accepted,
          };
        });
        return next;
      });
      hasLoadedRef.current = true;
      void supabase.rpc("mark_my_circle_request_updates_seen");
    } catch (error) {
      setLoadError(error?.message || "Circles could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [profile?.is_admin, user?.id]);

  useEffect(() => {
    refresh();
    return attachRealtimeRefresh({
      channelName:`circles-${user?.id}`,
      tables:[{ name:"circle_members" },{ name:"circle_join_requests" },{ name:"circle_invitations" },{ name:"circle_weekly_challenges" }],
      refresh,
    });
  }, [refresh, user?.id]);

  useEffect(() => {
    if (deepLinkAppliedRef.current || loading || !initialCircleId) return;
    const targetCircle = circles.find((circle) => Number(circle.id) === Number(initialCircleId));
    if (!targetCircle) {
      setLoadError("That circle is no longer available.");
      deepLinkAppliedRef.current = true;
      return;
    }
    setRosterCircle(targetCircle);
    setRosterQuery("");
    setExpandedChallengeId(initialChallengeId ? String(initialChallengeId) : null);
    deepLinkAppliedRef.current = true;
  }, [initialChallengeId, initialCircleId, loading, circles]);

  const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const mine = new Set(members.filter((m) => m.user_id === user?.id).map((m) => m.circle_id));
  function rosterFor(circleId) {
    return members
      .filter((member) => member.circle_id === circleId)
      .map((member) => memberProfiles[`${circleId}:${member.user_id}`] || byId[member.user_id] || {
        id:member.user_id,
        name:"Circle member",
        icon:"🙂",
        mood:"",
      });
  }
  function blocksFor(circleId) {
    return circleBlocks.filter((block) => block.circle_id === circleId);
  }
  function canManage(circle) {
    return circle.created_by === user?.id || !!profile?.is_admin;
  }

  function updateName(value) {
    setName(value);
    if (!emojiTouched) setEmoji(suggestEmoji(value));
  }

  async function create(event) {
    event.preventDefault();
    if (!name.trim()) return;
    const { error } = await createCircle(name.trim(), emoji);
    setMsg(error?.message || "Circle created");
    if (!error) {
      setName("");
      setEmoji("⭐");
      setEmojiTouched(false);
      setComposerOpen(false);
    }
    refresh();
  }

  async function invite(playerId) {
    if (!inviteCircle || inviteBusy) return;
    setInviteBusy(playerId);
    const { error } = await addPlayerToCircle(playerId, inviteCircle.id);
    setInviteBusy(null);
    setMsg(error?.message || `Invitation sent to ${byId[playerId]?.name || "Player"}`);
    if (!error) refresh();
  }

  async function inviteByEmail(event) {
    event.preventDefault();
    if (!inviteEmail.trim() || emailInviteBusy) return;
    setEmailInviteBusy(true);
    setMsg("");
    const { error } = await supabase.functions.invoke("send-app-invite", {
      body:{ email:inviteEmail.trim() },
    });
    setEmailInviteBusy(false);
    if (error) {
      let message=error.message || "Invitation failed";
      try {
        const details=await error.context?.json();
        if (details?.error) message=details.error;
      } catch { /* keep the function error */ }
      setMsg(message);
      return;
    }
    setMsg(`Invitation sent to ${inviteEmail.trim()}`);
    setInviteEmail("");
    setEmailInviteOpen(false);
  }

  async function decideInvitation(invitationId, accept) {
    const { error } = await supabase.rpc("decide_circle_invitation", {
      target_invitation_id: invitationId,
      accept_invitation: accept,
    });
    setMsg(error?.message || (accept ? "Circle joined" : "Invitation declined"));
    if (!error) await refresh();
  }

  async function request(circleId) {
    const { error } = await joinCircle(circleId);
    setMsg(error?.message || "Join request sent");
    refresh();
  }

  async function decide(requestId, approve) {
    const { error } = await supabase.rpc("decide_circle_join_request", { request_id:requestId, approve });
    setMsg(error?.message || (approve ? "Player added" : "Request declined"));
    refresh();
  }

  async function leave(circle) {
    if (leavingCircleId) return;
    setLeavingCircleId(circle.id);
    const { error } = await leaveCircle(circle.id);
    setMsg(error?.message || `You left ${circle.name}`);
    setLeavingCircleId(null);
    if (!error && rosterCircle?.id === circle.id) setRosterCircle(null);
    refresh();
  }

  async function moderateMember(circle, member, action) {
    if (moderationBusy || member.id === circle.created_by) return;
    const key = `${circle.id}:${member.id}:${action}`;
    setModerationBusy(key);
    const { error } = await supabase.rpc("moderate_circle_member", {
      target_circle_id:Number(circle.id),
      target_user_id:member.id,
      moderation_action:action,
      moderation_reason:null,
    });
    setModerationBusy(null);
    const verbs = { remove:"removed from", block:"blocked from", unblock:"unblocked for" };
    setMsg(error?.message || `${member.name} was ${verbs[action]} ${circle.name}`);
    if (!error) await refresh();
  }

  async function transferOwnership(circle, member) {
    if (moderationBusy) return;
    const key = `${circle.id}:${member.id}:transfer`;
    setModerationBusy(key);
    const { error } = await supabase.rpc("transfer_circle_ownership", {
      target_circle_id:Number(circle.id),
      new_owner_user_id:member.id,
    });
    setModerationBusy(null);
    setTransferConfirmId(null);
    setMsg(error?.message || `${member.name} is now the owner of ${circle.name}`);
    if (!error) await refresh();
  }

  async function deleteCircle() {
    if (!deleteCircleTarget || deleteBusy || deleteConfirmation !== deleteCircleTarget.name) return;
    setDeleteBusy(true);
    const { error } = await supabase.rpc("delete_managed_circle", {
      target_circle_id:Number(deleteCircleTarget.id),
      expected_circle_name:deleteConfirmation,
    });
    setDeleteBusy(false);
    setMsg(error?.message || `${deleteCircleTarget.name} was deleted`);
    if (!error) {
      setDeleteCircleTarget(null);
      setDeleteConfirmation("");
      setRosterCircle(null);
      await refresh();
    }
  }

  function challengesFor(circleId) {
    return circleChallenges.filter((challenge) => Number(challenge.circle_id) === Number(circleId));
  }
  function challengeFor(challengeKey) { return challengeEdits[String(challengeKey)] || defaultChallenge(); }
  function patchChallenge(challengeKey, patch) {
    setChallengeEdits((previous) => ({
      ...previous,
      [String(challengeKey)]:{ ...defaultChallenge(), ...(previous[String(challengeKey)] || {}), ...patch },
    }));
  }
  function toggleChallengeGame(challengeKey, game) {
    const edit = challengeFor(challengeKey);
    if (!edit.locked) patchChallenge(challengeKey, { games:edit.games.includes(game) ? edit.games.filter((item) => item !== game) : [...edit.games,game] });
  }
  function toggleDay(challengeKey, day) {
    const edit = challengeFor(challengeKey);
    if (!edit.locked) patchChallenge(challengeKey, { days:edit.days.includes(day) ? edit.days.filter((item) => item !== day) : [...edit.days,day].sort() });
  }
  function startNewChallenge(circleId) {
    const key = `new:${circleId}`;
    patchChallenge(key, defaultChallenge());
    setExpandedChallengeId(key);
  }
  async function saveCircleChallenge(circle, challengeKey) {
    const edit = challengeFor(challengeKey);
    const isStake = edit.rewardType === "stake";
    let { data, error } = await supabase.rpc("set_circle_weekly_challenge", {
      target_circle_id:Number(circle.id),
      selected_games:edit.games,
      selected_days:edit.days.map(Number),
      reward_points_in:edit.rewardType === "points" ? Number(edit.reward) || 0 : 0,
      reward_type_in:isStake ? "points" : edit.rewardType,
      reward_label_in:edit.rewardType === "prize" ? edit.rewardLabel?.trim() || null : null,
      target_challenge_id:edit.challengeId ? Number(edit.challengeId) : null,
      challenge_title_in:edit.title?.trim() || "Weekly challenge",
      repeat_weekly_in:edit.schedule === "repeat",
      duration_weeks_in:edit.schedule === "repeat" ? Number(edit.durationWeeks) : 1,
    });
    if (!error && isStake && edit.stakeRewardId) {
      const stakeResult = await supabase.rpc("set_circle_challenge_stake", {
        target_challenge_id:Number(data),
        target_reward_id:Number(edit.stakeRewardId),
        split_method:edit.stakeSplitMethod,
      });
      error = stakeResult.error;
    }
    setMsg(error?.message || (edit.challengeId ? "Challenge updated" : "Challenge created"));
    if (!error) {
      setExpandedChallengeId(null);
      await refresh();
    }
  }

  const inviteCandidates = inviteCircle ? profiles.filter((candidate) => {
    const rosterIds = new Set(members.filter((m) => m.circle_id === inviteCircle.id).map((m) => m.user_id));
    const blockedIds = new Set(blocksFor(inviteCircle.id).map((block) => block.user_id));
    return candidate.id !== user?.id
      && !rosterIds.has(candidate.id)
      && !blockedIds.has(candidate.id)
      && !candidate.is_private
      && !candidate.hidden_from_others
      && candidate.is_approved !== false
      && !candidate.account_deleted_at
      && candidate.name?.toLowerCase().includes(inviteQuery.toLowerCase());
  }) : [];
  const configuredChallengeGames = gameConfigLoading
    ? []
    : DEFAULT_GAMES.filter((game) => {
        const config = gameConfig?.[game];
        return config?.available !== false && config?.challenge_enabled !== false;
      });

  return (
    <div style={{ background:BG, minHeight:"100vh", fontFamily:"'Inter',sans-serif" }} className="circles-page flex justify-center p-4 pt-10">
      <style>{`
        @media (max-width: 520px) {
          .circles-page-header {
            display:grid !important;
            grid-template-columns:44px minmax(0,1fr) 52px;
            align-items:center;
            column-gap:10px;
          }
          .circles-page-header-copy {
            grid-column:2;
            min-width:0;
          }
          .circles-page-new-button {
            grid-column:2 / 4;
            grid-row:2;
            justify-self:stretch;
            justify-content:center;
            margin-top:10px;
          }
        }
      `}</style>
      <div className="w-full max-w-md">
        <header className="circles-page-header flex items-center gap-3 mb-5">
          <BackButton onClick={onBack} ariaLabel="Back" />
          <div className="circles-page-header-copy flex-1"><h1 className="text-2xl font-bold" style={{ fontFamily:"'Fredoka',sans-serif" }}>Circles</h1><p className="text-xs opacity-45">Play together, your way</p></div>
          {!profile?.hidden_from_others && <button onClick={() => setComposerOpen((open) => !open)} className="gloss-button circles-page-new-button rounded-full px-3 py-2 text-xs font-semibold flex items-center gap-1" style={{ background:ACCENT,color:"#fff" }}><Plus size={14}/>New circle</button>}
        </header>

        {!profile?.hidden_from_others && <div className="mb-4">
          {!emailInviteOpen ? <button className="gloss-button w-full rounded-2xl px-4 py-3 flex items-center gap-3 text-left" onClick={() => setEmailInviteOpen(true)} style={{ background:"#fff",border:"1px solid rgba(16,24,40,.08)" }}><span className="grid place-items-center rounded-xl shrink-0" style={{ width:34,height:34,background:"rgba(47,111,237,.09)",color:ACCENT }}><Mail size={15}/></span><span className="flex-1 min-w-0"><span className="block text-xs font-semibold">Invite someone new</span><span className="block text-[10px] opacity-45 mt-0.5">Send an email to someone who isn’t here yet</span></span><ChevronDown size={14} className="shrink-0" style={{ opacity:.3 }}/></button>
            : <form onSubmit={inviteByEmail} className="rounded-3xl p-4" style={{ background:"#fff",border:"1px solid rgba(47,111,237,.16)" }}><div className="text-sm font-bold">Invite by email</div><div className="text-[11px] opacity-45 mt-0.5 mb-3">They’ll receive a link to create their account.</div><input autoFocus required type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="friend@example.com" className="w-full rounded-2xl border px-3 py-2.5 text-base outline-none"/><div className="grid grid-cols-2 gap-2 mt-3"><button className="gloss-button rounded-full py-2.5 text-xs font-semibold" type="button" onClick={() => { setEmailInviteOpen(false);setInviteEmail(""); }} style={{ background:"rgba(16,24,40,.05)" }}>Cancel</button><button disabled={emailInviteBusy || !inviteEmail.trim()} className="gloss-button rounded-full py-2.5 text-xs font-semibold text-white disabled:opacity-40" style={{ background:ACCENT }}>{emailInviteBusy ? "Sending…" : "Send invitation"}</button></div></form>}
        </div>}

        {msg && <div className="rounded-xl p-3 mb-3 text-xs" style={{ background:"rgba(47,111,237,.08)" }}>{msg}</div>}
        {loadError && <div className="rounded-2xl p-3 mb-3 text-xs flex items-center gap-3" style={{ background:"rgba(181,67,58,.08)",color:"#9F2F2A" }}><span className="flex-1">{loadError}</span><button type="button" onClick={refresh} className="gloss-button rounded-full px-3 py-1.5 font-semibold" style={{ background:"#fff" }}>Retry</button></div>}
        {invitations.length > 0 && <div className="rounded-3xl p-4 mb-4" style={{ background:"#FFF8E7",border:"1px solid rgba(217,174,88,.22)" }}>
          <div className="text-xs font-bold mb-2">Circle invitations</div>
          {invitations.map((item) => <div key={item.invitation_id} className="flex items-center gap-2 py-2">
            <span className="text-xl">{item.circle_emoji || "⭐"}</span>
            <div className="flex-1 min-w-0"><div className="text-xs font-semibold truncate">{item.circle_name}</div><div className="text-[10px] opacity-45">{item.inviter_icon || "🙂"} {item.inviter_name || "A player"} invited you</div></div>
            <button className="gloss-button rounded-full px-2.5 py-1.5 text-[10px]" onClick={() => decideInvitation(item.invitation_id,false)} style={{ background:"rgba(16,24,40,.05)" }}>Decline</button>
            <button className="gloss-button rounded-full px-2.5 py-1.5 text-[10px] font-semibold text-white" onClick={() => decideInvitation(item.invitation_id,true)} style={{ background:ACCENT }}>Join</button>
          </div>)}
        </div>}
        {profile?.hidden_from_others && <div className="rounded-xl p-3 mb-3 text-xs" style={{ background:"rgba(181,67,58,.1)",color:"#B5433A" }}>Your account is hidden, so circle changes are disabled.</div>}

        {composerOpen && <form onSubmit={create} className="rounded-3xl p-4 mb-5" style={{ background:PANEL,border:"1px solid rgba(47,111,237,.16)",boxShadow:"0 16px 38px rgba(47,111,237,.10)" }}>
          <div className="text-sm font-bold">Create a circle</div>
          <div className="text-[11px] opacity-45 mt-0.5 mb-3">Give it a name. We’ll suggest an icon.</div>
          <div className="flex gap-2">
            <button className="gloss-button circle-icon-control rounded-2xl text-2xl shrink-0 flex items-center justify-center gap-0.5" type="button" onClick={() => setEmojiPickerOpen((open) => !open)} style={{ width:54,background:"linear-gradient(145deg,#eef3ff,#fff)" }} aria-label="Choose circle icon">{emoji}<ChevronDown size={11} style={{ opacity:.35 }}/></button>
            <input autoFocus value={name} onChange={(e) => updateName(e.target.value)} placeholder="Circle name" className="flex-1 min-w-0 rounded-2xl border px-3 py-2.5 text-sm outline-none"/>
          </div>
          {emojiPickerOpen && <div className="mt-3 rounded-2xl p-2.5" style={{ background:"rgba(16,24,40,.035)" }}><div className="grid grid-cols-8 gap-1">{CIRCLE_EMOJIS.map((item) => <button className="gloss-button rounded-xl text-lg" type="button" key={item} onClick={() => { setEmoji(item);setEmojiTouched(true);setEmojiPickerOpen(false); }} style={{ height:34,background:item === emoji ? "rgba(47,111,237,.14)" : "transparent" }}>{item}</button>)}</div></div>}
          <div className="flex gap-2 mt-3"><button className="gloss-button flex-1 rounded-full py-2.5 text-xs font-semibold" type="button" onClick={() => setComposerOpen(false)} style={{ background:"rgba(16,24,40,.05)" }}>Cancel</button><button disabled={!name.trim()} className="gloss-button flex-1 rounded-full py-2.5 text-xs font-semibold text-white disabled:opacity-35" style={{ background:ACCENT }}>Create circle</button></div>
        </form>}

        {loading ? <div className="space-y-3 py-2" role="status" aria-label="Loading circles">{[0,1,2].map((item) => <div key={item} className="h-[96px] rounded-3xl animate-pulse" style={{ background:"linear-gradient(90deg,#E9ECF2,#F5F6F9,#E9ECF2)" }}/>)}</div> : circles.length === 0 ? <div className="rounded-3xl p-6 text-center" style={{ background:"#fff",border:"1px solid rgba(16,24,40,.07)" }}><Users size={24} className="mx-auto opacity-25"/><div className="text-sm font-semibold mt-2">No circles yet</div><div className="text-[11px] opacity-45 mt-1">Create the first circle when you’re ready.</div></div> : <div className="flex flex-col gap-3">{circles.map((circle) => {
          const roster = rosterFor(circle.id);
          const isMine = mine.has(circle.id);
          const owner = circle.created_by === user?.id;
          const manager = canManage(circle);
          const myRequest = requests.find((r) => r.circle_id === circle.id && r.user_id === user?.id);
          const pending = requests.filter((r) => r.circle_id === circle.id && r.status === "pending");
          return <article key={circle.id} className="rounded-3xl p-4" style={{ background:PANEL,border:"1px solid rgba(16,24,40,.08)",boxShadow:isMine ? "0 12px 32px rgba(47,111,237,.07)" : "none" }}>
            <div className="flex items-center gap-3">
              <div className="circle-icon-control grid place-items-center rounded-2xl text-2xl" style={{ width:48,height:48,background:"linear-gradient(145deg,#f0f4ff,#fff)" }}>{circle.emoji || "⭐"}</div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm flex items-center gap-1.5"><span className="truncate">{circle.name}</span>{owner && <Crown size={12} style={{ color:"#D9AE58" }}/>}</div>
                <div className="flex items-center mt-1 max-w-full">
                  <div className="flex shrink-0">{roster.slice(0,3).map((member,index) => <span key={member.id} title={member.name} className="grid place-items-center rounded-full text-xs" style={{ width:24,height:24,background:"#F1F3F7",border:"2px solid white",marginLeft:index ? -6 : 0,zIndex:3-index }}>{member.icon || "🙂"}</span>)}</div>
                  <span className="text-[10px] opacity-50 ml-2 truncate">
                    {isMine && roster.length
                      ? `${roster.slice(0,2).map((member) => member.id === user?.id ? "You" : member.name).join(", ")}${roster.length > 2 ? ` +${roster.length - 2}` : ""}`
                      : `${roster.length} member${roster.length === 1 ? "" : "s"}`}
                  </span>
                </div>
              </div>
              {manager ? <button className="gloss-button rounded-full px-3 py-2 text-xs font-semibold flex items-center gap-1" onClick={() => { setRosterCircle(circle);setRosterQuery(""); }} style={{ background:"rgba(47,111,237,.09)",color:ACCENT }}><Users size={13}/>Manage</button>
                : isMine ? <button className="gloss-button rounded-full px-3 py-2 text-xs font-semibold flex items-center gap-1" onClick={() => { setRosterCircle(circle);setRosterQuery(""); }} style={{ background:"rgba(47,111,237,.09)",color:ACCENT }}><Users size={13}/>Circle</button>
                : myRequest?.status === "pending" ? <span className="text-[10px] opacity-45">Requested</span>
                : <button className="gloss-button rounded-full px-3 py-2 text-xs font-semibold" disabled={profile?.hidden_from_others} onClick={() => request(circle.id)} style={{ background:"rgba(47,111,237,.09)",color:ACCENT }}>Request to join</button>}
            </div>

            {manager && pending.length > 0 && (
              <div className="circle-join-requests mt-3 rounded-2xl p-3" style={{ background:"rgba(217,174,88,.12)",border:"1px solid rgba(217,174,88,.20)" }}>
                <div className="circle-join-requests-title text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color:"#8A681D" }}>Join requests</div>
                {pending.map((requestItem) => {
                  const candidate=byId[requestItem.user_id] || { id:requestItem.user_id,name:"Player",icon:"🙂" };
                  return (
                    <div key={requestItem.id} className="circle-join-request flex items-center gap-2 py-2">
                      <span className="circle-join-request-icon grid place-items-center rounded-full shrink-0">{candidate.icon || "🙂"}</span>
                      <span className="text-xs font-semibold flex-1 min-w-0 truncate">{candidate.name}</span>
                      <span className="circle-join-request-actions flex items-center gap-1.5">
                        <button className="gloss-button circle-join-action circle-join-action--approve text-[11px] font-semibold" onClick={() => decide(requestItem.id,true)} style={{ color:"#15803D" }}>Approve</button>
                        <button className="gloss-button circle-join-action circle-join-action--decline text-[11px]" onClick={() => decide(requestItem.id,false)} style={{ color:"#755B22" }}>Decline</button>
                        <button className="gloss-button circle-join-action circle-join-action--block text-[11px]" onClick={() => moderateMember(circle,candidate,"block")} style={{ color:"#B5433A" }}>Block</button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {myRequest && myRequest.status !== "pending" && !isMine && <div className="mt-3 rounded-xl p-2 text-xs flex items-center gap-2" style={{ background:myRequest.status === "approved" ? "rgba(22,163,74,.1)" : "rgba(181,67,58,.1)" }}>{myRequest.status === "approved" ? <Check size={13}/> : <X size={13}/>}Your request was {myRequest.status}.</div>}

          </article>;
        })}</div>}

        {rosterCircle && (() => {
          const roster = rosterFor(rosterCircle.id)
            .filter((member) => member.name?.toLowerCase().includes(rosterQuery.toLowerCase()))
            .sort((a,b) => Number(b.id === rosterCircle.created_by) - Number(a.id === rosterCircle.created_by) || a.name.localeCompare(b.name));
          const blocked = blocksFor(rosterCircle.id)
            .filter((member) => member.member_name?.toLowerCase().includes(rosterQuery.toLowerCase()));
          const manager = canManage(rosterCircle);
          const member = mine.has(rosterCircle.id);
          const owner = rosterCircle.created_by === user?.id;
          const rosterChallenges = challengesFor(rosterCircle.id);
          const newChallengeKey = `new:${rosterCircle.id}`;
          const visibleChallenges = expandedChallengeId === newChallengeKey
            ? [...rosterChallenges,{ challenge_id:newChallengeKey,challenge_title:"New challenge",isNew:true }]
            : rosterChallenges;
          return <div className="circles-manage-page fixed inset-0 z-50 flex justify-center overflow-y-auto" style={{ background:BG }}>
            <div className="circles-manage-shell w-full max-w-md p-4 pt-6 flex flex-col" style={{ background:BG,minHeight:"100dvh" }}>
              <div className="flex items-center gap-3 mb-3">
                <BackButton onClick={() => { setRosterCircle(null);setDeleteCircleTarget(null);setDeleteConfirmation(""); }} ariaLabel="Back to circles" />
                <div className="circle-icon-control grid place-items-center rounded-2xl text-2xl" style={{ width:44,height:44,background:"linear-gradient(145deg,#eef3ff,#fff)" }}>{rosterCircle.emoji || "⭐"}</div>
                <div className="flex-1 min-w-0"><div className="font-bold truncate">{owner ? `Manage ${rosterCircle.name}` : rosterCircle.name}</div><div className="text-[11px] opacity-45">Challenges, members and invites</div></div>
              </div>
              {member && <button className="gloss-button w-full rounded-2xl px-4 py-3 mb-3 text-sm font-semibold flex items-center justify-center gap-2 text-white" onClick={() => { setInviteCircle(rosterCircle);setInviteQuery(""); }} style={{ background:ACCENT }}><UserPlus size={16}/>Invite a player</button>}

              {member && <div className="circle-challenges-panel rounded-3xl p-4 mb-3" style={{ background:"#fff",border:"1px solid rgba(16,24,40,.07)" }}>
                <div className="flex items-center gap-2 mb-3"><div className="grid place-items-center rounded-xl" style={{ width:34,height:34,background:"rgba(18,148,106,.09)",color:"#0B7C58" }}><CalendarDays size={15}/></div><div className="flex-1"><div className="text-sm font-bold">Challenges</div><div className="text-[10px] opacity-45">{rosterChallenges.length} this week</div></div>{owner && <button className="gloss-button rounded-full px-3 py-2 text-[11px] font-semibold flex items-center gap-1" type="button" onClick={() => startNewChallenge(rosterCircle.id)} style={{ background:"rgba(47,111,237,.09)",color:ACCENT }}><Plus size={12}/>New</button>}</div>
                {visibleChallenges.length === 0 && <div className="rounded-2xl p-4 text-center" style={{ background:"#F7F8FB" }}><div className="text-xs font-semibold">No challenge yet</div><div className="text-[10px] opacity-45 mt-1">{owner ? "Create one for your circle to play this week." : "The owner hasn’t created one this week."}</div></div>}
                <div className="space-y-2">
                  {visibleChallenges.map((challenge) => {
                    const challengeKey=String(challenge.challenge_id);
                    const edit=challengeFor(challengeKey);
                    const challengeOpen=String(expandedChallengeId) === challengeKey;
                    const challengeGameOptions=[...new Set([
                      ...configuredChallengeGames,
                      ...edit.games.filter((game) => DEFAULT_GAMES.includes(game)),
                    ])];
                    return <div key={challengeKey} className="rounded-2xl overflow-hidden" style={{ background:"#F7F8FB",border:challengeOpen ? "1px solid rgba(47,111,237,.18)" : "1px solid transparent" }}>
                      <button className="gloss-button w-full flex items-center gap-2 p-3 text-left" type="button" onClick={() => setExpandedChallengeId(challengeOpen ? null : challengeKey)}>
                        <div className="flex-1 min-w-0"><div className="text-xs font-semibold truncate">{edit.title || challenge.challenge_title || "Weekly challenge"}</div><div className="text-[10px] opacity-45 mt-0.5">{edit.days.length} daily rounds · {edit.rewardType === "points" ? `${edit.reward} pts prize` : edit.rewardLabel || "Prize"}</div></div>
                        {edit.locked && <Lock size={12} style={{ color:"#8A681D" }}/>}<ChevronDown size={15} style={{ opacity:.35,transform:challengeOpen ? "rotate(180deg)" : "none" }}/>
                      </button>
                      {challengeOpen && <div className="px-3 pb-3" style={{ borderTop:"1px solid rgba(16,24,40,.06)" }}>
                        {edit.locked && <div className="rounded-xl p-2.5 text-[11px] mt-3" style={{ background:"rgba(217,174,88,.10)",color:"#775B1D" }}>Locked because a member started this challenge.</div>}
                        {owner && <label className="block mt-3"><span className="text-[11px] font-semibold">Challenge name</span><input disabled={edit.locked} value={edit.title} onChange={(event) => patchChallenge(challengeKey,{ title:event.target.value })} placeholder="e.g. Weekend sprint" className="w-full rounded-xl border px-3 py-2 text-base mt-1 bg-white disabled:opacity-55"/></label>}
                        <div className="text-[11px] font-semibold mt-3 mb-2">Games</div>
                        <div className="flex flex-wrap gap-2">
                          {challengeGameOptions.map((game) => {
                            const chosen=edit.games.includes(game);
                            return <button
                              disabled={!owner || edit.locked}
                              type="button"
                              key={game}
                              onClick={() => toggleChallengeGame(challengeKey,game)}
                              aria-pressed={chosen}
                              className="gloss-button inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-70"
                              style={challengeChoiceStyle(chosen)}
                            >
                              {chosen && <Check size={12} strokeWidth={3} className="shrink-0"/>}
                              {GAME_LABELS[game] || game}
                            </button>;
                          })}
                        </div>
                        <div className="text-[11px] font-semibold mt-4 mb-1">Playing days</div>
                        {challenge.isNew && <div className="text-[10px] opacity-45 mb-2">Choose every day this challenge can be played. No days are selected yet.</div>}
                        <div className="flex flex-wrap gap-2">
                          {DAYS.map((day) => {
                            const chosen=edit.days.includes(day.id);
                            return <button
                              disabled={!owner || edit.locked}
                              type="button"
                              key={day.id}
                              onClick={() => toggleDay(challengeKey,day.id)}
                              aria-pressed={chosen}
                              className="gloss-button inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-70"
                              style={challengeChoiceStyle(chosen)}
                            >
                              {chosen && <Check size={12} strokeWidth={3} className="shrink-0"/>}
                              {day.label}
                            </button>;
                          })}
                        </div>
                        {!!edit.games.length && !!edit.days.length && <div className="rounded-2xl p-3 mt-3" style={{ background:"rgba(47,111,237,.055)",border:"1px solid rgba(47,111,237,.10)" }}>
                          <div className="text-[10px] font-semibold mb-2">Daily game schedule</div>
                          <div className="flex flex-wrap gap-1.5">{buildCircleChallengeRounds({ activeDays:edit.days,gameIds:edit.games }).map((round) => <span key={round.date} className="rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize" style={{ background:"#fff",color:INK }}>{DAYS[round.isoDay-1]?.label} · {round.game}</span>)}</div>
                          <div className="text-[9px] opacity-45 mt-2">One attempt on that day only. A missed round scores −100.</div>
                        </div>}
                        <fieldset className="mt-4" disabled={!owner || edit.locked}>
                          <legend className="text-[11px] font-semibold">Schedule</legend>
                          <div className="text-[10px] opacity-45 mt-0.5 mb-2">Choose one. Recurring challenges have fresh results and a new winner each week.</div>
                          <div className="grid grid-cols-2 gap-2">
                            {[{id:"once",label:"One week only",hint:"Ends after this week"},{id:"repeat",label:"Repeat weekly",hint:"Choose a duration"}].map((option) => {
                              const selected=edit.schedule === option.id;
                              return <label key={option.id} className="rounded-2xl p-3 cursor-pointer" style={{ background:selected ? "rgba(47,111,237,.09)" : "#fff",border:selected ? "1px solid rgba(47,111,237,.35)" : "1px solid rgba(16,24,40,.10)" }}>
                                <span className="flex items-center gap-2">
                                  <input type="radio" name={`schedule-${challengeKey}`} value={option.id} checked={selected} onChange={() => patchChallenge(challengeKey,{ schedule:option.id })}/>
                                  <span className="text-[11px] font-semibold">{option.label}</span>
                                </span>
                                <span className="block text-[9px] opacity-45 mt-1 ml-5">{option.hint}</span>
                              </label>;
                            })}
                          </div>
                          {edit.schedule === "repeat" && <label className="block mt-2 rounded-2xl p-3" style={{ background:"rgba(47,111,237,.05)" }}>
                            <span className="text-[11px] font-semibold">How many weeks?</span>
                            <span className="flex items-center gap-2 mt-1.5">
                              <input type="number" min="2" max="52" value={edit.durationWeeks} onChange={(event) => patchChallenge(challengeKey,{ durationWeeks:Math.min(52,Math.max(2,Number(event.target.value) || 2)) })} className="w-20 rounded-xl border px-3 py-2 text-base bg-white"/>
                              <span className="text-[10px] opacity-50">2–52 weeks, including this week</span>
                            </span>
                          </label>}
                        </fieldset>
                        <div className="mt-4"><span className="text-[11px] font-semibold flex items-center gap-1 mb-2"><Gift size={12}/>Winner’s prize</span>{owner && <div className="flex gap-2 mb-2">{["points","prize","stake"].map((type) => <button className="gloss-button rounded-full px-3 py-1.5 text-xs font-semibold" key={type} type="button" disabled={edit.locked} onClick={() => patchChallenge(challengeKey,{ rewardType:type })} style={{ background:edit.rewardType === type ? "rgba(47,111,237,.14)" : "rgba(16,24,40,.05)",color:edit.rewardType === type ? ACCENT : INK }}>{type === "points" ? "Points" : type === "prize" ? "Real prize" : "Stake an item"}</button>)}</div>}
                        {edit.rewardType === "stake" ? (owner ? <div className="space-y-2">
                          <select disabled={edit.locked} value={edit.stakeRewardId || ""} onChange={(event) => patchChallenge(challengeKey,{ stakeRewardId:event.target.value })} className="w-full rounded-xl border px-3 py-2 text-sm bg-white">
                            <option value="">Choose an approved item…</option>
                            {myRewards.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.points_cost} pts</option>)}
                          </select>
                          <div className="flex gap-2">
                            {[["equal","Equal split"],["ranked","Ranked — last place pays most"]].map(([id,label]) => <label key={id} className="flex-1 rounded-xl p-2 text-[11px] cursor-pointer flex items-center gap-1.5" style={{ background:edit.stakeSplitMethod === id ? "rgba(47,111,237,.09)" : "#fff",border:edit.stakeSplitMethod === id ? "1px solid rgba(47,111,237,.35)" : "1px solid rgba(16,24,40,.10)" }}><input type="radio" name={`split-${challengeKey}`} checked={edit.stakeSplitMethod === id} onChange={() => patchChallenge(challengeKey,{ stakeSplitMethod:id })}/>{label}</label>)}
                          </div>
                          <p className="text-[9px] opacity-45">Every non-winner who accepts owes their share once the challenge closes — settled outside the app.</p>
                        </div> : <div className="text-xs">
                          <div>{edit.stakeRewardName || "An item"} · {edit.stakeSplitMethod === "ranked" ? "ranked split" : "equal split"}</div>
                          {!edit.stakeAccepted && <button className="gloss-button mt-2" type="button" onClick={() => acceptStake(challengeKey)} style={{ background:"rgba(22,163,74,.1)",color:"#166534" }}>Accept — I'll pay my share if I don't win</button>}
                          {edit.stakeAccepted && <div className="text-[10px] opacity-45 mt-1">You've accepted this stake.</div>}
                        </div>) : owner ? edit.rewardType === "points" ? <div className="flex items-center rounded-xl border px-3 bg-white"><input disabled={edit.locked} type="number" min="0" max={MAX_CHALLENGE_REWARD_POINTS} value={edit.reward} onChange={(event) => patchChallenge(challengeKey,{ reward:Math.min(Number(event.target.value) || 0, MAX_CHALLENGE_REWARD_POINTS) })} className="w-full py-2 text-base bg-transparent outline-none"/><span className="text-xs opacity-45">points (max {MAX_CHALLENGE_REWARD_POINTS})</span></div> : <input disabled={edit.locked} value={edit.rewardLabel} onChange={(event) => patchChallenge(challengeKey,{ rewardLabel:event.target.value })} placeholder="e.g. Movie ticket" className="w-full rounded-xl border px-3 py-2 text-base bg-white"/> : <div className="text-xs">{edit.rewardType === "points" ? `${edit.reward} points` : edit.rewardLabel || "Prize"}</div>}</div>
                        {owner && <button className="gloss-button mt-3 w-full rounded-full py-2.5 text-xs font-semibold text-white disabled:opacity-35" disabled={edit.locked || !edit.title.trim() || !edit.games.length || !edit.days.length || !edit.schedule || (edit.schedule === "repeat" && (edit.durationWeeks < 2 || edit.durationWeeks > 52))} type="button" onClick={() => saveCircleChallenge(rosterCircle,challengeKey)} style={{ background:ACCENT }}>{challenge.isNew ? "Create challenge" : "Save changes"}</button>}
                      </div>}
                    </div>;
                  })}
                </div>
              </div>}

              <div className="circle-members-panel rounded-3xl p-3 sm:p-4" style={{ background:"#fff",border:"1px solid rgba(16,24,40,.07)" }}>
              <div className="flex items-center justify-between px-1 mb-3"><div className="text-sm font-bold">Members</div><div className="text-[11px] opacity-45">{rosterFor(rosterCircle.id).length}</div></div>
              {rosterFor(rosterCircle.id).length + blocksFor(rosterCircle.id).length > 6 && <label className="circle-search-box flex items-center gap-2 rounded-2xl px-3 py-2.5 mb-3" style={{ background:"#F4F6FA" }}><Search size={15} style={{ opacity:.4 }}/><input value={rosterQuery} onChange={(event) => setRosterQuery(event.target.value)} placeholder="Find a member…" className="flex-1 bg-transparent outline-none text-base"/></label>}
              <div className="space-y-2 pr-0.5">
                {roster.map((member) => {
                  const circleOwner = member.id === rosterCircle.created_by;
                  const isMe = member.id === user?.id;
                  return <div key={member.id} className={`circle-member-row rounded-2xl p-3${isMe ? " circle-member-row--me" : ""}`} style={{ background:isMe ? "rgba(47,111,237,.07)" : "#F8F9FC" }}>
                    <div className="flex items-center gap-3">
                      <span className="circle-member-icon grid place-items-center rounded-xl text-xl" style={{ width:38,height:38,background:"#fff" }}>{member.icon || "🙂"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5"><span className="text-sm font-semibold truncate">{isMe ? `${member.name} (you)` : member.name}</span>{circleOwner && <Crown size={11} style={{ color:"#D9AE58" }}/>}</div>
                        <div className="text-[10px] opacity-40 truncate">{circleOwner ? "Circle owner" : member.mood || "Circle member"}</div>
                      </div>
                      {manager && !circleOwner && !isMe && <div className="flex gap-1.5 shrink-0">
                        <button className="gloss-button circle-action-btn grid place-items-center rounded-full shrink-0" data-variant="owner" disabled={!!moderationBusy} onClick={() => setMemberConfirm(memberConfirm?.id === member.id && memberConfirm?.action === "owner" ? null : { id:member.id,action:"owner" })} style={{ width:44,height:44,background:"rgba(217,174,88,.14)",color:"#9A6A12" }} aria-label={`Make ${member.name} circle owner`} title="Make owner"><Crown size={18}/></button>
                        <button className="gloss-button circle-action-btn grid place-items-center rounded-full shrink-0" data-variant="remove" disabled={!!moderationBusy} onClick={() => setMemberConfirm(memberConfirm?.id === member.id && memberConfirm?.action === "remove" ? null : { id:member.id,action:"remove" })} style={{ width:44,height:44,background:"rgba(16,24,40,.05)" }} aria-label={`Remove ${member.name}`} title="Remove"><UserMinus size={18}/></button>
                        <button className="gloss-button circle-action-btn grid place-items-center rounded-full shrink-0" data-variant="block" disabled={!!moderationBusy} onClick={() => setMemberConfirm(memberConfirm?.id === member.id && memberConfirm?.action === "block" ? null : { id:member.id,action:"block" })} style={{ width:44,height:44,background:"rgba(181,67,58,.09)",color:"#B5433A" }} aria-label={`Block ${member.name}`} title="Block"><Ban size={18}/></button>
                      </div>}
                    </div>
                    {memberConfirm?.id === member.id && memberConfirm.action === "owner" && <div className="circle-member-confirm rounded-xl px-3 py-2.5 mt-2 text-xs" data-variant="owner" style={{ background:"rgba(217,174,88,.12)",color:"#775B1D" }}>
                      <div className="mb-2">Make {member.name} the owner of {rosterCircle.name}? You'll remain a member, but lose owner-only controls.</div>
                      <div className="flex gap-2">
                        <button onClick={() => { transferOwnership(rosterCircle,member);setMemberConfirm(null); }} className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-white" style={{ background:"#9A6A12" }}>Make owner</button>
                        <button onClick={() => setMemberConfirm(null)} className="circle-action-btn rounded-full px-3 py-1.5 text-[11px] font-semibold" data-variant="cancel" style={{ background:"rgba(16,24,40,.06)" }}>Cancel</button>
                      </div>
                    </div>}
                    {memberConfirm?.id === member.id && memberConfirm.action === "remove" && <div className="circle-member-confirm rounded-xl px-3 py-2.5 mt-2 text-xs" data-variant="remove" style={{ background:"rgba(16,24,40,.06)",color:INK }}>
                      <div className="mb-2">Remove {member.name} from {rosterCircle.name}? They can rejoin later if invited, or by requesting to join again.</div>
                      <div className="flex gap-2">
                        <button onClick={() => { moderateMember(rosterCircle,member,"remove");setMemberConfirm(null); }} className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-white" style={{ background:"#4B5563" }}>Remove</button>
                        <button onClick={() => setMemberConfirm(null)} className="circle-action-btn rounded-full px-3 py-1.5 text-[11px] font-semibold" data-variant="cancel" style={{ background:"rgba(16,24,40,.06)" }}>Cancel</button>
                      </div>
                    </div>}
                    {memberConfirm?.id === member.id && memberConfirm.action === "block" && <div className="circle-member-confirm rounded-xl px-3 py-2.5 mt-2 text-xs" data-variant="block" style={{ background:"rgba(181,67,58,.08)",color:"#9F2F2A" }}>
                      <div className="mb-2">Block {member.name} from {rosterCircle.name}? They won't be able to join or be invited again until unblocked.</div>
                      <div className="flex gap-2">
                        <button onClick={() => { moderateMember(rosterCircle,member,"block");setMemberConfirm(null); }} className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-white" style={{ background:"#B5433A" }}>Block</button>
                        <button onClick={() => setMemberConfirm(null)} className="circle-action-btn rounded-full px-3 py-1.5 text-[11px] font-semibold" data-variant="cancel" style={{ background:"rgba(16,24,40,.06)" }}>Cancel</button>
                      </div>
                    </div>}
                  </div>;
                })}
                {manager && blocked.length > 0 && <div className="pt-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide opacity-45 px-1 mb-2">Blocked · {blocked.length}</div>
                  {blocked.map((member) => <div key={member.user_id} className="circle-blocked-row flex items-center gap-3 rounded-2xl p-3 mb-2" style={{ background:"rgba(181,67,58,.055)" }}>
                    <span className="grid place-items-center rounded-xl text-xl grayscale opacity-60" style={{ width:38,height:38,background:"#fff" }}>{member.member_icon || "🙂"}</span>
                    <div className="flex-1 min-w-0"><div className="text-sm font-semibold truncate">{member.member_name || "Player"}</div><div className="text-[10px] opacity-40">Cannot join or be invited</div></div>
                    <button className="gloss-button circle-action-btn rounded-full px-3 py-2 text-[11px] font-semibold flex items-center gap-1" data-variant="unblock" disabled={!!moderationBusy} onClick={() => moderateMember(rosterCircle,{ id:member.user_id,name:member.member_name || "Player" },"unblock")} style={{ background:"#fff",color:ACCENT }}><RotateCcw size={12}/>Unblock</button>
                  </div>)}
                </div>}
                {roster.length === 0 && blocked.length === 0 && <p className="text-center text-xs opacity-45 py-8">No matching members</p>}
              </div>
              {owner && <div className="mt-3 pt-3" style={{ borderTop:"1px solid rgba(16,24,40,.08)" }}>
                {deleteCircleTarget?.id !== rosterCircle.id ? <div className="flex items-center justify-between gap-3"><p className="text-[10px] opacity-40">Remove allows rejoining. Block prevents it.</p><button className="gloss-button circle-action-btn shrink-0 rounded-full px-3 py-2 text-[11px] font-semibold flex items-center gap-1" data-variant="delete" onClick={() => { setDeleteCircleTarget(rosterCircle);setDeleteConfirmation(""); }} style={{ background:"rgba(181,67,58,.08)",color:"#B5433A" }}><Trash2 size={12}/>Delete circle</button></div>
                  : <div className="rounded-2xl p-3" style={{ background:"rgba(181,67,58,.06)" }}>
                    <div className="text-xs font-semibold" style={{ color:"#9F2F2A" }}>Delete this circle permanently?</div>
                    <p className="text-[10px] opacity-50 mt-1">Type <strong>{rosterCircle.name}</strong> to confirm.</p>
                    <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={rosterCircle.name} className="w-full rounded-xl border px-3 py-2 text-base outline-none mt-2"/>
                    <div className="grid grid-cols-2 gap-2 mt-2"><button className="gloss-button rounded-full py-2 text-[11px] font-semibold" onClick={() => { setDeleteCircleTarget(null);setDeleteConfirmation(""); }} style={{ background:"#fff" }}>Cancel</button><button disabled={deleteBusy || deleteConfirmation !== rosterCircle.name} onClick={deleteCircle} className="gloss-button rounded-full py-2 text-[11px] font-semibold text-white disabled:opacity-35" style={{ background:"#B5433A" }}>{deleteBusy ? "Deleting…" : "Delete permanently"}</button></div>
                  </div>}
              </div>}
              {member && !owner && <button className="gloss-button mt-3 w-full rounded-full py-2.5 text-xs font-medium" disabled={leavingCircleId === rosterCircle.id} onClick={() => leave(rosterCircle)} style={{ background:"rgba(181,67,58,.07)",color:"#9F2F2A" }}>{leavingCircleId === rosterCircle.id ? "Leaving…" : "Leave circle"}</button>}
              </div>
            </div>
          </div>;
        })()}

        {inviteCircle && <div className="circles-manage-page fixed inset-0 z-[60] flex justify-center overflow-y-auto" style={{ background:BG }}><div className="circles-manage-shell w-full max-w-md p-4 pt-6" style={{ minHeight:"100dvh" }}><div className="flex items-center gap-3 mb-4"><BackButton onClick={() => setInviteCircle(null)} ariaLabel="Back to circle" /><div className="text-2xl">{inviteCircle.emoji || "⭐"}</div><div className="flex-1"><div className="font-bold">Invite to {inviteCircle.name}</div><div className="text-[11px] opacity-45">Choose an available player</div></div></div><div className="circle-invite-panel rounded-3xl p-4" style={{ background:"#fff" }}><label className="circle-search-box flex items-center gap-2 rounded-2xl px-3 py-2.5 mb-3" style={{ background:"#F4F6FA" }}><Search size={15} style={{ opacity:.4 }}/><input value={inviteQuery} onChange={(e) => setInviteQuery(e.target.value)} placeholder="Find a player…" className="flex-1 bg-transparent outline-none text-base"/></label>{inviteCandidates.length === 0 ? <div className="text-center py-8"><Users size={24} className="mx-auto opacity-25"/><p className="text-xs opacity-45 mt-2">No available players</p></div> : <div className="space-y-2">{inviteCandidates.map((candidate) => <div key={candidate.id} className="circle-invite-candidate-row flex items-center gap-3 rounded-2xl p-3" style={{ background:"#F8F9FC" }}><span className="text-xl">{candidate.icon || "🙂"}</span><div className="flex-1 min-w-0"><div className="text-sm font-semibold truncate">{candidate.name}</div><div className="text-[10px] opacity-40">{candidate.mood || "Ready to play"}</div></div><button className="gloss-button rounded-full px-3 py-1.5 text-xs font-semibold" disabled={inviteBusy === candidate.id} onClick={() => invite(candidate.id)} style={{ background:"rgba(47,111,237,.1)",color:ACCENT }}>{inviteBusy === candidate.id ? "Adding…" : "Invite"}</button></div>)}</div>}</div></div></div>}
      </div>
    </div>
  );
}
