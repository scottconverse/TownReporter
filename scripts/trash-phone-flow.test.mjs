// guards: cramped deleted-story titles can make the editor restore or permanently delete the wrong story.
import assert from 'node:assert/strict';import {test} from 'node:test';import {act,createElement as h} from 'react';
import {installDom} from './dom-harness.mjs';import {screenModule} from './screen-render-harness.mjs';import {browserScreen} from './bug-sweep-browser.harness.mjs';
const screen=await screenModule('src/components/ops-panels.tsx',{InkButton:`({children,onClick})=>h('button',{onClick},children)`,TRASH_DAYS:'30'});
test('deleted-story actions sit below the full title on a phone before and after confirmation',async()=>{
 globalThis.screenData={trash:[{id:1,kind:'article',label:'Council approves budget and public safety staffing for next year',deleted_at:'2026-10-08'}]};
 const {document,Event}=installDom();const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root'));
 try{await act(async()=>root.render(h(screen.RecentlyDeletedPanel)));
  for(const confirm of [false,true]){
   if(confirm)await act(async()=>[...document.querySelectorAll('button')].find(b=>/Delete for good/.test(b.textContent)).dispatchEvent(new Event('click',{bubbles:true})));
   const markup=document.getElementById('root').innerHTML;
   const {page,close}=await browserScreen(()=>h('div',{dangerouslySetInnerHTML:{__html:markup}}));try{
    const geometry=await page.locator('li > div').evaluate(n=>{const title=n.firstElementChild.getBoundingClientRect(),actions=n.lastElementChild.getBoundingClientRect();return {width:title.width,available:n.clientWidth,below:actions.top>=title.bottom};});
    assert.ok(geometry.width>=geometry.available-1&&geometry.below,JSON.stringify(geometry));
   }finally{await close();}
  }
 }finally{await act(async()=>root.unmount());}
});
