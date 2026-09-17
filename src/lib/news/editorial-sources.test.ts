import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editorialSourcesError, buildWritingPack} from './editorial.ts';
test('the observed omitted-appendix delivery is incomplete even with a heading',()=>{
  assert.match(editorialSourcesError('[ Claims appendix omitted, no web verification available this session. ]')!,/incomplete/);
  assert.match(editorialSourcesError('Verify this later.')!,/supporting links/);
  assert.equal(editorialSourcesError('The city lists the former mayor. https://longmontcolorado.gov/government/mayors-of-longmont'),null);
  assert.equal(editorialSourcesError('The vote was unanimous. minutes.pdf, page 3.'),null);
});
test('all writing packs require claims and sources and actual verification',()=>{
  const pack=buildWritingPack({subject:'Document preservation',research:'Archive lead'});
  assert.match(pack,/EVERY op-ed/); assert.match(pack,/Open and verify the sources yourself/);
  assert.match(pack,/Do not invent citations/);
});
