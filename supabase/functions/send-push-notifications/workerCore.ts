import { createProviderToken } from "./apns.ts";

export const MAX_ATTEMPTS=5;
export const APNS_TIMEOUT_MS=12_000;
export const PROVIDER_TOKEN_REFRESH_MS=50*60*1000;
export const MAX_APNS_PAYLOAD_BYTES=3_500;

export async function constantTimeEqual(left:string,right:string) {
  const [a,b]=await Promise.all([left,right].map((value)=>crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))));
  const aa=new Uint8Array(a),bb=new Uint8Array(b); let difference=0;
  for (let index=0;index<aa.length;index+=1) difference|=aa[index]^bb[index];
  return difference===0;
}

export function classifyWorkerError(caught:unknown) {
  const reason=caught instanceof DOMException && caught.name==="TimeoutError" ? "RequestTimeout"
    : caught instanceof Error && ["InvalidRouteData","PayloadTooLarge"].includes(caught.message) ? caught.message
    : caught instanceof Error ? caught.name : "NetworkError";
  return { reason,status:reason==="InvalidRouteData" || reason==="PayloadTooLarge" ? "failed" : "retry" };
}

export function validateRouteData(kind:string,data:unknown) {
  if (!data || typeof data!=="object" || Array.isArray(data)) return false;
  const route=data as Record<string,unknown>; const keys=Object.keys(route);
  if (new TextEncoder().encode(JSON.stringify(route)).length>512) return false;
  if (["chat_message","poke"].includes(kind)) return keys.every((key)=>["route","playerId"].includes(key)) && keys.length===2
    && route.route==="chat" && typeof route.playerId==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(route.playerId);
  if (["circle_challenge","competition_update"].includes(kind)) return keys.every((key)=>["route","circleId","challengeId"].includes(key))
    && route.route==="circle" && Number.isSafeInteger(Number(route.circleId)) && Number(route.circleId)>0
    && (route.challengeId===undefined || (Number.isSafeInteger(Number(route.challengeId)) && Number(route.challengeId)>0));
  return false;
}

export function buildApnsPayload(delivery:{ title:string;body:string;route_data:unknown;event_id:string|number;kind:string }) {
  if (!validateRouteData(delivery.kind,delivery.route_data)) throw new Error("InvalidRouteData");
  const payload={ aps:{ alert:{ title:delivery.title,body:delivery.body },sound:"default" },...(delivery.route_data as object),eventId:String(delivery.event_id) };
  const encoded=JSON.stringify(payload);
  if (new TextEncoder().encode(encoded).length>MAX_APNS_PAYLOAD_BYTES) throw new Error("PayloadTooLarge");
  return encoded;
}

export function createProviderTokenCache(factory=createProviderToken) {
  let cached:{ token:string;createdAt:number;fingerprint:string }|null=null;
  return async (config:{ keyId:string;teamId:string;privateKey:string },nowMs=Date.now()) => {
    const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`${config.keyId}:${config.teamId}:${config.privateKey}`)));
    const fingerprint=Array.from(digest,(byte)=>byte.toString(16).padStart(2,"0")).join("");
    if (cached && cached.fingerprint===fingerprint && nowMs-cached.createdAt<PROVIDER_TOKEN_REFRESH_MS) return cached.token;
    const token=await factory(config.keyId,config.teamId,config.privateKey,nowMs);
    cached={ token,createdAt:nowMs,fingerprint };
    return token;
  };
}
