// guards: the ranked source table's columns must not require horizontal panning on a phone.
//
// Dynamic sources unit 8 (spec 6a/6b): the inventory page's table is now the
// scored source table from `source-moves.tsx` (the old read-only table was
// folded into it). The rule this file guards did not change -- ten columns on
// a 390px screen stack as labelled cards rather than sliding sideways -- so it
// reads the new table, which is the one the page draws.
import assert from 'node:assert/strict';import {test} from 'node:test';
import {screenModule} from './screen-render-harness.mjs';import {browserScreen} from './bug-sweep-browser.harness.mjs';
const screen=await screenModule('src/components/source-moves.tsx',{
  // The row's source name is a link to the Sources screen; react-router is not
  // part of this render, so draw a plain anchor with the same children.
  Link:'({children}) => h("a",{href:"#"},children)',
},['@/lib/news/source-table']);
globalThis.screenData={
 'source-scores':{
  counts:{accepted:1,trial:1,dormant:0,suggestedSites:3},
  moves:[],
  rows:[
   {id:1,title:'Longmont City Council agenda and minutes',url:'https://longmontcolorado.gov/very/long/source/address/for/the/council/record',status:'trial',kind:'record',tier:'A',reads90:4,leads90:2,published90:1,score:0.25,lastLeadAt:'2026-10-08T12:00:00.000Z',nextDueAt:null,rhythm:null,intervalMinutes:1440,trialReads:4,dormantReason:null,lastObservationKind:'changed',lastObservationAt:'2026-10-08T12:00:00.000Z'},
  ],
 },
};
test('source inventory rows fit a phone while keeping every source detail readable',async()=>{
 for(const dark of [false,true]){const {page,close}=await browserScreen(screen.SourceMovesPanel,{dark});try{
  await page.locator('tbody a').first().click();
  const box=await page.locator('table').evaluate(n=>({width:n.getBoundingClientRect().width,container:n.parentElement.clientWidth,pan:n.parentElement.scrollWidth>n.parentElement.clientWidth+1}));assert.equal(box.pan,false,JSON.stringify(box));
  for(const cell of await page.locator('tbody td').all())assert.ok(await cell.evaluate(n=>n.scrollWidth<=n.clientWidth+1));
 }finally{await close();}}
});
