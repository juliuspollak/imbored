import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabase.js";

export function useNewTransfersCount(userId) {
  const [count,setCount]=useState(0);
  useEffect(()=>{
    if(!supabaseReady||!userId){setCount(0);return;} let cancelled=false;
    async function poll(){
      const {count:c,error}=await supabase.from("points_transactions").select("id",{count:"exact",head:true})
        .eq("player_id",userId).eq("reason_code","TRANSFER_RECEIVED").is("seen_at",null);
      if(cancelled)return; if(error){console.error("Unable to load new point transfers:",error.message);return;} setCount(c||0);
    }
    poll(); const i=setInterval(poll,15000); window.addEventListener("points-transfers-seen",poll);
    return()=>{cancelled=true;clearInterval(i);window.removeEventListener("points-transfers-seen",poll)};
  },[userId]); return count;
}
export async function markTransfersSeen(){
  const result=await supabase.rpc("mark_my_transfers_seen");
  window.dispatchEvent(new CustomEvent("points-transfers-seen")); return result;
}
