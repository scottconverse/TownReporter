// guards: a missing draft or unresolved legacy evidence must not falsely tell the editor a story is Ready.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {act,createElement as h} from 'react';
import {installDom} from './dom-harness.mjs';
import {screenModule} from './screen-render-harness.mjs';
const screen=await screenModule('src/routes/desk.story.$leadId.tsx', {
  showsPublishPrep: `()=>true`,
  stripReporterNotebook: `body=>body`,
  FindingEvidenceReviewPanel: `({list})=>{const {useEffect}=globalThis.readinessReact; useEffect(()=>list.onEvidenceState({ran:true,toReview:4,contradicted:0,evidenceToken:'review'}),[list.onEvidenceState]);return h('p',null,'Evidence review');}`,
  RedraftDialog: `({writerStatus})=>h('span',{'data-writer':true,title:writerStatus.reason},writerStatus.label)`,
}, ['@/lib/news/desk-drafts','@/lib/news/check-gates','@/lib/news/desk-copy','@/lib/news/story-readiness','@/components/story-readiness-chip','@/lib/news/writer-bar','@/lib/news/publish-blockers','@/components/publish-blockers']);
globalThis.readinessReact=await import('react');
test('Story Checks and Writer agree when a draft is absent or legacy claims need review',async()=>{
  const {document,Event}=installDom(); const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root'));
  try {for(const status of ['new','drafted','published']) {
    globalThis.screenData={lead:{lead:{id:22,headline:'Council votes',topic:'government',status,source_urls:'[]'},draft:status==='new'?null:{id:8,headline:'Council votes',dek:'A plan',body:'Council approved the plan.',topic:'government',research_json:null},namedOutlets:[],outletOverrides:[]},sources:[],memory:[]};
    await act(async()=>root.render(h(screen.Route.component,{key:status})));
    const checks=[...document.querySelectorAll('button')].find(b=>/^Checks/.test(b.textContent));assert.ok(checks);
    await act(async()=>checks.dispatchEvent(new Event('click',{bubbles:true})));
    const chip=document.querySelector('[data-story-readiness]');assert.equal(chip.dataset.storyReadiness,'not-ready');
    const reason=chip.title;assert.ok(reason);assert.equal(document.querySelector('[data-writer]').title,reason);
    if(status!=='new') assert.ok(document.body.textContent.includes(reason));
  }}finally{await act(async()=>root.unmount());}
});
