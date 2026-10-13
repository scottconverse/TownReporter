// Queue and Today, real routes and lifecycle writes on a disposable embedded database.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";

async function main() {
  assert.equal(process.env.DATABASE_URL || "", "", "browser fixtures must use disposable PGlite");
  const dataRoot=await mkdtemp(join(tmpdir(),"tr-release-h-"));
  process.env.TOWNREPORTER_DATA_ROOT=dataRoot;
  process.env.DATABASE_URL="";process.env.VERCEL="";process.env.VERCEL_ENV="";
  const PORT = 3502;
  process.env.PORT=String(PORT);process.env.NITRO_PORT=String(PORT);process.env.HOST="127.0.0.1";process.env.NITRO_HOST="127.0.0.1";
  const base=`http://127.0.0.1:${PORT}`;
  process.env.BETTER_AUTH_URL=base;
  await import(pathToFileURL(join(process.cwd(),".output/server/index.mjs")).href);
  const {s:getSql}=await import(pathToFileURL(join(process.cwd(),".output/server/_chunks/db.mjs")).href);
  const sql=await getSql();
  for(let i=0;i<100;i++){try{if((await fetch(base+"/login")).ok)break;}catch{/* Waiting for this fixture server to listen. */}await new Promise(r=>setTimeout(r,100));}
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1920,height:1080}});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  await page.emulateMedia({reducedMotion:"reduce"});
  const errors=[];page.on("pageerror",e=>{errors.push(e.message);console.error("PAGE ERROR",e.message);});
  page.on("console",m=>{if(m.type()==="error")console.error("CONSOLE",m.text());});
  await page.goto(base+"/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Name",{exact:true}).fill("Release H Editor");
  await page.getByLabel("Email",{exact:true}).fill(`release-h-${Date.now()}@townreporter.test`);
  await page.getByLabel("Password",{exact:true}).fill("release-h-fixture-password");
  await page.getByLabel("Confirm password",{exact:true}).fill("release-h-fixture-password");
  await fillPendingSetupCodeIfPresent(page,{dataRoot});
  await page.getByRole("button",{name:"Create editor account",exact:true}).click();
  await page.getByRole("link",{name:/^Queue/}).waitFor();
  await completeFirstRunSetup(page,base);
  const [owner]=await sql.query('select user_id, newsroom_id from newsroom_members limit 1');
  assert.ok(owner,"same disposable database serves the browser");
  const sentence="This lead has a written draft. Changing its status will keep the saved draft.";
  for(const route of ["/desk/queue","/desk"]){
    const headline=`Release H ${route} written draft`;
    const [lead]=await sql.query("insert into leads (user_id,newsroom_id,headline,why,topic,status,newsworthiness) values ($1,$2,$3,'Fixture','council','drafted',90) returning id",[owner.user_id,owner.newsroom_id,headline]);
    const body="The council discussed a neighborhood proposal. This saved fixture must survive the kill and its Undo.";
    const [draft]=await sql.query("insert into drafts (user_id,newsroom_id,lead_id,headline,dek,body,topic) values ($1,$2,$3,$4,'Fixture summary',$5,'council') returning id",[owner.user_id,owner.newsroom_id,lead.id,headline,body]);
    await page.goto(base+route,{waitUntil:"networkidle"});
    const row=route==="/desk/queue"? page.locator(".lead-row",{hasText:headline}) : page.locator(".today-lead",{hasText:headline});
    await row.getByRole("button",{name:/^Kill/}).first().click({timeout:10000});
    await page.getByText(sentence,{exact:true}).waitFor({timeout:10000}).catch(async error=>{console.error("AFTER KILL",(await page.locator("body").innerText()).slice(-4000));throw error;});
    assert.equal((await sql.query("select status from leads where id=$1",[lead.id]))[0].status,"drafted");
    await page.getByRole("button",{name:"Kill anyway",exact:true}).click({timeout:10000});
    await page.getByRole("button",{name:"Undo",exact:true}).waitFor();
    assert.equal((await sql.query("select status from leads where id=$1",[lead.id]))[0].status,"killed");
    assert.equal((await sql.query("select body from drafts where id=$1",[draft.id]))[0].body,body);
    assert.equal((await sql.query("select count(*) as n from audit_events where user_id=$1 and action='override' and subject_id=$2 and detail::jsonb->>'key'='lead-status-drafted'",[owner.user_id,lead.id]))[0].n,1);
    const killedPage = await page.context().newPage();
    try {
      await killedPage.goto(base+"/desk/queue", {waitUntil:"networkidle"});
      await killedPage.getByRole("button",{name:/^Killed/}).click();
      await killedPage.locator(".lead-row",{hasText:headline}).waitFor();
    } finally { await killedPage.close(); }
    await page.getByRole("button",{name:"Undo",exact:true}).click({force:true});
    await page.getByText("Undone: the lead is back on the Queue.",{exact:true}).waitFor();
    await page.goto(base+"/desk/queue",{waitUntil:"domcontentloaded"});
    await page.locator(".lead-row",{hasText:headline}).waitFor();
    assert.equal((await sql.query("select status from leads where id=$1",[lead.id]))[0].status,"drafted");
    assert.deepEqual(await sql.query("select id,body from drafts where lead_id=$1",[lead.id]),[{id:draft.id,body}]);
    await sql.query("update leads set status='killed' where id=$1",[lead.id]);
    console.log(`PASS ${route}: warning, Kill anyway, Killed, saved draft, audited override, Undo to drafted/Open`);
  }
  assert.deepEqual(errors,[]);
  await browser.close();
  await rm(dataRoot,{recursive:true,force:true});
  console.log("PASS Queue and Today Kill anyway browser regression");
}
main().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
