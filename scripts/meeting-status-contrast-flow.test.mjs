// guards: unreadable capture warnings and remove icons can hide failed meetings or cause a mistaken channel removal.
import assert from 'node:assert/strict';import {test} from 'node:test';import {createElement as h} from 'react';
import {screenModule} from './screen-render-harness.mjs';import {browserScreen,contrast} from './bug-sweep-browser.harness.mjs';
const meetings=await screenModule('src/components/meetings-activity.tsx',{},['@/lib/news/meeting-activity-label','@/lib/paper','@/lib/news/desk-copy']);
const settings=await screenModule('src/components/meeting-capture-settings.tsx',{Field:`({children})=>children`});
test('capture warning text and channel remove icons remain readable in both themes',async()=>{
 globalThis.screenData={'meeting-activity':['failed','captured'].map((status,i)=>({status,videoId:String(i),title:'Council meeting',published:'2026-10-08',captureDisposition:'provisional',aligned:false,chunks:[],votes:[],revisionCount:0})),'meeting-settings':{channels:['https://youtube.com/@city'],retentionMode:'transcript-only',durationCapSeconds:3600,sizeCapBytes:100000,speechToText:{line:'Available'}}};
 const Screen=()=>h('div',null,h(meetings.MeetingsActivity),h(settings.MeetingCaptureSettings));
 for(const dark of [false,true]){const {page,close}=await browserScreen(Screen,{dark});try{
  await page.locator('summary').first().click();
  const text=await contrast(page,'article > div > span, article p span, article > p.text-amber-800, article > p.meeting-warn');assert.ok(text.length>=3);assert.ok(text.every(r=>r>=4.5),JSON.stringify({dark,text}));
  const icons=await contrast(page,'button[aria-label="Remove"]');assert.equal(icons.length,1);assert.ok(icons[0]>=3,`${dark}: ${icons[0]}`);
 }finally{await close();}}
});
