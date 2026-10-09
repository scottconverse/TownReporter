// guards: eleven held reasons must not bury Publish guidance, and the full list must remain one press away.
import assert from 'node:assert/strict';import {test} from 'node:test';import {act,createElement as h} from 'react';
import {installDom} from './dom-harness.mjs';import {screenModule} from './screen-render-harness.mjs';import {story,openReporting} from './reporting-fix-browser.test-helper.mjs';
const screen=await screenModule('src/routes/desk.story.$leadId.tsx',{stripReporterNotebook:`body=>body`,showsPublishPrep:`()=>true`},['@/lib/news/desk-drafts','@/lib/news/check-gates','@/lib/news/desk-copy','@/lib/news/story-readiness','@/components/story-readiness-chip','@/lib/news/publish-blockers']);
test('Publish summarizes held items and Review opens Reporting with the complete list',async t=>{
 const held=Array.from({length:11},(_,i)=>({storyId:'story',headline:i===0?'Final budget enactment':`Remaining issue ${i}`,reason:'A retained legal detail requires further checking.',nextCheck:'Check the record.',unverified:true}));
 const reason=held.map(x=>`${x.headline}: ${x.reason}`).join(' ');
 globalThis.screenData={lead:{lead:{id:22,headline:'Council votes',topic:'government',status:'drafted',source_urls:'[]'},draft:{id:8,headline:'Council votes',dek:'A plan',body:'Council approved the plan.',topic:'government',research_json:JSON.stringify({storyReadiness:{version:1,state:'not-ready',openCount:5,totalCount:41,reason}})},namedOutlets:[],outletOverrides:[]},sources:[],memory:[],'reporting-package':{draftId:8,pkg:{held},storyLeads:[{leadId:22,storyId:'story',draftId:8}]}};
 const {document,Event}=installDom();const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root'));
 try{await act(async()=>root.render(h(screen.Route.component)));const bar=document.querySelector('.publish-blocked');assert.ok(bar);assert.ok(bar.textContent.includes('Final budget enactment'));assert.ok(bar.textContent.includes('and 10 more'));assert.ok(bar.textContent.length<110);
  document.getElementById('inspector-reporting').scrollIntoView=()=>{};
  await act(async()=>bar.querySelector('button').dispatchEvent(new Event('click',{bubbles:true})));assert.equal(document.getElementById('inspector-reporting').hidden,false);
 }finally{await act(async()=>root.unmount());}
 const page=await openReporting(t,[story('Council approved the plan.',[{id:'fact',text:'A claim',status:'UNVERIFIED',sourceIds:[],nextCheck:''}])],held);assert.equal(await page.locator('.reporting-held li').count(),11);
});
