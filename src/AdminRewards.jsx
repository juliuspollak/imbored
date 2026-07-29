import { useCallback, useEffect, useState } from "react";
import { Settings, Gift, ClipboardCheck, Plus, Sparkles, ChevronRight, Trash2, Users, ShieldCheck } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";
import { reviewRedemption } from "./lib/rewardRedemptions.js";
import { RedemptionStatusPill, RedemptionDisputeBanner, RedemptionActions } from "./RedemptionActions.jsx";

const BG="#F1F3F7",PANEL="#fff",INK="#1B2129",ACCENT="#2F6FED";
const card={background:PANEL,border:"1px solid rgba(16,24,40,.09)",borderRadius:16};
const TABS=[["rules","Rules",Settings],["rewards","Rewards",Gift],["redemptions","Orders",ClipboardCheck],["adjust","Adjust",Plus]];

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

export default function AdminRewards({onBack,onOpenCircles}){
  const {profile}=useAuth();
  const isRewardManager=!!(profile?.is_admin||profile?.is_reward_steward);
  const [tab,setTab]=useState(profile?.is_admin?"rules":"rewards");
  const [rules,setRules]=useState(null),[practiceUsage,setPracticeUsage]=useState(null),[circles,setCircles]=useState([]),[rosters,setRosters]=useState([]),[rewards,setRewards]=useState([]),[pending,setPending]=useState([]),[reds,setReds]=useState([]),[players,setPlayers]=useState([]);
  const [msg,setMsg]=useState(""),[loading,setLoading]=useState(true);
  const [newReward,setNewReward]=useState({circle_id:"",name:"",description:"",image_url:"",points_cost:"",stock_quantity:""});
  const [adjust,setAdjust]=useState({player:"",amount:"",reason:""});
  const [priceTarget,setPriceTarget]=useState(null);
  const [priceValue,setPriceValue]=useState("");
  const [deleteConfirmId,setDeleteConfirmId]=useState(null);

  const refresh=useCallback(async()=>{
    if(!isRewardManager)return;
    setLoading(true);
    const [{data:r},{data:usage},{data:t},{data:ro},{data:rw},{data:pr},{data:rd},{data:p}]=await Promise.all([
      supabase.from("reward_rules").select("*").eq("is_active",true).maybeSingle(),
      supabase.rpc("get_my_practice_reward_usage"),
      supabase.rpc("get_my_reward_circles"),
      supabase.rpc("get_my_circle_rosters"),
      supabase.from("rewards").select("*,profiles(name,icon),circles(name)").not("status","in","(suggested,pending)").order("created_at",{ascending:false}),
      supabase.rpc("get_pending_reward_proposals"),
      supabase.from("reward_redemptions").select("*,profiles(name,icon),rewards(name)").order("requested_at",{ascending:false}),
      supabase.from("profiles").select("id,name,icon").order("name"),
    ]);
    setRules(r);setPracticeUsage(usage);setCircles(t||[]);setRosters(ro||[]);setRewards(rw||[]);setPending(pr||[]);setReds(rd||[]);setPlayers(p||[]);
    setNewReward(cur=>cur.circle_id?cur:{...cur,circle_id:t?.[0]?.circle_id||""});
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
    const {error}=await supabase.rpc("propose_reward",{
      target_circle_id:Number(newReward.circle_id),
      reward_name:newReward.name,
      reward_description:newReward.description,
      reward_image_url:newReward.image_url,
      reward_points_cost:Number(newReward.points_cost),
      reward_stock_quantity:newReward.stock_quantity===""?null:Number(newReward.stock_quantity),
    });
    setMsg(error?.message||"Proposed — waiting on approval from this circle");
    if(!error)setNewReward(cur=>({circle_id:cur.circle_id,name:"",description:"",image_url:"",points_cost:"",stock_quantity:""}));
    refresh();
  }
  async function reviewProposal(id,decision){
    const {error}=await supabase.rpc("review_reward_proposal",{target_reward_id:id,decision_in:decision});
    setMsg(error?.message||"Vote recorded");
    refresh();
  }
  async function toggleRewardActive(r){
    await supabase.from("rewards").update({status:r.status==="active"?"rejected":"active"}).eq("id",r.id);
    refresh();
  }
  async function deleteReward(id){
    const {error}=await supabase.rpc("delete_reward",{target_reward_id:id});
    setMsg(error?.message||"Item deleted");
    setDeleteConfirmId(null);
    refresh();
  }
  function openPriceProposal(r){setPriceTarget(r);setPriceValue("");}
  async function submitPriceProposal(){
    const {error}=await supabase.rpc("price_reward_proposal",{target_reward_id:priceTarget.id,price_points_cost:Number(priceValue)});
    setMsg(error?.message||"Priced — now open for a vote");
    setPriceTarget(null);
    refresh();
  }
  async function review(id,status){
    const {error}=await reviewRedemption(id,status);
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
        <div><h1 className="text-2xl font-bold" style={{fontFamily:"'Fredoka',sans-serif",color:INK}}>Rewards Admin</h1><p className="text-xs opacity-45">Items, suggestions and delivery, all in one place</p></div>
      </header>

      {!profile?.is_admin&&<div className="flex items-start gap-2 rounded-2xl px-3 py-2.5 mb-4 text-xs" style={{background:"rgba(124,58,237,.08)",color:"#5B21B6"}}>
        <Sparkles size={14} className="shrink-0 mt-0.5"/>
        <span>You're a reward steward: you can manage items, price suggestions and review orders. Scoring rules and point adjustments stay admin-only.</span>
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
        {onOpenCircles&&<button onClick={onOpenCircles} className="w-full rounded-2xl p-3 flex items-center gap-3 text-left" style={card}>
          <span className="grid place-items-center rounded-xl shrink-0" style={{width:36,height:36,background:"rgba(47,111,237,.09)",color:ACCENT}}><Users size={16}/></span>
          <span className="flex-1 min-w-0"><span className="block text-sm font-semibold" style={{color:INK}}>Manage circles &amp; approvers</span><span className="block text-[11px] opacity-45">Rosters, invites, and who can approve reward items</span></span>
          <ChevronRight size={16} style={{opacity:.35}}/>
        </button>}

        {circles.length===0?<div className="rounded-2xl px-3 py-2.5 text-xs" style={{background:"rgba(217,148,10,.10)",color:"#8A5C00"}}>You're not on a circle yet — join or create one to start proposing items.</div>:<form onSubmit={addReward} className="p-4 grid grid-cols-2 gap-2" style={card}>
          <div className="col-span-2 text-xs font-semibold mb-1" style={{color:INK}}>Propose an item</div>
          <select required value={newReward.circle_id} onChange={e=>setNewReward({...newReward,circle_id:e.target.value})} className="col-span-2 border rounded-lg px-3 py-2 text-sm" style={{borderColor:"rgba(16,24,40,.12)"}}>
            {circles.map(t=><option key={t.circle_id} value={t.circle_id}>{t.circle_name} · {t.member_count} member{t.member_count===1?"":"s"}</option>)}
          </select>
          {newReward.circle_id&&<div className="col-span-2 flex flex-wrap gap-1.5 -mt-1">
            {rosters.filter(m=>String(m.circle_id)===String(newReward.circle_id)).map(m=><span key={m.user_id} className="rounded-full pl-1 pr-2 py-1 text-[11px] font-medium flex items-center gap-1" style={{background:"rgba(16,24,40,.04)",color:INK}}>
              <span>{m.member_icon||"🙂"}</span>{m.member_name}{m.can_approve_rewards&&<ShieldCheck size={10} style={{color:"#12946A"}}/>}
            </span>)}
          </div>}
          <input className="col-span-2 border rounded-lg px-3 py-2 text-sm" style={{borderColor:"rgba(16,24,40,.12)"}} placeholder="Reward name" value={newReward.name} onChange={e=>setNewReward({...newReward,name:e.target.value})} required/>
          <input className="col-span-2 border rounded-lg px-3 py-2 text-sm" style={{borderColor:"rgba(16,24,40,.12)"}} placeholder="Description" value={newReward.description} onChange={e=>setNewReward({...newReward,description:e.target.value})}/>
          <input className="col-span-2 border rounded-lg px-3 py-2 text-sm" style={{borderColor:"rgba(16,24,40,.12)"}} placeholder="Image URL" value={newReward.image_url} onChange={e=>setNewReward({...newReward,image_url:e.target.value})}/>
          <input type="number" className="border rounded-lg px-3 py-2 text-sm" style={{borderColor:"rgba(16,24,40,.12)"}} placeholder="Points cost" value={newReward.points_cost} onChange={e=>setNewReward({...newReward,points_cost:e.target.value})} required/>
          <input type="number" className="border rounded-lg px-3 py-2 text-sm" style={{borderColor:"rgba(16,24,40,.12)"}} placeholder="Stock (blank unlimited)" value={newReward.stock_quantity} onChange={e=>setNewReward({...newReward,stock_quantity:e.target.value})}/>
          <button className="col-span-2 rounded-xl py-2.5 text-white text-sm font-semibold" style={{background:ACCENT}}>Propose item</button>
        </form>}

        {pending.length>0&&<div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide opacity-40 px-1">Needs your attention</div>
          {pending.map(p=><div key={p.id} className="p-3" style={{...card,border:"1px solid rgba(217,148,10,.25)"}}>
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-sm truncate">{p.name} · {p.circle_name}</div>
              {p.status==="suggested"
                ?<span className="rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0" style={{color:"#7C3AED",background:"rgba(124,58,237,.09)"}}>Needs a price</span>
                :<span className="rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0" style={{color:"#B5730E",background:"rgba(217,148,10,.10)"}}>{p.approve_count}/{p.required_count} approved</span>}
            </div>
            <div className="text-xs opacity-50 mt-1 mb-2">{p.status==="suggested"?"Not priced yet":`${p.points_cost.toLocaleString()} Points`} · suggested by {p.creator_icon} {p.creator_name}</div>
            {p.status==="suggested"
              ?<button onClick={()=>openPriceProposal(p)} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(124,58,237,.1)",color:"#6D28D9"}}>Set price</button>
              :<div className="flex gap-2">
                <button onClick={()=>reviewProposal(p.id,"approve")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(22,163,74,.1)",color:"#166534"}}>Approve</button>
                <button onClick={()=>reviewProposal(p.id,"reject")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(181,67,58,.08)",color:"#B5433A"}}>Reject</button>
              </div>}
          </div>)}
        </div>}

        <div className="space-y-2">
          {rewards.length>0&&<div className="text-xs font-bold uppercase tracking-wide opacity-40 px-1">Items</div>}
          {rewards.map(r=><div key={r.id} className="p-3" style={card}>
            <div className="flex items-center gap-3">
              <div className="grid place-items-center rounded-xl shrink-0" style={{width:40,height:40,background:"rgba(217,174,88,.14)"}}>{r.image_url?<img src={r.image_url} alt="" className="w-full h-full object-cover rounded-xl"/>:<Gift size={18} style={{color:"#D9AE58"}}/>}</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate" style={{color:INK}}>{r.name}</div>
                <div className="text-xs opacity-45">{r.points_cost.toLocaleString()} Points · {r.stock_quantity??"Unlimited"} stock · {r.status}</div>
                <div className="text-[11px] opacity-40 mt-0.5 truncate">{r.circles?.name||"Unknown circle"} · by {r.profiles?.icon||"🙂"} {r.profiles?.name||"Unknown"}</div>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <button onClick={()=>toggleRewardActive(r)} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:r.status==="active"?"rgba(16,24,40,.05)":"rgba(22,163,74,.1)",color:r.status==="active"?INK:"#15803D"}}>{r.status==="active"?"Deactivate":"Reactivate"}</button>
                <button onClick={()=>setDeleteConfirmId(deleteConfirmId===r.id?null:r.id)} className="rounded-full px-3 py-1.5 text-[11px] font-semibold flex items-center justify-center gap-1" style={{background:"rgba(181,67,58,.08)",color:"#B5433A"}}><Trash2 size={11}/>Delete</button>
              </div>
            </div>
            {deleteConfirmId===r.id&&<div className="rounded-xl px-3 py-2.5 mt-2 text-xs" style={{background:"rgba(181,67,58,.08)",color:"#B5433A"}}>
              <div className="mb-2">Delete "{r.name}"? This can't be undone, and only works if no one has ever redeemed it.</div>
              <div className="flex gap-2">
                <button onClick={()=>deleteReward(r.id)} className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-white" style={{background:"#B5433A"}}>Delete item</button>
                <button onClick={()=>setDeleteConfirmId(null)} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(16,24,40,.06)",color:INK}}>Cancel</button>
              </div>
            </div>}
          </div>)}
        </div>
      </div>}

      {tab==="redemptions"&&<div className="space-y-2">
        {reds.length===0?<div className="p-6 text-center rounded-2xl" style={card}><ClipboardCheck size={22} style={{color:ACCENT,margin:"0 auto 8px"}}/><div className="text-sm font-semibold">No orders yet</div></div>
        :reds.map(r=><div key={r.id} className="p-3" style={card}>
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-sm truncate">{r.profiles?.icon} {r.profiles?.name} · {r.rewards?.name}</div>
            <RedemptionStatusPill status={r.status}/>
          </div>
          <div className="text-xs opacity-50 mt-1 mb-2">{r.points_cost.toLocaleString()} Points</div>
          <RedemptionDisputeBanner redemption={r}/>
          <RedemptionActions status={r.status} onReview={(status)=>review(r.id,status)}/>
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
        <p className="text-xs opacity-55 mb-3">Set a points cost — it'll then need a majority vote from this circle's approvers, same as any proposed item.</p>
        <input type="number" autoFocus value={priceValue} onChange={e=>setPriceValue(e.target.value)} placeholder="Points cost" className="w-full rounded-xl border px-3 py-2 text-sm" style={{borderColor:"rgba(16,24,40,.12)"}}/>
        <div className="flex gap-2 mt-4">
          <button onClick={()=>setPriceTarget(null)} className="flex-1 rounded-full py-2.5 text-xs font-semibold" style={{background:"rgba(16,24,40,.06)"}}>Cancel</button>
          <button disabled={!priceValue} onClick={submitPriceProposal} className="flex-1 rounded-full py-2.5 text-xs font-semibold text-white disabled:opacity-50" style={{background:ACCENT}}>Price it</button>
        </div>
      </div>
    </div>}
  </div>;
}
