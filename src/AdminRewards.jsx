import { useCallback, useEffect, useState } from "react";
import { Settings, Plus } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import Page from "./components/Page.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";
import StatusBanner from "./components/StatusBanner.jsx";

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
  ["daily_points_cap","Daily Practice cap","Maximum Practice points earned per Sydney day. Challenge points are not capped."],
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
    setRules(r);setPracticeUsage(usage);setPlayers(p||[]);setLoading(false);
  },[profile?.is_admin]);
  useEffect(()=>{refresh()},[refresh]);

  async function saveRules(){
    const {id,name,is_active,...editableRules}=rules;
    const {error}=await supabase.from("reward_rules").update({...editableRules,updated_at:new Date().toISOString(),updated_by:profile.id}).eq("id",id);
    setMsg(error?.message||"Rules saved");refresh();
  }
  async function doAdjust(e){e.preventDefault();const {error}=await supabase.rpc("admin_adjust_points",{target_player_id:adjust.player,amount:Number(adjust.amount),reason:adjust.reason});setMsg(error?.message||"Points adjusted");if(!error)setAdjust({player:"",amount:"",reason:""});}

  if(!profile?.is_admin)return <div style={{textAlign:"center",padding:"var(--space-8)",color:"var(--color-text-secondary)"}}>Admin only.</div>;

  return <Page>
    <div style={{display:"flex",alignItems:"center",gap:"var(--space-3)",marginBottom:"var(--space-4)"}}><BackButton onClick={onBack} /><div><h1 style={{fontSize:"var(--text-page-title-size)",fontWeight:700,color:"var(--color-text-primary)"}}>Reward Rules</h1><p style={{fontSize:"var(--text-caption-size)",color:"var(--color-text-secondary)"}}>Scoring rules and point adjustments</p></div></div>

    {msg&&<div style={{marginBottom:"var(--space-3)"}}><StatusBanner variant="info" dismissible onDismiss={()=>setMsg("")}>{msg}</StatusBanner></div>}

    <div style={{display:"flex",gap:"var(--space-2)",marginBottom:"var(--space-5)"}}>
      {TABS.map(([id,label,Icon])=><Button key={id} variant={tab===id?"primary":"secondary"} size="sm" before={<Icon size={13}/>} onClick={()=>setTab(id)} style={{flex:1}}>{label}</Button>)}
    </div>

    {loading?<p style={{textAlign:"center",padding:"var(--space-8)",color:"var(--color-text-secondary)"}}>Loading…</p>:<>
    {tab==="rules"&&rules&&<div style={{display:"flex",flexDirection:"column",gap:"var(--space-3)"}}>
      <div style={{borderRadius:"var(--radius-lg)",padding:"var(--space-3)",fontSize:"var(--text-caption-size)",background:"var(--color-info-bg)",color:"var(--color-text-primary)"}}>Challenge games earn the full award without a daily cap. Practice earns half, only three Practice completions of each game score per day, and Practice earnings stop after {rules.daily_points_cap || 40} points in a Sydney day.</div>
      {practiceUsage&&<div style={{borderRadius:"var(--radius-lg)",padding:"var(--space-3)",fontSize:"var(--text-caption-size)",background:"var(--color-success-bg)",color:"var(--color-text-primary)"}}><div style={{fontWeight:600}}>Your practice rewards today (limit {practiceUsage.daily_limit} per game)</div><div style={{marginTop:"var(--space-1)",opacity:.7}}>{practiceUsage.by_game?.length?practiceUsage.by_game.map(i=>`${i.game} ${i.rewarded_count}/${practiceUsage.daily_limit}`).join(" · "):"None yet"}</div></div>}
      <Card style={{padding:"var(--space-4)",display:"grid",gridTemplateColumns:"1fr 1fr",gap:"var(--space-3)"}}>
        {FIELDS.map(([key,label,help])=><label key={key} style={{fontSize:11}}>
          <span style={{fontWeight:600,color:"var(--color-text-primary)"}}>{label}</span>
          <input type="number" value={rules[key]??0} onChange={e=>setRules({...rules,[key]:Number(e.target.value)})} style={{display:"block",width:"100%",marginTop:"var(--space-1)",borderRadius:"var(--radius-sm)",border:"1px solid var(--color-border-strong)",padding:"var(--space-2)",fontSize:"var(--text-body-size)",background:"var(--color-surface-input)",color:"var(--color-text-primary)",boxSizing:"border-box"}}/>
          <span style={{display:"block",marginTop:"var(--space-1)",color:"var(--color-text-secondary)",lineHeight:1.3}}>{help}</span>
        </label>)}
        <Button variant="primary" fullWidth onClick={saveRules} style={{gridColumn:"span 2"}}>Save rules</Button>
      </Card>
    </div>}

    {tab==="adjust"&&<form onSubmit={doAdjust}><Card style={{padding:"var(--space-4)"}}>
      <select required value={adjust.player} onChange={e=>setAdjust({...adjust,player:e.target.value})} style={{width:"100%",borderRadius:"var(--radius-sm)",border:"1px solid var(--color-border-strong)",padding:"var(--space-2) var(--space-3)",fontSize:"var(--text-body-size)",marginBottom:"var(--space-2)",background:"var(--color-surface-input)",color:"var(--color-text-primary)",boxSizing:"border-box"}}><option value="">Player</option>{players.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <input required type="number" value={adjust.amount} onChange={e=>setAdjust({...adjust,amount:e.target.value})} placeholder="Amount, negative to deduct" style={{width:"100%",borderRadius:"var(--radius-sm)",border:"1px solid var(--color-border-strong)",padding:"var(--space-2) var(--space-3)",fontSize:"var(--text-body-size)",marginBottom:"var(--space-2)",background:"var(--color-surface-input)",color:"var(--color-text-primary)",boxSizing:"border-box"}}/>
      <input required value={adjust.reason} onChange={e=>setAdjust({...adjust,reason:e.target.value})} placeholder="Reason" style={{width:"100%",borderRadius:"var(--radius-sm)",border:"1px solid var(--color-border-strong)",padding:"var(--space-2) var(--space-3)",fontSize:"var(--text-body-size)",marginBottom:"var(--space-2)",background:"var(--color-surface-input)",color:"var(--color-text-primary)",boxSizing:"border-box"}}/>
      <Button variant="primary" fullWidth type="submit">Apply adjustment</Button>
    </Card></form>}
    </>}
  </Page>;
}
