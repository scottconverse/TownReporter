import assert from "node:assert/strict";
import { test } from "node:test";
import { coerceDraft } from "./coerce-draft.ts";
import { reportAndDraft, REPORT_EDIT_SYSTEM, reportWriteSystem } from "./report.ts";
import { NAME_INVENTORY_SYSTEM } from "./name-check-work.ts";
import type { LeadRow } from "./types.ts";

const fallback = { headline: "Council update", dek: "Water rates", topic: "council" };
// Valid wire JSON: JSON.parse decodes each doubled slash to a literal slash+n.
const raw = String.raw`{"headline":"Council update","dek":"Water rates","topic":"council","body":"The council voted 5-2.\\nThe rate starts Tuesday.\\n\\nResidents pay $40. Quoted: \"water\"; path C:\\records; tab \\t; slash \\/; Unicode \\u0041; actual tab\tand newline\nremain."}`;
const expected = "The council voted 5-2.\nThe rate starts Tuesday.\n\nResidents pay $40. Quoted: \"water\"; path C:\\records; tab \\t; slash \\/; Unicode \\u0041; actual tab\tand newline\nremain.";

test("TXB-1 valid JSON normalizes only literal body newline escapes", () => {
  assert.ok(JSON.parse(raw).body.includes("\\n\\n"));
  assert.equal(coerceDraft(raw, fallback).body, expected);
  const untouched = String.raw`Label \n \t \"quote\" C:\records`;
  const draft = coerceDraft(JSON.stringify({ ...fallback, headline: untouched, dek: untouched,
    body: expected, integrity_notes: untouched, source_urls: ["https://example.test/a?n=1"], memory_entities: [untouched] }), fallback);
  assert.equal(draft.body, expected);
  assert.equal(draft.headline, untouched);
  assert.equal(draft.dek, untouched);
  assert.equal(draft.integrity_notes, untouched);
  assert.deepEqual(draft.memory_entities, [untouched]);
  assert.deepEqual(draft.source_urls, ["https://example.test/a?n=1"]);
});

test("TXB-1 nested JSON body also crosses the same normalization boundary", () => {
  assert.equal(coerceDraft(JSON.stringify({ ...fallback, body: raw }), fallback).body, expected);
});

for (const escapedStage of ["writer", "edit"] as const) {
  test(`TXB-1 ${escapedStage} reply reaches writer checkpoint and final save payload with paragraphs`, async () => {
    const paper = { name: "Test Paper", city: "Longmont", state: "Colorado" };
    const url = "https://city.example/water";
    const body = "The council voted 5-2 on Tuesday.\nThe new water rate starts in January.\n\nResidents will pay 40 dollars for water service.";
    const lead = { id: 154, ...fallback, why: fallback.dek, status: "new", source_urls: JSON.stringify([url]), evidence: "", newsworthiness: 1, created_at: "2026-10-19" } as LeadRow;
    const reply = (escaped: boolean) => JSON.stringify({ ...fallback, body: escaped ? body.replace(/\n/g, "\\n") : body, source_urls: [url], unanswered: [] });
    const checkpoints: string[] = [];
    const seen: string[] = [];
    const result = await reportAndDraft({ userId: "txb-1", lead, urls: [url], memory: [], researchScope: "supplied", modelChoice: "codex-balanced" }, {
      paper: async () => paper,
      ingest: async () => ({ url, title: "Water rate notice", text: body, extras: [] }),
      capture: async () => ({ version_id: 1, capture_event_id: 2 }),
      hydrate: async () => [],
      onWriterDraft: async draft => { checkpoints.push(draft.body); },
      chat: async (system) => {
        if (system.startsWith(reportWriteSystem(paper))) { seen.push("writer"); return { ok: true, text: reply(escapedStage === "writer") }; }
        if (system === REPORT_EDIT_SYSTEM) { seen.push("edit"); return { ok: true, text: reply(escapedStage === "edit") }; }
        if (system === NAME_INVENTORY_SYSTEM) return { ok: true, text: JSON.stringify({ complete: true, people: [] }) };
        if (system.includes('"fetch_urls"')) return { ok: true, text: JSON.stringify({ news: fallback.headline, form: "brief" }) };
        return { ok: true, text: reply(false) };
      },
    });
    assert.deepEqual(seen, ["writer", "edit"]);
    assert.deepEqual(checkpoints, [body]);
    assert.ok(!("error" in result));
    if (!("error" in result)) assert.equal(result.body, body);
  });
}

test("TXB-1 raw JSON crosses actual coercion and transactional save boundary without a database", async () => {
  const { saveDraftForEditorInTransaction } = await import("./draft-edit.server.ts");
  const statements: { text: string; values: unknown[] }[] = [];
  // Only a tagged-template recorder: no connection is opened and no DB writes run.
  const sql = (async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join("?");
    statements.push({ text, values });
    if (text.includes("select id from leads")) return [{ id: 154 }];
    if (text.includes("select * from drafts") || text.includes("insert into drafts")) return [];
    assert.fail(`Unexpected persistence query: ${text}`);
  }) as unknown as import("../db.ts").Sql;
  const draft = coerceDraft(raw, fallback);
  assert.deepEqual(await saveDraftForEditorInTransaction(sql, { userId: "txb-1", newsroomId: 154 }, {
    leadId: 154, headline: draft.headline, dek: draft.dek, topic: draft.topic, body: draft.body,
  }), { ok: true });
  const insert = statements.find(statement => statement.text.includes("insert into drafts"));
  assert.ok(insert);
  assert.deepEqual(insert.values.slice(0, 7), ["txb-1", 154, 154, fallback.headline, fallback.dek, expected, fallback.topic]);
});
