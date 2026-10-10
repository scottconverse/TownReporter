// guards: an editor could accept human exceptions accidentally or need a separate save for every AI-supported claim.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";
import { getSql } from "../src/lib/db.ts";
import { applyMigrationsToTestPglite } from "../src/lib/test-support/pglite-migrations.ts";
import { loadFindingEvidenceReview, persistAiEvidenceDecision } from "../src/lib/news/finding-evidence-review.ts";
import { sha256 } from "../src/lib/news/url-guard.ts";
const window = installDom();
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { EvidenceCheckList } = await import(await moduleUrl("src/components/evidence-check-list.tsx", {
  "../lib/news/evidence-check-list": stubUrl('export const evidenceDetailId = key => "detail-" + key;'),
}));
test("opens human exceptions and accepts the supported set in one press", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql(), room = 89914, lead = 89914;
  await sql.query('insert into "user"(id,name,email,"emailVerified","createdAt","updatedAt") values($1,$2,$3,false,now(),now()) on conflict(id) do nothing', ["evidence-editor", "Scott", "evidence-fixture@example.org"]);
  await sql.query("insert into leads(id,user_id,newsroom_id,headline,why,status) values($1,$2,$3,'Plan','fixture','drafted')", [lead, "evidence-editor", room]);
  const text = "The plan was submitted.";
  const [capture] = await sql.query("insert into artifact_versions(user_id,newsroom_id,url,title,full_text,content_hash) values($1,$2,$3,'Plan',$4,'fixture') returning id", ["evidence-editor", room, "https://example.org/plan", text]);
  const aiRows = ["Supported", "Needs a human"].map((verdict, index) => ({ text: index ? "The plan was approved." : text, urls: ["https://example.org/plan"], verdict,
    quote: text, sourceUrl: "https://example.org/plan", sourceHash: "", locator: "record", checkedAt: new Date().toISOString(), reason: "fixture" }));
  aiRows[0].sourceHash = await sha256(text);
  await sql.query("insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,found_note,research_json) values($1,$2,$3,'Plan','Plan',$4,'council',$5,$6)", ["evidence-editor", room, lead, text,
    JSON.stringify(aiRows.map(row => ({ text: row.text, source_urls: row.urls, artifact_version_ids: [capture.id] }))), JSON.stringify({ aiEvidenceReview: { checkedText: text, rows: aiRows } })]);
  const review = await loadFindingEvidenceReview(sql, room, lead);
  const root = createRoot(document.getElementById("root"));
  let accepted = 0, removed = "";
  const rows = [
    { key: "supported", tone: "ok", what: "The plan was submitted.", note: "The plan was submitted.", aiVerdict: "Supported" },
    { key: "human", tone: "warn", what: "The plan was approved.", note: "Approval is uncertain.", aiVerdict: "Needs a human" },
    { key: "unsupported", tone: "warn", what: "The mayor resigned.", note: "The mayor remains in office.", aiVerdict: "Not supported" },
  ].map(row => ({ ...row, chip: row.aiVerdict, action: null, ref: { kind: "claim", id: row.key } }));
  await React.act(async () => root.render(React.createElement(EvidenceCheckList, { rows, ranLine: "",
    compareLabel: "", onCompare() {}, onStylePress() {}, detail: () => "judgment",
    onAcceptSupported: async () => { accepted++; await persistAiEvidenceDecision({ newsroomId: room, userId: "evidence-editor" },
      { leadId: lead, draftId: review.draftId, evidenceToken: review.evidenceToken, action: "accept-supported" }); }, onRemoveSentence: row => removed = row.key })));
  const click = async pattern => {
    const button = [...document.querySelectorAll("button")].find(node => pattern.test(node.textContent));
    assert.ok(button, `missing ${pattern}`);
    await React.act(async () => button.dispatchEvent(new window.Event("click", { bubbles: true })));
  };
  await click(/Accept the AI/);
  assert.equal(accepted, 1);
  const [saved] = await sql.query("select research_json from drafts where id=$1", [review.draftId]);
  const judgments = JSON.parse(saved.research_json).findingEvidenceReview.judgments;
  assert.deepEqual(Object.keys(judgments), ["finding:0"]);
  assert.equal(judgments["finding:0"].acceptedBy, "Scott");
  assert.ok(judgments["finding:0"].acceptedAt);
  const first = document.querySelector("li");
  assert.ok(first.textContent.includes("approved"));
  assert.ok(first.querySelector("details").hasAttribute("open"));
  const supported = document.querySelector("details[data-ai-supported]");
  assert.ok(!supported.hasAttribute("open"));
  await click(/Spot-check/);
  assert.ok(supported.hasAttribute("open"));
  await click(/Remove this sentence/);
  assert.equal(removed, "unsupported");
  await React.act(async () => root.unmount());
});
