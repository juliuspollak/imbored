import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apnsHost, classifyApns, createProviderToken } from "./apns.ts";

Deno.serve(async (request) => {
  const expected=Deno.env.get("PUSH_WORKER_SECRET");
  if (!expected || request.headers.get("authorization")!==`Bearer ${expected}`) return new Response("Unauthorized",{ status:401 });
  const required=["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","APNS_KEY_ID","APNS_TEAM_ID","APNS_PRIVATE_KEY","APNS_BUNDLE_ID"];
  const missing=required.filter((key)=>!Deno.env.get(key));
  if (missing.length) return Response.json({ error:`Missing secrets: ${missing.join(", ")}` },{ status:500 });
  const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{ auth:{ persistSession:false } });
  const { data:deliveries,error }=await supabase.rpc("claim_push_deliveries",{ batch_size:100 });
  if (error) return Response.json({ error:error.message },{ status:500 });
  const token=await createProviderToken(Deno.env.get("APNS_KEY_ID")!,Deno.env.get("APNS_TEAM_ID")!,Deno.env.get("APNS_PRIVATE_KEY")!.replaceAll("\\n","\n"));
  const results=[];
  for (const delivery of deliveries || []) {
    let status="retry",httpStatus=0,reason="NetworkError",apnsId:string|null=null;
    try {
      const response=await fetch(`${apnsHost(delivery.apns_environment)}/3/device/${encodeURIComponent(delivery.device_token)}`,{
        method:"POST",headers:{ authorization:`bearer ${token}`,"apns-topic":Deno.env.get("APNS_BUNDLE_ID")!,"apns-push-type":"alert","apns-priority":"10" },
        body:JSON.stringify({ aps:{ alert:{ title:delivery.title,body:delivery.body },sound:"default" },...delivery.route_data,eventId:String(delivery.event_id) }),
      });
      httpStatus=response.status; apnsId=response.headers.get("apns-id");
      const payload=await response.json().catch(()=>({})); reason=payload.reason || (response.ok ? "Success" : "Unknown");
      status=classifyApns(response.status,reason);
    } catch (caught) { reason=caught instanceof Error ? caught.name : "NetworkError"; }
    await supabase.rpc("finish_push_delivery",{ delivery_id_in:delivery.delivery_id,status_in:status,http_status_in:httpStatus,reason_in:reason,apns_id_in:apnsId });
    results.push({ deliveryId:delivery.delivery_id,status,httpStatus,reason });
  }
  console.log(JSON.stringify({ event:"push_batch_complete",count:results.length,statuses:results.reduce((out,item)=>(out[item.status]=(out[item.status]||0)+1,out),{}) }));
  return Response.json({ processed:results.length,results });
});
