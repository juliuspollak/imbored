import { useState, useEffect, useCallback, useRef } from "react";
import {
  Ban, CalendarDays, Check, CheckCircle2, ChevronDown, Crown, Ellipsis, Gift,
  Lock, Mail, Plus, RotateCcw, Search, Trash2,
  UserMinus, UserPlus, Users, X,
} from "lucide-react";
import BackButton from "./BackButton.jsx";
import { useAuth } from "./lib/AuthContext.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { attachRealtimeRefresh } from "./lib/realtimeRefresh.js";
import { buildCircleChallengeRounds } from "./lib/circleChallengeRounds.js";
import { useGameConfig } from "./lib/useGameConfig.js";
import Page from "./components/Page.jsx";
import PageHeader from "./components/PageHeader.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";
import TextInput from "./components/TextInput.jsx";
import StatusBanner from "./components/StatusBanner.jsx";
import AvatarGroup from "./components/AvatarGroup.jsx";
import { GAME_NAMES } from "./lib/gameBranding.jsx";


const CIRCLE_EMOJIS = ["🎮","🧩","🚀","🔥","⭐","🏆","🦄","🐉","🦊","🐼","🌈","⚡","💎","👑","🎯","🛸"];
const DAYS = [{id:1,label:"Mon"},{id:2,label:"Tue"},{id:3,label:"Wed"},{id:4,label:"Thu"},{id:5,label:"Fri"},{id:6,label:"Sat"},{id:7,label:"Sun"}];
const DEFAULT_GAMES = ["hive","binary","gridly","minisudoku","geo","zoom"];
const GAME_LABELS = GAME_NAMES;
const MAX_CHALLENGE_REWARD_POINTS = 50;
const CIRCLE_MONOGRAM_COLORS = ["#315A9B", "#7251A8", "#177B68", "#A55245", "#8A641C", "#236B86"];

function circleIdentity(circle) {
  if (circle?.emoji && circle.emoji !== "⭐") return { label:circle.emoji, color:"var(--color-primary-subtle)", isEmoji:true };
  const name = circle?.name?.trim() || "Circle";
  const hash = [...name].reduce((total, character) => total + character.charCodeAt(0), 0);
  return { label:name.charAt(0).toUpperCase(), color:CIRCLE_MONOGRAM_COLORS[hash % CIRCLE_MONOGRAM_COLORS.length], isEmoji:false };
}

function CirclePortalMark() {
  const [animationRun, setAnimationRun] = useState(0);
  return (
    <button type="button" className="circle-portal-trigger" onClick={() => setAnimationRun((run) => run + 1)} aria-label="Spin the circle portal again">
      <span key={animationRun} className="circle-portal-mark" aria-hidden="true">
        <span className="circle-portal-ring" />
        <span className="circle-portal-comet">
          <span className="circle-portal-spark circle-portal-comet-head" />
          <span className="circle-portal-spark circle-portal-comet-tail-1" />
          <span className="circle-portal-spark circle-portal-comet-tail-2" />
          <span className="circle-portal-spark circle-portal-comet-tail-3" />
          <span className="circle-portal-spark circle-portal-comet-tail-4" />
        </span>
      </span>
    </button>
  );
}

function challengeChoiceStyle(selected) {
  return {
    background: selected ? "var(--color-primary-subtle)" : "var(--color-surface-elevated)",
    color: selected ? "var(--color-primary)" : "var(--color-text-primary)",
    border: selected ? "1px solid var(--color-primary-subtle-border)" : "1px solid transparent",
  };
}

function suggestEmoji(value) {
  const rules = [[/(space|star|galaxy|moon|astro)/,"🚀"],[/(fire|hot|flame)/,"🔥"],[/(king|queen|royal|crown)/,"👑"],[/(dragon)/,"🐉"],[/(fox)/,"🦊"],[/(panda)/,"🐼"],[/(rainbow|colour|color)/,"🌈"],[/(winner|champ|trophy)/,"🏆"],[/(target|aim|bull)/,"🎯"],[/(gem|diamond)/,"💎"],[/(magic|unicorn)/,"🦄"],[/(fast|bolt|lightning)/,"⚡"],[/(game|play)/,"🎮"],[/(puzzle|quiz|brain)/,"🧩"]];
  return rules.find(([pattern]) => pattern.test(value.toLowerCase()))?.[1] || "⭐";
}

const clampReward = (value) => Math.max(0, Math.min(Number(value) || 0, MAX_CHALLENGE_REWARD_POINTS));

const defaultChallenge = () => ({
  title:"Weekly challenge", games:[], days:[], reward:MAX_CHALLENGE_REWARD_POINTS, rewardType:"points",
  rewardLabel:"", rewardGoesTo:"winner", schedule:null, durationWeeks:4, locked:false, challengeId:null,
  stakeRewardId:null, stakeRewardName:"", stakeSplitMethod:"equal", stakeAccepted:false,
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
  const [memberConfirm, setMemberConfirm] = useState(null);
  const [memberMenu, setMemberMenu] = useState(null);
  const [deleteCircleTarget, setDeleteCircleTarget] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [leavingCircleId, setLeavingCircleId] = useState(null);
  const [expandedChallengeId, setExpandedChallengeId] = useState(null);
  const [challengeEdits, setChallengeEdits] = useState({});
  const [myRewards, setMyRewards] = useState([]);
  const [cardMenuCircleId, setCardMenuCircleId] = useState(null);
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
            reward:clampReward(item.reward_points ?? MAX_CHALLENGE_REWARD_POINTS),
            rewardType:item.stake_reward_id ? "stake" : (item.reward_type || "points"),
            rewardLabel:item.reward_label || "",
            rewardGoesTo:item.reward_goes_to || "winner",
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
    return members.filter((member) => member.circle_id === circleId)
      .map((member) => memberProfiles[`${circleId}:${member.user_id}`] || byId[member.user_id] || { id:member.user_id, name:"Circle member", icon:"🙂", mood:"" });
  }
  function blocksFor(circleId) { return circleBlocks.filter((block) => block.circle_id === circleId); }
  function canManage(circle) { return circle.created_by === user?.id || !!profile?.is_admin; }

  function updateName(value) { setName(value); if (!emojiTouched) setEmoji(suggestEmoji(value)); }

  async function create(event) {
    event.preventDefault();
    if (!name.trim()) return;
    const { error } = await createCircle(name.trim(), emoji);
    setMsg(error?.message || "Circle created");
    if (!error) { setName(""); setEmoji("⭐"); setEmojiTouched(false); setComposerOpen(false); }
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
    setEmailInviteBusy(true); setMsg("");
    const { error } = await supabase.functions.invoke("send-app-invite", { body:{ email:inviteEmail.trim() } });
    setEmailInviteBusy(false);
    if (error) {
      let message=error.message || "Invitation failed";
      try { const details=await error.context?.json(); if (details?.error) message=details.error; } catch { /* */ }
      setMsg(message); return;
    }
    setMsg(`Invitation sent to ${inviteEmail.trim()}`);
    setInviteEmail(""); setEmailInviteOpen(false);
  }

  async function decideInvitation(invitationId, accept) {
    const { error } = await supabase.rpc("decide_circle_invitation", { target_invitation_id: invitationId, accept_invitation: accept });
    setMsg(error?.message || (accept ? "Circle joined" : "Invitation declined"));
    if (!error) await refresh();
  }

  async function request(circleId) {
    const { error } = await joinCircle(circleId);
    setMsg(error?.message || "Join request sent"); refresh();
  }

  async function decide(requestId, approve) {
    const { error } = await supabase.rpc("decide_circle_join_request", { request_id:requestId, approve });
    setMsg(error?.message || (approve ? "Player added" : "Request declined")); refresh();
  }

  async function dismissRequestUpdate() {
    const seenAt = new Date().toISOString();
    const { error } = await supabase.rpc("mark_my_circle_request_updates_seen");
    if (error) {
      setMsg(error.message || "Could not dismiss the request update.");
      return;
    }
    setRequests((current) => current.map((item) =>
      item.user_id === user?.id && item.status !== "pending"
        ? { ...item, user_seen_at: seenAt }
        : item
    ));
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
    const key = `${circle.id}:${member.id}:${action}`; setModerationBusy(key);
    const { error } = await supabase.rpc("moderate_circle_member", { target_circle_id:Number(circle.id), target_user_id:member.id, moderation_action:action, moderation_reason:null });
    setModerationBusy(null);
    const verbs = { remove:"removed from", block:"blocked from", unblock:"unblocked for" };
    setMsg(error?.message || `${member.name} was ${verbs[action]} ${circle.name}`);
    if (!error) await refresh();
  }

  async function transferOwnership(circle, member) {
    if (moderationBusy) return;
    setModerationBusy(`${circle.id}:${member.id}:transfer`);
    const { error } = await supabase.rpc("transfer_circle_ownership", { target_circle_id:Number(circle.id), new_owner_user_id:member.id });
    setModerationBusy(null); setMemberConfirm(null);
    setMsg(error?.message || `${member.name} is now the owner of ${circle.name}`);
    if (!error) await refresh();
  }

  async function deleteCircle() {
    if (!deleteCircleTarget || deleteBusy || deleteConfirmation !== deleteCircleTarget.name) return;
    setDeleteBusy(true);
    const { error } = await supabase.rpc("delete_managed_circle", { target_circle_id:Number(deleteCircleTarget.id), expected_circle_name:deleteConfirmation });
    setDeleteBusy(false);
    setMsg(error?.message || `${deleteCircleTarget.name} was deleted`);
    if (!error) { setDeleteCircleTarget(null); setDeleteConfirmation(""); setRosterCircle(null); await refresh(); }
  }

  function challengesFor(circleId) { return circleChallenges.filter((c) => Number(c.circle_id) === Number(circleId)); }
  function challengeFor(challengeKey) { return challengeEdits[String(challengeKey)] || defaultChallenge(); }
  function patchChallenge(challengeKey, patch) { setChallengeEdits((prev) => ({ ...prev, [String(challengeKey)]: { ...defaultChallenge(), ...(prev[String(challengeKey)] || {}), ...patch } })); }
  function toggleChallengeGame(challengeKey, game) {
    const edit = challengeFor(challengeKey);
    if (!edit.locked) patchChallenge(challengeKey, { games:edit.games.includes(game) ? edit.games.filter((i) => i !== game) : [...edit.games,game] });
  }
  function toggleDay(challengeKey, day) {
    const edit = challengeFor(challengeKey);
    if (!edit.locked) patchChallenge(challengeKey, { days:edit.days.includes(day) ? edit.days.filter((i) => i !== day) : [...edit.days,day].sort() });
  }
  function startNewChallenge(circleId) { patchChallenge(`new:${circleId}`, defaultChallenge()); setExpandedChallengeId(`new:${circleId}`); }

  async function saveCircleChallenge(circle, challengeKey) {
    const edit = challengeFor(challengeKey); const isStake = edit.rewardType === "stake";
    let { data, error } = await supabase.rpc("set_circle_weekly_challenge", {
      target_circle_id:Number(circle.id), selected_games:edit.games, selected_days:edit.days.map(Number),
      reward_points_in:edit.rewardType === "points" ? clampReward(edit.reward) : 0,
      reward_type_in:isStake ? "points" : edit.rewardType, reward_label_in:edit.rewardType === "prize" ? edit.rewardLabel?.trim() || null : null,
      target_challenge_id:edit.challengeId ? Number(edit.challengeId) : null,
      challenge_title_in:edit.title?.trim() || "Weekly challenge", repeat_weekly_in:edit.schedule === "repeat",
      duration_weeks_in:edit.schedule === "repeat" ? Number(edit.durationWeeks) : 1,
      reward_goes_to_in:edit.rewardType === "prize" ? edit.rewardGoesTo : "winner",
    });
    if (!error && isStake && edit.stakeRewardId) {
      const stakeResult = await supabase.rpc("set_circle_challenge_stake", { target_challenge_id:Number(data), target_reward_id:Number(edit.stakeRewardId), split_method:edit.stakeSplitMethod });
      error = stakeResult.error;
    }
    setMsg(error?.message || (edit.challengeId ? "Challenge updated" : "Challenge created"));
    if (!error) { setExpandedChallengeId(null); await refresh(); }
  }

  const inviteCandidates = inviteCircle ? profiles.filter((candidate) => {
    const rosterIds = new Set(members.filter((m) => m.circle_id === inviteCircle.id).map((m) => m.user_id));
    const blockedIds = new Set(blocksFor(inviteCircle.id).map((b) => b.user_id));
    return candidate.id !== user?.id && !rosterIds.has(candidate.id) && !blockedIds.has(candidate.id)
      && !candidate.is_private && !candidate.hidden_from_others && candidate.is_approved !== false
      && !candidate.account_deleted_at && candidate.name?.toLowerCase().includes(inviteQuery.toLowerCase());
  }) : [];

  const configuredChallengeGames = gameConfigLoading ? [] : DEFAULT_GAMES.filter((game) => {
    const config = gameConfig?.[game]; return config?.available !== false && config?.challenge_enabled !== false;
  });

  return (
    <Page>
      <style>{`
        .design-circle-card:active { transform: scale(0.985); transition: transform var(--transition-fast); }
        .design-circle-card .design-btn:active { transform: scale(0.96); }
        .design-circle-card .design-input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-ring); outline: none; }
        @media (max-width: 520px) {
          .circles-page-header { margin-top: calc(max(16px, env(safe-area-inset-top, 0px)) + 16px); padding-right: calc(60px + env(safe-area-inset-right, 0px)); }
        }
        .circle-title-with-portal { display:inline-flex; align-items:center; gap:9px; }
        .circle-portal-trigger {
          appearance:none; display:inline-grid; place-items:center; width:34px; height:34px; padding:2px;
          border:0; border-radius:50%; background:transparent; cursor:pointer; flex:0 0 34px;
          -webkit-tap-highlight-color:transparent;
        }
        .circle-portal-trigger:focus-visible { outline:2px solid var(--color-primary); outline-offset:2px; }
        .circle-portal-trigger:active { transform:scale(.94); }
        .circle-portal-mark {
          position:relative; display:inline-block; width:30px; height:30px; flex:0 0 30px;
          border-radius:50%; animation:circle-portal-arrive 700ms cubic-bezier(.2,.9,.2,1) both;
        }
        .circle-portal-ring {
          position:absolute; inset:4px; border-radius:50%;
          border:1.5px solid color-mix(in srgb,var(--color-primary) 48%,transparent);
          border-left-color:color-mix(in srgb,var(--color-warning-gold) 60%,transparent); border-bottom-color:transparent;
          box-shadow:0 0 9px color-mix(in srgb,var(--color-primary) 38%,transparent),inset 0 0 7px color-mix(in srgb,var(--color-primary) 22%,transparent);
          animation:circle-portal-spin 3.6s cubic-bezier(.18,.72,.22,1) both;
        }
        .circle-portal-comet {
          position:absolute; inset:1px; border-radius:50%;
          transform:rotate(0deg); animation:circle-comet-orbit 3.8s linear both;
        }
        .circle-portal-spark {
          position:absolute; border-radius:50%; background:var(--color-warning-gold);
          box-shadow:0 0 6px 2px color-mix(in srgb,var(--color-warning-gold) 62%,transparent);
        }
        .circle-portal-comet-head { width:5px; height:5px; top:-1px; left:12px; background:#fff; }
        .circle-portal-comet-tail-1 { width:4px; height:4px; top:0; left:7px; opacity:.9; }
        .circle-portal-comet-tail-2 { width:3px; height:3px; top:3px; left:3px; opacity:.68; }
        .circle-portal-comet-tail-3 { width:2.5px; height:2.5px; top:7px; left:0; opacity:.46; }
        .circle-portal-comet-tail-4 { width:2px; height:2px; top:12px; left:-1px; opacity:.25; }
        @keyframes circle-portal-arrive { from { opacity:0; transform:scale(.35); } 65% { opacity:1; transform:scale(1.12); } to { transform:scale(1); } }
        @keyframes circle-portal-spin { from { transform:rotate(0deg) scale(.65); } to { transform:rotate(720deg) scale(1); } }
        @keyframes circle-comet-orbit {
          0% { opacity:0; transform:rotate(0deg) scale(.6); }
          10% { opacity:1; transform:rotate(108deg) scale(.92); }
          100% { opacity:.72; transform:rotate(1080deg) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .circle-portal-mark,.circle-portal-ring,.circle-portal-comet,.circle-portal-spark { animation:none !important; }
        }
      `}</style>

      {/* Header */}
      <PageHeader
        title={<span className="circle-title-with-portal">Circles <CirclePortalMark /></span>}
        subtitle="Play together, your way"
        onBack={onBack}
        action={!profile?.hidden_from_others && (
          <Button variant="primary" before={<Plus size={16} />} onClick={() => setComposerOpen((o) => !o)}>
            <span className="hidden sm:inline">{composerOpen ? "Cancel" : "New circle"}</span>
            <span className="sm:hidden">{composerOpen ? "✕" : "New"}</span>
          </Button>
        )}
      />

      {/* Composer form */}
      {composerOpen && (
        <Card style={{ marginBottom: "var(--section-gap)" }}>
          <div style={{ fontSize: "var(--text-card-title-size)", fontWeight: "var(--text-card-title-weight)", color: "var(--color-text-primary)" }}>Create a circle</div>
          <div style={{ fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-line)", color: "var(--color-text-secondary)", marginTop: "var(--space-1)" }}>Give it a name. We'll suggest an icon.</div>
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
            <button type="button" onClick={() => setEmojiPickerOpen((o) => !o)} aria-label="Choose circle icon"
              style={{ width: 52, height: 52, borderRadius: "var(--radius-md)", background: "var(--color-surface-elevated)", color: "var(--color-text-primary)", border: "1px solid var(--color-border)", fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center", gap: 2, cursor: "pointer", flexShrink: 0 }}>
              {emoji}<ChevronDown size={11} style={{ opacity: 0.35 }} />
            </button>
            <TextInput autoFocus value={name} onChange={(e) => updateName(e.target.value)} placeholder="Circle name" />
          </div>
          {emojiPickerOpen && <div style={{ marginTop: "var(--space-3)", borderRadius: "var(--radius-md)", padding: 10, background: "var(--color-surface-elevated)" }}><div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 4 }}>{CIRCLE_EMOJIS.map((item) => <button key={item} type="button" onClick={() => { setEmoji(item); setEmojiTouched(true); setEmojiPickerOpen(false); }} style={{ height: 34, borderRadius: "var(--radius-sm)", fontSize: 18, background: item === emoji ? "var(--color-primary-subtle)" : "transparent", border: "none", cursor: "pointer" }}>{item}</button>)}</div></div>}
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
            <Button variant="ghost" fullWidth onClick={() => setComposerOpen(false)}>Cancel</Button>
            <Button variant="primary" fullWidth disabled={!name.trim()} onClick={create} loading={false}>Create circle</Button>
          </div>
        </Card>
      )}

      {/* Email invitation */}
      {!profile?.hidden_from_others && (
        <div style={{ marginBottom: "var(--section-gap)" }}>
          {!emailInviteOpen ? (
            <Card onClick={() => setEmailInviteOpen(true)} style={{ cursor: "pointer", padding: "var(--space-3)", boxShadow: "var(--shadow-control)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <span style={{ width: 36, height: 36, borderRadius: "var(--radius-sm)", background: "var(--color-info-bg)", color: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Mail size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>Invite by email</div>
                  <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginTop: 1 }}>Invite someone who isn't here yet</div>
                </div>
                <ChevronDown size={16} style={{ opacity: 0.35, flexShrink: 0 }} />
              </div>
            </Card>
          ) : (
            <Card as="form" onSubmit={inviteByEmail} style={{ padding: "var(--space-5)" }}>
              <div style={{ fontSize: "var(--text-card-title-size)", fontWeight: "var(--text-card-title-weight)", color: "var(--color-text-primary)" }}>Invite by email</div>
              <div style={{ fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-line)", color: "var(--color-text-secondary)", marginTop: "var(--space-1)" }}>They'll receive a link to create their account.</div>
              <div style={{ marginTop: "var(--space-4)" }}>
                <TextInput autoFocus required type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="friend@example.com" />
              </div>
              <div style={{ marginTop: "var(--space-3)" }}>
                <Button variant="primary" fullWidth loading={emailInviteBusy} disabled={!inviteEmail.trim()} type="submit">
                  {emailInviteBusy ? "Sending…" : "Send invitation"}
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Message / Error banners */}
      {msg && <div style={{ marginBottom: "var(--section-gap)" }}><StatusBanner variant="info" dismissible onDismiss={() => setMsg("")}>{msg}</StatusBanner></div>}
      {loadError && <div style={{ marginBottom: "var(--section-gap)" }}>
        <StatusBanner variant="error">{loadError} <Button variant="ghost" size="sm" onClick={refresh} style={{ marginLeft: 8 }}>Retry</Button></StatusBanner>
      </div>}

      {/* Invitations */}
      {invitations.length > 0 && (
        <div style={{ marginBottom: "var(--section-gap)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)", background: "var(--color-warning-bg)", border: "1px solid var(--color-warning-border)" }}>
          <div style={{ fontSize: "var(--text-body-secondary-size)", fontWeight: 700, marginBottom: "var(--space-2)", color: "var(--color-warning-text)" }}>Circle invitations</div>
          {invitations.map((item) => (
            <div key={item.invitation_id} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) 0" }}>
              <span style={{ fontSize: 20 }}>{item.circle_emoji || "⭐"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--text-body-secondary-size)", fontWeight: 600, color: "var(--color-text-primary)" }} className="truncate">{item.circle_name}</div>
                <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>{item.inviter_icon || "🙂"} {item.inviter_name || "A player"} invited you</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => decideInvitation(item.invitation_id, false)}>Decline</Button>
              <Button variant="primary" size="sm" onClick={() => decideInvitation(item.invitation_id, true)}>Join</Button>
            </div>
          ))}
        </div>
      )}

      {profile?.hidden_from_others && <div style={{ marginBottom: "var(--section-gap)" }}><StatusBanner variant="warning">Your account is hidden, so circle changes are disabled.</StatusBanner></div>}

      {/* Loading / Empty / Circle cards */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }} role="status" aria-label="Loading circles">
          {[0,1,2].map((i) => <div key={i} style={{ height: 96, borderRadius: "var(--radius-lg)", background: "linear-gradient(90deg, var(--color-surface-elevated), var(--color-surface), var(--color-surface-elevated))", animation: "pulse 1.5s ease-in-out infinite" }} />)}
        </div>
      ) : circles.length === 0 ? (
        <Card style={{ textAlign: "center", padding: "var(--space-8)" }}>
          <Users size={28} style={{ opacity: 0.25, margin: "0 auto" }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", marginTop: "var(--space-3)" }}>No circles yet</div>
          <div style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-secondary)", marginTop: "var(--space-1)" }}>Create the first circle when you're ready.</div>
        </Card>
      ) : (
        <>
          <div style={{ fontSize: "var(--text-section-title-size)", fontWeight: "var(--text-section-title-weight)", color: "var(--color-text-secondary)", margin: "24px var(--space-1) 10px" }}>Your circles</div>
          <div style={{ overflow: "hidden", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-card)", marginBottom: "var(--section-gap)" }}>
            {circles.map((circle, circleIndex) => {
              const roster = rosterFor(circle.id);
              const isMine = mine.has(circle.id);
              const owner = circle.created_by === user?.id;
              const manager = canManage(circle);
              const myRequest = requests.find((r) => r.circle_id === circle.id && r.user_id === user?.id);
              const pending = requests.filter((r) => r.circle_id === circle.id && r.status === "pending");
              const menuOpen = cardMenuCircleId === circle.id;
              const identity = circleIdentity(circle);

              return (
                <article key={circle.id} className="design-circle-card" style={{ background: "var(--color-surface)", border: "none", borderBottom: circleIndex === circles.length - 1 ? "none" : "1px solid var(--color-border)", padding: "var(--space-3)", minHeight: 72, boxShadow: "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                    <div className="design-circle-icon" data-circle={circle.name} style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: identity.color, color: identity.isEmoji ? "inherit" : "#fff", fontSize: identity.isEmoji ? 22 : 17, fontWeight: 750, display: "grid", placeItems: "center", flexShrink: 0 }}>{identity.label}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)", lineHeight: "22px" }} className="truncate">{circle.name}</span>
                        {owner && <Crown size={14} style={{ color: "var(--color-warning-gold)", flexShrink: 0 }} aria-label="Circle owner" />}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", marginTop: 5, gap: 6 }}>
                        {roster.length > 0 && <AvatarGroup members={roster} />}
                        <span style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-secondary)" }}>
                          {isMine && roster.length
                            ? roster.length === 1 ? "1 member" : `${roster.filter((m) => m.id !== user?.id).slice(0, 2).map((m) => m.name).join(", ")}${roster.length - 1 > 2 ? ` +${roster.length - 3}` : ""}`
                            : `${roster.length} member${roster.length === 1 ? "" : "s"}`}
                        </span>
                      </div>
                    </div>
                    {manager ? (
                      <Button variant="icon" onClick={() => setCardMenuCircleId(menuOpen ? null : circle.id)} aria-label={`Manage ${circle.name}`} aria-expanded={menuOpen}><Ellipsis size={18} /></Button>
                    ) : isMine ? (
                      <Button variant="icon" onClick={() => { setRosterCircle(circle); setRosterQuery(""); }} aria-label={`View ${circle.name}`}><Ellipsis size={18} /></Button>
                    ) : myRequest?.status === "pending" ? (
                      <span style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-secondary)", fontWeight: 500, flexShrink: 0 }}>Requested</span>
                    ) : (
                      <Button variant="secondary" size="sm" disabled={profile?.hidden_from_others} onClick={() => request(circle.id)}>Request to join</Button>
                    )}
                  </div>

                  {manager && menuOpen && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                      <Button size="sm" variant="ghost" before={<Users size={13} />} onClick={() => { setCardMenuCircleId(null); setRosterCircle(circle); setRosterQuery(""); }}>Manage members</Button>
                      <Button size="sm" variant="ghost" before={<Trash2 size={13} />} onClick={() => { setCardMenuCircleId(null); leave(circle); }} style={{ color:"var(--color-danger-text)" }}>Leave / Delete</Button>
                    </div>
                  )}

                  {/* Pending join requests */}
                  {manager && pending.length > 0 && (
                    <div style={{ marginTop: "var(--space-3)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", background: "var(--color-warning-bg)", border: "1px solid var(--color-warning-border)" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "var(--space-2)", color: "var(--color-warning-text)" }}>Join requests</div>
                      {pending.map((ri) => {
                        const candidate = byId[ri.user_id] || { id: ri.user_id, name: "Player", icon: "🙂" };
                        return (
                          <div key={ri.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) 0" }}>
                            <span style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--color-avatar-bg)", fontSize: 13, display: "grid", placeItems: "center", flexShrink: 0 }}>{candidate.icon || "🙂"}</span>
                            <span style={{ fontSize: "var(--text-body-secondary-size)", fontWeight: 600, flex: 1, minWidth: 0 }} className="truncate">{candidate.name}</span>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => decide(ri.id, true)} style={{ fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-success-text)", background: "transparent", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 8 }}>Approve</button>
                              <button onClick={() => decide(ri.id, false)} style={{ fontSize: "var(--text-caption-size)", color: "var(--color-warning-text)", background: "transparent", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 8 }}>Decline</button>
                              <button onClick={() => moderateMember(circle, candidate, "block")} style={{ fontSize: "var(--text-caption-size)", color: "var(--color-danger-text)", background: "transparent", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 8 }}>Block</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Approval */}
                  {myRequest && myRequest.status === "approved" && !myRequest.user_seen_at && (
                    <div style={{ marginTop: "var(--space-3)" }}><StatusBanner variant="success" dismissible onDismiss={dismissRequestUpdate}>Your request to join {circle.name} was approved.</StatusBanner></div>
                  )}

                  {/* Denied */}
                  {myRequest && myRequest.status !== "approved" && myRequest.status !== "pending" && !myRequest.user_seen_at && (
                    <div style={{ marginTop: "var(--space-3)" }}><StatusBanner variant="error" dismissible onDismiss={dismissRequestUpdate}>Your request to join {circle.name} was {myRequest.status}.</StatusBanner></div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}

      {/* ---- Roster/Manage overlay ---- */}
      {rosterCircle && (() => {
        const roster = rosterFor(rosterCircle.id).filter((m) => m.name?.toLowerCase().includes(rosterQuery.toLowerCase())).sort((a,b) => Number(b.id === rosterCircle.created_by) - Number(a.id === rosterCircle.created_by) || a.name.localeCompare(b.name));
        const rosterIdentity = circleIdentity(rosterCircle);
        const blocked = blocksFor(rosterCircle.id).filter((m) => m.member_name?.toLowerCase().includes(rosterQuery.toLowerCase()));
        const manager = canManage(rosterCircle);
        const member = mine.has(rosterCircle.id);
        const owner = rosterCircle.created_by === user?.id;
        const rosterChallenges = challengesFor(rosterCircle.id);
        const nck = `new:${rosterCircle.id}`;
        const visibleChallenges = expandedChallengeId === nck ? [...rosterChallenges, { challenge_id: nck, challenge_title: "New challenge", isNew: true }] : rosterChallenges;

        return (
          <div className="circles-manage-page" style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "center", overflowY: "auto", background: "var(--color-page-bg)" }}>
            <div style={{ width: "100%", maxWidth: "var(--page-max-width)", padding: "calc(var(--space-4) + env(safe-area-inset-top, 0px)) var(--space-4) var(--space-4)", display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
                <BackButton onClick={() => { setRosterCircle(null); setDeleteCircleTarget(null); setDeleteConfirmation(""); }} ariaLabel="Back to circles" />
                <div style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: rosterIdentity.color, color: rosterIdentity.isEmoji ? "inherit" : "#fff", fontSize: rosterIdentity.isEmoji ? 22 : 17, fontWeight: 750, display: "grid", placeItems: "center", flexShrink: 0 }}>{rosterIdentity.label}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: "var(--color-text-primary)" }} className="truncate">{owner ? `Manage ${rosterCircle.name}` : rosterCircle.name}</div>
                  <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>Challenges, members and invites</div>
                </div>
              </div>

              {member && <Button variant="primary" fullWidth before={<UserPlus size={16} />} onClick={() => { setInviteCircle(rosterCircle); setInviteQuery(""); }} style={{ marginBottom: "var(--space-3)" }}>Invite a player</Button>}

              {member && (
                <Card style={{ marginBottom: "var(--space-3)", padding: "var(--space-4)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
                    <div style={{ width: 34, height: 34, borderRadius: "var(--radius-sm)", background: "var(--color-success-bg)", color: "var(--color-success-text)", display: "grid", placeItems: "center", flexShrink: 0 }}><CalendarDays size={15} /></div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "var(--text-body-size)", fontWeight: 700, color: "var(--color-text-primary)" }}>Challenges</div>
                      <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>{rosterChallenges.length} this week</div>
                    </div>
                    {owner && <Button variant="secondary" size="sm" before={<Plus size={12} />} onClick={() => startNewChallenge(rosterCircle.id)}>New</Button>}
                  </div>

                  {visibleChallenges.length === 0 && (
                    <div style={{ borderRadius: "var(--radius-md)", padding: "var(--space-4)", textAlign: "center", background: "var(--color-surface-elevated)" }}>
                      <div style={{ fontSize: "var(--text-body-secondary-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>No challenge yet</div>
                      <div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", marginTop: "var(--space-1)" }}>{owner ? "Create one for your circle to play this week." : "The owner hasn't created one this week."}</div>
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    {visibleChallenges.map((challenge) => {
                      const ck = String(challenge.challenge_id);
                      const edit = challengeFor(ck);
                      const open = String(expandedChallengeId) === ck;
                      const games = [...new Set([...configuredChallengeGames, ...edit.games.filter((g) => DEFAULT_GAMES.includes(g))])];
                      return <div key={ck} style={{ borderRadius: "var(--radius-md)", overflow: "hidden", background: "var(--color-surface-elevated)", border: open ? "1px solid var(--color-primary-subtle-border)" : "1px solid transparent" }}>
                        <button type="button" onClick={() => setExpandedChallengeId(open ? null : ck)} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", width: "100%", padding: "var(--space-3)", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", color: "inherit", fontFamily: "inherit" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "var(--text-body-secondary-size)", fontWeight: 600, color: "var(--color-text-primary)" }} className="truncate">{edit.title || challenge.challenge_title || "Weekly challenge"}</div>
                            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>{edit.days.length} daily rounds · {edit.rewardType === "points" ? `${edit.reward} pts prize` : edit.rewardType === "prize" ? edit.rewardLabel || "Prize" : "Staked item"}</div>
                          </div>
                          {edit.locked && <Lock size={12} style={{ color: "var(--color-warning-text)" }} />}<ChevronDown size={15} style={{ opacity: 0.35, transform: open ? "rotate(180deg)" : "none" }} />
                        </button>
                        {open && <div style={{ padding: "0 12px 12px", borderTop: "1px solid var(--color-border)" }}>
                          {edit.locked && <div style={{ borderRadius: "var(--radius-sm)", padding: 10, fontSize: "var(--text-caption-size)", marginTop: "var(--space-3)", background: "var(--color-warning-bg)", color: "var(--color-warning-text)" }}>Locked because a member started this challenge.</div>}
                          {owner && <label style={{ display: "block", marginTop: "var(--space-3)" }}><span style={{ fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>Challenge name</span><input disabled={edit.locked} value={edit.title} onChange={(e) => patchChallenge(ck, { title: e.target.value })} placeholder="e.g. Weekend sprint" style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "8px 12px", fontSize: "var(--text-input-size)", marginTop: "var(--space-1)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", boxSizing: "border-box" }} /></label>}
                          <div style={{ fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-text-primary)", marginTop: "var(--space-3)", marginBottom: 6 }}>Games</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>{games.map((game) => {
                            const chosen = edit.games.includes(game);
                            return <button key={game} type="button" disabled={!owner || edit.locked} onClick={() => toggleChallengeGame(ck, game)} aria-pressed={chosen} style={{ borderRadius: "var(--radius-sm)", padding: "8px 12px", fontSize: "var(--text-caption-size)", fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, ...challengeChoiceStyle(chosen), opacity: (!owner || edit.locked) ? 0.7 : 1 }}>{chosen && <Check size={12} strokeWidth={3} />}{GAME_LABELS[game] || game}</button>;
                          })}</div>
                          <div style={{ fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-text-primary)", marginTop: "var(--space-4)", marginBottom: "var(--space-1)" }}>Playing days</div>
                          {challenge.isNew && <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: "var(--space-2)" }}>Choose every day this challenge can be played.</div>}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>{DAYS.map((day) => {
                            const chosen = edit.days.includes(day.id);
                            return <button key={day.id} type="button" disabled={!owner || edit.locked} onClick={() => toggleDay(ck, day.id)} aria-pressed={chosen} style={{ borderRadius: "var(--radius-sm)", padding: "8px 12px", fontSize: "var(--text-caption-size)", fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, ...challengeChoiceStyle(chosen), opacity: (!owner || edit.locked) ? 0.7 : 1 }}>{chosen && <Check size={12} strokeWidth={3} />}{day.label}</button>;
                          })}</div>
                          {!!edit.games.length && !!edit.days.length && <div style={{ borderRadius: "var(--radius-md)", padding: "var(--space-3)", marginTop: "var(--space-3)", background: "var(--color-primary-subtle)", border: "1px solid var(--color-primary-subtle-border)" }}><div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-2)" }}>Daily game schedule</div><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{buildCircleChallengeRounds({ activeDays: edit.days, gameIds: edit.games }).map((r) => <span key={r.date} style={{ borderRadius: "var(--radius-full)", padding: "4px 10px", fontSize: 11, fontWeight: 600, background: "var(--color-surface)", color: "var(--color-text-primary)" }}>{DAYS[r.isoDay-1]?.label} · {GAME_LABELS[r.game] || r.game}</span>)}</div></div>}
                          {/* Schedule */}
                          <fieldset style={{ marginTop: "var(--space-4)", border: "none", padding: 0 }} disabled={!owner || edit.locked}>
                            <legend style={{ fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>Schedule</legend>
                            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2, marginBottom: "var(--space-2)" }}>Choose one.</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
                              {[{id:"once",label:"One week only"},{id:"repeat",label:"Repeat weekly"}].map((opt) => {
                                const sel = edit.schedule === opt.id;
                                return <label key={opt.id} style={{ borderRadius: "var(--radius-md)", padding: "var(--space-3)", cursor: "pointer", background: sel ? "var(--color-primary-subtle)" : "var(--color-surface)", border: sel ? "1px solid var(--color-primary-subtle-border)" : "1px solid var(--color-border)", display: "block" }}>
                                  <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}><input type="radio" name={`sched-${ck}`} checked={sel} onChange={() => patchChallenge(ck, { schedule: opt.id })} /><span style={{ fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>{opt.label}</span></span>
                                </label>;
                              })}
                            </div>
                            {edit.schedule === "repeat" && <label style={{ display: "block", marginTop: "var(--space-2)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", background: "var(--color-primary-subtle)" }}><span style={{ fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-text-primary)" }}>How many weeks?</span><span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: 6 }}><input type="number" min="2" max="52" value={edit.durationWeeks} onChange={(e) => patchChallenge(ck, { durationWeeks: Math.min(52, Math.max(2, Number(e.target.value) || 2)) })} style={{ width: 72, borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "8px 12px", fontSize: "var(--text-input-size)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", boxSizing: "border-box" }} /><span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>2–52 weeks</span></span></label>}
                          </fieldset>
                          {/* Prize */}
                          <div style={{ marginTop: "var(--space-4)" }}><span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-2)" }}><Gift size={12} /> Winner's prize</span>
                          {owner && <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>{["points","prize","stake"].map((type) => <Button key={type} variant={edit.rewardType === type ? "secondary" : "ghost"} size="sm" disabled={edit.locked} onClick={() => patchChallenge(ck, { rewardType: type })}>{type === "points" ? "Points" : type === "prize" ? "Real prize" : "Stake an item"}</Button>)}</div>}
                          {edit.rewardType === "stake" ? (owner ? <div><select disabled={edit.locked} value={edit.stakeRewardId || ""} onChange={(e) => patchChallenge(ck, { stakeRewardId: e.target.value })} style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "8px 12px", fontSize: "var(--text-body-size)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", boxSizing: "border-box" }}><option value="">Choose an approved item…</option>{myRewards.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.points_cost} pts</option>)}</select><div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>{[["equal","Equal split"],["ranked","Ranked"]].map(([id,label]) => <label key={id} style={{ flex: 1, borderRadius: "var(--radius-sm)", padding: "var(--space-2)", fontSize: "var(--text-caption-size)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, background: edit.stakeSplitMethod === id ? "var(--color-primary-subtle)" : "var(--color-surface)", border: edit.stakeSplitMethod === id ? "1px solid var(--color-primary-subtle-border)" : "1px solid var(--color-border)" }}><input type="radio" name={`split-${ck}`} checked={edit.stakeSplitMethod === id} onChange={() => patchChallenge(ck, { stakeSplitMethod: id })} />{label}</label>)}</div></div> : <div style={{ fontSize: "var(--text-body-secondary-size)" }}><div>{edit.stakeRewardName || "An item"}</div>{!edit.stakeAccepted && <button type="button" onClick={() => acceptStake(ck)} style={{ marginTop: "var(--space-2)", padding: "6px 14px", borderRadius: "var(--radius-sm)", fontSize: "var(--text-caption-size)", fontWeight: 600, background: "var(--color-success-bg)", color: "var(--color-success-text)", border: "none", cursor: "pointer" }}>Accept — I'll pay my share if I don't win</button>}{edit.stakeAccepted && <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: "var(--space-1)" }}>You've accepted this stake.</div>}</div>) : owner ? edit.rewardType === "points" ? <div style={{ display: "flex", alignItems: "center", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", background: "var(--color-surface-input)", padding: "0 12px" }}><input disabled={edit.locked} type="number" min="0" max={MAX_CHALLENGE_REWARD_POINTS} value={edit.reward} onChange={(e) => patchChallenge(ck, { reward: clampReward(e.target.value) })} style={{ width: "100%", padding: "8px 0", fontSize: "var(--text-input-size)", background: "transparent", border: "none", outline: "none", color: "var(--color-text-primary)" }} /><span style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)", flexShrink: 0 }}>points (max {MAX_CHALLENGE_REWARD_POINTS})</span></div> : <><div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>{[["winner","Winner gets it"],["loser","Loser owes it"]].map(([id,label]) => <Button key={id} variant={edit.rewardGoesTo === id ? "secondary" : "ghost"} size="sm" disabled={edit.locked} onClick={() => patchChallenge(ck, { rewardGoesTo: id })}>{label}</Button>)}</div><input disabled={edit.locked} value={edit.rewardLabel} onChange={(e) => patchChallenge(ck, { rewardLabel: e.target.value })} placeholder={edit.rewardGoesTo === "loser" ? "e.g. Clean the bathroom" : "e.g. Movie ticket"} style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-strong)", padding: "8px 12px", fontSize: "var(--text-input-size)", background: "var(--color-surface-input)", color: "var(--color-text-primary)", boxSizing: "border-box" }} /></> : <div style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-primary)" }}>{edit.rewardType === "points" ? `${edit.reward} points` : `${edit.rewardLabel || "Prize"}${edit.rewardGoesTo === "loser" ? " · loser owes it" : ""}`}{edit.rewardType === "prize" && !edit.stakeAccepted && <button type="button" onClick={() => acceptStake(ck)} style={{ display: "block", marginTop: "var(--space-2)", padding: "6px 14px", borderRadius: "var(--radius-sm)", fontSize: "var(--text-caption-size)", fontWeight: 600, background: "var(--color-success-bg)", color: "var(--color-success-text)", border: "none", cursor: "pointer" }}>{edit.rewardGoesTo === "loser" ? "Accept — I’ll settle it if I finish last" : "Accept — I’ll help cover it if I don’t win"}</button>}{edit.rewardType === "prize" && edit.stakeAccepted && <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: "var(--space-1)" }}>You’ve agreed to this.</div>}</div>}</div>
                          {owner && <Button variant="primary" fullWidth disabled={edit.locked || !edit.title.trim() || !edit.games.length || !edit.days.length || !edit.schedule || (edit.schedule === "repeat" && (edit.durationWeeks < 2 || edit.durationWeeks > 52))} onClick={() => saveCircleChallenge(rosterCircle, ck)} style={{ marginTop: "var(--space-3)" }}>{challenge.isNew ? "Create challenge" : "Save changes"}</Button>}
                        </div>}
                      </div>;
                    })}
                  </div>
                </Card>
              )}

              {/* Members */}
              <Card style={{ padding: "var(--space-4)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px", marginBottom: "var(--space-3)" }}>
                  <div style={{ fontSize: "var(--text-section-title-size)", fontWeight: 700, color: "var(--color-text-primary)" }}>Members</div>
                  <div style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-secondary)" }}>{roster.length}</div>
                </div>
                {roster.length + blocked.length > 6 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: "var(--space-3)", background: "var(--color-surface-input)" }}>
                    <Search size={15} style={{ opacity: 0.4 }} />
                    <input value={rosterQuery} onChange={(e) => setRosterQuery(e.target.value)} placeholder="Find a member…" style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: "var(--text-input-size)", color: "var(--color-text-primary)" }} />
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  {roster.map((member) => {
                    const circleOwner = member.id === rosterCircle.created_by;
                    const isMe = member.id === user?.id;
                    return <div key={member.id} style={{ borderRadius: "var(--radius-md)", padding: "var(--space-3)", background: isMe ? "var(--color-primary-subtle)" : "var(--color-surface-elevated)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                        <span style={{ width: 38, height: 38, borderRadius: "var(--radius-sm)", background: "var(--color-surface)", fontSize: 20, display: "grid", placeItems: "center", flexShrink: 0 }}>{member.icon || "🙂"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)" }} className="truncate">{isMe ? `${member.name} (you)` : member.name}</span>{circleOwner && <Crown size={11} style={{ color: "var(--color-warning-gold)", flexShrink: 0 }} />}</div>
                          <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }} className="truncate">{circleOwner ? "Circle owner" : member.mood || "Circle member"}</div>
                        </div>
                        {manager && !circleOwner && !isMe && (
                          <button disabled={!!moderationBusy} onClick={() => setMemberMenu(memberMenu === member.id ? null : member.id)} style={{ width: 32, height: 32, borderRadius: "var(--radius-sm)", background: "var(--color-surface-elevated)", color: "var(--color-text-primary)", border: "none", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}><Ellipsis size={16} /></button>
                        )}
                      </div>
                      {memberMenu === member.id && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                          <button onClick={() => { setMemberConfirm({ id: member.id, action: "owner" }); setMemberMenu(null); }} style={{ borderRadius: "var(--radius-full)", padding: "6px 12px", fontSize: "var(--text-caption-size)", fontWeight: 500, display: "flex", alignItems: "center", gap: "var(--space-1)", background: "var(--color-surface-elevated)", color: "var(--color-text-primary)", border: "none", cursor: "pointer" }}><Crown size={11} /> Make owner</button>
                          <button onClick={() => { setMemberConfirm({ id: member.id, action: "remove" }); setMemberMenu(null); }} style={{ borderRadius: "var(--radius-full)", padding: "6px 12px", fontSize: "var(--text-caption-size)", fontWeight: 500, display: "flex", alignItems: "center", gap: "var(--space-1)", background: "var(--color-surface-elevated)", color: "var(--color-text-primary)", border: "none", cursor: "pointer" }}><UserMinus size={11} /> Remove</button>
                          <button onClick={() => { setMemberConfirm({ id: member.id, action: "block" }); setMemberMenu(null); }} style={{ borderRadius: "var(--radius-full)", padding: "6px 12px", fontSize: "var(--text-caption-size)", fontWeight: 500, display: "flex", alignItems: "center", gap: "var(--space-1)", background: "var(--color-danger-bg)", color: "var(--color-danger-text)", border: "none", cursor: "pointer" }}><Ban size={11} /> Block</button>
                        </div>
                      )}
                      {/* Confirm dialogs */}
                      {memberConfirm?.id === member.id && memberConfirm.action === "owner" && (
                        <div style={{ borderRadius: "var(--radius-sm)", padding: "10px 12px", marginTop: "var(--space-2)", fontSize: "var(--text-caption-size)", background: "var(--color-warning-bg)", color: "var(--color-warning-text)" }}>
                          <div style={{ marginBottom: "var(--space-2)" }}>Make {member.name} the owner of {rosterCircle.name}? You'll remain a member, but lose owner-only controls.</div>
                          <div style={{ display: "flex", gap: "var(--space-2)" }}>
                            <button onClick={() => { transferOwnership(rosterCircle, member); }} style={{ borderRadius: "var(--radius-full)", padding: "6px 14px", fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-page-bg)", background: "var(--color-warning-text)", border: "none", cursor: "pointer" }}>Make owner</button>
                            <button onClick={() => setMemberConfirm(null)} style={{ borderRadius: "var(--radius-full)", padding: "6px 14px", fontSize: "var(--text-caption-size)", fontWeight: 600, background: "var(--color-surface-elevated)", color: "var(--color-text-primary)", border: "none", cursor: "pointer" }}>Cancel</button>
                          </div>
                        </div>
                      )}
                      {memberConfirm?.id === member.id && memberConfirm.action === "remove" && (
                        <div style={{ borderRadius: "var(--radius-sm)", padding: "10px 12px", marginTop: "var(--space-2)", fontSize: "var(--text-caption-size)", background: "var(--color-surface-elevated)", color: "var(--color-text-primary)" }}>
                          <div style={{ marginBottom: "var(--space-2)" }}>Remove {member.name} from {rosterCircle.name}? They can rejoin later.</div>
                          <div style={{ display: "flex", gap: "var(--space-2)" }}>
                            <button onClick={() => { moderateMember(rosterCircle, member, "remove"); setMemberConfirm(null); }} style={{ borderRadius: "var(--radius-full)", padding: "6px 14px", fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-primary-text)", background: "var(--color-icon-primary)", border: "none", cursor: "pointer" }}>Remove</button>
                            <button onClick={() => setMemberConfirm(null)} style={{ borderRadius: "var(--radius-full)", padding: "6px 14px", fontSize: "var(--text-caption-size)", fontWeight: 600, background: "var(--color-surface-elevated)", color: "var(--color-text-primary)", border: "none", cursor: "pointer" }}>Cancel</button>
                          </div>
                        </div>
                      )}
                      {memberConfirm?.id === member.id && memberConfirm.action === "block" && (
                        <div style={{ borderRadius: "var(--radius-sm)", padding: "10px 12px", marginTop: "var(--space-2)", fontSize: "var(--text-caption-size)", background: "var(--color-danger-bg)", color: "var(--color-danger-text)" }}>
                          <div style={{ marginBottom: "var(--space-2)" }}>Block {member.name} from {rosterCircle.name}? They won't be able to join or be invited again until unblocked.</div>
                          <div style={{ display: "flex", gap: "var(--space-2)" }}>
                            <button onClick={() => { moderateMember(rosterCircle, member, "block"); setMemberConfirm(null); }} style={{ borderRadius: "var(--radius-full)", padding: "6px 14px", fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--color-primary-text)", background: "var(--color-danger-solid)", border: "none", cursor: "pointer" }}>Block</button>
                            <button onClick={() => setMemberConfirm(null)} style={{ borderRadius: "var(--radius-full)", padding: "6px 14px", fontSize: "var(--text-caption-size)", fontWeight: 600, background: "var(--color-surface-elevated)", color: "var(--color-text-primary)", border: "none", cursor: "pointer" }}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>;
                  })}
                  {/* Blocked list */}
                  {manager && blocked.length > 0 && (
                    <div style={{ paddingTop: "var(--space-3)" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--color-text-secondary)", marginBottom: "var(--space-2)" }}>Blocked · {blocked.length}</div>
                      {blocked.map((m) => <div key={m.user_id} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", marginBottom: "var(--space-2)", background: "var(--color-danger-subtle-bg)" }}>
                        <span style={{ width: 38, height: 38, borderRadius: "var(--radius-sm)", background: "var(--color-surface)", fontSize: 20, display: "grid", placeItems: "center", filter: "grayscale(1)", opacity: 0.6, flexShrink: 0 }}>{m.member_icon || "🙂"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)" }} className="truncate">{m.member_name || "Player"}</div><div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Cannot join or be invited</div></div>
                        <Button variant="secondary" size="sm" disabled={!!moderationBusy} before={<RotateCcw size={12} />} onClick={() => moderateMember(rosterCircle, { id: m.user_id, name: m.member_name || "Player" }, "unblock")}>Unblock</Button>
                      </div>)}
                    </div>
                  )}
                  {roster.length === 0 && blocked.length === 0 && <p style={{ textAlign: "center", fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-secondary)", padding: "var(--space-8) 0" }}>No matching members</p>}
                </div>
                {owner && (
                  <div style={{ marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--color-border)" }}>
                    {deleteCircleTarget?.id !== rosterCircle.id ? (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)" }}>
                        <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: 0 }}>Remove allows rejoining. Block prevents it.</p>
                        <Button variant="danger" size="sm" before={<Trash2 size={12} />} onClick={() => { setDeleteCircleTarget(rosterCircle); setDeleteConfirmation(""); }}>Delete circle</Button>
                      </div>
                    ) : (
                      <div style={{ borderRadius: "var(--radius-md)", padding: "var(--space-3)", background: "var(--color-danger-subtle-bg)" }}>
                        <div style={{ fontSize: "var(--text-body-secondary-size)", fontWeight: 600, color: "var(--color-danger-text)" }}>Delete this circle permanently?</div>
                        <p style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: "var(--space-1)" }}>Type <strong style={{ color: "var(--color-text-primary)" }}>{rosterCircle.name}</strong> to confirm.</p>
                        <TextInput value={deleteConfirmation} onChange={(e) => setDeleteConfirmation(e.target.value)} placeholder={rosterCircle.name} style={{ marginTop: "var(--space-2)" }} />
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                          <Button variant="ghost" onClick={() => { setDeleteCircleTarget(null); setDeleteConfirmation(""); }}>Cancel</Button>
                          <Button variant="danger" disabled={deleteBusy || deleteConfirmation !== rosterCircle.name} onClick={deleteCircle}>{deleteBusy ? "Deleting…" : "Delete permanently"}</Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {member && !owner && <Button variant="danger" fullWidth disabled={leavingCircleId === rosterCircle.id} onClick={() => leave(rosterCircle)} style={{ marginTop: "var(--space-3)" }}>{leavingCircleId === rosterCircle.id ? "Leaving…" : "Leave circle"}</Button>}
              </Card>
            </div>
          </div>
        );
      })()}

      {/* ---- Invite overlay ---- */}
      {inviteCircle && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "center", overflowY: "auto", background: "var(--color-page-bg)" }}>
          <div style={{ width: "100%", maxWidth: "var(--page-max-width)", padding: "calc(var(--space-4) + env(safe-area-inset-top, 0px)) var(--space-4) var(--space-4)", minHeight: "100dvh" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
              <BackButton onClick={() => setInviteCircle(null)} ariaLabel="Back to circle" />
              <div style={{ fontSize: 28 }}>{inviteCircle.emoji || "⭐"}</div>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700, color: "var(--color-text-primary)" }}>Invite to {inviteCircle.name}</div><div style={{ fontSize: "var(--text-caption-size)", color: "var(--color-text-secondary)" }}>Choose an available player</div></div>
            </div>
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: "var(--space-3)", background: "var(--color-surface-input)" }}>
                <Search size={15} style={{ opacity: 0.4 }} />
                <input value={inviteQuery} onChange={(e) => setInviteQuery(e.target.value)} placeholder="Find a player…" style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: "var(--text-input-size)", color: "var(--color-text-primary)" }} />
              </div>
              {inviteCandidates.length === 0 ? (
                <div style={{ textAlign: "center", padding: "var(--space-8) 0" }}>
                  <Users size={24} style={{ opacity: 0.25, margin: "0 auto" }} />
                  <p style={{ fontSize: "var(--text-body-secondary-size)", color: "var(--color-text-secondary)", marginTop: "var(--space-2)" }}>No available players</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  {inviteCandidates.map((c) => (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", background: "var(--color-surface-elevated)" }}>
                      <span style={{ fontSize: 24 }}>{c.icon || "🙂"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: "var(--text-body-size)", fontWeight: 600, color: "var(--color-text-primary)" }} className="truncate">{c.name}</div><div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{c.mood || "Ready to play"}</div></div>
                      <Button variant="secondary" size="sm" disabled={inviteBusy === c.id} onClick={() => invite(c.id)}>{inviteBusy === c.id ? "Adding…" : "Invite"}</Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </Page>
  );
}
