import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import Button from "./Button.jsx";
import StatusBanner from "./StatusBanner.jsx";

export default function SandboxPushTest(){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[choices,setChoices]=useState([]);
  async function send(registrationId){setBusy(true);setMessage("");try{const {data,error}=await supabase.functions.invoke("send-push-notifications",{body:{mode:"sandbox-self-test",...(registrationId?{registrationId}:{})}});if(error)throw error;if(data?.registrations){setChoices(data.registrations);setMessage("Choose exactly one sandbox installation.");}else{setChoices([]);setMessage(data?.sent?"Test push sent to this iPhone.":data?.reason||"Test push failed.");}}catch(error){setMessage(error.message||"Test push failed.");}finally{setBusy(false);}}
  return <div style={{padding:"var(--space-4)",borderTop:"1px solid var(--color-border)"}}><Button type="button" variant="secondary" fullWidth loading={busy} onClick={()=>send()}>Send sandbox test push</Button>{choices.map((item)=><Button key={item.id} type="button" variant="ghost" fullWidth disabled={busy} onClick={()=>send(item.id)} style={{marginTop:"var(--space-2)"}}>Installation {item.id} · {item.lastSeenAt?new Date(item.lastSeenAt).toLocaleString():"unknown"}</Button>)}{message&&<StatusBanner variant="warning">{message}</StatusBanner>}</div>;
}
