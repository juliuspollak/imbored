import { useCallback, useEffect, useState } from "react";
import { Users, Plus, ShieldCheck, UserPlus, Mail, Check, X } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import { isCommunityVisibleProfile } from "./lib/profileVisibility.js";

const BG="#F1F3F7",PANEL="#fff",INK="#1B2129",ACCENT="#2F6FED";
const card={background:PANEL,border:"1px solid rgba(16,24,40,.09)",borderRadius:16};

export default function GuardianCircles({onBack}){
  const {user}=useAuth();
  const [circles,setCircles]=useState([]);
  const [rosters,setRosters]=useState({});
  const [invitations,setInvitations]=useState([]);
  const [players,setPlayers]=useState([]);
  const [loading,setLoading]=useState(true);
  const [msg,setMsg]=useState("");
  const [newName,setNewName]=useState("");
  const [inviteFor,setInviteFor]=useState(null);
  const [inviteQuery,setInviteQuery]=useState("");

  const refresh=useCallback(async()=>{
    setLoading(true);
    const [{data:c},{data:inv},{data:p}]=await Promise.all([
      supabase.rpc("get_my_circles"),
      supabase.rpc("get_my_pending_circle_invitations"),
      supabase.from("profiles").select("id,name,icon,is_private,hidden_from_others,account_deleted_at").neq("id",user.id).order("name"),
    ]);
    setCircles(c||[]);
    setInvitations(inv||[]);
    setPlayers((p||[]).filter(isCommunityVisibleProfile));
    const rosterEntries=await Promise.all((c||[]).map(async circle=>{
      const {data}=await supabase.rpc("get_circle_roster",{target_circle_id:circle.circle_id});
      return [circle.circle_id,data||[]];
    }));
    setRosters(Object.fromEntries(rosterEntries));
    setLoading(false);
  },[user.id]);
  useEffect(()=>{refresh()},[refresh]);

  async function createCircle(e){
    e.preventDefault();
    const {error}=await supabase.rpc("create_guardian_circle",{circle_name:newName});
    setMsg(error?.message||"Circle created");
    if(!error)setNewName("");
    refresh();
  }
  async function toggleApprove(circleId,memberId,approve){
    const {error}=await supabase.rpc("set_circle_approver",{target_circle_id:circleId,target_user_id:memberId,approve});
    setMsg(error?.message||"Updated");
    refresh();
  }
  async function invite(circleId,playerId){
    const {error}=await supabase.rpc("invite_to_circle",{target_circle_id:circleId,target_user_id:playerId});
    setMsg(error?.message||"Invited");
    if(!error)setInviteFor(null);
    refresh();
  }
  async function decide(invitationId,accept){
    const {error}=await supabase.rpc("decide_circle_invitation",{target_invitation_id:invitationId,accept_invitation:accept});
    setMsg(error?.message||(accept?"Joined circle":"Invitation declined"));
    refresh();
  }

  const inviteCandidates=inviteFor
    ? players.filter(p=>!(rosters[inviteFor]||[]).some(m=>m.user_id===p.id) && p.name.toLowerCase().includes(inviteQuery.toLowerCase()))
    : [];

  return <div style={{background:BG,minHeight:"100vh",fontFamily:"'Inter',sans-serif"}} className="p-4 pt-10 flex justify-center">
    <div className="w-full max-w-xl">
      <header className="flex items-center gap-3 mb-6">
        <BackButton onClick={onBack} ariaLabel="Back"/>
        <div><h1 className="text-2xl font-bold" style={{fontFamily:"'Fredoka',sans-serif",color:INK}}>Circles</h1><p className="text-xs opacity-45">Groups of guardians who jointly approve reward items</p></div>
      </header>
      {msg&&<div className="rounded-2xl px-3 py-2.5 mb-4 text-xs" style={{background:"rgba(47,111,237,.08)",color:INK}}>{msg}</div>}

      {invitations.length>0&&<div className="space-y-2 mb-4">
        <div className="text-xs font-bold uppercase tracking-wide opacity-40 px-1">Invitations</div>
        {invitations.map(i=><div key={i.invitation_id} className="p-3 flex items-center gap-3" style={{...card,border:"1px solid rgba(47,111,237,.25)"}}>
          <Mail size={16} style={{color:ACCENT}} className="shrink-0"/>
          <div className="flex-1 min-w-0 text-xs"><span className="font-semibold">{i.inviter_icon} {i.inviter_name}</span> invited you to <span className="font-semibold">{i.circle_name}</span></div>
          <button onClick={()=>decide(i.invitation_id,true)} className="grid place-items-center rounded-full shrink-0" style={{width:30,height:30,background:"rgba(22,163,74,.1)",color:"#166534"}} aria-label="Accept"><Check size={14}/></button>
          <button onClick={()=>decide(i.invitation_id,false)} className="grid place-items-center rounded-full shrink-0" style={{width:30,height:30,background:"rgba(181,67,58,.08)",color:"#B5433A"}} aria-label="Decline"><X size={14}/></button>
        </div>)}
      </div>}

      <form onSubmit={createCircle} className="p-4 mb-4 flex gap-2" style={card}>
        <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="New circle name, e.g. The Smiths" className="flex-1 min-w-0 border rounded-lg px-3 py-2 text-sm" style={{borderColor:"rgba(16,24,40,.12)"}} required/>
        <button className="rounded-xl px-4 text-white text-sm font-semibold flex items-center gap-1.5" style={{background:ACCENT}}><Plus size={14}/>Create</button>
      </form>

      {loading?<p className="text-sm text-center opacity-45 py-10">Loading…</p>
      :circles.length===0?<div className="p-6 text-center rounded-2xl" style={card}><Users size={22} style={{color:ACCENT,margin:"0 auto 8px"}}/><div className="text-sm font-semibold">No circles yet</div><div className="text-xs opacity-45 mt-1">Create one to start proposing reward items with other guardians.</div></div>
      :<div className="space-y-3">
        {circles.map(c=>{
          const roster=rosters[c.circle_id]||[];
          return <div key={c.circle_id} className="p-4" style={card}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="font-semibold text-sm truncate">{c.circle_name}</div>
              {c.can_approve&&<span className="rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0 flex items-center gap-1" style={{color:"#166534",background:"rgba(22,163,74,.1)"}}><ShieldCheck size={10}/>Approver</span>}
            </div>
            <div className="text-xs opacity-45 mb-3">{c.approver_count} approver{c.approver_count===1?"":"s"} · {c.member_count} member{c.member_count===1?"":"s"}</div>
            <div className="space-y-1.5">
              {roster.map(m=><div key={m.user_id} className="flex items-center gap-2">
                <span className="text-base">{m.icon||"🙂"}</span>
                <span className="flex-1 min-w-0 text-xs font-medium truncate">{m.name}{m.user_id===user.id?" (you)":""}</span>
                {c.can_approve&&m.user_id!==user.id&&<button onClick={()=>toggleApprove(c.circle_id,m.user_id,!m.can_approve)} className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{background:m.can_approve?"rgba(22,163,74,.1)":"rgba(16,24,40,.05)",color:m.can_approve?"#166534":INK}}>{m.can_approve?"Approver":"Make approver"}</button>}
                {!c.can_approve&&m.can_approve&&<span className="text-[10px] opacity-45">Approver</span>}
              </div>)}
            </div>
            {c.can_approve&&<button onClick={()=>{setInviteFor(c.circle_id);setInviteQuery("");}} className="w-full mt-3 rounded-xl py-2 text-xs font-semibold flex items-center justify-center gap-1.5" style={{background:"rgba(47,111,237,.08)",color:ACCENT}}><UserPlus size={13}/>Invite someone</button>}
          </div>;
        })}
      </div>}
    </div>

    {inviteFor&&<div className="fixed inset-0 z-50 grid place-items-center p-4" style={{background:"rgba(16,24,40,.45)"}}>
      <div className="w-full max-w-sm rounded-3xl p-5 max-h-[80vh] flex flex-col" style={{background:"#fff",boxShadow:"0 24px 60px rgba(16,24,40,.22)"}}>
        <div className="flex items-center justify-between mb-3"><h2 className="font-bold">Invite to circle</h2><button onClick={()=>setInviteFor(null)}><X size={16}/></button></div>
        <input value={inviteQuery} onChange={e=>setInviteQuery(e.target.value)} placeholder="Search players" className="w-full rounded-xl border px-3 py-2 text-sm mb-3" style={{borderColor:"rgba(16,24,40,.12)"}}/>
        <div className="overflow-y-auto flex-1 space-y-1.5">
          {inviteCandidates.length===0?<p className="text-xs text-center opacity-40 py-6">No players found.</p>:inviteCandidates.map(p=><button key={p.id} onClick={()=>invite(inviteFor,p.id)} className="w-full flex items-center gap-2.5 rounded-xl px-2 py-2 text-left" style={{background:"rgba(16,24,40,.03)"}}>
            <span className="text-lg">{p.icon||"🙂"}</span><span className="text-sm font-medium flex-1 min-w-0 truncate">{p.name}</span><UserPlus size={14} style={{color:ACCENT}}/>
          </button>)}
        </div>
      </div>
    </div>}
  </div>;
}
