import assert from "node:assert/strict";
import { it } from "node:test";
import { reportAndDraft } from "./report.ts";

it("drafts from the filed watch capture without refetching or replacing its provenance", async () => {
  const url = "https://council.example/july-packet.pdf";
  const packets: string[] = [];
  let fetches = 0;
  const result = await reportAndDraft({
    userId: "retained-test", newsroomId: 1,
    lead: { id: 1, headline: "July meeting agenda", why: "Historical brief", topic: "council", status: "new", source_urls: JSON.stringify([url]), evidence: "", newsworthiness: 1, created_at: "2024-07-11" },
    urls: [url], memory: [], researchScope: "supplied", modelChoice: "claude-frontier",
    retainedSources: [{ url, title: "July packet", text: "The July 17 meeting agenda lists library repairs.", extras: [], version_id: 1560, capture_event_id: 2423, captured_at: "2026-09-11T09:00:00Z", extraction_method: "ocr-pages-partial:Codex:12/44" }],
  }, {
    paper: async () => ({ name: "Test Paper", city: "Ramsey", state: "" }),
    ingest: async () => { fetches++; return { url, title: "Timeout", text: "timeout", extras: [] }; },
    capture: async () => ({ version_id: 1561, capture_event_id: 2424 }),
    hydrate: async () => [{ url, version_id: 1561, capture_event_id: 2424, captured_at: "2026-09-11T10:00:00Z" }],
    chat: async (system, user) => {
      packets.push(user);
      return { ok: true, text: JSON.stringify(system.includes('"fetch_urls"') ? { news: "Library repairs", form: "brief" } : { headline: "Library repairs on July agenda", dek: "A historical agenda item.", body: "The July 17 agenda lists library repairs.", topic: "council", source_urls: [url], integrity_notes: "", unanswered: [] }) };
    },
  });
  assert.equal(fetches, 0, "the editor-filed capture must not be replaced by another fetch");
  assert.ok(!("error" in result));
  assert.ok(packets.some(text => text.includes("library repairs")));
  assert.ok(packets.some(text => text.includes("12/44")), "reading limitations must reach the writer");
  const provenance = result.provenance.find(item => item.url === url);
  assert.equal(provenance?.version_id, 1560);
  assert.equal(provenance?.capture_event_id, 2423);
  assert.equal(provenance?.captured_at, "2026-09-11T09:00:00Z");
  assert.match(result.integrity_notes, /12\/44/, "partial reading must remain visible even if the writer omits it");
});
