import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft, CalendarDays, Check, ChevronDown, Crown, Gift,
  Lock, Plus, Search, Sparkles, UserMinus, UserPlus, Users, X,
} from "lucide-react";
import { useAuth } from "./lib/AuthContext.jsx";
import { supabase, supabaseReady } from "./lib/supabase.js";
import { attachRealtimeRefresh } from "./lib/realtimeRefresh.js";

const BG = "#F1F3F7";
const PANEL = "#fff";
const INK = "#1B2129";
const ACCENT = "#2F6FED";
const TEAM_EMOJIS = ["🎮","🧩","🚀","🔥","⭐","🏆","🦄","🐉","🦊","🐼","🌈","⚡","💎","👑","🎯","🛸"];
const DAYS = [{id:1,label:"Mon"},{id:2,label:"Tue"},{id:3,label:"Wed"},{id:4,label:"Thu"},{id:5,label:"Fri"},{id:6,label:"Sat"},{id:7,label:"Sun"}];
const DEFAULT_GAMES = ["queens","tango","zip","minisudoku","geo"];

function suggestEmoji(value) {
  const rules = [[/(space|star|galaxy|moon|astro)/,"🚀"],[/(fire|hot|flame)/,"🔥"],[/(king|queen|royal|crown)/,"👑"],[/(dragon)/,"🐉"],[/(fox)/,"🦊"],[/(panda)/,"🐼"],[/(rainbow|colour|color)/,"🌈"],[/(winner|champ|trophy)/,"🏆"],[/(target|aim|bull)/,"🎯"],[/(gem|diamond)/,"💎"],[/(magic|unicorn)/,"🦄"],[/(fast|bolt|lightning)/,"⚡"],[/(game|play)/,"🎮"],[/(puzzle|quiz|brain)/,"🧩"]];
  return rules.find(([pattern]) => pattern.test(value.toLowerCase()))?.[1] || "⭐";
}

const defaultChallenge = () => ({ games:[...DEFAULT_GAMES], days:[1,2,3,4,5,6,7], reward:100, rewardType:"points", rewardLabel:"", locked:false, challengeId:null });

export default function Teams({ onBack }) {
  const { user, profile, createTeam, addPlayerToTeam, joinTeam, leaveTeam } = useAuth();
  const [teams, setTeams] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [members, setMembers] = useState([]);
  const [memberProfiles, setMemberProfiles] = useState({});
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("⭐");
  const [emojiTouched, setEmojiTouched] = useState(false);
  const [inviteTeam, setInviteTeam] = useState(null);
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteBusy, setInviteBusy] = useState(null);
  const [rosterTeam, setRosterTeam] = useState(null);
  const [rosterQuery, setRosterQuery] = useState("");
  const [removeBusy, setRemoveBusy] = useState(null);
  const [leavingTeamId, setLeavingTeamId] = useState(null);
  const [expandedChallengeId, setExpandedChallengeId] = useState(null);
  const [challengeEdits, setChallengeEdits] = useState({});

  const refresh = useCallback(async () => {
    if (!supabaseReady) return;
    setLoading(true);
    const [{data:t},{data:p},{data:m},{data:r},{data:c},rosterResult] = await Promise.all([
      supabase.from("teams").select("*").order("created_at"),
      supabase.from("profiles").select("id,name,icon,mood,is_private,hidden_from_others,is_approved,account_deleted_at").order("name"),
      supabase.from("team_members").select("team_id,user_id"),
      supabase.from("team_join_requests").select("*").order("requested_at",{ascending:false}),
      supabase.rpc("get_my_active_team_challenges"),
      supabase.rpc("get_my_team_rosters"),
    ]);
    setTeams(t || []);
    setProfiles(p || []);
    setMembers(m || []);
    setMemberProfiles(Object.fromEntries((rosterResult.data || []).map((item) => [
      `${item.team_id}:${item.user_id}`,
      { id:item.user_id,name:item.member_name,icon:item.member_icon,mood:item.member_mood,is_owner:item.is_owner },
    ])));
    setRequests(r || []);
    setChallengeEdits((previous) => {
      const next = { ...previous };
      (c || []).forEach((item) => {
        next[item.team_id] = {
          games:item.game_ids || DEFAULT_GAMES,
          days:item.active_days || [1,2,3,4,5,6,7],
          reward:Number(item.reward_points ?? 100),
          rewardType:item.reward_type || "points",
          rewardLabel:item.reward_label || "",
          locked:!!item.is_locked,
          challengeId:item.challenge_id,
        };
      });
      return next;
    });
    setLoading(false);
    await supabase.rpc("mark_my_team_request_updates_seen");
  }, []);

  useEffect(() => {
    refresh();
    return attachRealtimeRefresh({
      channelName:`teams-${user?.id}`,
      tables:[{ name:"team_members" },{ name:"team_join_requests" }],
      refresh,
    });
  }, [refresh, user?.id]);

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
    setMsg(error?.message || `${byId[playerId]?.name || "Player"} joined ${inviteTeam.name}`);
    if (!error) refresh();
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
    refresh();
  }

  async function removeMember(team, member) {
    if (removeBusy || member.id === user?.id) return;
    setRemoveBusy(member.id);
    const { error } = await supabase.rpc("remove_player_from_team", {
      target_team_id:Number(team.id),
      target_user_id:member.id,
    });
    setRemoveBusy(null);
    setMsg(error?.message || `${member.name} was removed from ${team.name}`);
    if (!error) await refresh();
  }

  function challengeFor(teamId) { return challengeEdits[teamId] || defaultChallenge(); }
  function patchChallenge(teamId, patch) { setChallengeEdits((previous) => ({ ...previous, [teamId]:{ ...defaultChallenge(), ...(previous[teamId] || {}), ...patch } })); }
  function toggleChallengeGame(teamId, game) {
    const edit = challengeFor(teamId);
    if (!edit.locked) patchChallenge(teamId, { games:edit.games.includes(game) ? edit.games.filter((item) => item !== game) : [...edit.games,game] });
  }
  function toggleDay(teamId, day) {
    const edit = challengeFor(teamId);
    if (!edit.locked) patchChallenge(teamId, { days:edit.days.includes(day) ? edit.days.filter((item) => item !== day) : [...edit.days,day].sort() });
  }
  async function saveTeamChallenge(team) {
    const edit = challengeFor(team.id);
    const { error } = await supabase.rpc("set_team_weekly_challenge", {
      target_team_id:Number(team.id),
      selected_games:edit.games,
      selected_days:edit.days.map(Number),
      reward_points_in:edit.rewardType === "points" ? Number(edit.reward) || 0 : 0,
      reward_type_in:edit.rewardType,
      reward_label_in:edit.rewardType === "prize" ? edit.rewardLabel?.trim() || null : null,
    });
    setMsg(error?.message || "Weekly challenge saved");
    if (!error) refresh();
  }

  const inviteCandidates = inviteTeam ? profiles.filter((candidate) => {
    const rosterIds = new Set(members.filter((m) => m.team_id === inviteTeam.id).map((m) => m.user_id));
    return candidate.id !== user?.id
      && !rosterIds.has(candidate.id)
      && !candidate.is_private
      && !candidate.hidden_from_others
      && candidate.is_approved !== false
      && !candidate.account_deleted_at
      && candidate.name?.toLowerCase().includes(inviteQuery.toLowerCase());
  }) : [];

  return (
    <div style={{ background:BG, minHeight:"100vh", fontFamily:"'Inter',sans-serif" }} className="flex justify-center p-4 pt-10">
      <div className="w-full max-w-md">
        <header className="flex items-center gap-3 mb-5">
          <button onClick={onBack} className="grid place-items-center rounded-full" style={{ width:36,height:36,background:"rgba(16,24,40,.05)" }} aria-label="Back"><ArrowLeft size={17}/></button>
          <div className="flex-1"><h1 className="text-2xl font-bold" style={{ fontFamily:"'Fredoka',sans-serif" }}>Teams</h1><p className="text-xs opacity-45">Play together, your way</p></div>
          {!profile?.hidden_from_others && <button onClick={() => setComposerOpen((open) => !open)} className="rounded-full px-3 py-2 text-xs font-semibold text-white flex items-center gap-1" style={{ background:ACCENT }}><Plus size={14}/>New team</button>}
        </header>

        {msg && <div className="rounded-xl p-3 mb-3 text-xs" style={{ background:"rgba(47,111,237,.08)" }}>{msg}</div>}
        {profile?.hidden_from_others && <div className="rounded-xl p-3 mb-3 text-xs" style={{ background:"rgba(181,67,58,.1)",color:"#B5433A" }}>Your account is hidden, so team changes are disabled.</div>}

        {composerOpen && <form onSubmit={create} className="rounded-3xl p-4 mb-5" style={{ background:PANEL,border:"1px solid rgba(47,111,237,.16)",boxShadow:"0 16px 38px rgba(47,111,237,.10)" }}>
          <div className="text-sm font-bold">Create a team</div>
          <div className="text-[11px] opacity-45 mt-0.5 mb-3">Give it a name. We’ll suggest an icon.</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEmojiPickerOpen((open) => !open)} className="rounded-2xl text-2xl shrink-0 flex items-center justify-center gap-0.5" style={{ width:54,background:"linear-gradient(145deg,#eef3ff,#fff)" }} aria-label="Choose team icon">{emoji}<ChevronDown size={11} style={{ opacity:.35 }}/></button>
            <input autoFocus value={name} onChange={(e) => updateName(e.target.value)} placeholder="Team name" className="flex-1 min-w-0 rounded-2xl border px-3 py-2.5 text-sm outline-none"/>
          </div>
          {emojiPickerOpen && <div className="mt-3 rounded-2xl p-2.5" style={{ background:"rgba(16,24,40,.035)" }}><div className="grid grid-cols-8 gap-1">{TEAM_EMOJIS.map((item) => <button type="button" key={item} onClick={() => { setEmoji(item);setEmojiTouched(true);setEmojiPickerOpen(false); }} className="rounded-xl text-lg" style={{ height:34,background:item === emoji ? "rgba(47,111,237,.14)" : "transparent" }}>{item}</button>)}</div></div>}
          <div className="flex gap-2 mt-3"><button type="button" onClick={() => setComposerOpen(false)} className="flex-1 rounded-full py-2.5 text-xs font-semibold" style={{ background:"rgba(16,24,40,.05)" }}>Cancel</button><button disabled={!name.trim()} className="flex-1 rounded-full py-2.5 text-xs font-semibold text-white disabled:opacity-35" style={{ background:ACCENT }}>Create team</button></div>
        </form>}

        {loading ? <p className="text-center opacity-40 py-8">Loading…</p> : <div className="flex flex-col gap-3">{teams.map((team) => {
          const roster = rosterFor(team.id);
          const isMine = mine.has(team.id);
          const owner = team.created_by === user?.id;
          const myRequest = requests.find((r) => r.team_id === team.id && r.user_id === user?.id);
          const pending = requests.filter((r) => r.team_id === team.id && r.status === "pending");
          const edit = challengeFor(team.id);
          const challengeOpen = expandedChallengeId === team.id;
          return <article key={team.id} className="rounded-3xl p-4" style={{ background:PANEL,border:"1px solid rgba(16,24,40,.08)",boxShadow:isMine ? "0 12px 32px rgba(47,111,237,.07)" : "none" }}>
            <div className="flex items-center gap-3">
              <div className="grid place-items-center rounded-2xl text-2xl" style={{ width:48,height:48,background:"linear-gradient(145deg,#f0f4ff,#fff)" }}>{team.emoji || "⭐"}</div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm flex items-center gap-1.5"><span className="truncate">{team.name}</span>{owner && <Crown size={12} style={{ color:"#D9AE58" }}/>}</div>
                <button
                  type="button"
                  disabled={!isMine}
                  onClick={() => { setRosterTeam(team);setRosterQuery(""); }}
                  className="flex items-center mt-1 max-w-full text-left disabled:cursor-default"
                  aria-label={isMine ? `View members of ${team.name}` : undefined}
                >
                  <div className="flex shrink-0">{roster.slice(0,3).map((member,index) => <span key={member.id} title={member.name} className="grid place-items-center rounded-full text-xs" style={{ width:24,height:24,background:"#F1F3F7",border:"2px solid white",marginLeft:index ? -6 : 0,zIndex:3-index }}>{member.icon || "🙂"}</span>)}</div>
                  <span className="text-[10px] opacity-50 ml-2 truncate">
                    {isMine && roster.length
                      ? `${roster.slice(0,2).map((member) => member.id === user?.id ? "You" : member.name).join(", ")}${roster.length > 2 ? ` +${roster.length - 2}` : ""}`
                      : `${roster.length} member${roster.length === 1 ? "" : "s"}`}
                    {isMine ? " · View all" : ""}
                  </span>
                </button>
              </div>
              {owner ? <button onClick={() => { setInviteTeam(team);setInviteQuery(""); }} className="rounded-full px-3 py-2 text-xs font-semibold flex items-center gap-1" style={{ background:"rgba(47,111,237,.09)",color:ACCENT }}><UserPlus size={13}/>Invite</button>
                : isMine ? <button disabled={leavingTeamId === team.id} onClick={() => leave(team)} className="rounded-full px-3 py-2 text-xs font-medium" style={{ background:"rgba(181,67,58,.07)",color:"#9F2F2A" }}>{leavingTeamId === team.id ? "Leaving…" : "Leave"}</button>
                : myRequest?.status === "pending" ? <span className="text-[10px] opacity-45">Requested</span>
                : <button disabled={profile?.hidden_from_others} onClick={() => request(team.id)} className="rounded-full px-3 py-2 text-xs font-semibold" style={{ background:"rgba(47,111,237,.09)",color:ACCENT }}>Request to join</button>}
            </div>

            {owner && pending.length > 0 && <div className="mt-3 rounded-2xl p-3" style={{ background:"#FFF8E7" }}><div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color:"#8A681D" }}>Join requests</div>{pending.map((requestItem) => <div key={requestItem.id} className="flex items-center gap-2 py-1"><span>{byId[requestItem.user_id]?.icon || "🙂"}</span><span className="text-xs flex-1">{byId[requestItem.user_id]?.name || "Player"}</span><button onClick={() => decide(requestItem.id,true)} className="text-[11px] font-semibold" style={{ color:"#15803D" }}>Approve</button><button onClick={() => decide(requestItem.id,false)} className="text-[11px]" style={{ color:"#B5433A" }}>Decline</button></div>)}</div>}
            {myRequest && myRequest.status !== "pending" && !isMine && <div className="mt-3 rounded-xl p-2 text-xs flex items-center gap-2" style={{ background:myRequest.status === "approved" ? "rgba(22,163,74,.1)" : "rgba(181,67,58,.1)" }}>{myRequest.status === "approved" ? <Check size={13}/> : <X size={13}/>}Your request was {myRequest.status}.</div>}

            {owner && <div className="mt-3 pt-3" style={{ borderTop:"1px solid rgba(16,24,40,.07)" }}>
              <button onClick={() => setExpandedChallengeId(challengeOpen ? null : team.id)} className="w-full flex items-center gap-2 text-left"><div className="grid place-items-center rounded-xl" style={{ width:34,height:34,background:"rgba(18,148,106,.09)",color:"#0B7C58" }}><CalendarDays size={15}/></div><div className="flex-1"><div className="text-xs font-semibold">Weekly challenge</div><div className="text-[10px] opacity-45">{edit.games.length} games · {edit.rewardType === "points" ? `${edit.reward} pts` : edit.rewardLabel || "Prize"}</div></div>{edit.locked && <Lock size={12} style={{ color:"#8A681D" }}/>}<ChevronDown size={15} style={{ opacity:.35,transform:challengeOpen ? "rotate(180deg)" : "none" }}/></button>
              {challengeOpen && <div className="mt-3">
                {edit.locked && <div className="rounded-xl p-2.5 text-[11px]" style={{ background:"rgba(217,174,88,.10)",color:"#775B1D" }}>Locked because a member started this week’s challenge.</div>}
                <div className="text-[11px] font-semibold mt-3 mb-2">Games</div><div className="flex flex-wrap gap-2">{DEFAULT_GAMES.map((game) => { const chosen=edit.games.includes(game);return <button disabled={edit.locked} type="button" key={game} onClick={() => toggleChallengeGame(team.id,game)} className="rounded-full px-3 py-1.5 text-xs capitalize disabled:opacity-55" style={{ background:chosen ? "rgba(47,111,237,.12)" : "rgba(16,24,40,.05)",color:chosen ? ACCENT : INK }}>{game}</button>; })}</div>
                <div className="text-[11px] font-semibold mt-4 mb-2">Playing days</div><div className="grid grid-cols-7 gap-1">{DAYS.map((day) => { const chosen=edit.days.includes(day.id);return <button disabled={edit.locked} type="button" key={day.id} onClick={() => toggleDay(team.id,day.id)} className="rounded-lg py-2 text-[10px] font-semibold disabled:opacity-55" style={{ background:chosen ? "rgba(18,148,106,.12)" : "rgba(16,24,40,.05)",color:chosen ? "#0B7C58" : INK }}>{day.label}</button>; })}</div>
                <div className="mt-4"><span className="text-[11px] font-semibold flex items-center gap-1 mb-2"><Gift size={12}/>Reward</span><div className="flex gap-2 mb-2">{["points","prize"].map((type) => <button key={type} type="button" disabled={edit.locked} onClick={() => patchChallenge(team.id,{ rewardType:type })} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background:edit.rewardType === type ? "rgba(47,111,237,.14)" : "rgba(16,24,40,.05)",color:edit.rewardType === type ? ACCENT : INK }}>{type === "points" ? "Points" : "Real prize"}</button>)}</div>{edit.rewardType === "points" ? <div className="flex items-center rounded-xl border px-3"><input disabled={edit.locked} type="number" min="0" max="100000" value={edit.reward} onChange={(e) => patchChallenge(team.id,{ reward:e.target.value })} className="w-full py-2 text-sm bg-transparent outline-none"/><span className="text-xs opacity-45">points</span></div> : <input disabled={edit.locked} value={edit.rewardLabel} onChange={(e) => patchChallenge(team.id,{ rewardLabel:e.target.value })} placeholder="e.g. Movie ticket" className="w-full rounded-xl border px-3 py-2 text-sm"/>}</div>
                <button disabled={edit.locked || !edit.games.length || !edit.days.length} type="button" onClick={() => saveTeamChallenge(team)} className="mt-3 w-full rounded-full py-2.5 text-xs font-semibold text-white disabled:opacity-35" style={{ background:ACCENT }}>Save challenge</button>
              </div>}
            </div>}
          </article>;
        })}</div>}

        {rosterTeam && (() => {
          const roster = rosterFor(rosterTeam.id)
            .filter((member) => member.name?.toLowerCase().includes(rosterQuery.toLowerCase()))
            .sort((a,b) => Number(b.id === rosterTeam.created_by) - Number(a.id === rosterTeam.created_by) || a.name.localeCompare(b.name));
          const owner = rosterTeam.created_by === user?.id;
          return <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background:"rgba(16,24,40,.42)" }}>
            <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl p-4 flex flex-col" style={{ background:"#fff",maxHeight:"84vh" }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="grid place-items-center rounded-2xl text-2xl" style={{ width:44,height:44,background:"linear-gradient(145deg,#eef3ff,#fff)" }}>{rosterTeam.emoji || "⭐"}</div>
                <div className="flex-1 min-w-0"><div className="font-bold truncate">{rosterTeam.name}</div><div className="text-[11px] opacity-45">{rosterFor(rosterTeam.id).length} members</div></div>
                <button onClick={() => setRosterTeam(null)} className="grid place-items-center rounded-full" style={{ width:32,height:32,background:"rgba(16,24,40,.05)" }} aria-label="Close members"><X size={15}/></button>
              </div>
              {rosterFor(rosterTeam.id).length > 6 && <label className="flex items-center gap-2 rounded-2xl px-3 py-2.5 mb-3" style={{ background:"#F4F6FA" }}><Search size={15} style={{ opacity:.4 }}/><input value={rosterQuery} onChange={(event) => setRosterQuery(event.target.value)} placeholder="Find a member…" className="flex-1 bg-transparent outline-none text-sm"/></label>}
              <div className="space-y-2 overflow-y-auto overscroll-contain pr-0.5">
                {roster.map((member) => {
                  const teamOwner = member.id === rosterTeam.created_by;
                  const isMe = member.id === user?.id;
                  return <div key={member.id} className="flex items-center gap-3 rounded-2xl p-3" style={{ background:isMe ? "rgba(47,111,237,.07)" : "#F8F9FC" }}>
                    <span className="grid place-items-center rounded-xl text-xl" style={{ width:38,height:38,background:"#fff" }}>{member.icon || "🙂"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5"><span className="text-sm font-semibold truncate">{isMe ? `${member.name} (you)` : member.name}</span>{teamOwner && <Crown size={11} style={{ color:"#D9AE58" }}/>}</div>
                      <div className="text-[10px] opacity-40 truncate">{teamOwner ? "Team owner" : member.mood || "Team member"}</div>
                    </div>
                    {owner && !teamOwner && !isMe && <button disabled={removeBusy === member.id} onClick={() => removeMember(rosterTeam,member)} className="grid place-items-center rounded-full" style={{ width:34,height:34,background:"rgba(181,67,58,.08)",color:"#B5433A" }} aria-label={`Remove ${member.name}`} title={`Remove ${member.name}`}><UserMinus size={14}/></button>}
                  </div>;
                })}
                {roster.length === 0 && <p className="text-center text-xs opacity-45 py-8">No matching members</p>}
              </div>
              {owner && <p className="text-[10px] opacity-40 text-center mt-3">As team owner, you can remove members here.</p>}
            </div>
          </div>;
        })()}

        {inviteTeam && <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background:"rgba(16,24,40,.42)" }}><div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl p-4" style={{ background:"#fff",maxHeight:"82vh",overflow:"auto" }}><div className="flex items-center gap-3 mb-3"><div className="text-2xl">{inviteTeam.emoji || "⭐"}</div><div className="flex-1"><div className="font-bold">Invite to {inviteTeam.name}</div><div className="text-[11px] opacity-45">Choose an available player</div></div><button onClick={() => setInviteTeam(null)} className="grid place-items-center rounded-full" style={{ width:32,height:32,background:"rgba(16,24,40,.05)" }}><X size={15}/></button></div><label className="flex items-center gap-2 rounded-2xl px-3 py-2.5 mb-3" style={{ background:"#F4F6FA" }}><Search size={15} style={{ opacity:.4 }}/><input value={inviteQuery} onChange={(e) => setInviteQuery(e.target.value)} placeholder="Find a player…" className="flex-1 bg-transparent outline-none text-sm"/></label>{inviteCandidates.length === 0 ? <div className="text-center py-8"><Users size={24} className="mx-auto opacity-25"/><p className="text-xs opacity-45 mt-2">No available players</p></div> : <div className="space-y-2">{inviteCandidates.map((candidate) => <div key={candidate.id} className="flex items-center gap-3 rounded-2xl p-3" style={{ background:"#F8F9FC" }}><span className="text-xl">{candidate.icon || "🙂"}</span><div className="flex-1 min-w-0"><div className="text-sm font-semibold truncate">{candidate.name}</div><div className="text-[10px] opacity-40">{candidate.mood || "Ready to play"}</div></div><button disabled={inviteBusy === candidate.id} onClick={() => invite(candidate.id)} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background:"rgba(47,111,237,.1)",color:ACCENT }}>{inviteBusy === candidate.id ? "Adding…" : "Invite"}</button></div>)}</div>}</div></div>}
      </div>
    </div>
  );
}
