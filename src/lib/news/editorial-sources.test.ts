import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editorialSourcesError, buildWritingPack} from './editorial.ts';
test('the observed omitted-appendix delivery is incomplete even with a heading',()=>{
  assert.match(editorialSourcesError('[ Claims appendix omitted, no web verification available this session. ]')!,/incomplete/);
  assert.match(editorialSourcesError('Verify this later.')!,/supporting links/);
  assert.equal(editorialSourcesError('The city lists the former mayor. https://longmontcolorado.gov/government/mayors-of-longmont'),null);
  assert.equal(editorialSourcesError('The vote was unanimous. minutes.pdf, page 3.'),null);
});
// Sources are supplied in the pack; the writer must not invent verification.
test('all writing packs require claims and sources',()=>{
  const pack=buildWritingPack({subject:'Document preservation',research:'Archive lead'});
  assert.match(pack,/EVERY op-ed/); assert.match(pack,/Do not invent citations/);
  assert.match(pack,/The sources are provided in this pack/);
});

test('a pack for a writer with no web tools never asks it to open a page',()=>{
  const pack=buildWritingPack({
    subject:'Document preservation',
    research:'Archive lead',
    deskResearch:{searches:1,pages:1,captures:[{url:'https://example.test/a',title:'A',captureEventId:3,versionId:4}]},
  });
  assert.match(pack,/the desk searched 1 time and read 1 page/);
  assert.match(pack,/Include each checkable factual claim/);
  assert.doesNotMatch(pack,/available web tools|native capabilities/i);
});
