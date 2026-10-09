// guards: published stories must expose the model and effort controls used by their AI actions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement as h } from 'react';
import { installDom } from './dom-harness.mjs';
import { screenModule } from './screen-render-harness.mjs';
const screen = await screenModule('src/routes/desk.story.$leadId.tsx', {}, ['@/lib/news/desk-drafts','@/lib/news/check-gates','@/lib/news/desk-copy','@/lib/news/story-readiness','@/components/story-readiness-chip','@/lib/news/writer-bar']);
test('published story model and effort buttons open their settings panel', async () => {
  globalThis.screenData = {lead:{lead:{id:22,headline:'Council votes',topic:'government',status:'published',source_urls:'[]'},draft:{id:8,headline:'Council votes',dek:'A plan',body:'Council approved the plan.',topic:'government'},namedOutlets:[],outletOverrides:[]},sources:[],memory:[]};
  const {document, Event} = installDom();
  const {createRoot} = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async()=>root.render(h(screen.Route.component)));
    const click = async pattern => { const b=[...document.querySelectorAll('button')].find(b=>pattern.test(b.textContent)); assert.ok(b); await act(async()=>b.dispatchEvent(new Event('click',{bubbles:true}))); };
    await click(/Model & research/);
    assert.ok(document.getElementById('story-model-research'));
    await click(/^Close$/);
    assert.equal(document.getElementById('story-model-research'),null);
    await click(/^Thinking effort$/);
    assert.ok(document.getElementById('story-model-research'));
  } finally { await act(async()=>root.unmount()); }
});
