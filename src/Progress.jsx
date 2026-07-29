import { useCallback, useEffect, useMemo, useState } from "react";
import { Star, Flame, Trophy, Gift, Send, Plus, ShieldCheck, ExternalLink, PartyPopper, X, Pencil, Save, Sparkles, Lock, Gamepad2, ArrowDownLeft, ArrowUpRight, RotateCcw, Info, ChevronDown, ChevronRight, ClipboardCheck } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase } from "./lib/supabase.js";
import { isCommunityVisibleProfile } from "./lib/profileVisibility.js";
import { useAuth } from "./lib/AuthContext.jsx";
import { markTransfersSeen } from "./lib/useNewTransfers.js";

const BG="#F1F3F7", PANEL="#fff", INK="#1B2129", ACCENT="#2F6FED", CREAM="#1B2129";
const card={background:PANEL,border:"1px solid rgba(16,24,40,.09)",borderRadius:16};
const ACTIVITY_LIMIT=8;
const TRANSFER_HISTORY_LIMIT=100;
const GAME_LABELS={queens:"Queens",tango:"Tango",zip:"Zip",minisudoku:"Mini Sudoku",geo:"Geo",zoom:"Zoom"};
const WISH_EMOJIS=["🎁","🚲","🚗","🎮","📱","💻","🎧","⌚","📚","👟","🧸","🎨","✈️","🏕️","🎸","⚽","🏀","🛴","🛹","🐶"];
function suggestWishEmoji(value){
  const s=value.toLowerCase();
  const rules=[
    [/(e[- ]?bike|electric bike|bicycle|bike|cycling)/,"🚲"], [/(scooter)/,"🛴"], [/(skate|board)/,"🛹"],
    [/(car|vehicle)/,"🚗"], [/(phone|iphone|mobile)/,"📱"], [/(laptop|computer|macbook|pc)/,"💻"],
    [/(headphone|earbud|airpod|music)/,"🎧"], [/(watch)/,"⌚"], [/(book|novel|read)/,"📚"],
    [/(shoe|sneaker|boot)/,"👟"], [/(game|playstation|xbox|switch)/,"🎮"], [/(paint|art|draw)/,"🎨"],
    [/(travel|flight|holiday|trip)/,"✈️"], [/(camp|tent)/,"🏕️"], [/(guitar|instrument)/,"🎸"],
    [/(football|soccer)/,"⚽"], [/(basketball)/,"🏀"], [/(dog|puppy)/,"🐶"], [/(toy|plush|teddy)/,"🧸"]
  ];
  return rules.find(([re])=>re.test(s))?.[1]||"🎁";
}
function nextLevelThreshold(level){ return 500 * level * level; }
function activityDetails(item){
  const game=item.gameStat?.game;
  const mode=item.gameStat?.mode;
  if(item.reason_code==="GAME_COMPLETED") return {
    title:`${GAME_LABELS[game]||"Game"} completed`,
    subtitle:mode==="challenge"?"Challenge":"Practice",
    Icon:Gamepad2,color:"#2F6FED",background:"rgba(47,111,237,.10)"
  };
  if(item.reason_code==="TEAM_CHALLENGE_WINNER") return {title:"Team challenge won",subtitle:"Winner’s prize",Icon:Trophy,color:"#9A721F",background:"rgba(217,174,88,.14)"};
  if(item.reason_code==="TEAM_CHALLENGE_COMPLETED") return {title:"Team challenge completed",subtitle:"Challenge reward",Icon:Trophy,color:"#0B7C58",background:"rgba(18,148,106,.10)"};
  if(item.reason_code==="TRANSFER_RECEIVED") return {title:`Received from ${item.other?.name||"a player"}`,subtitle:"Points transfer",Icon:ArrowDownLeft,color:"#15803D",background:"rgba(22,163,74,.10)"};
  if(item.reason_code==="TRANSFER_SENT") return {title:`Sent to ${item.other?.name||"a player"}`,subtitle:"Points transfer",Icon:ArrowUpRight,color:"#B45309",background:"rgba(234,88,12,.09)"};
  if(item.reason_code==="REWARD_REDEEMED") return {title:item.metadata?.reward_name||"Reward redeemed",subtitle:"Spent from your balance",Icon:Gift,color:"#7C3AED",background:"rgba(124,58,237,.09)"};
  if(item.reason_code==="REWARD_REFUND") return {title:"Reward refunded",subtitle:"Returned to your balance",Icon:RotateCcw,color:"#15803D",background:"rgba(22,163,74,.10)"};
  if(item.reason_code==="STREAK_PROTECTION") return {title:"Streak protected",subtitle:"Protection used",Icon:ShieldCheck,color:"#2F6FED",background:"rgba(47,111,237,.10)"};
  if(item.reason_code==="CHALLENGE_STREAK_BROKEN") return {title:"Challenge streak ended",subtitle:"Missed-day adjustment",Icon:Flame,color:"#B5433A",background:"rgba(181,67,58,.09)"};
  if(item.reason_code==="ADMIN_ADJUSTMENT") return {title:item.metadata?.reason||"Points adjustment",subtitle:"Account adjustment",Icon:Star,color:"#9A721F",background:"rgba(217,174,88,.14)"};
  return {title:"Points updated",subtitle:"Account activity",Icon:Star,color:"#2F6FED",background:"rgba(47,111,237,.10)"};
}
function gameBreakdown(item){
  if(item.reason_code!=="GAME_COMPLETED") return [];
  const metadata=item.metadata||{};
  if(metadata.economy_rebased) return [
    ["Previous scale",metadata.pre_v137_points],
    ["Rebalanced",metadata.rebased_points],
  ].filter(([,value])=>Number(value)!==0);
  return [
    ["Base",metadata.base],
    ["Day difficulty",metadata.day_bonus],
    ["Speed",metadata.time],
    ["Hints",metadata.hints],
    ["Mistakes",metadata.mistakes],
    ["Weekly streak",metadata.weekly_streak],
    ["Practice rate",metadata.mode_adjustment],
    ["Adjustment",metadata.limit_adjustment],
    ["Daily cap",metadata.daily_cap_adjustment],
  ].filter(([,value])=>Number(value)!==0);
}

export default function Progress({ onBack, onOpenRewardRequests }) {
  const { user, profile } = useAuth();
  const [progress,setProgress]=useState(null), [rules,setRules]=useState(null), [rewards,setRewards]=useState([]), [wishes,setWishes]=useState([]), [players,setPlayers]=useState([]);
  const [tab,setTab]=useState("rewards"), [message,setMessage]=useState(""), [loading,setLoading]=useState(true);
  const [wish,setWish]=useState({name:"",product_url:"",note:"",emoji:"🎁"});
  const [wishEmojiTouched,setWishEmojiTouched]=useState(false);
  const [editingWish,setEditingWish]=useState(null);
  const [transfer,setTransfer]=useState({player:"",amount:""});
  const [newTransfers,setNewTransfers]=useState([]);
  const [transferLog,setTransferLog]=useState([]);
  const [activity,setActivity]=useState([]);
  const [expandedActivityId,setExpandedActivityId]=useState(null);
  const [redeemTarget,setRedeemTarget]=useState(null);
  const [redeeming,setRedeeming]=useState(false);

  const refresh=useCallback(async()=>{
    setLoading(true);
    await supabase.rpc("ensure_player_progress",{uid:user.id});

    const [{data:p},{data:r},{data:rw},{data:w},{data:ps},{data:tx},{data:transfers}] = await Promise.all([
      supabase.from("player_progress").select("*").eq("player_id",user.id).single(),
      supabase.from("reward_rules").select("*").eq("is_active",true).maybeSingle(),
      supabase.rpc("list_my_available_rewards"),
      supabase.from("reward_wishes").select("*").eq("player_id",user.id).order("created_at",{ascending:false}),
      supabase.from("profiles").select("id,name,icon,is_admin,is_approved,is_blocked,hidden_from_others,account_deleted_at").neq("id",user.id).order("name"),
      supabase.from("points_transactions").select("id,points,reason_code,game_stat_id,related_player_id,reward_id,metadata,created_at,seen_at")
        .eq("player_id",user.id).neq("points",0).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(ACTIVITY_LIMIT),
      supabase.from("points_transactions").select("id,points,reason_code,related_player_id,created_at,seen_at")
        .eq("player_id",user.id).in("reason_code",["TRANSFER_RECEIVED","TRANSFER_SENT"])
        .order("created_at",{ascending:false}).order("id",{ascending:false}).limit(TRANSFER_HISTORY_LIMIT),
    ]);
    const transactionRows=tx||[];
    const gameStatIds=[...new Set(transactionRows.map(item=>item.game_stat_id).filter(Boolean))];
    const {data:gameStats}=gameStatIds.length
      ? await supabase.from("game_stats").select("id,game,mode,seconds,mistakes,hints").in("id",gameStatIds)
      : {data:[]};
    const availablePlayers = (ps || []).filter((item) =>
      isCommunityVisibleProfile(item)
      && !item.is_blocked
      && (item.is_admin || item.is_approved !== false)
    );
    setProgress(p); setRules(r); setRewards(rw||[]); setWishes(w||[]); setPlayers(availablePlayers); setLoading(false);

    const playerById = Object.fromEntries(availablePlayers.map(pl=>[pl.id,pl]));
    const gameStatById=Object.fromEntries((gameStats||[]).map(item=>[item.id,item]));
    const enrichTransaction=item=>({
      ...item,
      metadata:item.metadata||{},
      other:playerById[item.related_player_id]||null,
      gameStat:gameStatById[item.game_stat_id]||null,
    });
    const enrichedTransactions=transactionRows.map(enrichTransaction);
    const enrichedTransfers=(transfers||[]).map(enrichTransaction);
    setActivity(enrichedTransactions);
    setNewTransfers(enrichedTransfers.filter(t=>t.reason_code==="TRANSFER_RECEIVED"&&!t.seen_at).map(t=>({id:t.id,points:t.points,sender:t.other})));
    setTransferLog(enrichedTransfers);
    if (enrichedTransfers.some(t=>t.reason_code==="TRANSFER_RECEIVED"&&!t.seen_at)) await markTransfersSeen();
  },[user.id]);
  useEffect(()=>{refresh()},[refresh]);

  function dismissTransferNotice(id){ setNewTransfers(list=>list.filter(n=>n.id!==id)); }

  const level=Number(progress?.current_level||1);
  const lifetimePoints=Number(progress?.lifetime_points||0);
  const levelStart=500*(level-1)*(level-1);
  const levelTarget=nextLevelThreshold(level);
  const pointsToNext=Math.max(0,levelTarget-lifetimePoints);
  const pct=useMemo(()=>Math.max(0,Math.min(100,((lifetimePoints-levelStart)/Math.max(1,levelTarget-levelStart))*100)),[levelStart,levelTarget,lifetimePoints]);
  // Compares against the live challenge-streak columns (challenge_current_streak /
  // challenge_last_completed_date), not the legacy current_streak / last_completed_date
  // pair the scoring function stopped updating after the streak system moved to
  // per-day-in-Sydney tracking - those are frozen and unrelated to the real streak.
  // Sydney-day strings (not the browser's local timezone) so this can't drift from
  // what the server actually considers "yesterday"/"two days ago".
  const sydneyDateString=(offsetDays=0)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Sydney"}).format(new Date(Date.now()+offsetDays*86400000));
  const canProtect=Number(progress?.challenge_current_streak||0)>0
    && progress?.challenge_last_completed_date===sydneyDateString(-2)
    && !(progress?.streak_protected_through && progress.streak_protected_through>=sydneyDateString(-1));
  const socialUnlocked=!!profile?.is_admin || Number(progress?.current_level || 1)>=2 || Number(progress?.lifetime_points || 0)>=500;

  async function confirmRedeem(){
    if(!redeemTarget)return;
    setRedeeming(true);
    const {error}=await supabase.rpc("redeem_reward",{target_reward_id:redeemTarget.id,note:null});
    setRedeeming(false);
    setRedeemTarget(null);
    setMessage(error?.message||"Reward requested");
    refresh();
  }
  async function submitWish(e){e.preventDefault(); if(!socialUnlocked){setMessage("Reward wishes unlock at Level 2.");return;} if(!wish.name.trim())return; const {error}=await supabase.from("reward_wishes").insert({player_id:user.id,...wish}); setMessage(error?.message||"Wish sent to admin"); if(!error){setWish({name:"",product_url:"",note:"",emoji:"🎁"});setWishEmojiTouched(false);} refresh();}
  function updateWishName(value){setWish(current=>({...current,name:value,emoji:wishEmojiTouched?current.emoji:suggestWishEmoji(value)}));}
  function startWishEdit(item){
    setEditingWish({id:item.id,name:item.name||"",product_url:item.product_url||"",note:item.note||"",emoji:item.emoji||suggestWishEmoji(item.name||"")});
  }
  async function saveWishEdit(e){
    e.preventDefault();
    if(!editingWish?.name.trim())return;
    const {error}=await supabase.rpc("update_submitted_wish",{
      target_wish_id:editingWish.id,
      new_name:editingWish.name,
      new_product_url:editingWish.product_url||"",
      new_note:editingWish.note||"",
      new_emoji:editingWish.emoji||"🎁"
    });
    setMessage(error?.message||"Wish updated");
    if(!error)setEditingWish(null);
    refresh();
  }
  async function sendPoints(e){e.preventDefault(); if(!socialUnlocked){setMessage("Point transfers unlock at Level 2.");return;} const amount=Number(transfer.amount); const {error}=await supabase.rpc("transfer_points",{target_player_id:transfer.player,amount}); setMessage(error?.message||"Points sent"); if(!error)setTransfer({player:"",amount:""}); refresh();}
  async function protect(){const {error}=await supabase.rpc("protect_streak"); setMessage(error?.message||"Streak protected"); refresh();}

  return <div style={{background:BG,minHeight:"100vh",fontFamily:"'Inter',sans-serif"}} className="p-4 pt-10 flex justify-center"><div className="w-full max-w-md">
    <div className="flex items-center gap-3 mb-5"><BackButton onClick={onBack}/><h1 className="text-2xl" style={{fontFamily:"'Fredoka',sans-serif",fontWeight:700,color:INK}}>My Progress</h1></div>
    {loading?<p className="text-center text-sm opacity-40">Loading…</p>:<>
      {newTransfers.length>0&&<div className="flex flex-col gap-2 mb-3">{newTransfers.map(n=><div key={n.id} className="rounded-xl p-3 flex items-center gap-2.5" style={{background:"rgba(139,92,246,.10)",border:"1px solid rgba(139,92,246,.28)"}}><PartyPopper size={18} style={{color:"#8B5CF6",flexShrink:0}}/><div className="flex-1 text-xs" style={{color:INK}}><span className="font-semibold">{n.sender?.icon||"🙂"} {n.sender?.name||"Someone"}</span> sent you <span className="font-semibold">{n.points.toLocaleString()} points</span>!</div><button onClick={()=>dismissTransferNotice(n.id)} aria-label="Dismiss" style={{color:INK,opacity:.4}}><X size={14}/></button></div>)}</div>}
      <section className="rounded-3xl p-4 mb-3 overflow-hidden relative" style={{background:"linear-gradient(145deg,#17233E 0%,#243B73 100%)",color:"#fff",boxShadow:"0 14px 34px rgba(31,52,102,.18)"}}>
        <div className="absolute rounded-full" style={{width:150,height:150,right:-55,top:-70,background:"rgba(255,255,255,.07)"}}/>
        <div className="relative flex items-start gap-3">
          <div className="grid place-items-center rounded-2xl shrink-0" style={{width:52,height:52,background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.14)"}}>
            <Trophy size={23}/>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[.16em]" style={{opacity:.62}}>Your level</div>
            <div className="text-2xl font-bold mt-0.5">Level {level}</div>
            <div className="text-[11px] mt-0.5" style={{opacity:.72}}>{pointsToNext.toLocaleString()} lifetime points to Level {level+1}</div>
          </div>
        </div>
        <div className="relative mt-4">
          <div className="h-2.5 rounded-full overflow-hidden" style={{background:"rgba(255,255,255,.14)"}}>
            <div className="h-full rounded-full" style={{width:`${pct}%`,background:"linear-gradient(90deg,#7EA8FF,#FFFFFF)",boxShadow:"0 0 14px rgba(255,255,255,.28)"}}/>
          </div>
          <div className="flex justify-between mt-1.5 text-[9px]" style={{opacity:.62}}>
            <span>{lifetimePoints.toLocaleString()} lifetime</span>
            <span>{levelTarget.toLocaleString()} needed</span>
          </div>
        </div>
        <div className="relative grid grid-cols-2 gap-2 mt-4">
          <div className="rounded-2xl px-3 py-2.5" style={{background:"rgba(255,255,255,.09)"}}>
            <div className="text-lg font-bold">{Number(progress?.available_points||0).toLocaleString()}</div>
            <div className="text-[9px]" style={{opacity:.62}}>Available to spend</div>
          </div>
          <div className="rounded-2xl px-3 py-2.5" style={{background:"rgba(255,255,255,.09)"}}>
            <div className="flex items-center gap-1.5 text-lg font-bold"><Flame size={16} style={{color:"#FF9D83"}}/>{progress?.challenge_current_streak||0}</div>
            <div className="text-[9px]" style={{opacity:.62}}>Day streak</div>
          </div>
        </div>
      </section>

      <div className="rounded-2xl px-3 py-2.5 mb-3 flex items-start gap-2" style={{background:"rgba(47,111,237,.07)",color:INK}}>
        <Info size={14} className="shrink-0 mt-0.5" style={{color:ACCENT}}/>
        <span className="text-[10px] leading-relaxed" style={{opacity:.62}}>
          Lifetime points raise your level and never decrease when you spend or send points. Gameplay can earn up to {rules?.daily_points_cap||40} points per Sydney day; only the first {rules?.practice_daily_limit||3} Practice games score per game each day, at {rules?.practice_points_percent||50}% of Challenge points.
        </span>
      </div>

      <section className="mb-3 overflow-hidden" style={{...card,borderRadius:20}}>
        <div className="px-4 pt-3.5 pb-2">
          <div className="text-sm font-bold" style={{color:INK}}>How you earned your points</div>
          <div className="text-[10px] mt-0.5" style={{color:INK,opacity:.43}}>Your latest {ACTIVITY_LIMIT} rewards, bonuses and spending</div>
        </div>
        {activity.length===0
          ? <div className="px-4 py-5 text-xs text-center" style={{color:INK,opacity:.4}}>Play a game to start earning points.</div>
          : <div>
            {activity.map((item,index)=>{
              const details=activityDetails(item);
              const Icon=details.Icon;
              const breakdown=gameBreakdown(item);
              const expanded=expandedActivityId===item.id;
              const canExpand=breakdown.length>0;
              return <div key={item.id} style={{borderTop:index===0?"none":"1px solid rgba(16,24,40,.06)"}}>
                <button
                  type="button"
                  onClick={()=>canExpand&&setExpandedActivityId(expanded?null:item.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  aria-expanded={canExpand?expanded:undefined}
                  style={{cursor:canExpand?"pointer":"default"}}
                >
                  <span className="grid place-items-center rounded-xl shrink-0" style={{width:34,height:34,background:details.background,color:details.color}}><Icon size={15}/></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] font-semibold truncate" style={{color:INK}}>{details.title}</span>
                    <span className="block text-[9px] mt-0.5 truncate" style={{color:INK,opacity:.42}}>
                      {details.subtitle} · {new Date(item.created_at).toLocaleDateString(undefined,{day:"numeric",month:"short"})}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-xs font-bold" style={{color:Number(item.points)>=0?"#15803D":"#B5433A"}}>{Number(item.points)>=0?"+":""}{Number(item.points).toLocaleString()}</span>
                    <span className="block text-[8px] mt-0.5" style={{color:INK,opacity:.36}}>points</span>
                  </span>
                  {canExpand&&<ChevronDown size={14} style={{color:INK,opacity:.3,transform:expanded?"rotate(180deg)":"none",transition:"transform .15s"}}/>}
                </button>
                {expanded&&<div className="flex flex-wrap gap-1.5 px-4 pb-3 pl-[62px]">
                  {breakdown.map(([label,value])=><span key={label} className="rounded-full px-2 py-1 text-[9px] font-semibold" style={{background:Number(value)>0?"rgba(22,163,74,.08)":"rgba(181,67,58,.07)",color:Number(value)>0?"#15803D":"#9F2F2A"}}>
                    {label} {Number(value)>0?"+":""}{Number(value)}
                  </span>)}
                </div>}
              </div>;
            })}
          </div>}
      </section>
      {canProtect&&<button onClick={protect} className="gloss-button w-full p-3 mb-3 flex items-center justify-between rounded-lg" style={{color:INK}}><span className="flex items-center gap-2"><ShieldCheck size={18} style={{color:ACCENT}}/><span className="text-sm font-semibold">Protect your streak</span></span><span className="text-xs">{rules?.streak_protection_cost||250} Points</span></button>}
      {message&&<div className="rounded-xl p-3 mb-3 text-xs" style={{background:"rgba(47,111,237,.08)",color:INK}}>{message}</div>}
      <div className="game-mode-switch mb-3" style={{width:"100%",justifyContent:"flex-start"}}>{[["rewards","Rewards",Gift],["wish","Wish",Plus],["transfer","Transfer",Send]].map(([id,label,Icon])=>{const locked=id!=="rewards"&&!socialUnlocked;return <button key={id} disabled={locked} onClick={()=>setTab(id)} className={`gloss-button ${tab===id?"is-active":""}`} style={{flex:1}}>{locked?<Lock size={12}/>:<Icon size={14}/>} {label}</button>})}</div>
      {!socialUnlocked&&<div className="rounded-2xl p-3 mb-3 text-xs flex items-start gap-2" style={{background:"rgba(217,174,88,.10)",color:"#775B1D"}}><Lock size={14} style={{marginTop:1,flexShrink:0}}/><span>Reach Level 2 to submit reward wishes and transfer points. Rewards, streak protection, gameplay, teams you join, chat, and feedback remain available.</span></div>}
      {tab==="rewards"&&onOpenRewardRequests&&<button onClick={onOpenRewardRequests} className="w-full mb-2 rounded-2xl p-3 flex items-center gap-3 text-left" style={card}>
        <span className="grid place-items-center rounded-xl shrink-0" style={{width:36,height:36,background:"rgba(47,111,237,.09)",color:ACCENT}}><ClipboardCheck size={16}/></span>
        <span className="flex-1 min-w-0"><span className="block text-sm font-semibold" style={{color:INK}}>Track my requests</span><span className="block text-[11px] opacity-45">See status and deliveries for what you've redeemed</span></span>
        <ChevronRight size={16} style={{opacity:.35}}/>
      </button>}
      {tab==="rewards"&&<div className="grid grid-cols-2 gap-2">{rewards.length===0?<p className="col-span-2 text-sm text-center opacity-40 py-8">No rewards yet.</p>:rewards.map(r=>{
        const affordable=progress.available_points>=r.points_cost;
        const short=r.points_cost-progress.available_points;
        return <div key={r.id} className="overflow-hidden" style={{...card,opacity:affordable?1:.6}}>{r.image_url?<img src={r.image_url} alt="" className="w-full h-24 object-cover"/>:<div className="h-24 flex items-center justify-center" style={{background:"rgba(217,174,88,.12)"}}><Gift size={30} style={{color:"#D9AE58"}}/></div>}<div className="p-3"><div className="font-semibold text-sm truncate" style={{color:INK}}>{r.name}</div><div className="text-xs mt-1" style={{color:INK,opacity:.55}}>{r.points_cost.toLocaleString()} Points</div><button disabled={!affordable} onClick={()=>setRedeemTarget(r)} className="w-full mt-2 rounded-lg py-1.5 text-xs font-semibold" style={{background:affordable?ACCENT:"rgba(16,24,40,.08)",color:affordable?"white":INK}}>{affordable?"Redeem":`Need ${short.toLocaleString()} more`}</button></div></div>;
      })}</div>}
      {tab==="wish"&&<><form onSubmit={submitWish} className="p-4" style={card}><div className="flex gap-2 mb-2"><div className="rounded-xl text-2xl flex items-center justify-center shrink-0" style={{width:46,background:"rgba(47,111,237,.08)"}}>{wish.emoji}</div><input value={wish.name} onChange={e=>updateWishName(e.target.value)} placeholder="What would make your day?" className="flex-1 min-w-0 rounded-xl border px-3 py-2 text-sm"/></div><div className="text-[11px] opacity-45 mb-2 flex items-center gap-1"><Sparkles size={12}/>Suggested from your wish — tap another emoji to change it</div><div className="flex flex-wrap gap-1.5 mb-3">{WISH_EMOJIS.map(item=><button type="button" key={item} onClick={()=>{setWish({...wish,emoji:item});setWishEmojiTouched(true)}} className="rounded-lg text-lg" style={{width:34,height:34,background:item===wish.emoji?"rgba(47,111,237,.14)":"rgba(16,24,40,.045)",border:item===wish.emoji?"1px solid rgba(47,111,237,.35)":"1px solid transparent"}}>{item}</button>)}</div><input value={wish.product_url} onChange={e=>setWish({...wish,product_url:e.target.value})} placeholder="🔗 Optional product link" className="w-full rounded-lg border px-3 py-2 text-sm mb-2"/><textarea value={wish.note} onChange={e=>setWish({...wish,note:e.target.value})} placeholder="💭 Add a note, size, colour or idea" className="w-full rounded-lg border px-3 py-2 text-sm mb-2"/><button className="w-full rounded-xl py-2.5 text-sm font-semibold text-white" style={{background:ACCENT}}>Send wish</button></form>{wishes.map(w=>editingWish?.id===w.id?<form key={w.id} onSubmit={saveWishEdit} className="p-4 mt-2" style={{...card,border:"1px solid rgba(47,111,237,.3)",background:"rgba(47,111,237,.035)"}}><div className="text-xs font-semibold mb-3 flex items-center gap-1.5"><Pencil size={13}/>Edit submitted wish</div><div className="flex gap-2 mb-2"><div className="rounded-xl text-2xl flex items-center justify-center shrink-0" style={{width:46,background:"rgba(47,111,237,.08)"}}>{editingWish.emoji}</div><input value={editingWish.name} onChange={e=>setEditingWish({...editingWish,name:e.target.value,emoji:suggestWishEmoji(e.target.value)})} className="flex-1 min-w-0 rounded-xl border px-3 py-2 text-sm"/></div><div className="flex flex-wrap gap-1.5 mb-3">{WISH_EMOJIS.map(item=><button type="button" key={item} onClick={()=>setEditingWish({...editingWish,emoji:item})} className="rounded-lg text-lg" style={{width:34,height:34,background:item===editingWish.emoji?"rgba(47,111,237,.14)":"rgba(16,24,40,.045)"}}>{item}</button>)}</div><input value={editingWish.product_url} onChange={e=>setEditingWish({...editingWish,product_url:e.target.value})} placeholder="🔗 Optional product link" className="w-full rounded-lg border px-3 py-2 text-sm mb-2"/><textarea value={editingWish.note} onChange={e=>setEditingWish({...editingWish,note:e.target.value})} placeholder="💭 Notes" className="w-full rounded-lg border px-3 py-2 text-sm mb-3"/><div className="flex gap-2"><button type="button" onClick={()=>setEditingWish(null)} className="flex-1 rounded-xl py-2 text-xs font-semibold" style={{background:"rgba(16,24,40,.06)"}}>Cancel</button><button className="flex-1 rounded-xl py-2 text-xs font-semibold text-white flex items-center justify-center gap-1.5" style={{background:ACCENT}}><Save size={13}/>Save wish</button></div></form>:<div key={w.id} className="p-3 mt-2" style={card}><div className="flex items-start gap-2"><div className="text-xl">{w.emoji||(w.status==="approved"?"🎉":w.status==="declined"?"🌧️":"🎁")}</div><div className="flex-1 min-w-0"><div className="text-sm font-semibold">{w.name}</div>{w.note&&<div className="text-xs opacity-55 mt-1">{w.note}</div>}<div className="text-[11px] opacity-45 capitalize mt-1">{w.status}{w.points_cost?` · ${w.points_cost.toLocaleString()} Points`:""}</div></div><div className="flex gap-1.5">{w.product_url&&<a href={w.product_url} target="_blank" rel="noreferrer" className="rounded-full flex items-center justify-center" style={{width:30,height:30,background:"rgba(16,24,40,.05)"}} aria-label="Open wish link"><ExternalLink size={14}/></a>}{w.status==="submitted"&&<button onClick={()=>startWishEdit(w)} className="rounded-full flex items-center justify-center" style={{width:30,height:30,background:"rgba(47,111,237,.09)",color:ACCENT}} aria-label="Edit submitted wish"><Pencil size={14}/></button>}</div></div></div>)}</>}
      {tab==="transfer"&&<><form onSubmit={sendPoints} className="p-4" style={card}><select value={transfer.player} onChange={e=>setTransfer({...transfer,player:e.target.value})} className="w-full rounded-lg border px-3 py-2 text-sm mb-2" required><option value="">Choose player</option>{players.map(p=><option key={p.id} value={p.id}>{p.icon||"🙂"} {p.name}</option>)}</select><input type="number" min="10" value={transfer.amount} onChange={e=>setTransfer({...transfer,amount:e.target.value})} placeholder="Points" className="w-full rounded-lg border px-3 py-2 text-sm mb-2" required/><button className="w-full rounded-lg py-2 text-sm font-semibold text-white" style={{background:ACCENT}}>Send Points</button></form><div className="mt-3"><div className="text-xs font-semibold mb-2 opacity-60">Transfer history</div>{transferLog.length===0?<div className="text-xs opacity-40 text-center py-4">No transfers yet.</div>:transferLog.map(t=><div key={t.id} className="flex items-center gap-3 p-3 mb-2" style={card}><div className="text-xl">{t.reason_code==="TRANSFER_RECEIVED"?"🎉":"💸"}</div><div className="flex-1"><div className="text-xs font-semibold">{t.reason_code==="TRANSFER_RECEIVED"?`Received from ${t.other?.icon||"🙂"} ${t.other?.name||"Someone"}`:`Sent to ${t.other?.icon||"🙂"} ${t.other?.name||"Someone"}`}</div><div className="text-[10px] opacity-40">{new Date(t.created_at).toLocaleString()}</div></div><div className="font-bold text-sm" style={{color:t.points>0?"#15803D":"#B5433A"}}>{t.points>0?"+":""}{t.points.toLocaleString()}</div></div>)}</div></>}
    </>}
    {redeemTarget&&<div className="fixed inset-0 z-50 grid place-items-center p-4" style={{background:"rgba(16,24,40,.45)"}}><div className="w-full max-w-sm rounded-3xl p-5" style={{background:"#fff",boxShadow:"0 24px 60px rgba(16,24,40,.22)"}}><div className="flex gap-3 items-start"><div className="text-2xl">{redeemTarget.image_url?<img src={redeemTarget.image_url} alt="" className="rounded-xl" style={{width:44,height:44,objectFit:"cover"}}/>:<Gift size={28} style={{color:"#D9AE58"}}/>}</div><div className="flex-1"><h2 className="font-bold">Redeem {redeemTarget.name}?</h2><p className="text-xs opacity-55 mt-1">{redeemTarget.points_cost.toLocaleString()} Points will be spent right away. A reward manager will review and deliver it.</p></div><button onClick={()=>setRedeemTarget(null)} aria-label="Cancel"><X size={16}/></button></div><div className="flex gap-2 mt-4"><button onClick={()=>setRedeemTarget(null)} className="flex-1 rounded-full py-2.5 text-xs font-semibold" style={{background:"rgba(16,24,40,.06)"}}>Cancel</button><button disabled={redeeming} onClick={confirmRedeem} className="flex-1 rounded-full py-2.5 text-xs font-semibold text-white disabled:opacity-50" style={{background:ACCENT}}>{redeeming?"Redeeming…":"Redeem"}</button></div></div></div>}
  </div></div>;
}
