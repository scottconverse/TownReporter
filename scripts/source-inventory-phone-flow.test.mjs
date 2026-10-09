// guards: source inventory columns must not require horizontal panning on a phone.
import assert from 'node:assert/strict';import {test} from 'node:test';
import {screenModule} from './screen-render-harness.mjs';import {browserScreen} from './bug-sweep-browser.harness.mjs';
const screen=await screenModule('src/routes/desk.inventory.tsx');
test('source inventory rows fit a phone while keeping every source detail readable',async()=>{
 globalThis.screenData={'source-inventory':{rows:[{id:1,url:'https://longmontcolorado.gov/very/long/source/address/for/the/council/record',title:'Longmont City Council agenda and minutes',purpose:'Official meeting records',observation:'New records since last checked',reviewStatus:'Accepted',lastReadAt:'2026-10-08',unverified:'Publication date still unknown'}],total:1}};
 for(const dark of [false,true]){const {page,close}=await browserScreen(screen.Route.component,{dark});try{
  await page.locator('tbody a').click();
  const box=await page.locator('table').evaluate(n=>({width:n.getBoundingClientRect().width,container:n.parentElement.clientWidth,pan:n.parentElement.scrollWidth>n.parentElement.clientWidth+1}));assert.equal(box.pan,false,JSON.stringify(box));
  for(const cell of await page.locator('tbody td').all())assert.ok(await cell.evaluate(n=>n.scrollWidth<=n.clientWidth+1));
 }finally{await close();}}
});
