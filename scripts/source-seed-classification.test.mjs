// guards: first-run sources must not assign official evidence status to an unknown commercial host.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {moduleUrl} from './dom-harness.mjs';
const {SEED_SOURCES}=await import(await moduleUrl('src/lib/paper.ts'));
const {kindFromSourceUrl,tierFromKind}=await import(await moduleUrl('src/lib/news/desk-copy.ts'));
test('first-run commercial seeds use the same classification as sources added by URL',()=>{
  for(const source of SEED_SOURCES.filter(s=>new URL(s.url).hostname==='mynextlight.com')) {
    assert.equal(source.kind,kindFromSourceUrl(source.url));
    assert.equal(source.tier,tierFromKind(source.kind));
  }
});
