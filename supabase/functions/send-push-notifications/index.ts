import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apnsHost,classifyApns } from "./apns.ts";
import { APNS_TIMEOUT_MS,buildApnsPayload,classifyWorkerError,constantTimeEqual,createProviderTokenCache } from "./workerCore.ts";

const providerToken=createProviderTokenCache();

Deno.serve(async (request) => {
  const expected=Deno.env.get("PUSH_WORKER_SECRET");
  const supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"") || "";
  if (!expected || !supplied || !(await constantTimeEqual(supplied,expected))) return new Response("Unauthorized",{ status:401 });
  const required=["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","APNS_KEY_ID","APNS_TEAM_ID","APNS_PRIVATE_KEY","APNS_BUNDLE_ID"];
  const missing=required.filter((key)=>!Deno.env.get(key));
  if (missing.length) return Response.json({ error:`Missing server configuration: ${missing.join(", ")}` },{ status:500 });
  const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{ auth:{ persistSession:false } });
  const { data:deliveries,error }=await supabase.rpc("claim_push_deliveries",{ batch_size:10 });
  if (error) return Response.json({ error:"Unable to claim push deliveries" },{ status:500 });
  const summary={ claimed:deliveries?.length || 0,sent:0,retry:0,failed:0,invalidated:0,completion_errors:0 };
  if (!deliveries?.length) return Response.json(summary);
  let token:string;
  try {
    token=await providerToken({ keyId:Deno.env.get("APNS_KEY_ID")!,teamId:Deno.env.get("APNS_TEAM_ID")!,privateKey:Deno.env.get("APNS_PRIVATE_KEY")!.replaceAll("\\n","\n") });
  } catch {
    console.error(JSON.stringify({ event:"apns_provider_token_error" }));
    return Response.json({ ...summary,error:"Unable to initialise APNs authentication" },{ status:500 });
  }
  for (const delivery of deliveries) {
    let status="retry",httpStatus=0,reason="NetworkError",apnsId:string|null=null;
    try {
      const body=buildApnsPayload(delivery);
      const response=await fetch(`${apnsHost(delivery.apns_environment)}/3/device/${encodeURIComponent(delivery.device_token)}`,{
        method:"POST",signal:AbortSignal.timeout(APNS_TIMEOUT_MS),headers:{ authorization:`bearer ${token}`,"apns-topic":Deno.env.get("APNS_BUNDLE_ID")!,"apns-push-type":"alert","apns-priority":"10","apns-collapse-id":String(delivery.event_id),"content-type":"application/json" },body,
      });
      httpStatus=response.status; apnsId=response.headers.get("apns-id");
      const payload=await response.json().catch(()=>({})); reason=typeof payload.reason==="string" ? payload.reason : (response.ok ? "Success" : "Unknown");
      status=classifyApns(response.status,reason);
    } catch (caught) {
      ({ reason,status }=classifyWorkerError(caught));
    }
    const { data:finalStatus,error:finishError }=await supabase.rpc("finish_push_delivery",{ delivery_id_in:delivery.delivery_id,claim_token_in:delivery.claim_token,status_in:status,http_status_in:httpStatus,reason_in:reason,apns_id_in:apnsId });
    if (finishError || !finalStatus) {
      summary.completion_errors+=1;
      console.error(JSON.stringify({ event:"push_completion_error",deliveryId:delivery.delivery_id,reason:finishError ? "rpc_error" : "stale_lease" }));
      continue;
    }
    if (finalStatus==="sent") summary.sent+=1;
    else if (finalStatus==="retry") summary.retry+=1;
    else if (finalStatus==="invalid_token") summary.invalidated+=1;
    else summary.failed+=1;
    console.log(JSON.stringify({ event:"apns_delivery_result",deliveryId:delivery.delivery_id,status:finalStatus,httpStatus,reason }));
  }
  console.log(JSON.stringify({ event:"push_batch_complete",...summary }));
  return Response.json(summary,{ status:summary.completion_errors ? 500 : 200 });
});
