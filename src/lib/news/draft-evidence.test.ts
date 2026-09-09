import { it } from "node:test";
import assert from "node:assert/strict";
import { evidenceNeedsReview, reconcileDraftEvidence, mayInheritLeadSources } from "./draft-evidence.ts";
const original = { body: "Vendor announces testing software.", source_urls: '["https://vendor.example/release"]', provenance_json: '[{"url":"https://vendor.example/release"}]', found_note: 'Vendor raised money.', unanswered: '["Revenue?"]', research_json: '{"news":"Vendor funding"}' };
const replacement = "The library opens at noon Tuesday.";
it("explicit report citations stay authoritative through save while legacy manual drafts may inherit", () => {
  const explicit = { ...original, source_urls: "[]", research_json: '{"citationPolicy":"explicit"}' };
  assert.equal(mayInheritLeadSources(explicit), false);
  const saved = { ...explicit, ...reconcileDraftEvidence(explicit, explicit.body, "keep") };
  assert.equal(mayInheritLeadSources(saved), false);
  assert.equal(mayInheritLeadSources({ source_urls: "[]", research_json: "{}" }), true);
  assert.equal(mayInheritLeadSources({ source_urls: "[]", research_json: "" }), true);
});
it("body replacement invalidates previous evidence until reviewed, including after saving", () => {
  assert.equal(evidenceNeedsReview(original, replacement), true);
  const saved = { ...original, ...reconcileDraftEvidence(original, replacement), body: replacement };
  assert.equal(evidenceNeedsReview(saved, replacement), true);
  assert.equal(saved.source_urls, original.source_urls);
});
it("review keeps confirmed evidence and a subsequent content change invalidates it again", () => {
  const kept = { ...original, ...reconcileDraftEvidence(original, replacement, "keep"), body: replacement };
  assert.equal(evidenceNeedsReview(kept, replacement), false);
  assert.equal(evidenceNeedsReview(kept, `${replacement} It closes Friday.`), true);
});
it("removing stale public evidence preserves a private audit copy and prevents resurrection", () => {
  const removed = reconcileDraftEvidence(original, replacement, "remove");
  assert.equal(removed.source_urls, "[]");
  assert.equal(removed.provenance_json, "[]");
  assert.equal(removed.found_note, "");
  assert.equal(removed.unanswered, "[]");
  assert.match(removed.research_json, /vendor\.example/);
  assert.match(removed.research_json, /Vendor announces testing software/);
});
it("whitespace-only editing does not require a repeated evidence review", () => {
  assert.equal(evidenceNeedsReview(original, " Vendor announces   testing software. "), false);
});
