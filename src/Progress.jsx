import { useCallback, useEffect, useMemo, useState } from "react";
import { Star, Flame, Trophy, Gift, Send, ShieldCheck, PartyPopper, X, Lock, Gamepad2, ArrowDownLeft, ArrowUpRight, RotateCcw, Info, ChevronDown, ChevronRight } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase } from "./lib/supabase.js";
import { isCommunityVisibleProfile } from "./lib/profileVisibility.js";
import { useAuth } from "./lib/AuthContext.jsx";
import { markTransfersSeen } from "./lib/useNewTransfers.js";
import Page from "./components/Page.jsx";
import Button from "./components/Button.jsx";
import Card from "./components/Card.jsx";
import StatusBanner from "./components/StatusBanner.jsx";

const ACTIVITY_LIMIT=8;
const TRANSFER_HISTORY_LIMIT=100;
const GAME_LABELS={queens:"Queens",tango:"Tango",zip:"Zip",minisudoku:"Mini Sudoku",geo:"Geo",zoom:"Zoom"};
function nextLevelThreshold(level){ return 500 * level * level; }
function activityDetails(item){
  const game=item.gameStat?.game,mode=item.gameStat?.mode;
  if(item.reason_code==="GAME_COMPLETED") return {title:`${GAME_LABELS[game]||"Game"} completed`,subtitle:mode==="challenge"?"Challenge":"Practice",Icon:Gamepad2,color:"#2F6FED",bg:"rgba(47,111,237,.10)"};
  if(item.reason_code==="TEAM_CHALLENGE_WINNER") return {title:"Team challenge won",subtitle:"Winner's prize",Icon:Trophy,color:"#9A721F",bg:"rgba(217,174,88,.14)"};
  if(item.reason_code==="TEAM_CHALLENGE_COMPLETED") return {title:"Team challenge completed",subtitle:"Challenge reward",Icon:Trophy,color:"#0B7C58",bg:"rgba(18,148,106,.10)"};
  if(item.reason_code==="TRANSFER_RECEIVED") return {title:`Received from ${item.other?.name||"a player"}`,subtitle:"Points transfer",Icon:ArrowDownLeft,color:"#15803D",bg:"rgba(22,163,74,.10)"};
  if(item.reason_code==="TRANSFER_SENT") return {title:`Sent to ${item.other?.name||"a player"}`,subtitle:"Points transfer",Icon:ArrowUpRight,color:"#B45309",bg:"rgba(234,88,12,.09)"};
  if(item.reason_code==="REWARD_REDEEMED") return {title:item.metadata?.reward_name||"Reward redeemed",subtitle:"Spent from your balance",Icon:Gift,color:"#7C3AED",bg:"rgba(124,58,237,.09)"};
  if(item.reason_code==="REWARD_REFUND") return {title:"Reward refunded",subtitle:"Returned to your balance",Icon:RotateCcw,color:"#15803D",bg:"rgba(22,163,74,.10)"};
  if(item.reason_code==="STREAK_PROTECTION") return {title:"Streak protected",subtitle:"Protection used",Icon:ShieldCheck,color:"#2F6FED",bg:"rgba(47,111,237,.10)"};
  if(item.reason_code==="CHALLENGE_STREAK_BROKEN") return {title:"Challenge streak ended",subtitle:"Missed-day adjustment",Icon:Flame,color:"#B5433A",bg:"rgba(181,67,58,.09)"};
  if(item.reason_code==="ADMIN_ADJUSTMENT") return {title:item.metadata?.reason||"Points adjustment",subtitle:"Account adjustment",Icon:Star,color:"#9A721F",bg:"rgba(217,174,88,.14)"};
  return {title:"Points updated",subtitle:"Account activity",Icon:Star,color:"#2F6FED",bg:"rgba(47,111,237,.10)"};
}
function gameBreakdown(item){
  if(item.reason_code!=="GAME_COMPLETED") return [];
  const m=item.metadata||{};
  if(m.economy_rebased) return [["Previous scale",m.pre_v137_points],["Rebalanced",m.rebased_points]].filter(([,v])=>Number(v)!==0);
  return [["Base",m.base],["Day difficulty",m.day_bonus],["Speed",m.time],["Hints",m.hints],["Mistakes",m.mistakes],["Weekly streak",m.weekly_streak],["Practice rate",m.mode_adjustment],["Adjustment",m.limit_adjustment],["Practice cap",m.daily_cap_adjustment]].filter(([,v])=>Number(v)!==0);
}

export default function Progress({ onBack, onOpenRewards }) {
  const { user, profile } = useAuth();
  const [progress,setProgress]=useState(null),[rules,setRules]=useState(null),[players,setPlayers]=useState([]);
  const [message,setMessage]=useState(""),[loading,setLoading]=useState(true);
  const [transfer,setTransfer]=useState({player:"",amount:""});
  const [newTransfers,setNewTransfers]=useState([]);
  const [transferLog,setTransferLog]=useState([]);
  const [activity,setActivity]=useState([]);
  const [expandedActivityId,setExpandedActivityId]=useState(null);

  const refresh=useCallback(async()=>{
    setLoading(true);
    await supabase.rpc("ensure_player_progress",{uid:user.id});
    const [{data:p},{data:r},{data:ps},{data:tx},{data:transfers}]=await Promise.all([
      supabase.from("player_progress").select("*").eq("player_id",user.id).single(),
      supabase.from("reward_rules").select("*").eq("is_active",true).maybeSingle(),
      supabase.from("profiles").select("id,name,icon,is_admin,is_approved,is_blocked,hidden_from_others,account_deleted_at").neq("id",user.id).order("name"),
      supabase.from("points_transactions").select("id,points,reason_code,game_stat_id,related_player_id,reward_id,metadata,created_at,seen_at").eq("player_id",user.id).neq("points",0).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(ACTIVITY_LIMIT),
      supabase.from("points_transactions").select("id,points,reason_code,related_player_id,created_at,seen_at").eq("player_id",user.id).in("reason_code",["TRANSFER_RECEIVED","TRANSFER_SENT"]).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(TRANSFER_HISTORY_LIMIT),
    ]);
    const txRows=tx||[];
    const gsIds=[...new Set(txRows.map(i=>i.game_stat_id).filter(Boolean))];
    const {data:gameStats}=gsIds.length?await supabase.from("game_stats").select("id,game,mode,seconds,mistakes,hints").in("id",gsIds):{data:[]};
    const avail=(ps||[]).filter(i=>isCommunityVisibleProfile(i)&&!i.is_blocked&&(i.is_admin||i.is_approved!==false));
    setProgress(p);setRules(r);setPlayers(avail);setLoading(false);
    const pb=Object.fromEntries(avail.map(pl=>[pl.id,pl]));
    const gsb=Object.fromEntries((gameStats||[]).map(i=>[i.id,i]));
    const enrich=i=>({...i,metadata:i.metadata||{},other:pb[i.related_player_id]||null,gameStat:gsb[i.game_stat_id]||null});
    setActivity(txRows.map(enrich));
    const eTrans=(transfers||[]).map(enrich);
    setNewTransfers(eTrans.filter(t=>t.reason_code==="TRANSFER_RECEIVED"&&!t.seen_at).map(t=>({id:t.id,points:t.points,sender:t.other})));
    setTransferLog(eTrans);
    if(eTrans.some(t=>t.reason_code==="TRANSFER_RECEIVED"&&!t.seen_at)) await markTransfersSeen();
  },[user.id]);
  useEffect(()=>{refresh()},[refresh]);

  function dismissTransferNotice(id){setNewTransfers(l=>l.filter(n=>n.id!==id));}
  const level=Number(progress?.current_level||1),lp=Number(progress?.lifetime_points||0);
  const ls=500*(level-1)*(level-1),lt=nextLevelThreshold(level);
  const p2n=Math.max(0,lt-lp);
  const pct=useMemo(()=>Math.max(0,Math.min(100,((lp-ls)/Math.max(1,lt-ls))*100)),[ls,lt,lp]);
  const sd=(o=0)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Sydney"}).format(new Date(Date.now()+o*86400000));
  const canProtect=Number(progress?.challenge_current_streak||0)>0&&progress?.challenge_last_completed_date===sd(-2)&&!(progress?.streak_protected_through&&progress.streak_protected_through>=sd(-1));
  const socialUnlocked=!!profile?.is_admin||level>=2||lp>=500;

  async function sendPoints(e){e.preventDefault();if(!socialUnlocked){setMessage("Point transfers unlock at Level 2.");return;}const amount=Number(transfer.amount);const{error}=await supabase.rpc("transfer_points",{target_player_id:transfer.player,amount});setMessage(error?.message||"Points sent");if(!error)setTransfer({player:"",amount:""});refresh();}
  async function protect(){const{error}=await supabase.rpc("protect_streak");setMessage(error?.message||"Streak protected");refresh();}

  return (
    <Page>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-5)" }}>
        <BackButton onClick={onBack} />
        <h1 style={{ fontSize: "var(--text-page-title-size)", fontWeight: 700, color: "var(--color-text-primary)" }}>My Progress</h1>
      </div>
      {loading?<p style={{textAlign:"center",fontSize:"var(--text-body-size)",color:"var(--color-text-secondary)",padding:"var(--space-8) 0"}}>Loading…</p>:<>
        {newTransfers.length>0&&<div style={{display:"flex",flexDirection:"column",gap:"var(--space-2)",marginBottom:"var(--space-3)"}}>
          {newTransfers.map(n=><StatusBanner key={n.id} variant="info" dismissible onDismiss={()=>dismissTransferNotice(n.id)}>
            <PartyPopper size={14} style={{marginRight:4}}/> <strong>{n.sender?.icon||"🙂"} {n.sender?.name||"Someone"}</strong> sent you <strong>{n.points.toLocaleString()} points</strong>!
          </StatusBanner>)}
        </div>}

        <section style={{borderRadius:"var(--radius-xl)",padding:"var(--space-4)",marginBottom:"var(--space-3)",overflow:"hidden",position:"relative",background:"linear-gradient(145deg,#17233E 0%,#243B73 100%)",color:"#fff",boxShadow:"0 14px 34px rgba(31,52,102,.18)"}}>
          <div style={{position:"absolute",width:150,height:150,right:-55,top:-70,background:"rgba(255,255,255,.07)",borderRadius:"50%"}}/>
          <div style={{position:"relative",display:"flex",alignItems:"flex-start",gap:"var(--space-3)"}}>
            <div style={{width:52,height:52,borderRadius:"var(--radius-lg)",background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.14)",display:"grid",placeItems:"center",flexShrink:0}}><Trophy size={23}/></div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:".16em",opacity:.62}}>Your level</div>
              <div style={{fontSize:"1.5rem",fontWeight:700,marginTop:2}}>Level {level}</div>
              <div style={{fontSize:11,marginTop:2,opacity:.72}}>{p2n.toLocaleString()} lifetime points to Level {level+1}</div>
            </div>
          </div>
          <div style={{position:"relative",marginTop:"var(--space-4)"}}>
            <div style={{height:10,borderRadius:"var(--radius-full)",overflow:"hidden",background:"rgba(255,255,255,.14)"}}>
              <div style={{height:"100%",borderRadius:"var(--radius-full)",width:`${pct}%`,background:"linear-gradient(90deg,#7EA8FF,#FFFFFF)",boxShadow:"0 0 14px rgba(255,255,255,.28)"}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:9,opacity:.62}}><span>{lp.toLocaleString()} lifetime</span><span>{lt.toLocaleString()} needed</span></div>
          </div>
          <div style={{position:"relative",display:"grid",gridTemplateColumns:"1fr 1fr",gap:"var(--space-2)",marginTop:"var(--space-4)"}}>
            <div style={{borderRadius:"var(--radius-lg)",padding:"10px var(--space-3)",background:"rgba(255,255,255,.09)"}}><div style={{fontSize:"1.1rem",fontWeight:700}}>{Number(progress?.available_points||0).toLocaleString()}</div><div style={{fontSize:9,opacity:.62}}>Available to spend</div></div>
            <div style={{borderRadius:"var(--radius-lg)",padding:"10px var(--space-3)",background:"rgba(255,255,255,.09)"}}><div style={{display:"flex",alignItems:"center",gap:6,fontSize:"1.1rem",fontWeight:700}}><Flame size={16} style={{color:"#FF9D83"}}/>{progress?.challenge_current_streak||0}</div><div style={{fontSize:9,opacity:.62}}>Day streak</div></div>
          </div>
        </section>

        <div style={{borderRadius:"var(--radius-lg)",padding:"var(--space-3)",marginBottom:"var(--space-3)",display:"flex",alignItems:"flex-start",gap:"var(--space-2)",background:"var(--color-info-bg)",color:"var(--color-text-primary)"}}>
          <Info size={14} style={{color:"var(--color-primary)",flexShrink:0,marginTop:2}}/>
          <span style={{fontSize:10,lineHeight:1.5,opacity:.65}}>Lifetime points raise your level and never decrease when you spend or send points. Practice can earn up to {rules?.daily_points_cap||40} points per Sydney day; only the first {rules?.practice_daily_limit||3} Practice games per game score each day, at {rules?.practice_points_percent||50}% of Challenge points. Challenge points are not capped.</span>
        </div>

        {onOpenRewards&&<button onClick={onOpenRewards} style={{width:"100%",marginBottom:"var(--space-3)",borderRadius:"var(--radius-lg)",padding:"var(--space-3)",display:"flex",alignItems:"center",gap:"var(--space-3)",textAlign:"left",background:"var(--color-surface)",border:"1px solid var(--color-border)",cursor:"pointer",color:"inherit"}}>
          <span style={{width:36,height:36,borderRadius:"var(--radius-md)",background:"var(--color-info-bg)",color:"var(--color-primary)",display:"grid",placeItems:"center",flexShrink:0}}><Gift size={16}/></span>
          <span style={{flex:1,minWidth:0}}><span style={{display:"block",fontSize:"var(--text-body-size)",fontWeight:600,color:"var(--color-text-primary)"}}>Open Rewards</span><span style={{display:"block",fontSize:11,color:"var(--color-text-secondary)"}}>Suggest, vote on, and get rewards from your circles</span></span>
          <ChevronRight size={16} style={{opacity:.35}}/>
        </button>}

        <Card style={{marginBottom:"var(--space-3)",padding:0,overflow:"hidden",borderRadius:"var(--radius-xl)"}}>
          <div style={{padding:"14px var(--space-4) var(--space-2)"}}>
            <div style={{fontSize:"var(--text-body-size)",fontWeight:700,color:"var(--color-text-primary)"}}>How you earned your points</div>
            <div style={{fontSize:10,marginTop:2,color:"var(--color-text-secondary)"}}>Your latest {ACTIVITY_LIMIT} rewards, bonuses and spending</div>
          </div>
          {activity.length===0?<div style={{padding:"var(--space-5) var(--space-4)",textAlign:"center",fontSize:"var(--text-caption-size)",color:"var(--color-text-secondary)"}}>Play a game to start earning points.</div>:<div>
            {activity.map((item,index)=>{const d=activityDetails(item);const Icon=d.Icon;const br=gameBreakdown(item);const expanded=expandedActivityId===item.id;const canExpand=br.length>0;
              return <div key={item.id} style={{borderTop:index===0?"none":"1px solid var(--color-border)"}}>
                <button type="button" onClick={()=>canExpand&&setExpandedActivityId(expanded?null:item.id)} style={{display:"flex",alignItems:"center",gap:"var(--space-3)",width:"100%",padding:"var(--space-3) var(--space-4)",textAlign:"left",background:"transparent",border:"none",cursor:canExpand?"pointer":"default",color:"inherit",fontFamily:"inherit"}} aria-expanded={canExpand?expanded:undefined}>
                  <span style={{width:34,height:34,borderRadius:"var(--radius-md)",display:"grid",placeItems:"center",color:d.color,background:d.bg,flexShrink:0}}><Icon size={15}/></span>
                  <span style={{flex:1,minWidth:0}}>
                    <span style={{display:"block",fontSize:11,fontWeight:600,color:"var(--color-text-primary)"}} className="truncate">{d.title}</span>
                    <span style={{display:"block",fontSize:9,marginTop:2,color:"var(--color-text-secondary)"}} className="truncate">{d.subtitle} · {new Date(item.created_at).toLocaleDateString(undefined,{day:"numeric",month:"short"})}</span>
                  </span>
                  <span style={{textAlign:"right",flexShrink:0}}>
                    <span style={{display:"block",fontSize:"var(--text-caption-size)",fontWeight:700,color:Number(item.points)>=0? "var(--color-success-text)":"var(--color-danger-text)"}}>{Number(item.points)>=0?"+":""}{Number(item.points).toLocaleString()}</span>
                    <span style={{display:"block",fontSize:8,marginTop:2,color:"var(--color-text-secondary)"}}>points</span>
                  </span>
                  {canExpand&&<ChevronDown size={14} style={{color:"var(--color-text-secondary)",transform:expanded?"rotate(180deg)":"none",transition:"transform .15s"}}/>}
                </button>
                {expanded&&<div style={{display:"flex",flexWrap:"wrap",gap:6,padding:"0 var(--space-4) var(--space-3)",paddingLeft:62}}>
                  {br.map(([label,value])=><span key={label} style={{borderRadius:"var(--radius-full)",padding:"2px 8px",fontSize:9,fontWeight:600,background:Number(value)>0?"var(--color-success-bg)":"var(--color-danger-bg)",color:Number(value)>0?"var(--color-success-text)":"var(--color-danger-text)"}}>{label} {Number(value)>0?"+":""}{Number(value)}</span>)}
                </div>}
              </div>;
            })}
          </div>}
        </Card>

        {canProtect&&<Button variant="secondary" fullWidth before={<ShieldCheck size={18}/>} onClick={protect} style={{marginBottom:"var(--space-3)",justifyContent:"space-between"}}><span>Protect your streak</span><span style={{fontSize:"var(--text-caption-size)"}}>{rules?.streak_protection_cost||250} Points</span></Button>}
        {message&&<div style={{marginBottom:"var(--space-3)"}}><StatusBanner variant="info" dismissible onDismiss={()=>setMessage("")}>{message}</StatusBanner></div>}

        <div style={{fontSize:"var(--text-body-size)",fontWeight:700,marginBottom:"var(--space-2)",display:"flex",alignItems:"center",gap:"var(--space-2)",color:"var(--color-text-primary)"}}><Send size={14}/> Transfer points</div>
        {!socialUnlocked?<StatusBanner variant="warning"><Lock size={14} style={{marginRight:4}}/> Reach Level 2 to send points to other players.</StatusBanner>
        :<><form onSubmit={sendPoints} style={{marginBottom:"var(--space-3)"}}><Card style={{padding:"var(--space-4)"}}><select value={transfer.player} onChange={e=>setTransfer({...transfer,player:e.target.value})} required style={{width:"100%",borderRadius:"var(--radius-sm)",border:"1px solid var(--color-border-strong)",padding:"var(--space-2) var(--space-3)",fontSize:"var(--text-body-size)",marginBottom:"var(--space-2)",background:"var(--color-surface-input)",color:"var(--color-text-primary)",boxSizing:"border-box"}}><option value="">Choose player</option>{players.map(p=><option key={p.id} value={p.id}>{p.icon||"🙂"} {p.name}</option>)}</select><input type="number" min="10" value={transfer.amount} onChange={e=>setTransfer({...transfer,amount:e.target.value})} placeholder="Points" required style={{width:"100%",borderRadius:"var(--radius-sm)",border:"1px solid var(--color-border-strong)",padding:"var(--space-2) var(--space-3)",fontSize:"var(--text-body-size)",marginBottom:"var(--space-2)",background:"var(--color-surface-input)",color:"var(--color-text-primary)",boxSizing:"border-box"}}/><Button variant="primary" fullWidth type="submit">Send Points</Button></Card></form>
        <div style={{marginTop:"var(--space-3)"}}><div style={{fontSize:"var(--text-caption-size)",fontWeight:600,marginBottom:"var(--space-2)",color:"var(--color-text-secondary)"}}>Transfer history</div>
        {transferLog.length===0?<div style={{textAlign:"center",padding:"var(--space-4)",fontSize:"var(--text-caption-size)",color:"var(--color-text-secondary)"}}>No transfers yet.</div>
        :transferLog.map(t=><Card key={t.id} style={{display:"flex",alignItems:"center",gap:"var(--space-3)",padding:"var(--space-3)",marginBottom:"var(--space-2)"}}>
          <div style={{fontSize:20}}>{t.reason_code==="TRANSFER_RECEIVED"?"🎉":"💸"}</div>
          <div style={{flex:1}}><div style={{fontSize:"var(--text-caption-size)",fontWeight:600,color:"var(--color-text-primary)"}}>{t.reason_code==="TRANSFER_RECEIVED"?`Received from ${t.other?.icon||"🙂"} ${t.other?.name||"Someone"}`:`Sent to ${t.other?.icon||"🙂"} ${t.other?.name||"Someone"}`}</div><div style={{fontSize:10,color:"var(--color-text-secondary)"}}>{new Date(t.created_at).toLocaleString()}</div></div>
          <div style={{fontWeight:700,fontSize:"var(--text-body-size)",color:t.points>0?"var(--color-success-text)":"var(--color-danger-text)"}}>{t.points>0?"+":""}{t.points.toLocaleString()}</div>
        </Card>)}
        </div></>}
      </>}
    </Page>
  );
}
