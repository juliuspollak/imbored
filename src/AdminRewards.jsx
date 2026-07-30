import { useCallback, useEffect, useState } from "react";
import { Settings, Plus } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";

const BG="#F1F3F7",PANEL="#fff",INK="#1B2129",ACCENT="#2F6FED";
const card={background:PANEL,border:"1px solid rgba(16,24,40,.09)",borderRadius:16};
const TABS=[["rules","Rules",Settings],["adjust","Adjust",Plus]];

const FIELDS=[
  ["base_points","Base points","Starting score for every completed game."],
  ["hint_penalty","Hint penalty","Points deducted for each hint."],
  ["mistake_penalty","Mistake penalty","Points deducted for each mistake."],
  ["fast_time_bonus","Fast-time adjustment","Added below 80% of the benchmark; deducted above 150%."],
  ["average_time_bonus","Average-time adjustment","Added up to the benchmark; deducted above 120%."],
  ["streak_weekly_bonus","Weekly streak bonus","Awarded once on streak days 7, 14, 21 and so on."],
  ["practice_points_percent","Practice points","Percentage of the equivalent Challenge award. Keep below 100%."],
  ["day_points_step","Daily difficulty step","Points added per day: Monday +0, Tuesday +1 step, through Sunday +6 steps."],
  ["minimum_points","Minimum game points","Lowest possible award for a completed game."],
  ["maximum_points","Maximum game points","Highest possible award before a separate winner's prize."],
  ["daily_points_cap","Daily gameplay cap","Maximum gameplay points earned per Sydney day across Practice and Challenge. Streak milestones and winner prizes are separate."],
  ["practice_daily_limit","Daily practice limit","Number of practice games that can award points each day."],
  ["streak_protection_cost","Streak protection cost","Points charged to protect a missed streak day."],
];

export default function AdminRewards({onBack}){
  const {profile}=useAuth();
  const [tab,setTab]=useState("rules");
  const [rules,setRules]=useState(null),[practiceUsage,setPracticeUsage]=useState(null),[players,setPlayers]=useState([]);
  const [msg,setMsg]=useState(""),[loading,setLoading]=useState(true);
  const [adjust,setAdjust]=useState({player:"",amount:"",reason:""});

  const refresh=useCallback(async()=>{
    if(!profile?.is_admin)return;
    setLoading(true);
    const [{data:r},{data:usage},{data:p}]=await Promise.all([
      supabase.from("reward_rules").select("*").eq("is_active",true).maybeSingle(),
      supabase.rpc("get_my_practice_reward_usage"),
      supabase.from("profiles").select("id,name,icon").order("name"),
    ]);
    setRules(r);setPracticeUsage(usage);setPlayers(p||[]);
    setLoading(false);
  },[profile?.is_admin]);
  useEffect(()=>{refresh()},[refresh]);

  async function saveRules(){
    const {id,name,is_active,...editableRules}=rules;
    const {error}=await supabase.from("reward_rules").update({...editableRules,updated_at:new Date().toISOString(),updated_by:profile.id}).eq("id",id);
    setMsg(error?.message||"Rules saved");
    refresh();
  }
  async function doAdjust(e){
    e.preventDefault();
    const {error}=await supabase.rpc("admin_adjust_points",{target_player_id:adjust.player,amount:Number(adjust.amount),reason:adjust.reason});
    setMsg(error?.message||"Points adjusted");
    if(!error)setAdjust({player:"",amount:"",reason:""});
  }

  if(!profile?.is_admin)return <div className="p-10 text-center text-sm opacity-45">Admin only.</div>;

  return <div style={{background:BG,minHeight:"100vh",fontFamily:"'Inter',sans-serif"}} className="p-4 pt-10 flex justify-center">
    <div className="w-full max-w-xl">
      <header className="flex items-center gap-3 mb-6">
        <BackButton onClick={onBack} ariaLabel="Back"/>
        <div><h1 className="text-2xl font-bold" style={{fontFamily:"'Fredoka',sans-serif",color:INK}}>Rewards Admin</h1><p className="text-xs opacity-45">Scoring rules and point adjustments</p></div>
      </header>

      {msg&&<div className="rounded-2xl px-3 py-2.5 mb-4 text-xs" style={{background:"rgba(47,111,237,.08)",color:INK}}>{msg}</div>}

      <div className="game-mode-switch mb-5" style={{width:"100%",justifyContent:"flex-start"}}>
        {TABS.map(([id,label,Icon])=><button key={id} onClick={()=>setTab(id)} className={`gloss-button ${tab===id?"is-active":""}`} style={{flex:1}}><Icon size={13}/> {label}</button>)}
      </div>

      {loading?<p className="text-sm text-center opacity-45 py-10">Loading…</p>:<>

      {tab==="rules"&&rules&&<div className="space-y-3">
        <div className="rounded-2xl px-3 py-2.5 text-xs" style={{background:"rgba(47,111,237,.07)",color:INK}}>Challenge games earn the full award. Practice earns half, only the first three Practice completions of each game score per day, and gameplay stops earning after 40 points in a Sydney day. Later-day puzzles add a little more for difficulty. Weekly streak milestones and the winner's prize remain separate.</div>
        {practiceUsage&&<div className="rounded-2xl px-3 py-3 text-xs" style={{background:"rgba(22,163,74,.07)",color:INK}}><div className="font-semibold">Your practice rewards today (limit {practiceUsage.daily_limit} per game)</div><div className="mt-1 opacity-70">{practiceUsage.by_game?.length?practiceUsage.by_game.map(item=>`${item.game} ${item.rewarded_count}/${practiceUsage.daily_limit}`).join(" · "):"None yet"}</div></div>}
        <div className="p-4 grid grid-cols-2 gap-3" style={card}>
          {FIELDS.map(([key,label,help])=><label key={key} className="text-[11px]">
            <span className="font-semibold" style={{color:INK}}>{label}</span>
            <input type="number" value={rules[key]??0} onChange={e=>setRules({...rules,[key]:Number(e.target.value)})} className="block w-full mt-1 rounded-lg border px-2 py-2 text-sm" style={{borderColor:"rgba(16,24,40,.12)"}}/>
            <span className="block mt-1 opacity-45 leading-tight">{help}</span>
          </label>)}
          <button onClick={saveRules} className="col-span-2 rounded-xl py-2.5 text-white font-semibold text-sm" style={{background:ACCENT}}>Save rules</button>
        </div>
      </div>}

      {tab==="adjust"&&<form onSubmit={doAdjust} className="p-4" style={card}>
        <select required value={adjust.player} onChange={e=>setAdjust({...adjust,player:e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mb-2" style={{borderColor:"rgba(16,24,40,.12)"}}>
          <option value="">Player</option>{players.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input required type="number" value={adjust.amount} onChange={e=>setAdjust({...adjust,amount:e.target.value})} placeholder="Amount, negative to deduct" className="w-full border rounded-lg px-3 py-2 text-sm mb-2" style={{borderColor:"rgba(16,24,40,.12)"}}/>
        <input required value={adjust.reason} onChange={e=>setAdjust({...adjust,reason:e.target.value})} placeholder="Reason" className="w-full border rounded-lg px-3 py-2 text-sm mb-2" style={{borderColor:"rgba(16,24,40,.12)"}}/>
        <button className="w-full rounded-xl py-2.5 text-white text-sm font-semibold" style={{background:ACCENT}}>Apply adjustment</button>
      </form>}

      </>}
    </div>
  </div>;
}
