// guards: glued sentences and one dense draft paragraph make the editor repair copy before it can print.
import assert from 'node:assert/strict';import {test} from 'node:test';import {createElement as h} from 'react';
import {writingPass} from '../src/lib/news/civic-reporting-run.server.ts';import {record,story,write} from './reporting-fix-browser.test-helper.mjs';import {moduleUrl} from './dom-harness.mjs';import {browserScreen} from './bug-sweep-browser.harness.mjs';
const {StoryBody}=await import(await moduleUrl('src/components/story-body.tsx'));
test('filed reporting copy separates repaired sentence joins into short paragraphs',async()=>{
 const draft='The council discussed requirements.The mayor gave the floor to the chair.The meeting used a retained transcription.The council reviewed how the changes would affect residents who travel across the city every day. Staff described the next steps and explained that detailed planning would continue after the meeting. Council members asked about the timeline and the work needed to make the plan available for public review. The proposal will return for further discussion when the staff has prepared the details and answered the questions raised by residents. Residents can review the meeting record and follow the discussion as the council considers what should happen next.';
 const result=await write(writingPass,record([]),{stories:[story(draft)],held:[]});const body=result.stories[0].draft;
 assert.doesNotMatch(body,/requirements\.The|chair\.The|transcription\.The/);assert.ok(body.split(/\n\n/).length>=3);
 const {page,close}=await browserScreen(()=>h(StoryBody,{body}));try{assert.ok(await page.locator('p').count()>=3);}finally{await close();}
});
