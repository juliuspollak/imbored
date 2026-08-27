import { apnsHost,classifyApns } from "./apns.ts";
import { APNS_TIMEOUT_MS,buildApnsPayload,classifyWorkerError,constantTimeEqual } from "./workerCore.ts";

type Dependencies={ env:(key:string)=>string|undefined;createClient:()=>any;providerToken:(config:{keyId:string;teamId:string;privateKey:string})=>Promise<string>;fetch:typeof fetch };
export function createPushHandler(deps:Dependencies) { return async(request:Request)=>{
  const expected=deps.env("PUSH_WORKER_SECRET"),supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";
  if(!expected||!supplied||!(await constantTimeEqual(supplied,expected))) return new Response("Unauthorized",{status:401});
  const required=["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","APNS_KEY_ID","APNS_TEAM_ID","APNS_PRIVATE_KEY","APNS_BUNDLE_ID"],missing=required.filter((key)=>!deps.env(key));
  if(missing.length) return Response.json({error:`Missing server configuration: ${missing.join(", ")}`},{status:500});
  const payload=await request.json().catch(()=>null) as {mode?:unknown}|null,supabase=deps.createClient();
  if(payload?.mode==="empty-check"){
    const now=new Date().toISOString();
    const [events,deliveries]=await Promise.all([
      supabase.from("notification_events").select("id",{count:"exact",head:true}).is("processed_at",null).lte("available_at",now),
      supabase.from("notification_deliveries").select("id",{count:"exact",head:true}).lt("attempt_count",5).or(`and(status.in.(pending,retry),next_attempt_at.lte.${now}),and(status.eq.sending,lease_expires_at.lte.${now})`),
    ]);
    if(events.error||deliveries.error){
      const failed=events.error?"notification_events":"notification_deliveries",code=(events.error||deliveries.error)?.code||"unknown";
      console.error(JSON.stringify({event:"push_empty_check_error",query:failed,code}));
      return Response.json({ok:false,mode:"empty-check",error:"Unable to inspect push queue",diagnostic:{query:failed,code}},{status:500});
    }
    const eligible=(events.count??0)+(deliveries.count??0);
    return Response.json({ok:true,mode:"empty-check",eligible,safeToSmokeTest:eligible===0});
  }
  const {data:claimed,error}=await supabase.rpc("claim_push_deliveries",{batch_size:10});
  if(error) return Response.json({error:"Unable to claim push deliveries"},{status:500});
  const summary={claimed:claimed?.length||0,sent:0,retry:0,failed:0,invalidated:0,completion_errors:0};if(!claimed?.length)return Response.json(summary);
  let token:string;try{token=await deps.providerToken({keyId:deps.env("APNS_KEY_ID")!,teamId:deps.env("APNS_TEAM_ID")!,privateKey:deps.env("APNS_PRIVATE_KEY")!.replaceAll("\\n","\n")});}catch{console.error(JSON.stringify({event:"apns_provider_token_error"}));return Response.json({...summary,error:"Unable to initialise APNs authentication"},{status:500});}
  for(const delivery of claimed){let status="retry",httpStatus=0,reason="NetworkError",apnsId:string|null=null;try{const body=buildApnsPayload(delivery),response=await deps.fetch(`${apnsHost(delivery.apns_environment)}/3/device/${encodeURIComponent(delivery.device_token)}`,{method:"POST",signal:AbortSignal.timeout(APNS_TIMEOUT_MS),headers:{authorization:`bearer ${token}`,"apns-topic":deps.env("APNS_BUNDLE_ID")!,"apns-push-type":"alert","apns-priority":"10","apns-collapse-id":String(delivery.event_id),"content-type":"application/json"},body});httpStatus=response.status;apnsId=response.headers.get("apns-id");const result=await response.json().catch(()=>({}));reason=typeof result.reason==="string"?result.reason:(response.ok?"Success":"Unknown");status=classifyApns(response.status,reason);}catch(caught){({reason,status}=classifyWorkerError(caught));}
    const {data:finalStatus,error:finishError}=await supabase.rpc("finish_push_delivery",{delivery_id_in:delivery.delivery_id,claim_token_in:delivery.claim_token,status_in:status,http_status_in:httpStatus,reason_in:reason,apns_id_in:apnsId});if(finishError||!finalStatus){summary.completion_errors+=1;console.error(JSON.stringify({event:"push_completion_error",deliveryId:delivery.delivery_id,reason:finishError?"rpc_error":"stale_lease"}));continue;}if(finalStatus==="sent")summary.sent+=1;else if(finalStatus==="retry")summary.retry+=1;else if(finalStatus==="invalid_token")summary.invalidated+=1;else summary.failed+=1;console.log(JSON.stringify({event:"apns_delivery_result",deliveryId:delivery.delivery_id,status:finalStatus,httpStatus,reason}));}
  console.log(JSON.stringify({event:"push_batch_complete",...summary}));
  return Response.json(summary,{status:summary.completion_errors?500:200});
};}
