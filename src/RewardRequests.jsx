import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, AlertTriangle } from "lucide-react";
import BackButton from "./BackButton.jsx";
import { supabase } from "./lib/supabase.js";
import { useAuth } from "./lib/AuthContext.jsx";

const BG="#F1F3F7",PANEL="#fff",INK="#1B2129",ACCENT="#2F6FED";
const box={background:PANEL,border:"1px solid rgba(16,24,40,.09)",borderRadius:14};
const DISPUTE_WINDOW_MS=48*60*60*1000;

const STATUS_LABEL={
  requested:{text:"Requested",color:"#B5730E",bg:"rgba(217,148,10,.10)"},
  approved:{text:"Approved",color:"#2F6FED",bg:"rgba(47,111,237,.09)"},
  declined:{text:"Declined",color:"#B5433A",bg:"rgba(181,67,58,.09)"},
  fulfilled:{text:"Delivered",color:"#12946A",bg:"rgba(18,148,106,.09)"},
  disputed:{text:"Disputed",color:"#B5433A",bg:"rgba(181,67,58,.09)"},
  cancelled:{text:"Cancelled",color:"#6B7280",bg:"rgba(107,114,128,.09)"},
};

export default function RewardRequests({onBack}){
  const {user,profile}=useAuth();
  const isRewardManager=!!(profile?.is_admin||profile?.is_reward_steward);
  const [reds,setReds]=useState([]);
  const [loading,setLoading]=useState(true);
  const [msg,setMsg]=useState("");
  const [disputeTarget,setDisputeTarget]=useState(null);
  const [disputeReason,setDisputeReason]=useState("");

  const refresh=useCallback(async()=>{
    setLoading(true);
    const {data,error}=await supabase.rpc("list_reward_requests");
    if(error) setMsg(error.message);
    setReds(data||[]);
    setLoading(false);
  },[]);

  useEffect(()=>{
    refresh();
    if(!user?.id) return;
    supabase.from("user_section_views").upsert({user_id:user.id,section:"rewardrequests",viewed_at:new Date().toISOString()})
      .then(({error})=>{
        if(error) console.error("Unable to mark Reward Requests as viewed:",error);
        else window.dispatchEvent(new CustomEvent("rewardrequests-section-seen"));
      });
  },[refresh,user?.id]);

  async function review(id,status){
    const {error}=await supabase.rpc("review_redemption",{target_id:id,new_status:status,admin_note_in:null});
    setMsg(error?.message||"Request updated");
    refresh();
  }

  async function submitDispute(){
    if(!disputeReason.trim())return;
    const {error}=await supabase.rpc("dispute_redemption",{target_id:disputeTarget.id,reason:disputeReason.trim()});
    setMsg(error?.message||"Dispute raised");
    if(!error){setDisputeTarget(null);setDisputeReason("");}
    refresh();
  }

  function canDispute(r){
    return r.player_id===user?.id && r.status==="fulfilled" && r.fulfilled_at
      && Date.now()-new Date(r.fulfilled_at).getTime()<DISPUTE_WINDOW_MS;
  }

  return <div style={{background:BG,minHeight:"100vh",fontFamily:"'Inter',sans-serif"}} className="p-4 pt-10 flex justify-center">
    <div className="w-full max-w-xl">
      <div className="flex gap-3 items-center mb-1"><BackButton onClick={onBack}/><h1 className="text-2xl font-bold" style={{fontFamily:"'Fredoka',sans-serif",color:INK}}>{isRewardManager?"Reward requests":"My reward requests"}</h1></div>
      <p className="text-xs opacity-45 mb-4 px-1">{isRewardManager?"Every player's item requests, in one place — from request to delivery.":"Track your requests from request to delivery, and dispute one if it's marked delivered by mistake."}</p>
      {msg&&<div className="p-3 mb-3 rounded-xl text-xs" style={{background:"rgba(47,111,237,.08)"}}>{msg}</div>}
      {loading?<p className="text-sm text-center opacity-45 py-10">Loading…</p>
      :reds.length===0?<div className="p-6 text-center rounded-2xl" style={box}><ClipboardCheck size={22} style={{color:ACCENT,margin:"0 auto 8px"}}/><div className="text-sm font-semibold">No requests yet</div></div>
      :reds.map(r=><div key={r.id} className="p-3 mb-2" style={box}>
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold text-sm">{r.player_icon} {r.player_name} · {r.reward_name}</div>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0" style={{color:STATUS_LABEL[r.status]?.color,background:STATUS_LABEL[r.status]?.bg}}>{STATUS_LABEL[r.status]?.text||r.status}</span>
        </div>
        <div className="text-xs opacity-50 mt-1 mb-2">{r.points_cost.toLocaleString()} Points · requested {new Date(r.requested_at).toLocaleDateString()}{r.reviewed_by_name&&["approved","declined","fulfilled","disputed"].includes(r.status)?` · by ${r.reviewed_by_icon||""} ${r.reviewed_by_name}`:""}</div>
        {r.status==="disputed"&&r.dispute_reason&&<div className="flex items-start gap-1.5 text-xs mb-2 rounded-lg px-2 py-1.5" style={{background:"rgba(181,67,58,.08)",color:"#B5433A"}}><AlertTriangle size={12} className="shrink-0 mt-0.5"/>{r.dispute_reason}</div>}
        {isRewardManager&&r.status==="requested"&&<div className="flex gap-2">
          <button onClick={()=>review(r.id,"approved")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(22,163,74,.1)",color:"#166534"}}>Approve</button>
          <button onClick={()=>review(r.id,"declined")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(181,67,58,.08)",color:"#B5433A"}}>Decline &amp; refund</button>
        </div>}
        {isRewardManager&&r.status==="approved"&&<button onClick={()=>review(r.id,"fulfilled")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(47,111,237,.09)",color:ACCENT}}>Mark delivered</button>}
        {isRewardManager&&r.status==="disputed"&&<div className="flex gap-2">
          <button onClick={()=>review(r.id,"fulfilled")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(22,163,74,.1)",color:"#166534"}}>Confirm delivered</button>
          <button onClick={()=>review(r.id,"approved")} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(47,111,237,.09)",color:ACCENT}}>Reopen for delivery</button>
        </div>}
        {canDispute(r)&&<button onClick={()=>setDisputeTarget(r)} className="rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{background:"rgba(181,67,58,.08)",color:"#B5433A"}}>Dispute this</button>}
      </div>)}
    </div>
    {disputeTarget&&<div className="fixed inset-0 z-50 grid place-items-center p-4" style={{background:"rgba(16,24,40,.45)"}}>
      <div className="w-full max-w-sm rounded-3xl p-5" style={{background:"#fff",boxShadow:"0 24px 60px rgba(16,24,40,.22)"}}>
        <h2 className="font-bold mb-1">Dispute "{disputeTarget.reward_name}"</h2>
        <p className="text-xs opacity-55 mb-3">Say what's wrong — a reward steward will review it.</p>
        <textarea value={disputeReason} onChange={e=>setDisputeReason(e.target.value)} placeholder="e.g. This hasn't actually been delivered yet" className="w-full rounded-xl border px-3 py-2 text-sm" rows={3}/>
        <div className="flex gap-2 mt-4">
          <button onClick={()=>{setDisputeTarget(null);setDisputeReason("");}} className="flex-1 rounded-full py-2.5 text-xs font-semibold" style={{background:"rgba(16,24,40,.06)"}}>Cancel</button>
          <button disabled={!disputeReason.trim()} onClick={submitDispute} className="flex-1 rounded-full py-2.5 text-xs font-semibold text-white disabled:opacity-50" style={{background:"#B5433A"}}>Raise dispute</button>
        </div>
      </div>
    </div>}
  </div>;
}
