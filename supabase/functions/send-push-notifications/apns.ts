export function apnsHost(environment:string) { return environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com"; }
export function classifyApns(status:number,reason:string) {
  if (status===200) return "sent";
  if ([400,404,410].includes(status) && ["BadDeviceToken","DeviceTokenNotForTopic","Unregistered"].includes(reason)) return "invalid_token";
  if (status===429 || status>=500) return "retry";
  return "failed";
}
function bytes(value:string) { return new TextEncoder().encode(value); }
function base64url(value:Uint8Array|string) {
  const input=typeof value==="string" ? bytes(value) : value;
  let binary=""; for (const byte of input) binary+=String.fromCharCode(byte);
  return btoa(binary).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"");
}
export async function createProviderToken(keyId:string,teamId:string,pem:string,nowMs=Date.now()) {
  const der=Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g,"")),(c)=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey("pkcs8",der,{ name:"ECDSA",namedCurve:"P-256" },false,["sign"]);
  const header=base64url(JSON.stringify({ alg:"ES256",kid:keyId }));
  const claims=base64url(JSON.stringify({ iss:teamId,iat:Math.floor(nowMs/1000) }));
  const signature=new Uint8Array(await crypto.subtle.sign({ name:"ECDSA",hash:"SHA-256" },key,bytes(`${header}.${claims}`)));
  return `${header}.${claims}.${base64url(signature)}`;
}
