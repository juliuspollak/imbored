import { assertEquals,assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { MAX_APNS_PAYLOAD_BYTES,PROVIDER_TOKEN_REFRESH_MS,buildApnsPayload,classifyWorkerError,constantTimeEqual,createProviderTokenCache,validateRouteData } from "./workerCore.ts";

const playerId="123e4567-e89b-42d3-a456-426614174000";
Deno.test("worker secret comparison accepts only the complete secret",async()=>{ assertEquals(await constantTimeEqual("correct","correct"),true);assertEquals(await constantTimeEqual("correct","wrong"),false);assertEquals(await constantTimeEqual("correct","correct-extra"),false); });
Deno.test("route data accepts only allowlisted object shapes",()=>{
  assertEquals(validateRouteData("chat_message",{ route:"chat",playerId }),true);
  assertEquals(validateRouteData("chat_message",{ route:"admin",playerId }),false);
  assertEquals(validateRouteData("chat_message",["chat",playerId]),false);
  assertEquals(validateRouteData("chat_message","chat"),false);
  assertEquals(validateRouteData("chat_message",{ route:"chat",playerId,extra:"x".repeat(600) }),false);
});
Deno.test("final payload is conservatively bounded",()=>{
  const encoded=buildApnsPayload({ kind:"chat_message",title:"New message",body:"A player sent you a message",route_data:{ route:"chat",playerId },event_id:1 });
  assertEquals(new TextEncoder().encode(encoded).length<MAX_APNS_PAYLOAD_BYTES,true);
  assertThrows(()=>buildApnsPayload({ kind:"chat_message",title:"x".repeat(4000),body:"body",route_data:{ route:"chat",playerId },event_id:1 }),Error,"PayloadTooLarge");
});
Deno.test("provider token cache reuses warm tokens and refreshes at fifty minutes",async()=>{
  let generations=0;
  const cache=createProviderTokenCache(async()=>`token-${++generations}`);
  const config={ keyId:"KEY",teamId:"TEAM",privateKey:"private" };
  assertEquals(await cache(config,0),"token-1");
  assertEquals(await cache(config,PROVIDER_TOKEN_REFRESH_MS-1),"token-1");
  assertEquals(await cache(config,PROVIDER_TOKEN_REFRESH_MS),"token-2");
  assertEquals(generations,2);
});
Deno.test("APNs timeouts remain retryable while invalid local payloads do not",()=>{
  assertEquals(classifyWorkerError(new DOMException("timed out","TimeoutError")),{ reason:"RequestTimeout",status:"retry" });
  assertEquals(classifyWorkerError(new Error("PayloadTooLarge")),{ reason:"PayloadTooLarge",status:"failed" });
});
