import assert from "node:assert/strict";
import { it } from "node:test";
import { paperSetupWarning } from "./paper-settings.ts";
import { getSql } from "../db.ts";
it("setup warns an invited editor, allows a named override and audits it; unreadable setup needs its own consent", async()=>{
 const context={userId:"setup-wiring-editor",newsroomId:1};
 const first=await paperSetupWarning(context,undefined,"start the scan",async()=>false);
 assert.equal(first?.warning.key,"paper-not-set-up");
 assert.match(first?.warning.sentence??"",/^This paper is not fully set up:/);
 assert.equal(await paperSetupWarning(context,["paper-not-set-up"],"start the scan",async()=>false),null);
 const broken=async()=>{throw new Error("unreadable");};
 assert.equal((await paperSetupWarning(context,["paper-not-set-up"],"start the scan",broken))?.warning.key,"paper-setup-uncheckable");
 assert.equal(await paperSetupWarning(context,["paper-setup-uncheckable"],"start the scan",broken),null);
 const rows=await (await getSql()).query<{detail:string;created_at:unknown}>("select detail,created_at from audit_events where user_id=$1 and action='override'",[context.userId]);
 for(const key of ["paper-not-set-up","paper-setup-uncheckable"]) assert.ok(rows.some(r=>JSON.parse(r.detail).key===key && JSON.parse(r.detail).target && r.created_at));
});
