// guards: answered meeting facts must not leave false Open rows for the editor to investigate again.
import assert from 'node:assert/strict';import {test} from 'node:test';import fixtures from './fixtures/answered-reporting-facts.json' with {type:'json'};
import {reviewOpenStoryClaims,bindClaimsToEvidence} from '../src/lib/news/civic-reporting-run.server.ts';import {record,story,openReporting} from './reporting-fix-browser.test-helper.mjs';
test('open airport, appropriation, appointment, minutes and parent-engagement facts get a final transcript recheck before filing',async t=>{
 const checked=[];
 // Each passage joins consecutive run-10 caption excerpts at its first retained time.
 const tape=record(fixtures.flatMap(f=>f.segments));
 tape.identity={videoId:'S1kSaew-UUY',videoUrl:'https://www.youtube.com/watch?v=S1kSaew-UUY'};
 for(const fixture of fixtures){let calls=0;const quote=fixture.quote;
  const result=await reviewOpenStoryClaims({story:story(fixture.claim.text,[fixture.claim]),record:tape,documents:[],method:{text:'Use supplied records only.'},chatOpts:{},throwIfCancelled:async()=>{},chat:async(_system,prompt)=>{calls++;if(calls===2)assert.ok(prompt.includes(quote),fixture.claim.id);return {ok:true,text:JSON.stringify(calls===1?{verdict:'OPEN',reason:fixture.claim.nextCheck}:{verdict:'VERIFIED',quote,sourceKind:'transcript',sourceUrl:tape.identity.videoUrl})};}});
  assert.equal(calls,2);assert.equal(result.claims[0].status,'VERIFIED',fixture.claim.id);assert.equal(result.claims[0].transcriptEvidence.quote,quote);assert.equal(result.claims[0].transcriptEvidence.startSeconds,fixture.segments[0].seconds);
  const filed=bindClaimsToEvidence(result,{actions:[]},tape,[]);assert.equal(filed[0].status,'VERIFIED',`${fixture.claim.id} at filing`);assert.equal(filed[0].transcriptEvidence.quote,quote);checked.push({...result,claims:filed});
 }
 const page=await openReporting(t,checked);assert.ok((await page.locator('.reporting-claims').first().innerText()).length>0);
});
