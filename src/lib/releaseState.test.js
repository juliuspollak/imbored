import test from "node:test";
import assert from "node:assert/strict";
import { currentReleaseIdentity, hasUnseenRelease, markReleaseSeen } from "./releaseState.js";

function memoryStorage() { const values=new Map(); return { getItem:(key)=>values.get(key) ?? null, setItem:(key,value)=>values.set(key,value) }; }

test("first install is unseen and dismissal persists for the same web release", async () => {
  const storage=memoryStorage();
  const identity=await currentReleaseIdentity({ native:false });
  assert.equal(hasUnseenRelease(identity,storage),true);
  markReleaseSeen(identity,storage);
  assert.equal(hasUnseenRelease(identity,storage),false);
});

test("native build numbers surface a new release even when marketing version is unchanged", async () => {
  const first=await currentReleaseIdentity({ native:true,getInfo:async()=>({ version:"1.0",build:"2" }) });
  const next=await currentReleaseIdentity({ native:true,getInfo:async()=>({ version:"1.0",build:"3" }) });
  assert.notEqual(first,next);
  const storage=memoryStorage(); markReleaseSeen(first,storage);
  assert.equal(hasUnseenRelease(next,storage),true);
});
