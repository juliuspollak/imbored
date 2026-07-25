import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";
import { attachRealtimeRefresh } from "./realtimeRefresh.js";

export function useNewTransfersCount(userId) {
  const [count,setCount]=useState(0);
  useEffect(()=>{
    if(!supabaseReady||!userId){setCount(0);return;} let cancelled=false;
    async function refresh(){
      const {count:c,error}=await supabase.from("points_transactions").select("id",{count:"exact",head:true})
        .eq("player_id",userId).eq("reason_code","TRANSFER_RECEIVED").is("seen_at",null);
      if(cancelled)return; if(error){console.error("Unable to load new point transfers:",error.message);return;} setCount(c||0);
    }
    refresh();
    const detach=attachRealtimeRefresh({channelName:`point-transfers-${userId}`,tables:[{name:"points_transactions",filter:`player_id=eq.${userId}`}],refresh});
    window.addEventListener("points-transfers-seen",refresh);
    return()=>{cancelled=true;detach();window.removeEventListener("points-transfers-seen",refresh)};
  },[userId]); return count;
}
export async function markTransfersSeen(){
  const result=await supabase.rpc("mark_my_transfers_seen");
  window.dispatchEvent(new CustomEvent("points-transfers-seen")); return result;
}
