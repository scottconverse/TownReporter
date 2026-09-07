import { it } from "node:test";
import assert from "node:assert/strict";
import { parseNotes } from "./notes.ts";
import { draftSourceInputs } from "./draft-input.ts";
const supplied="https://library.example/hours";
const discovered="https://vendor.example/press-release";
it("a public-to-supplied redraft excludes prior discovered history and scanned lead sources", () => {
  const notes=parseNotes(JSON.stringify({scratch:`Supplied notice ${supplied}`,suppliedUrls:[supplied],opened:[{url:discovered,title:"Prior discovery"}]}));
  assert.deepEqual(draftSourceInputs([discovered],notes,"supplied"),{urls:[supplied],extraUrls:[]});
});
it("an old scanned lead has no implicitly supplied URLs", () => {
  assert.deepEqual(draftSourceInputs([discovered],parseNotes('{}'),"supplied"),{urls:[],extraUrls:[]});
});
