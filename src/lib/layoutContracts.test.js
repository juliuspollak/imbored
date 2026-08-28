import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app=readFileSync(new URL("../App.jsx",import.meta.url),"utf8");
test("profile and online bubbles share one safe-area dock centre line",()=>{ assert.match(app,/className="account-menu-dock"[\s\S]*right:"max\(var\(--global-player-bubble-offset\), env\(safe-area-inset-right\)\)"/);assert.match(app,/width:"var\(--global-player-bubble-size\)"[\s\S]*alignItems:"center"/);assert.match(app,/className="account-online-bubble"[\s\S]*left:"50%"[\s\S]*translateX\(-50%\)/); });
