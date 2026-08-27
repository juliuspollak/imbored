import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createPushHandler } from "./handler.ts";
import { createProviderTokenCache } from "./workerCore.ts";

const providerToken=createProviderTokenCache();
Deno.serve(createPushHandler({
  env:(key)=>Deno.env.get(key),
  createClient:()=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}}),
  providerToken,
  fetch,
}));
