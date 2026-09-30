import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editorialSourcesError, buildWritingPack} from './editorial.ts';
test('the observed omitted-appendix delivery is incomplete even with a heading',()=>{
  assert.match(editorialSourcesError('[ Claims appendix omitted, no web verification available this session. ]')!,/incomplete/);
  assert.match(editorialSourcesError('Verify this later.')!,/supporting links/);
  assert.equal(editorialSourcesError('The city lists the former mayor. https://longmontcolorado.gov/government/mayors-of-longmont'),null);
  assert.equal(editorialSourcesError('The vote was unanimous. minutes.pdf, page 3.'),null);
});
/*
  The writing pass has no web tools at all (SEC-3: the call holding the
  private voice must not hold an outbound fetch tool). The pack may therefore
  never ask it to open a source — it must send it to the research record and
  to the desk's own pointers, and require it to be plain about what the record
  could not confirm.
*/
test('all writing packs require claims and sources, cited from the research record',()=>{
  const pack=buildWritingPack({subject:'Document preservation',research:'Archive lead'});
  assert.match(pack,/EVERY op-ed/); assert.match(pack,/Include each checkable factual claim/);
  assert.match(pack,/Do not invent citations/);
  assert.match(pack,/no web access of your own in this pass/);
  assert.doesNotMatch(pack,/Open and verify the sources yourself|available web tools|native capabilities/i);
});
