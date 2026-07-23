import { useCallback, useEffect, useMemo, useState } from "react";
import { Home, Star, Flame, Trophy, Gift, Send, Plus, ShieldCheck, ExternalLink } from "lucide-react";
import { supabase } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";

const BG="#F1F3F7", PANEL="#fff", INK="#1B2129", ACCENT="#2F6FED";
const card={background:PANEL,border:"1px solid rgba(16,24,40,.09)",borderRadius:16};
function nextLevelThreshold(level){ return 500 * level * level; }

export default function Progress({ onBack }) {
  const { user } = useAuth();
  const [progress,setProgress]=useState(null), [rules,setRules]=useState(null), [rewards,setRewards]=useState([]), [wishes,setWishes]=useState([]), [players,setPlayers]=useState([]);
  const [tab,setTab]=useState("rewards"), [message,setMessage]=useState(""), [loading,setLoading]=useState(true);
  const [wish,setWish]=useState({name:"",product_url:"",note:""});
  const [transfer,setTransfer]=useState({player:"",amount:""});

  const refresh=useCallback(async()=>{
    setLoading(true);
    await supabase.rpc("ensure_player_progress",{uid:user.id});
    const [{data:p},{data:r},{data:rw},{data:w},{data:ps}] = await Promise.all([
      supabase.from("player_progress").select("*").eq("player_id",user.id).single(),
      supabase.from("reward_rules").select("*").eq("is_active",true).maybeSingle(),
      supabase.from("rewards").select("*").eq("is_active",true).order("points_cost"),
      supabase.from("reward_wishes").select("*").eq("player_id",user.id).order("created_at",{ascending:false}),
      supabase.from("profiles").select("id,name,icon").neq("id",user.id).order("name")
    ]);
    setProgress(p); setRules(r); setRewards(rw||[]); setWishes(w||[]); setPlayers(ps||[]); setLoading(false);
  },[user.id]);
  useEffect(()=>{refresh()},[refresh]);

  const pct=useMemo(()=>{if(!progress)return 0; const prev=500*(progress.current_level-1)*(progress.current_level-1); const next=nextLevelThreshold(progress.current_level); return Math.max(0,Math.min(100,((progress.lifetime_points-prev)/(next-prev))*100));},[progress]);
  const today=new Date(); today.setHours(0,0,0,0); const last=progress?.last_completed_date ? new Date(progress.last_completed_date+"T00:00:00") : null;
  const canProtect=last && Math.round((today-last)/86400000)===2 && !(progress?.streak_protected_through);

  async function redeem(id){ if(!confirm("Redeem this reward with your Points?"))return; const {error}=await supabase.rpc("redeem_reward",{target_reward_id:id,note:null}); setMessage(error?.message||"Reward requested"); refresh(); }
  async function submitWish(e){e.preventDefault(); if(!wish.name.trim())return; const {error}=await supabase.from("reward_wishes").insert({player_id:user.id,...wish}); setMessage(error?.message||"Wish sent to admin"); if(!error)setWish({name:"",product_url:"",note:""}); refresh();}
  async function sendPoints(e){e.preventDefault(); const amount=Number(transfer.amount); const {error}=await supabase.rpc("transfer_points",{target_player_id:transfer.player,amount}); setMessage(error?.message||"Points sent"); if(!error)setTransfer({player:"",amount:""}); refresh();}
  async function protect(){const {error}=await supabase.rpc("protect_streak"); setMessage(error?.message||"Streak protected"); refresh();}

  return <div style={{background:BG,minHeight:"100vh",fontFamily:"'Inter',sans-serif"}} className="p-4 pt-10 flex justify-center"><div className="w-full max-w-md">
    <div className="flex items-center gap-3 mb-5"><button onClick={onBack} className="nav-btn flex gap-1.5 items-center rounded-full px-3 py-1.5" style={{background:"rgba(16,24,40,.05)",color:INK}}><Home size={15}/><span className="text-xs font-medium">Home</span></button><h1 className="text-2xl" style={{fontFamily:"'Fredoka',sans-serif",fontWeight:700,color:INK}}>My Progress</h1></div>
    {loading?<p className="text-center text-sm opacity-40">Loading…</p>:<>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="p-3 text-center" style={card}><Star size={20} fill="currentColor" className="mx-auto mb-1" style={{color:"#D9AE58"}}/><div className="text-xl font-bold" style={{color:INK}}>{progress?.available_points?.toLocaleString()}</div><div className="text-[10px] opacity-45">Points</div></div>
        <div className="p-3 text-center" style={card}><Flame size={20} className="mx-auto mb-1" style={{color:"#E05A47"}}/><div className="text-xl font-bold" style={{color:INK}}>{progress?.current_streak||0}</div><div className="text-[10px] opacity-45">Day streak</div></div>
        <div className="p-3 text-center" style={card}><Trophy size={20} className="mx-auto mb-1" style={{color:ACCENT}}/><div className="text-xl font-bold" style={{color:INK}}>{progress?.current_level||1}</div><div className="text-[10px] opacity-45">Level</div></div>
      </div>
      <div className="p-3 mb-3" style={card}><div className="flex justify-between text-[11px] mb-2" style={{color:INK,opacity:.55}}><span>Level {progress.current_level}</span><span>{progress.lifetime_points.toLocaleString()} lifetime Points</span></div><div className="h-2 rounded-full" style={{background:"rgba(47,111,237,.12)"}}><div className="h-2 rounded-full" style={{width:`${pct}%`,background:ACCENT}}/></div></div>
      {canProtect&&<button onClick={protect} className="w-full p-3 mb-3 flex items-center justify-between" style={{...card,color:INK}}><span className="flex items-center gap-2"><ShieldCheck size={18} style={{color:ACCENT}}/><span className="text-sm font-semibold">Protect your streak</span></span><span className="text-xs">{rules?.streak_protection_cost||250} Points</span></button>}
      {message&&<div className="rounded-xl p-3 mb-3 text-xs" style={{background:"rgba(47,111,237,.08)",color:INK}}>{message}</div>}
      <div className="flex gap-1 mb-3 p-1 rounded-xl" style={{background:"rgba(16,24,40,.05)"}}>{[["rewards","Rewards",Gift],["wish","Wish",Plus],["transfer","Transfer",Send]].map(([id,label,Icon])=><button key={id} onClick={()=>setTab(id)} className="flex-1 rounded-lg py-2 text-xs font-semibold flex gap-1 justify-center items-center" style={{background:tab===id?PANEL:"transparent",color:INK}}><Icon size={14}/>{label}</button>)}</div>
      {tab==="rewards"&&<div className="grid grid-cols-2 gap-2">{rewards.length===0?<p className="col-span-2 text-sm text-center opacity-40 py-8">No rewards yet.</p>:rewards.map(r=><div key={r.id} className="overflow-hidden" style={card}>{r.image_url?<img src={r.image_url} alt="" className="w-full h-24 object-cover"/>:<div className="h-24 flex items-center justify-center" style={{background:"rgba(217,174,88,.12)"}}><Gift size={30} style={{color:"#D9AE58"}}/></div>}<div className="p-3"><div className="font-semibold text-sm truncate" style={{color:INK}}>{r.name}</div><div className="text-xs mt-1" style={{color:INK,opacity:.55}}>{r.points_cost.toLocaleString()} Points</div><button disabled={progress.available_points<r.points_cost} onClick={()=>redeem(r.id)} className="w-full mt-2 rounded-lg py-1.5 text-xs font-semibold" style={{background:progress.available_points>=r.points_cost?ACCENT:"rgba(16,24,40,.08)",color:progress.available_points>=r.points_cost?"white":INK}}>Redeem</button></div></div>)}</div>}
      {tab==="wish"&&<><form onSubmit={submitWish} className="p-4" style={card}><input value={wish.name} onChange={e=>setWish({...wish,name:e.target.value})} placeholder="What would you like?" className="w-full rounded-lg border px-3 py-2 text-sm mb-2"/><input value={wish.product_url} onChange={e=>setWish({...wish,product_url:e.target.value})} placeholder="Optional product link" className="w-full rounded-lg border px-3 py-2 text-sm mb-2"/><textarea value={wish.note} onChange={e=>setWish({...wish,note:e.target.value})} placeholder="Optional note" className="w-full rounded-lg border px-3 py-2 text-sm mb-2"/><button className="w-full rounded-lg py-2 text-sm font-semibold text-white" style={{background:ACCENT}}>Send wish</button></form>{wishes.map(w=><div key={w.id} className="p-3 mt-2 flex items-center" style={card}><div className="flex-1"><div className="text-sm font-semibold">{w.name}</div><div className="text-[11px] opacity-45 capitalize">{w.status}{w.points_cost?` · ${w.points_cost.toLocaleString()} Points`:""}</div></div>{w.product_url&&<a href={w.product_url} target="_blank" rel="noreferrer"><ExternalLink size={15}/></a>}</div>)}</>}
      {tab==="transfer"&&<form onSubmit={sendPoints} className="p-4" style={card}><select value={transfer.player} onChange={e=>setTransfer({...transfer,player:e.target.value})} className="w-full rounded-lg border px-3 py-2 text-sm mb-2" required><option value="">Choose player</option>{players.map(p=><option key={p.id} value={p.id}>{p.icon||"🙂"} {p.name}</option>)}</select><input type="number" min="10" value={transfer.amount} onChange={e=>setTransfer({...transfer,amount:e.target.value})} placeholder="Points" className="w-full rounded-lg border px-3 py-2 text-sm mb-2" required/><button className="w-full rounded-lg py-2 text-sm font-semibold text-white" style={{background:ACCENT}}>Send Points</button></form>}
    </>}
  </div></div>;
}
