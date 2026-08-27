import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { apnsHost,classifyApns } from "./apns.ts";
Deno.test("TestFlight uses production APNs and direct builds may use sandbox",()=>{ assertEquals(apnsHost("production"),"https://api.push.apple.com");assertEquals(apnsHost("sandbox"),"https://api.sandbox.push.apple.com"); });
Deno.test("invalid tokens are retired while transient APNs failures retry",()=>{ assertEquals(classifyApns(410,"Unregistered"),"invalid_token");assertEquals(classifyApns(400,"BadDeviceToken"),"invalid_token");assertEquals(classifyApns(503,"Shutdown"),"retry");assertEquals(classifyApns(403,"InvalidProviderToken"),"failed"); });
