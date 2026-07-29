import { useState, useEffect, useCallback, useRef } from "react";
import {
  ArrowLeft, Ban, CalendarDays, Check, ChevronDown, Crown, Gift,
  Lock, Mail, Plus, RotateCcw, Search, ShieldCheck, Trash2,
  UserMinus, UserPlus, Users, X,
} from "lucide-react";
import BackButton from "./BackButton.jsx";
import { useAuth } from "./lib/AuthContext.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { attachRealtimeRefresh } from "./lib/realtimeRefresh.js";
import { buildTeamChallengeRounds } from "./lib/teamChallengeRounds.js";
import { useGameConfig } from "./lib/useGameConfig.js";

const BG = "#F1F3F7";
const PANEL = "#fff";
const INK = "#1B2129";
const ACCENT = "#2F6FED";
const CREAM = "#1B2129";
const TEAM_EMOJIS = ["🎮","🧩","🚀","🔥","⭐","🏆","🦄","🐉","🦊","🐼","🌈","⚡","💎","👑","🎯","🛸"];
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

export default function Teams({ onBack, initialTeamId = null, initialChallengeId = null }) {
  const { user, profile, createTeam, addPlayerToTeam, joinTeam, leaveTeam } = useAuth();
  const { config: gameConfig, loading: gameConfigLoading } = useGameConfig();
  const [teams, setTeams] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [members, setMembers] = useState([]);
  const [memberProfiles, setMemberProfiles] = useState({});
  const [requests, setRequests] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [teamBlocks, setTeamBlocks] = useState([]);
  const [teamChallenges, setTeamChallenges] = useState([]);
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
  const [inviteTeam, setInviteTeam] = useState(null);
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteBusy, setInviteBusy] = useState(null);
  const [rosterTeam, setRosterTeam] = useState(null);
  const [rosterQuery, setRosterQuery] = useState("");
  const [moderationBusy, setModerationBusy] = useState(null);
  const [deleteTeamTarget, setDeleteTeamTarget] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [leavingTeamId, setLeavingTeamId] = useState(null);
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
        supabase.from("teams").select("*").order("created_at"),
        supabase.from("profiles").select("id,name,icon,mood,is_private,hidden_from_others,is_approved,account_deleted_at").order("name"),
        supabase.from("team_members").select("team_id,user_id"),
        supabase.from("team_join_requests").select("*").order("requested_at",{ascending:false}),
        supabase.rpc("get_my_active_team_challenges"),
        supabase.rpc("get_my_team_rosters"),
        supabase.rpc("get_my_managed_team_blocks"),
        supabase.rpc("get_my_pending_team_invitations"),
      ]);
      const [teamsResult,profilesResult,membersResult,requestsResult,challengesResult,rosterResult,blocksResult,invitationsResult] = results;
      const criticalError = teamsResult.error || membersResult.error || challengesResult.error || rosterResult.error;
      if (criticalError) setLoadError(criticalError.message || "Some team details could not be loaded.");
      const challenges = challengesResult.data || [];
      const mergedMembers = new Map();
      (membersResult.data || []).forEach((item) => mergedMembers.set(`${item.team_id}:${item.user_id}`, item));
      (rosterResult.data || []).forEach((item) => mergedMembers.set(`${item.team_id}:${item.user_id}`, { team_id:item.team_id,user_id:item.user_id }));
      setTeams(teamsResult.data || []);
      setProfiles(profilesResult.data || []);
      setMembers([...mergedMembers.values()]);
      setMemberProfiles(Object.fromEntries((rosterResult.data || []).map((item) => [
        `${item.team_id}:${item.user_id}`,
        { id:item.user_id,name:item.member_name,icon:item.member_icon,mood:item.member_mood,is_owner:item.is_owner,can_approve_rewards:item.can_approve_rewards },
      ])));
      setRequests(requestsResult.data || []);
      setTeamBlocks(blocksResult.data || []);
      setInvitations(invitationsResult.data || []);
      setTeamChallenges(challenges);
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
      void supabase.rpc("mark_my_team_request_updates_seen");
    } catch (error) {
      setLoadError(error?.message || "Teams could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [profile?.is_admin, user?.id]);

  useEffect(() => {
    refresh();
    return attachRealtimeRefresh({
      channelName:`teams-${user?.id}`,
      tables:[{ name:"team_members" },{ name:"team_join_requests" },{ name:"team_invitations" },{ name:"team_weekly_challenges" }],
      refresh,
    });
  }, [refresh, user?.id]);

  useEffect(() => {
    if (deepLinkAppliedRef.current || loading || !initialTeamId) return;
    const targetTeam = teams.find((team) => Number(team.id) === Number(initialTeamId));
    if (!targetTeam) {
      setLoadError("That team is no longer available.");
      deepLinkAppliedRef.current = true;
      return;
    }
    setRosterTeam(targetTeam);
    setRosterQuery("");
    setExpandedChallengeId(initialChallengeId ? String(initialChallengeId) : null);
    deepLinkAppliedRef.current = true;
  }, [initialChallengeId, initialTeamId, loading, teams]);

  const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const mine = new Set(members.filter((m) => m.user_id === user?.id).map((m) => m.team_id));
  function rosterFor(teamId) {
    return members
      .filter((member) => member.team_id === teamId)
      .map((member) => memberProfiles[`${teamId}:${member.user_id}`] || byId[member.user_id] || {
        id:member.user_id,
        name:"Team member",
        icon:"🙂",
        mood:"",
      });
  }
  function blocksFor(teamId) {
    return teamBlocks.filter((block) => block.team_id === teamId);
  }
  function canManage(team) {
    return team.created_by === user?.id || !!profile?.is_admin;
  }

  function updateName(value) {
    setName(value);
    if (!emojiTouched) setEmoji(suggestEmoji(value));
  }

  async function create(event) {
    event.preventDefault();
    if (!name.trim()) return;
    const { error } = await createTeam(name.trim(), emoji);
    setMsg(error?.message || "Team created");
    if (!error) {
      setName("");
      setEmoji("⭐");
      setEmojiTouched(false);
      setComposerOpen(false);
    }
    refresh();
  }

  async function invite(playerId) {
    if (!inviteTeam || inviteBusy) return;
    setInviteBusy(playerId);
    const { error } = await addPlayerToTeam(playerId, inviteTeam.id);
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
    const { error } = await supabase.rpc("decide_team_invitation", {
      target_invitation_id: invitationId,
      accept_invitation: accept,
    });
    setMsg(error?.message || (accept ? "Team joined" : "Invitation declined"));
    if (!error) await refresh();
  }

  async function request(teamId) {
    const { error } = await joinTeam(teamId);
    setMsg(error?.message || "Join request sent");
    refresh();
  }

  async function decide(requestId, approve) {
    const { error } = await supabase.rpc("decide_team_join_request", { request_id:requestId, approve });
    setMsg(error?.message || (approve ? "Player added" : "Request declined"));
    refresh();
  }

  async function leave(team) {
    if (leavingTeamId) return;
    setLeavingTeamId(team.id);
    const { error } = await leaveTeam(team.id);
    setMsg(error?.message || `You left ${team.name}`);
    setLeavingTeamId(null);
    if (!error && rosterTeam?.id === team.id) setRosterTeam(null);
    refresh();
  }

  async function moderateMember(team, member, action) {
    if (moderationBusy || member.id === team.created_by) return;
    const key = `${team.id}:${member.id}:${action}`;
    setModerationBusy(key);
    const { error } = await supabase.rpc("moderate_team_member", {
      target_team_id:Number(team.id),
      target_user_id:member.id,
      moderation_action:action,
      moderation_reason:null,
    });
    setModerationBusy(null);
    const verbs = { remove:"removed from", block:"blocked from", unblock:"unblocked for" };
    setMsg(error?.message || `${member.name} was ${verbs[action]} ${team.name}`);
    if (!error) await refresh();
  }

  async function toggleRewardApprover(team, member) {
    if (moderationBusy || member.id === team.created_by) return;
    const key = `${team.id}:${member.id}:approver`;
    setModerationBusy(key);
    const { error } = await supabase.rpc("set_team_reward_approver", {
      target_team_id:Number(team.id),
      target_user_id:member.id,
      approve:!member.can_approve_rewards,
    });
    setModerationBusy(null);
    setMsg(error?.message || `${member.name} is ${member.can_approve_rewards ? "no longer" : "now"} a reward approver for ${team.name}`);
    if (!error) await refresh();
  }

  async function deleteTeam() {
    if (!deleteTeamTarget || deleteBusy || deleteConfirmation !== deleteTeamTarget.name) return;
    setDeleteBusy(true);
    const { error } = await supabase.rpc("delete_managed_team", {
      target_team_id:Number(deleteTeamTarget.id),
      expected_team_name:deleteConfirmation,
    });
    setDeleteBusy(false);
    setMsg(error?.message || `${deleteTeamTarget.name} was deleted`);
    if (!error) {
      setDeleteTeamTarget(null);
      setDeleteConfirmation("");
      setRosterTeam(null);
      await refresh();
    }
  }

  function challengesFor(teamId) {
    return teamChallenges.filter((challenge) => Number(challenge.team_id) === Number(teamId));
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
  function startNewChallenge(teamId) {
    const key = `new:${teamId}`;
    patchChallenge(key, defaultChallenge());
    setExpandedChallengeId(key);
  }
  async function saveTeamChallenge(team, challengeKey) {
    const edit = challengeFor(challengeKey);
    const isStake = edit.rewardType === "stake";
    let { data, error } = await supabase.rpc("set_team_weekly_challenge", {
      target_team_id:Number(team.id),
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
      const stakeResult = await supabase.rpc("set_team_challenge_stake", {
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

  const inviteCandidates = inviteTeam ? profiles.filter((candidate) => {
    const rosterIds = new Set(members.filter((m) => m.team_id === inviteTeam.id).map((m) => m.user_id));
    const blockedIds = new Set(blocksFor(inviteTeam.id).map((block) => block.user_id));
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
    <div style={{ background:BG, minHeight:"100vh", fontFamily:"'Inter',sans-serif" }} className="teams-page flex justify-center p-4 pt-10">
      <style>{`
        @media (max-width: 520px) {
          .teams-page-header {
            display:grid !important;
            grid-template-columns:44px minmax(0,1fr) 52px;
            align-items:center;
            column-gap:10px;
          }
          .teams-page-header-copy {
            grid-column:2;
            min-width:0;
          }
          .teams-page-new-button {
            grid-column:2 / 4;
            grid-row:2;
            justify-self:stretch;
            justify-content:center;
            margin-top:10px;
          }
        }
      `}</style>
      <div className="w-full max-w-md">
        <header className="teams-page-header flex items-center gap-3 mb-5">
          <BackButton onClick={onBack} ariaLabel="Back" />
          <div className="teams-page-header-copy flex-1"><h1 className="text-2xl font-bold" style={{ fontFamily:"'Fredoka',sans-serif" }}>Teams</h1><p className="text-xs opacity-45">Play together, your way</p></div>
          {!profile?.hidden_from_others && <button onClick={() => setComposerOpen((open) => !open)} className="gloss-button teams-page-new-button rounded-full px-3 py-2 text-xs font-semibold flex items-center gap-1" style={{ background:ACCENT,color:"#fff" }}><Plus size={14}/>New team</button>}
        </header>

        {!profile?.hidden_from_others && <div className="mb-4">
          {!emailInviteOpen ? <button className="gloss-button" onClick={() => setEmailInviteOpen(true)} className="w-full rounded-2xl px-4 py-3 flex items-center gap-3 text-left" style={{ background:"#fff",border:"1px solid rgba(16,24,40,.08)" }}><span className="grid place-items-center rounded-xl" style={{ width:34,height:34,background:"rgba(47,111,237,.09)",color:ACCENT }}><Mail size={15}/></span><span className="flex-1"><span className="block text-xs font-semibold">Invite someone new</span><span className="block text-[10px] opacity-45 mt-0.5">Send an email to someone who isn’t here yet</span></span><ChevronDown size={14} style={{ opacity:.3 }}/></button>
            : <form onSubmit={inviteByEmail} className="rounded-3xl p-4" style={{ background:"#fff",border:"1px solid rgba(47,111,237,.16)" }}><div className="text-sm font-bold">Invite by email</div><div className="text-[11px] opacity-45 mt-0.5 mb-3">They’ll receive a link to create their account.</div><input autoFocus required type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="friend@example.com" className="w-full rounded-2xl border px-3 py-2.5 text-base outline-none"/><div className="grid grid-cols-2 gap-2 mt-3"><button className="gloss-button" type="button" onClick={() => { setEmailInviteOpen(false);setInviteEmail(""); }} className="rounded-full py-2.5 text-xs font-semibold" style={{ background:"rgba(16,24,40,.05)" }}>Cancel</button><button disabled={emailInviteBusy || !inviteEmail.trim()} className="gloss-button rounded-full py-2.5 text-xs font-semibold text-white disabled:opacity-40" style={{ background:ACCENT }}>{emailInviteBusy ? "Sending…" : "Send invitation"}</button></div></form>}
        </div>}

        {msg && <div className="rounded-xl p-3 mb-3 text-xs" style={{ background:"rgba(47,111,237,.08)" }}>{msg}</div>}
        {loadError && <div className="rounded-2xl p-3 mb-3 text-xs flex items-center gap-3" style={{ background:"rgba(181,67,58,.08)",color:"#9F2F2A" }}><span className="flex-1">{loadError}</span><button type="button" onClick={refresh} className="gloss-button rounded-full px-3 py-1.5 font-semibold" style={{ background:"#fff" }}>Retry</button></div>}
        {invitations.length > 0 && <div className="rounded-3xl p-4 mb-4" style={{ background:"#FFF8E7",border:"1px solid rgba(217,174,88,.22)" }}>
          <div className="text-xs font-bold mb-2">Team invitations</div>
          {invitations.map((item) => <div key={item.invitation_id} className="flex items-center gap-2 py-2">
            <span className="text-xl">{item.team_emoji || "⭐"}</span>
            <div className="flex-1 min-w-0"><div className="text-xs font-semibold truncate">{item.team_name}</div><div className="text-[10px] opacity-45">{item.inviter_icon || "🙂"} {item.inviter_name || "A player"} invited you</div></div>
            <button className="gloss-button" onClick={() => decideInvitation(item.invitation_id,false)} className="rounded-full px-2.5 py-1.5 text-[10px]" style={{ background:"rgba(16,24,40,.05)" }}>Decline</button>
            <button className="gloss-button" onClick={() => decideInvitation(item.invitation_id,true)} className="rounded-full px-2.5 py-1.5 text-[10px] font-semibold text-white" style={{ background:ACCENT }}>Join</button>
          </div>)}
        </div>}
        {profile?.hidden_from_others && <div className="rounded-xl p-3 mb-3 text-xs" style={{ background:"rgba(181,67,58,.1)",color:"#B5433A" }}>Your account is hidden, so team changes are disabled.</div>}

        {composerOpen && <form onSubmit={create} className="rounded-3xl p-4 mb-5" style={{ background:PANEL,border:"1px solid rgba(47,111,237,.16)",boxShadow:"0 16px 38px rgba(47,111,237,.10)" }}>
          <div className="text-sm font-bold">Create a team</div>
          <div className="text-[11px] opacity-45 mt-0.5 mb-3">Give it a name. We’ll suggest an icon.</div>
          <div className="flex gap-2">
            <button className="gloss-button" type="button" onClick={() => setEmojiPickerOpen((open) => !open)} className="team-icon-control rounded-2xl text-2xl shrink-0 flex items-center justify-center gap-0.5" style={{ width:54,background:"linear-gradient(145deg,#eef3ff,#fff)" }} aria-label="Choose team icon">{emoji}<ChevronDown size={11} style={{ opacity:.35 }}/></button>
            <input autoFocus value={name} onChange={(e) => updateName(e.target.value)} placeholder="Team name" className="flex-1 min-w-0 rounded-2xl border px-3 py-2.5 text-sm outline-none"/>
          </div>
          {emojiPickerOpen && <div className="mt-3 rounded-2xl p-2.5" style={{ background:"rgba(16,24,40,.035)" }}><div className="grid grid-cols-8 gap-1">{TEAM_EMOJIS.map((item) => <button className="gloss-button" type="button" key={item} onClick={() => { setEmoji(item);setEmojiTouched(true);setEmojiPickerOpen(false); }} className="rounded-xl text-lg" style={{ height:34,background:item === emoji ? "rgba(47,111,237,.14)" : "transparent" }}>{item}</button>)}</div></div>}
          <div className="flex gap-2 mt-3"><button className="gloss-button" type="button" onClick={() => setComposerOpen(false)} className="flex-1 rounded-full py-2.5 text-xs font-semibold" style={{ background:"rgba(16,24,40,.05)" }}>Cancel</button><button disabled={!name.trim()} className="gloss-button flex-1 rounded-full py-2.5 text-xs font-semibold text-white disabled:opacity-35" style={{ background:ACCENT }}>Create team</button></div>
        </form>}

        {loading ? <div className="space-y-3 py-2" role="status" aria-label="Loading teams">{[0,1,2].map((item) => <div key={item} className="h-[96px] rounded-3xl animate-pulse" style={{ background:"linear-gradient(90deg,#E9ECF2,#F5F6F9,#E9ECF2)" }}/>)}</div> : teams.length === 0 ? <div className="rounded-3xl p-6 text-center" style={{ background:"#fff",border:"1px solid rgba(16,24,40,.07)" }}><Users size={24} className="mx-auto opacity-25"/><div className="text-sm font-semibold mt-2">No teams yet</div><div className="text-[11px] opacity-45 mt-1">Create the first team when you’re ready.</div></div> : <div className="flex flex-col gap-3">{teams.map((team) => {
          const roster = rosterFor(team.id);
          const isMine = mine.has(team.id);
          const owner = team.created_by === user?.id;
          const manager = canManage(team);
          const myRequest = requests.find((r) => r.team_id === team.id && r.user_id === user?.id);
          const pending = requests.filter((r) => r.team_id === team.id && r.status === "pending");
          return <article key={team.id} className="rounded-3xl p-4" style={{ background:PANEL,border:"1px solid rgba(16,24,40,.08)",boxShadow:isMine ? "0 12px 32px rgba(47,111,237,.07)" : "none" }}>
            <div className="flex items-center gap-3">
              <div className="grid place-items-center rounded-2xl text-2xl" style={{ width:48,height:48,background:"linear-gradient(145deg,#f0f4ff,#fff)" }}>{team.emoji || "⭐"}</div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm flex items-center gap-1.5"><span className="truncate">{team.name}</span>{owner && <Crown size={12} style={{ color:"#D9AE58" }}/>}</div>
                <button className="gloss-button"
                  type="button"
                  disabled={manager || (!isMine && !profile?.is_admin)}
                  onClick={() => { setRosterTeam(team);setRosterQuery(""); }}
                  className="flex items-center mt-1 max-w-full text-left disabled:cursor-default"
                  aria-label={!manager && (isMine || profile?.is_admin) ? `View members of ${team.name}` : undefined}
                >
                  <div className="flex shrink-0">{roster.slice(0,3).map((member,index) => <span key={member.id} title={member.name} className="grid place-items-center rounded-full text-xs" style={{ width:24,height:24,background:"#F1F3F7",border:"2px solid white",marginLeft:index ? -6 : 0,zIndex:3-index }}>{member.icon || "🙂"}</span>)}</div>
                  <span className="text-[10px] opacity-50 ml-2 truncate">
                    {isMine && roster.length
                      ? `${roster.slice(0,2).map((member) => member.id === user?.id ? "You" : member.name).join(", ")}${roster.length > 2 ? ` +${roster.length - 2}` : ""}`
                      : `${roster.length} member${roster.length === 1 ? "" : "s"}`}
                    {!manager && (isMine || profile?.is_admin) ? " · View members" : ""}
                  </span>
                </button>
              </div>
              {manager ? <button className="gloss-button" onClick={() => { setRosterTeam(team);setRosterQuery(""); }} className="rounded-full px-3 py-2 text-xs font-semibold flex items-center gap-1" style={{ background:"rgba(47,111,237,.09)",color:ACCENT }}><Users size={13}/>Manage</button>
                : isMine ? <button className="gloss-button" onClick={() => { setRosterTeam(team);setRosterQuery(""); }} className="rounded-full px-3 py-2 text-xs font-semibold flex items-center gap-1" style={{ background:"rgba(47,111,237,.09)",color:ACCENT }}><Users size={13}/>Team</button>
                : myRequest?.status === "pending" ? <span className="text-[10px] opacity-45">Requested</span>
                : <button className="gloss-button" disabled={profile?.hidden_from_others} onClick={() => request(team.id)} className="rounded-full px-3 py-2 text-xs font-semibold" style={{ background:"rgba(47,111,237,.09)",color:ACCENT }}>Request to join</button>}
            </div>

            {manager && pending.length > 0 && (
              <div className="team-join-requests mt-3 rounded-2xl p-3" style={{ background:"rgba(217,174,88,.12)",border:"1px solid rgba(217,174,88,.20)" }}>
                <div className="team-join-requests-title text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color:"#8A681D" }}>Join requests</div>
                {pending.map((requestItem) => {
                  const candidate=byId[requestItem.user_id] || { id:requestItem.user_id,name:"Player",icon:"🙂" };
                  return (
                    <div key={requestItem.id} className="team-join-request flex items-center gap-2 py-2">
                      <span className="team-join-request-icon grid place-items-center rounded-full shrink-0">{candidate.icon || "🙂"}</span>
                      <span className="text-xs font-semibold flex-1 min-w-0 truncate">{candidate.name}</span>
                      <span className="team-join-request-actions flex items-center gap-1.5">
                        <button className="gloss-button team-join-action team-join-action--approve text-[11px] font-semibold" onClick={() => decide(requestItem.id,true)} style={{ color:"#15803D" }}>Approve</button>
                        <button className="gloss-button team-join-action team-join-action--decline text-[11px]" onClick={() => decide(requestItem.id,false)} style={{ color:"#755B22" }}>Decline</button>
                        <button className="gloss-button team-join-action team-join-action--block text-[11px]" onClick={() => moderateMember(team,candidate,"block")} style={{ color:"#B5433A" }}>Block</button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {myRequest && myRequest.status !== "pending" && !isMine && <div className="mt-3 rounded-xl p-2 text-xs flex items-center gap-2" style={{ background:myRequest.status === "approved" ? "rgba(22,163,74,.1)" : "rgba(181,67,58,.1)" }}>{myRequest.status === "approved" ? <Check size={13}/> : <X size={13}/>}Your request was {myRequest.status}.</div>}

          </article>;
        })}</div>}

        {rosterTeam && (() => {
          const roster = rosterFor(rosterTeam.id)
            .filter((member) => member.name?.toLowerCase().includes(rosterQuery.toLowerCase()))
            .sort((a,b) => Number(b.id === rosterTeam.created_by) - Number(a.id === rosterTeam.created_by) || a.name.localeCompare(b.name));
          const blocked = blocksFor(rosterTeam.id)
            .filter((member) => member.member_name?.toLowerCase().includes(rosterQuery.toLowerCase()));
          const manager = canManage(rosterTeam);
          const member = mine.has(rosterTeam.id);
          const owner = rosterTeam.created_by === user?.id;
          const rosterChallenges = challengesFor(rosterTeam.id);
          const newChallengeKey = `new:${rosterTeam.id}`;
          const visibleChallenges = expandedChallengeId === newChallengeKey
            ? [...rosterChallenges,{ challenge_id:newChallengeKey,challenge_title:"New challenge",isNew:true }]
            : rosterChallenges;
          return <div className="teams-manage-page fixed inset-0 z-50 flex justify-center overflow-y-auto" style={{ background:BG }}>
            <div className="teams-manage-shell w-full max-w-md p-4 pt-6 flex flex-col" style={{ background:BG,minHeight:"100dvh" }}>
              <div className="flex items-center gap-3 mb-3">
                <button className="gloss-button" onClick={() => { setRosterTeam(null);setDeleteTeamTarget(null);setDeleteConfirmation(""); }} className="grid place-items-center rounded-full shrink-0" style={{ width:36,height:36,background:"rgba(16,24,40,.05)" }} aria-label="Back to teams"><ArrowLeft size={17}/></button>
                <div className="grid place-items-center rounded-2xl text-2xl" style={{ width:44,height:44,background:"linear-gradient(145deg,#eef3ff,#fff)" }}>{rosterTeam.emoji || "⭐"}</div>
                <div className="flex-1 min-w-0"><div className="font-bold truncate">{owner ? `Manage ${rosterTeam.name}` : rosterTeam.name}</div><div className="text-[11px] opacity-45">Challenges, members and invites</div></div>
              </div>
              {member && <button className="gloss-button" onClick={() => { setInviteTeam(rosterTeam);setInviteQuery(""); }} className="w-full rounded-2xl px-4 py-3 mb-3 text-sm font-semibold flex items-center justify-center gap-2 text-white" style={{ background:ACCENT }}><UserPlus size={16}/>Invite a player</button>}

              {member && <div className="team-challenges-panel rounded-3xl p-4 mb-3" style={{ background:"#fff",border:"1px solid rgba(16,24,40,.07)" }}>
                <div className="flex items-center gap-2 mb-3"><div className="grid place-items-center rounded-xl" style={{ width:34,height:34,background:"rgba(18,148,106,.09)",color:"#0B7C58" }}><CalendarDays size={15}/></div><div className="flex-1"><div className="text-sm font-bold">Challenges</div><div className="text-[10px] opacity-45">{rosterChallenges.length} this week</div></div>{owner && <button className="gloss-button" type="button" onClick={() => startNewChallenge(rosterTeam.id)} className="rounded-full px-3 py-2 text-[11px] font-semibold flex items-center gap-1" style={{ background:"rgba(47,111,237,.09)",color:ACCENT }}><Plus size={12}/>New</button>}</div>
                {visibleChallenges.length === 0 && <div className="rounded-2xl p-4 text-center" style={{ background:"#F7F8FB" }}><div className="text-xs font-semibold">No challenge yet</div><div className="text-[10px] opacity-45 mt-1">{owner ? "Create one for your team to play this week." : "The owner hasn’t created one this week."}</div></div>}
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
                      <button className="gloss-button" type="button" onClick={() => setExpandedChallengeId(challengeOpen ? null : challengeKey)} className="w-full flex items-center gap-2 p-3 text-left">
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
                          <div className="flex flex-wrap gap-1.5">{buildTeamChallengeRounds({ activeDays:edit.days,gameIds:edit.games }).map((round) => <span key={round.date} className="rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize" style={{ background:"#fff",color:INK }}>{DAYS[round.isoDay-1]?.label} · {round.game}</span>)}</div>
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
                        <div className="mt-4"><span className="text-[11px] font-semibold flex items-center gap-1 mb-2"><Gift size={12}/>Winner’s prize</span>{owner && <div className="flex gap-2 mb-2">{["points","prize","stake"].map((type) => <button className="gloss-button" key={type} type="button" disabled={edit.locked} onClick={() => patchChallenge(challengeKey,{ rewardType:type })} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background:edit.rewardType === type ? "rgba(47,111,237,.14)" : "rgba(16,24,40,.05)",color:edit.rewardType === type ? ACCENT : INK }}>{type === "points" ? "Points" : type === "prize" ? "Real prize" : "Stake an item"}</button>)}</div>}
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
                        {owner && <button className="gloss-button" disabled={edit.locked || !edit.title.trim() || !edit.games.length || !edit.days.length || !edit.schedule || (edit.schedule === "repeat" && (edit.durationWeeks < 2 || edit.durationWeeks > 52))} type="button" onClick={() => saveTeamChallenge(rosterTeam,challengeKey)} className="mt-3 w-full rounded-full py-2.5 text-xs font-semibold text-white disabled:opacity-35" style={{ background:ACCENT }}>{challenge.isNew ? "Create challenge" : "Save changes"}</button>}
                      </div>}
                    </div>;
                  })}
                </div>
              </div>}

              <div className="team-members-panel rounded-3xl p-3 sm:p-4" style={{ background:"#fff",border:"1px solid rgba(16,24,40,.07)" }}>
              <div className="flex items-center justify-between px-1 mb-3"><div className="text-sm font-bold">Members</div><div className="text-[11px] opacity-45">{rosterFor(rosterTeam.id).length}</div></div>
              {rosterFor(rosterTeam.id).length + blocksFor(rosterTeam.id).length > 6 && <label className="flex items-center gap-2 rounded-2xl px-3 py-2.5 mb-3" style={{ background:"#F4F6FA" }}><Search size={15} style={{ opacity:.4 }}/><input value={rosterQuery} onChange={(event) => setRosterQuery(event.target.value)} placeholder="Find a member…" className="flex-1 bg-transparent outline-none text-base"/></label>}
              <div className="space-y-2 pr-0.5">
                {roster.map((member) => {
                  const teamOwner = member.id === rosterTeam.created_by;
                  const isMe = member.id === user?.id;
                  return <div key={member.id} className="rounded-2xl p-3" style={{ background:isMe ? "rgba(47,111,237,.07)" : "#F8F9FC" }}>
                    <div className="flex items-center gap-3">
                      <span className="team-member-icon grid place-items-center rounded-xl text-xl" style={{ width:38,height:38,background:"#fff" }}>{member.icon || "🙂"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5"><span className="text-sm font-semibold truncate">{isMe ? `${member.name} (you)` : member.name}</span>{teamOwner && <Crown size={11} style={{ color:"#D9AE58" }}/>}{(teamOwner || member.can_approve_rewards) && <ShieldCheck size={11} style={{ color:"#12946A" }}/>}</div>
                        <div className="text-[10px] opacity-40 truncate">{teamOwner ? "Team owner" : member.mood || "Team member"}{member.can_approve_rewards && !teamOwner ? " · Reward approver" : ""}</div>
                      </div>
                      {manager && !teamOwner && !isMe && <div className="flex gap-1">
                        <button className="gloss-button" disabled={!!moderationBusy} onClick={() => toggleRewardApprover(rosterTeam,member)} className="grid place-items-center rounded-full" style={{ width:32,height:32,background:member.can_approve_rewards ? "rgba(18,148,106,.12)" : "rgba(16,24,40,.05)",color:member.can_approve_rewards ? "#12946A" : undefined }} aria-label={member.can_approve_rewards ? `Remove ${member.name} as reward approver` : `Make ${member.name} a reward approver`} title="Reward approver"><ShieldCheck size={13}/></button>
                        <button className="gloss-button" disabled={!!moderationBusy} onClick={() => moderateMember(rosterTeam,member,"remove")} className="grid place-items-center rounded-full" style={{ width:32,height:32,background:"rgba(16,24,40,.05)" }} aria-label={`Remove ${member.name}`} title="Remove"><UserMinus size={13}/></button>
                        <button className="gloss-button" disabled={!!moderationBusy} onClick={() => moderateMember(rosterTeam,member,"block")} className="grid place-items-center rounded-full" style={{ width:32,height:32,background:"rgba(181,67,58,.09)",color:"#B5433A" }} aria-label={`Block ${member.name}`} title="Block"><Ban size={13}/></button>
                      </div>}
                    </div>
                  </div>;
                })}
                {manager && blocked.length > 0 && <div className="pt-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide opacity-45 px-1 mb-2">Blocked · {blocked.length}</div>
                  {blocked.map((member) => <div key={member.user_id} className="flex items-center gap-3 rounded-2xl p-3 mb-2" style={{ background:"rgba(181,67,58,.055)" }}>
                    <span className="grid place-items-center rounded-xl text-xl grayscale opacity-60" style={{ width:38,height:38,background:"#fff" }}>{member.member_icon || "🙂"}</span>
                    <div className="flex-1 min-w-0"><div className="text-sm font-semibold truncate">{member.member_name || "Player"}</div><div className="text-[10px] opacity-40">Cannot join or be invited</div></div>
                    <button className="gloss-button" disabled={!!moderationBusy} onClick={() => moderateMember(rosterTeam,{ id:member.user_id,name:member.member_name || "Player" },"unblock")} className="rounded-full px-3 py-2 text-[11px] font-semibold flex items-center gap-1" style={{ background:"#fff",color:ACCENT }}><RotateCcw size={12}/>Unblock</button>
                  </div>)}
                </div>}
                {roster.length === 0 && blocked.length === 0 && <p className="text-center text-xs opacity-45 py-8">No matching members</p>}
              </div>
              {owner && <div className="mt-3 pt-3" style={{ borderTop:"1px solid rgba(16,24,40,.08)" }}>
                {deleteTeamTarget?.id !== rosterTeam.id ? <div className="flex items-center justify-between gap-3"><p className="text-[10px] opacity-40">Remove allows rejoining. Block prevents it.</p><button className="gloss-button" onClick={() => { setDeleteTeamTarget(rosterTeam);setDeleteConfirmation(""); }} className="shrink-0 rounded-full px-3 py-2 text-[11px] font-semibold flex items-center gap-1" style={{ background:"rgba(181,67,58,.08)",color:"#B5433A" }}><Trash2 size={12}/>Delete team</button></div>
                  : <div className="rounded-2xl p-3" style={{ background:"rgba(181,67,58,.06)" }}>
                    <div className="text-xs font-semibold" style={{ color:"#9F2F2A" }}>Delete this team permanently?</div>
                    <p className="text-[10px] opacity-50 mt-1">Type <strong>{rosterTeam.name}</strong> to confirm.</p>
                    <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={rosterTeam.name} className="w-full rounded-xl border px-3 py-2 text-base outline-none mt-2"/>
                    <div className="grid grid-cols-2 gap-2 mt-2"><button className="gloss-button" onClick={() => { setDeleteTeamTarget(null);setDeleteConfirmation(""); }} className="rounded-full py-2 text-[11px] font-semibold" style={{ background:"#fff" }}>Cancel</button><button disabled={deleteBusy || deleteConfirmation !== rosterTeam.name} onClick={deleteTeam} className="gloss-button rounded-full py-2 text-[11px] font-semibold text-white disabled:opacity-35" style={{ background:"#B5433A" }}>{deleteBusy ? "Deleting…" : "Delete permanently"}</button></div>
                  </div>}
              </div>}
              {member && !owner && <button className="gloss-button" disabled={leavingTeamId === rosterTeam.id} onClick={() => leave(rosterTeam)} className="mt-3 w-full rounded-full py-2.5 text-xs font-medium" style={{ background:"rgba(181,67,58,.07)",color:"#9F2F2A" }}>{leavingTeamId === rosterTeam.id ? "Leaving…" : "Leave team"}</button>}
              </div>
            </div>
          </div>;
        })()}

        {inviteTeam && <div className="fixed inset-0 z-[60] flex justify-center overflow-y-auto" style={{ background:BG }}><div className="w-full max-w-md p-4 pt-6" style={{ minHeight:"100dvh" }}><div className="flex items-center gap-3 mb-4"><button className="gloss-button" onClick={() => setInviteTeam(null)} className="grid place-items-center rounded-full" style={{ width:36,height:36,background:"rgba(16,24,40,.05)" }}><ArrowLeft size={17}/></button><div className="text-2xl">{inviteTeam.emoji || "⭐"}</div><div className="flex-1"><div className="font-bold">Invite to {inviteTeam.name}</div><div className="text-[11px] opacity-45">Choose an available player</div></div></div><div className="rounded-3xl p-4" style={{ background:"#fff" }}><label className="flex items-center gap-2 rounded-2xl px-3 py-2.5 mb-3" style={{ background:"#F4F6FA" }}><Search size={15} style={{ opacity:.4 }}/><input value={inviteQuery} onChange={(e) => setInviteQuery(e.target.value)} placeholder="Find a player…" className="flex-1 bg-transparent outline-none text-base"/></label>{inviteCandidates.length === 0 ? <div className="text-center py-8"><Users size={24} className="mx-auto opacity-25"/><p className="text-xs opacity-45 mt-2">No available players</p></div> : <div className="space-y-2">{inviteCandidates.map((candidate) => <div key={candidate.id} className="flex items-center gap-3 rounded-2xl p-3" style={{ background:"#F8F9FC" }}><span className="text-xl">{candidate.icon || "🙂"}</span><div className="flex-1 min-w-0"><div className="text-sm font-semibold truncate">{candidate.name}</div><div className="text-[10px] opacity-40">{candidate.mood || "Ready to play"}</div></div><button className="gloss-button" disabled={inviteBusy === candidate.id} onClick={() => invite(candidate.id)} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background:"rgba(47,111,237,.1)",color:ACCENT }}>{inviteBusy === candidate.id ? "Adding…" : "Invite"}</button></div>)}</div>}</div></div></div>}
      </div>
    </div>
  );
}
