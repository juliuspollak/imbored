import { useCallback, useEffect, useState } from "react";
import { Settings, Gift, Lightbulb, ClipboardCheck, Plus, Sparkles, AlertTriangle } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";

const BG="#F1F3F7",PANEL="#fff",INK="#1B2129",ACCENT="#2F6FED";
const card={background:PANEL,border:"1px solid rgba(16,24,40,.09)",borderRadius:16};
const TABS=[["rules","Rules",Settings],["rewards","Rewards",Gift],["wishes","Wishes",Lightbulb],["redemptions","Orders",ClipboardCheck],["adjust","Adjust",Plus]];
const STATUS_LABEL={
  requested:{text:"Requested",color:"#B5730E",bg:"rgba(217,148,10,.10)"},
  approved:{text:"Approved",color:"#2F6FED",bg:"rgba(47,111,237,.09)"},
  declined:{text:"Declined",color:"#B5433A",bg:"rgba(181,67,58,.09)"},
  fulfilled:{text:"Delivered",color:"#12946A",bg:"rgba(18,148,106,.09)"},
  disputed:{text:"Disputed",color:"#B5433A",bg:"rgba(181,67,58,.09)"},
  cancelled:{text:"Cancelled",color:"#6B7280",bg:"rgba(107,114,128,.09)"},
};

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

function StatusPill({status}){
  const s=STATUS_LABEL[status]||{text:status,color:INK,bg:"rgba(16,24,40,.06)"};
  return <span className="rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0" style={{color:s.color,background:s.bg}}>{s.text}</span>;
}

export default function AdminRewards({onBack}){
  const {profile}=useAuth();
  const isRewardManager=!!(profile?.is_admin||profile?.is_reward_steward);
  const [tab,setTab]=useState(profile?.is_admin?"rules":"rewards");
  const [rules,setRules]=useState(null),[practiceUsage,setPracticeUsage]=useState(null),[rewards,setRewards]=useState([]),[wishes,setWishes]=useState([]),[reds,setReds]=useState([]),[players,setPlayers]=useState([]);
  const [msg,setMsg]=useState(""),[loading,setLoading]=useState(true);
  const [newReward,setNewReward]=useState({name:"",description:"",image_url:"",points_cost:"",stock_quantity:""});
  const [adjust,setAdjust]=useState({player:"",amount:"",reason:""});
  const [priceTarget,setPriceTarget]=useState(null);
  const [priceValue,setPriceValue]=useState("");

  const refresh=useCallback(async()=>{
    if(!isRewardManager)return;
    setLoading(true);
    const [{data:r},{data:usage},{data:rw},{data:w},{data:rd},{data:p}]=await Promise.all([
      supabase.from("reward_rules").select("*").eq("is_active",true).maybeSingle(),
      supabase.rpc("get_my_practice_reward_usage"),
      supabase.from("rewards").select("*").order("created_at",{ascending:false}),
      supabase.from("reward_wishes").select("*,profiles(name,icon)").order("created_at",{ascending:false}),
      supabase.from("reward_redemptions").select("*,profiles(name,icon),rewards(name)").order("requested_at",{ascending:false}),
      supabase.from("profiles").select("id,name,icon").order("name"),
    ]);
    setRules(r);setPracticeUsage(usage);setRewards(rw||[]);setWishes(w||[]);setReds(rd||[]);setPlayers(p||[]);
    setLoading(false);
  },[isRewardManager]);
  useEffect(()=>{refresh()},[refresh]);

  async function saveRules(){
    const {id,name,is_active,...editableRules}=rules;
    const {error}=await supabase.from("reward_rules").update({...editableRules,updated_at:new Date().toISOString(),updated_by:profile.id}).eq("id",id);
    setMsg(error?.message||"Rules saved");
    refresh();
  }
  async function addReward(e){
    e.preventDefault();
    const payload={...newReward,points_cost:Number(newReward.points_cost),stock_quantity:newReward.stock_quantity===""?null:Number(newReward.stock_quantity),created_by:profile.id};
    const {error}=await supabase.from("rewards").insert(payload);
    setMsg(error?.message||"Reward added");
    if(!error)setNewReward({name:"",description:"",image_url:"",points_cost:"",stock_quantity:""});
    refresh();
  }
  async function toggleRewardActive(r){
    await supabase.from("rewards").update({is_active:!r.is_active}).eq("id",r.id);
    refresh();
  }
  function openPriceWish(w){setPriceTarget(w);setPriceValue(w.points_cost||"");}
  async function submitPriceWish(status="approved"){
    const {error}=await supabase.from("reward_wishes").update({points_cost:Number(priceValue),status,reviewed_by:profile.id,reviewed_at:new Date().toISOString()}).eq("id",priceTarget.id);
    setMsg(error?.message||"Wish updated");
    setPriceTarget(null);
    refresh();
  }
  async function declineWish(w){
    await supabase.from("reward_wishes").update({status:"declined",reviewed_by:profile.id,reviewed_at:new Date().toISOString()}).eq("id",w.id);
    refresh();
  }
  async function review(id,status){
    const {error}=await supabase.rpc("review_redemption",{target_id:id,new_status:status,admin_note_in:null});
    setMsg(error?.message||"Redemption updated");
    refresh();
  }
  async function doAdjust(e){
    e.preventDefault();
    const {error}=await supabase.rpc("admin_adjust_points",{target_player_id:adjust.player,amount:Number(adjust.amount),reason:adjust.reason});
    setMsg(error?.message||"Points adjusted");
    if(!error)setAdjust({player:"",amount:"",reason:""});
  }

  if(!isRewardManager)return <div className="p-10 text-center text-sm opacity-45">Admin or reward steward only.</div>;

  const visibleTabs=TABS.filter(([id])=>profile?.is_admin||!["rules","adjust"].includes(id));

  return <div style={{background:BG,minHeight:"100vh",fontFamily:"'Inter',sans-serif"}} className="p-4 pt-10 flex justify-center">
    <div className="w-full max-w-xl">
      <header className="flex items-center gap-3 mb-6">
        <BackButton onClick={onBack} ariaLabel="Back"/>
        <div><h1 className="text-2xl font-bold" style={{fontFamily:"'Fredoka',sans-serif",color:INK}}>Rewards Admin</h1><p className="text-xs opacity-45">Items, wishes and delivery, all in one place</p></div>
      </header>

      {!profile?.is_admin&&<div className="flex items-start gap-2 rounded-2xl px-3 py-2.5 mb-4 text-xs" style={{background:"rgba(124,58,237,.08)",color:"#5B21B6"}}>
        <Sparkles size={14} className="shrink-0 mt-0.5"/>
        <span>You're a reward steward: you can manage items, price wishes and review orders. Scoring rules and point adjustments stay admin-only.</span>
      </div>}
      {msg&&<div className="rounded-2xl px-3 py-2.5 mb-4 text-xs" style={{background:"rgba(47,111,237,.08)",color:INK}}>{msg}</div>}

      <div className="game-mode-switch mb-5" style={{width:"100%",justifyContent:"flex-start"}}>
        {visibleTabs.map(([id,label,Icon])=><button key={id} onClick={()=>setTab(id)} className={`gloss-button ${tab===id?"is-active":""}`} style={{flex:1}}><Icon size={13}/> {label}</button>)}
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

      {tab==="rewards"&&<div className="space-y-3">
        <form onSubmit={addReward} className="p-4 grid grid-cols-2 gap-2" style={card}>
          <div className="col-span-2 text-xs font-semibold mb-1" style={{color:INK}}>Add an item</div>
          <input className="col-span-2 border rounded-lg px-3 py-2 text-sm" style={{borderColor:"rgba(16,24,40,.12)"}} placeholder="Reward name" value={newReward.name} onChange={e=>setNewReward({...newReward,name:e.target.value})} required/>
          <input className="col-span-2 border rounded-lg px-3 py-2 text-sm" style={{borderColor:"rgba(16,24,40,.12)"}} placeholder="Description" value={newReward.description} onChange={e=>setNewReward({...newReward,description:e.target.value})}/>
          <input className="col-span-2 border rounded-lg px-3 py-2 text-sm" style={{borderColor:"rgba(16,24,40,.12)"}} placeholder="Image URL" value={newReward.image_url} onChange={e=>setNewReward({...newReward,image_url:e.target.value})}/>
          <input type="number" className="border rounded-lg px-3 py-2 text-sm" style={{borderColor:"rgba(16,24,40,.12)"}} placeholder="Points cost" value={newReward.points_cost} onChange={e=>setNewReward({...newReward,points_cost:e.target.value})} required/>
          <input type="number" className="border rounded-lg px-3 py-2 text-sm" style={{borderColor:"rgba(16,24,40,.12)"}} placeholder="Stock (blank unlimited)" value={newReward.stock_quantity} onChange={e=>setNewReward({...newReward,stock_quantity:e.target.value})}/>
          <button className="col-span-2 rounded-xl py-2.5 text-white text-sm font-semibold" style={{background:ACCENT}}>Add reward</button>
        </form>
        {rewards.length===0?<div className="p-6 text-center rounded-2xl" style={card}><Gift size={22} style={{color:"#D9AE58",margin:"0 auto 8px"}}/><div className="text-sm font-semibold">No items yet</div></div>
        :rewards.map(r=><div key={r.id} className="p-3 flex items-center gap-3" style={card}>
          <div className="grid place-items-center rounded-xl shrink-0" style={{width:40,height:40,background:"rgba(217,174,88,.14)"}}>{r.image_url?<img src={r.image_url} alt="" className="w-full h-full object-cover rounded-xl"/>:<Gift size={18} style={{color:"#D9AE58"}}/>}</div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm truncate" style={{color:INK}}>{r.name}</div>
            <div className="text-xs opacity-45">{r.points_cost.toLocaleString()} Points · {r.stock_quantity??"Unlimited"} stock{r.is_active?"":" · Inactive"}</div>
          </div>
          <button onClick={()=>toggleRewardActive(r)} className="rounded-full px-3 py-1.5 text-[11px] font-semibold shrink-0" style={{background:r.is_active?"rgba(16,24,40,.05)":"rgba(22,163,74,.1)",color:r.is_active?INK:"#15803D"}}>{r.is_active?"Deactivate":"Activate"}</button>
        </div>)}
      </div>}

      {tab==="wishes"&&<div className="space-y-2">
        {wishes.length===0?<div className="p-6 text-center rounded-2xl" style={card}><Lightbulb size={22} style={{color:ACCENT,margin:"0 auto 8px"}}/><div className="text-sm font-semibold">No wishes yet</div></div>
        :wishes.map(w=><div key={w.id} className="p-3" style={card}>
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-sm truncate">{w.profiles?.icon} {w.profiles?.name} · {w.emoji||"🎁"} {w.name}</div>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold capitalize shrink-0" style={{background:"rgba(16,24,40,.06)",color:INK}}>{w.status}</span>
          </div>
          <div className="text-xs opacity-50 mt-1 mb-2">{w.points_cost?`${w.points_cost.toLocaleString()} Points`:"Not priced yet"}</div>
          {w.status==="submitted"&&<div className="flex gap-2">
            <button onClick={()=>openPriceWish(w)} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(22,163,74,.1)",color:"#166534"}}>Price &amp; approve</button>
            <button onClick={()=>declineWish(w)} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(181,67,58,.08)",color:"#B5433A"}}>Decline</button>
          </div>}
        </div>)}
      </div>}

      {tab==="redemptions"&&<div className="space-y-2">
        {reds.length===0?<div className="p-6 text-center rounded-2xl" style={card}><ClipboardCheck size={22} style={{color:ACCENT,margin:"0 auto 8px"}}/><div className="text-sm font-semibold">No orders yet</div></div>
        :reds.map(r=><div key={r.id} className="p-3" style={card}>
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-sm truncate">{r.profiles?.icon} {r.profiles?.name} · {r.rewards?.name}</div>
            <StatusPill status={r.status}/>
          </div>
          <div className="text-xs opacity-50 mt-1 mb-2">{r.points_cost.toLocaleString()} Points</div>
          {r.status==="disputed"&&r.dispute_reason&&<div className="flex items-start gap-1.5 text-xs mb-2 rounded-lg px-2 py-1.5" style={{background:"rgba(181,67,58,.08)",color:"#B5433A"}}><AlertTriangle size={12} className="shrink-0 mt-0.5"/>{r.dispute_reason}</div>}
          {r.status==="requested"&&<div className="flex gap-2">
            <button onClick={()=>review(r.id,"approved")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(22,163,74,.1)",color:"#166534"}}>Approve</button>
            <button onClick={()=>review(r.id,"declined")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(181,67,58,.08)",color:"#B5433A"}}>Decline &amp; refund</button>
          </div>}
          {r.status==="approved"&&<button onClick={()=>review(r.id,"fulfilled")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(47,111,237,.09)",color:ACCENT}}>Mark delivered</button>}
          {r.status==="disputed"&&<div className="flex gap-2">
            <button onClick={()=>review(r.id,"fulfilled")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(22,163,74,.1)",color:"#166534"}}>Confirm delivered</button>
            <button onClick={()=>review(r.id,"approved")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(47,111,237,.09)",color:ACCENT}}>Reopen for delivery</button>
          </div>}
        </div>)}
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

    {priceTarget&&<div className="fixed inset-0 z-50 grid place-items-center p-4" style={{background:"rgba(16,24,40,.45)"}}>
      <div className="w-full max-w-sm rounded-3xl p-5" style={{background:"#fff",boxShadow:"0 24px 60px rgba(16,24,40,.22)"}}>
        <h2 className="font-bold mb-1">Price "{priceTarget.name}"</h2>
        <p className="text-xs opacity-55 mb-3">Set a points cost, then approve it for redemption.</p>
        <input type="number" autoFocus value={priceValue} onChange={e=>setPriceValue(e.target.value)} placeholder="Points cost" className="w-full rounded-xl border px-3 py-2 text-sm" style={{borderColor:"rgba(16,24,40,.12)"}}/>
        <div className="flex gap-2 mt-4">
          <button onClick={()=>setPriceTarget(null)} className="flex-1 rounded-full py-2.5 text-xs font-semibold" style={{background:"rgba(16,24,40,.06)"}}>Cancel</button>
          <button disabled={!priceValue} onClick={()=>submitPriceWish("approved")} className="flex-1 rounded-full py-2.5 text-xs font-semibold text-white disabled:opacity-50" style={{background:ACCENT}}>Price &amp; approve</button>
        </div>
      </div>
    </div>}
  </div>;
}
