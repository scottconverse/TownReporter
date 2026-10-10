// guards: a missing draft or unresolved legacy evidence must not falsely tell the editor a story is Ready.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {act,createElement as h} from 'react';
import {installDom} from './dom-harness.mjs';
import {screenModule} from './screen-render-harness.mjs';
const screen=await screenModule('src/routes/desk.story.$leadId.tsx', {
  showsPublishPrep: `()=>true`,
  stripReporterNotebook: `body=>body`,
  ActionButton: `({children,disabled,onAct}) => h('button',{disabled: Boolean(disabled), 'data-action': true, onClick:()=>onAct&&onAct()}, children)`,
  FindingEvidenceReviewPanel: `({list})=>{const {useEffect}=globalThis.readinessReact; const toReview=(globalThis.screenData.lead&&globalThis.screenData.lead.uncheckedRecordedClaims)===0?0:4; useEffect(()=>list.onEvidenceState({ran:true,toReview,contradicted:0,evidenceToken:'review'}),[list.onEvidenceState,toReview]);return h('p',null,'Evidence review');}`,
  RedraftDialog: `({writerStatus})=>h('span',{'data-writer':true,title:writerStatus.reason},writerStatus.label)`,
}, ['@/lib/news/desk-drafts','@/lib/news/check-gates','@/lib/news/desk-copy','@/lib/news/story-readiness','@/components/story-readiness-chip','@/lib/news/writer-bar','@/lib/news/publish-blockers','@/components/publish-blockers','@/lib/news/unchecked-story-gate']);
globalThis.readinessReact=await import('react');
test('Story Checks and Writer agree when a draft is absent or legacy claims need review',async()=>{
  const {document,Event}=installDom(); const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root'));
  try {for(const status of ['new','drafted','published']) {
    globalThis.screenData={lead:{lead:{id:22,headline:'Council votes',topic:'government',status,source_urls:'[]'},draft:status==='new'?null:{id:8,headline:'Council votes',dek:'A plan',body:'Council approved the plan.',topic:'government',research_json:null},namedOutlets:[],outletOverrides:[],uncheckedRecordedClaims:4,uncheckedEvidenceChecked:false,uncheckedStoryAcknowledged:false,uncheckedExempt:false},sources:[],memory:[]};
    await act(async()=>root.render(h(screen.Route.component,{key:status})));
    const checks=[...document.querySelectorAll('button')].find(b=>/^Checks/.test(b.textContent));assert.ok(checks);
    await act(async()=>checks.dispatchEvent(new Event('click',{bubbles:true})));
    const chip=document.querySelector('[data-story-readiness]');assert.equal(chip.dataset.storyReadiness,'not-ready');
    const reason=chip.title;assert.ok(reason);assert.equal(document.querySelector('[data-writer]').title,reason);
    if(status!=='new') assert.ok(document.body.textContent.includes(reason));
  }}finally{await act(async()=>root.unmount());}
});
test('a zero-claim, unchecked, checkable story reads Not checked yet and blocks Publish; the acknowledgement clears it',async()=>{
  const {document,Event}=installDom(); const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root'));
  const draft={id:8,headline:'Council votes',dek:'A plan',body:'Council approved the $547.5 million budget.',topic:'government',research_json:null};
  const base={lead:{lead:{id:22,headline:'Council votes',topic:'government',status:'drafted',source_urls:'[]'},draft,namedOutlets:[],outletOverrides:[]},sources:[],memory:[]};
  const draw=async(facts)=>{globalThis.screenData={...base,lead:{...base.lead,...facts}};await act(async()=>root.render(h(screen.Route.component,{key:JSON.stringify(facts)})));};
  const publishButton=()=>[...document.querySelectorAll('button')].find(b=>/^Publish in /.test(b.textContent));
  try {
    await draw({uncheckedRecordedClaims:0,uncheckedEvidenceChecked:false,uncheckedStoryAcknowledged:false,uncheckedExempt:false});
    const checks=[...document.querySelectorAll('button')].find(b=>/^Checks/.test(b.textContent));
    await act(async()=>checks.dispatchEvent(new Event('click',{bubbles:true})));
    const chip=document.querySelector('[data-story-readiness]');
    assert.equal(chip.dataset.storyReadiness,'not-checked');
    assert.ok(chip.textContent.includes('Not checked yet'));
    assert.ok(document.body.textContent.includes('No claims were recorded for this story'));
    assert.ok(document.body.textContent.includes('I checked this story myself'));
    assert.equal(publishButton().hasAttribute('disabled'),true,'an unchecked story cannot print');

    /* The editor pressed "I checked this story myself": the loader reports the
       acknowledgement for this version, and the gate clears. */
    await draw({uncheckedRecordedClaims:0,uncheckedEvidenceChecked:false,uncheckedStoryAcknowledged:true,uncheckedExempt:false});
    assert.notEqual(document.querySelector('[data-story-readiness]').dataset.storyReadiness,'not-checked');
    assert.equal(publishButton().hasAttribute('disabled'),false,'the acknowledgement lets it print');

    /* A story with zero claims but nothing checkable in it is never gated. */
    draft.body='The council met and talked for a while.';
    await draw({uncheckedRecordedClaims:0,uncheckedEvidenceChecked:false,uncheckedStoryAcknowledged:false,uncheckedExempt:false});
    assert.notEqual(document.querySelector('[data-story-readiness]').dataset.storyReadiness,'not-checked');
  } finally { await act(async()=>root.unmount()); }
});
