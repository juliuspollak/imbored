import { apnsHost,classifyApns,diagnoseProviderConfiguration } from "./apns.ts";
import { APNS_TIMEOUT_MS,buildApnsPayload,classifyWorkerError,constantTimeEqual } from "./workerCore.ts";

type Dependencies={ env:(key:string)=>string|undefined;createClient:()=>any;createUserClient?:(authorization:string)=>any;providerToken:(config:{keyId:string;teamId:string;privateKey:string})=>Promise<string>;fetch:typeof fetch };
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
function safeQueueDiagnostic(query:string,error:unknown){
  const value=error&&typeof error==="object"?error as Record<string,unknown>:{};
  const rawCode=typeof value.code==="string"?value.code.trim():"";
  const code=rawCode||"FETCH_ERROR";
  const message=/^(42[0-9A-Z]{3}|PGRST[0-9A-Z]+)$/.test(code)
    ? "The live database schema or PostgREST query does not match the worker expectation."
    : "The database request failed before PostgREST returned a structured response.";
  return {query,code,message};
}
export function createPushHandler(deps:Dependencies) { return async(request:Request)=>{
  if(request.method==="OPTIONS")return new Response("ok",{headers:cors});
  const payload=await request.json().catch(()=>null) as {mode?:unknown;registrationId?:unknown}|null;
  if(payload?.mode==="sandbox-self-test"||payload?.mode==="apns-auth-check"){
    const authorization=request.headers.get("authorization")||"";
    if(!authorization.startsWith("Bearer ")||!deps.createUserClient)return json({ok:false,mode:"sandbox-self-test",reason:"Not authenticated"},401);
    const {data:identity,error:identityError}=await deps.createUserClient(authorization).auth.getUser();
    if(identityError||!identity?.user)return json({ok:false,mode:"sandbox-self-test",reason:"Not authenticated"},401);
    if(payload.mode==="apns-auth-check"){
      const keyId=deps.env("APNS_KEY_ID")||"",teamId=deps.env("APNS_TEAM_ID")||"",privateKey=(deps.env("APNS_PRIVATE_KEY")||"").replaceAll("\\n","\n");
      return json({ok:true,mode:"apns-auth-check",diagnostic:await diagnoseProviderConfiguration(keyId,teamId,privateKey)});
    }
    const supabase=deps.createClient();
    let registrationsQuery=supabase.from("push_device_registrations").select("id,installation_id,last_seen_at,device_token,apns_environment").eq("user_id",identity.user.id).eq("platform","ios").eq("apns_environment","sandbox").eq("is_active",true).order("last_seen_at",{ascending:false});
    const {data:registrations,error:registrationError}=await registrationsQuery;
    if(registrationError)return json({ok:false,mode:"sandbox-self-test",reason:"Unable to inspect sandbox registrations"},500);
    if(!registrations?.length)return json({ok:false,mode:"sandbox-self-test",reason:"No active sandbox device is registered. Run the local development iOS app and allow notifications first."});
    const requested=Number(payload.registrationId),selected=Number.isSafeInteger(requested)?registrations.find((item:any)=>item.id===requested):registrations.length===1?registrations[0]:null;
    if(!selected)return json({ok:false,mode:"sandbox-self-test",reason:"Choose one sandbox registration",registrations:registrations.map((item:any)=>({id:item.id,lastSeenAt:item.last_seen_at}))});
    const required=["APNS_KEY_ID","APNS_TEAM_ID","APNS_PRIVATE_KEY"],missing=required.filter((key)=>!deps.env(key));if(missing.length)return json({ok:false,mode:"sandbox-self-test",reason:"APNs is not configured"},500);
    let token:string;try{token=await deps.providerToken({keyId:deps.env("APNS_KEY_ID")!,teamId:deps.env("APNS_TEAM_ID")!,privateKey:deps.env("APNS_PRIVATE_KEY")!.replaceAll("\\n","\n")});}catch{return json({ok:false,mode:"sandbox-self-test",reason:"Unable to initialise APNs authentication"},500);}
    let response:Response,reason="Unknown";try{response=await deps.fetch(`${apnsHost("sandbox")}/3/device/${encodeURIComponent(selected.device_token)}`,{method:"POST",signal:AbortSignal.timeout(APNS_TIMEOUT_MS),headers:{authorization:`bearer ${token}`,"apns-topic":"au.imbored.app","apns-push-type":"alert","apns-priority":"10","content-type":"application/json"},body:JSON.stringify({aps:{alert:{title:"imBored test",body:"Push notifications are working."},sound:"default"},kind:"sandbox_self_test"})});const result=await response.json().catch(()=>({}));reason=typeof result.reason==="string"?result.reason:(response.ok?"Success":"Unknown");}catch(caught){const classified=classifyWorkerError(caught);return json({ok:false,mode:"sandbox-self-test",reason:classified.reason});}
    const status=classifyApns(response.status,reason);if(status==="invalid_token")await supabase.from("push_device_registrations").update({is_active:false,invalidated_at:new Date().toISOString(),invalidation_reason:reason}).eq("id",selected.id).eq("user_id",identity.user.id);
    return json({ok:status==="sent",mode:"sandbox-self-test",sent:status==="sent",status:response.status,...(status==="sent"?{}:{reason})});
  }
  const expected=deps.env("PUSH_WORKER_SECRET"),supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";
  if(!expected||!supplied||!(await constantTimeEqual(supplied,expected))) return new Response("Unauthorized",{status:401});
  const required=["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","APNS_KEY_ID","APNS_TEAM_ID","APNS_PRIVATE_KEY","APNS_BUNDLE_ID"],missing=required.filter((key)=>!deps.env(key));
  if(missing.length) return Response.json({error:`Missing server configuration: ${missing.join(", ")}`},{status:500});
  const supabase=deps.createClient();
  if(payload?.mode==="empty-check"){
    const now=new Date().toISOString();
    const events=await supabase.from("notification_events").select("id",{count:"exact",head:true}).is("processed_at",null).lte("available_at",now);
    if(events.error){const diagnostic=safeQueueDiagnostic("notification_events",events.error);console.error(JSON.stringify({event:"push_empty_check_error",...diagnostic}));return Response.json({ok:false,mode:"empty-check",error:"Unable to inspect push queue",diagnostic},{status:500});}
    const deliveries=await supabase.from("notification_deliveries").select("id",{count:"exact",head:true}).lt("attempt_count",5).or(`and(status.in.(pending,retry),next_attempt_at.lte.${now}),and(status.eq.sending,lease_expires_at.lte.${now})`);
    if(deliveries.error){const diagnostic=safeQueueDiagnostic("notification_deliveries",deliveries.error);console.error(JSON.stringify({event:"push_empty_check_error",...diagnostic}));return Response.json({ok:false,mode:"empty-check",error:"Unable to inspect push queue",diagnostic},{status:500});}
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
