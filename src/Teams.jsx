import { useState,useEffect,useCallback } from "react";
import { ArrowLeft,Plus,LogOut,Crown,Clock,Check,X,UserCheck } from "lucide-react";
import { useAuth } from "./lib/AuthContext.jsx";
import { supabase,supabaseReady } from "./lib/supabase.js";
const BG="#F1F3F7",PANEL="#fff",INK="#1B2129",ACCENT="#2F6FED";
export default function Teams({onBack}){
 const {user,profile,createTeam,joinTeam,leaveTeam}=useAuth();
 const [teams,setTeams]=useState([]),[profiles,setProfiles]=useState([]),[members,setMembers]=useState([]),[requests,setRequests]=useState([]),[loading,setLoading]=useState(true),[name,setName]=useState(""),[msg,setMsg]=useState("");
 const refresh=useCallback(async()=>{if(!supabaseReady)return;setLoading(true);const [{data:t},{data:p},{data:m},{data:r}]=await Promise.all([
  supabase.from("teams").select("*").order("created_at"),supabase.from("profiles").select("id,name,icon,mood,is_private,hidden_from_others"),supabase.from("team_members").select("team_id,user_id"),supabase.from("team_join_requests").select("*").order("requested_at",{ascending:false})]);setTeams(t||[]);setProfiles(p||[]);setMembers(m||[]);setRequests(r||[]);setLoading(false);await supabase.rpc("mark_my_team_request_updates_seen");},[]);
 useEffect(()=>{refresh()},[refresh]);
 const byId=Object.fromEntries(profiles.map(p=>[p.id,p])); const mine=new Set(members.filter(m=>m.user_id===user?.id).map(m=>m.team_id));
 async function create(e){e.preventDefault();if(!name.trim())return;const{error}=await createTeam(name.trim());setMsg(error?.message||"Team created");if(!error)setName("");refresh();}
 async function request(id){const{error}=await joinTeam(id);setMsg(error?.message||"Join request sent to the team owner");refresh();}
 async function decide(id,approve){const{error}=await supabase.rpc("decide_team_join_request",{request_id:id,approve});setMsg(error?.message||(approve?"Request approved":"Request declined"));refresh();}
 return <div style={{background:BG,minHeight:"100vh",fontFamily:"'Inter',sans-serif"}} className="flex justify-center p-4 pt-10"><div className="w-full max-w-md">
  <div className="flex items-center gap-3 mb-5"><button onClick={onBack} className="rounded-full flex items-center justify-center" style={{width:34,height:34,background:"rgba(16,24,40,.05)"}}><ArrowLeft size={16}/></button><h1 className="text-2xl font-bold" style={{fontFamily:"'Fredoka',sans-serif"}}>Teams</h1></div>
  {msg&&<div className="rounded-xl p-3 mb-3 text-xs" style={{background:"rgba(47,111,237,.08)"}}>{msg}</div>}
  {profile?.hidden_from_others&&<div className="rounded-xl p-3 mb-3 text-xs" style={{background:"rgba(181,67,58,.1)",color:"#B5433A"}}>Your account is hidden by an admin, so team join requests are disabled.</div>}
  <form onSubmit={create} className="flex gap-2 mb-5"><input value={name} onChange={e=>setName(e.target.value)} placeholder="New team name" className="flex-1 rounded-xl border px-3 py-2 text-sm"/><button className="rounded-xl px-3 text-white font-semibold flex items-center gap-1" style={{background:ACCENT}}><Plus size={14}/>Create</button></form>
  {loading?<p className="text-center opacity-40">Loading…</p>:<div className="flex flex-col gap-3">{teams.map(team=>{const roster=members.filter(m=>m.team_id===team.id).map(m=>byId[m.user_id]).filter(Boolean);const isMine=mine.has(team.id),owner=team.created_by===user?.id;const myReq=requests.find(r=>r.team_id===team.id&&r.user_id===user?.id);const pending=requests.filter(r=>r.team_id===team.id&&r.status==="pending");return <div key={team.id} className="rounded-2xl p-4" style={{background:PANEL,border:"1px solid rgba(16,24,40,.09)"}}>
   <div className="flex justify-between items-center"><div className="flex gap-2 items-center font-bold text-sm">{team.name}{owner&&<Crown size={13} style={{color:"#D9AE58"}}/>}</div>{isMine?<button onClick={async()=>{const{error}=await leaveTeam(team.id);setMsg(error?.message||"Left team");refresh()}} className="text-xs flex gap-1" style={{color:"#B5433A"}}><LogOut size={12}/>Leave</button>:myReq?.status==="pending"?<span className="text-xs flex gap-1 opacity-50"><Clock size={12}/>Requested</span>:<button disabled={profile?.hidden_from_others} onClick={()=>request(team.id)} className="text-xs font-semibold disabled:opacity-30" style={{color:ACCENT}}>Request to join</button>}</div>
   <div className="flex flex-wrap gap-1.5 mt-3">{roster.map(m=><span key={m.id} className="rounded-full px-2 py-1 text-xs" style={{background:"rgba(16,24,40,.05)"}}>{m.icon||"🙂"} {m.name}</span>)}</div>
   {myReq&&myReq.status!=="pending"&&!isMine&&<div className="mt-3 rounded-xl p-2 text-xs flex items-center gap-2" style={{background:myReq.status==="approved"?"rgba(22,163,74,.1)":"rgba(181,67,58,.1)"}}>{myReq.status==="approved"?<Check size={13}/>:<X size={13}/>}Your request was {myReq.status}.</div>}
   {owner&&pending.length>0&&<div className="mt-4 pt-3 border-t"><div className="text-xs font-semibold mb-2 flex gap-1"><UserCheck size={13}/>Join requests</div>{pending.map(r=><div key={r.id} className="flex justify-between items-center py-1"><span className="text-xs">{byId[r.user_id]?.icon||"🙂"} {byId[r.user_id]?.name||"Player"}</span><div className="flex gap-2"><button onClick={()=>decide(r.id,true)} className="text-xs" style={{color:"#15803D"}}>Approve</button><button onClick={()=>decide(r.id,false)} className="text-xs" style={{color:"#B5433A"}}>Decline</button></div></div>)}</div>}
  </div>})}</div>}
  <p className="text-[11px] text-center opacity-35 mt-6">Joining a team now requires approval from the person who created it.</p>
 </div></div>
}
