import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sql } from "../db.ts";
import { checkRetainedDocumentaryStory, loadCurrentReportingDocumentChecks } from "./reporting-document-check.server.ts";
import type { PackageStory } from "./civic-reporting.ts";
import type { DocumentRead } from "./civic-reporting-run.server.ts";

const fixture = JSON.parse(readFileSync(new URL("./reporting-document-check.request15.fixture.json", import.meta.url), "utf8")) as {
  filed: PackageStory; accepted: PackageStory; documents: DocumentRead[];
};
it("rechecks actual request-15 c11/c12 against retained page31 without rewriting original machine status", () => {
  const before = JSON.stringify(fixture);
  const result = checkRetainedDocumentaryStory(fixture);
  assert.deepEqual(Object.values(result).map((row) => row.status), ["VERIFIED", "VERIFIED"]);
  assert.equal(fixture.filed.claims[0].status, "UNVERIFIED");
  assert.equal(JSON.stringify(fixture), before);
  assert.match(result.c11.references[0].locator, /31/);
  assert.match(result.c12.references[0].locator, /31/);
  assert.match(result.c11.inputFingerprint, /^[a-f0-9]{64}$/);
});

it("fails unavailable for changed filed text, item, source URL, locator, or accepted writer draft", () => {
  for (const change of [
    (f: typeof fixture) => { f.filed.claims[0].text += " Additional assertion."; },
    (f: typeof fixture) => { f.filed.claims[0].item = "Different item"; },
    (f: typeof fixture) => { f.filed.sources[0].url += "?different-document=1"; },
    (f: typeof fixture) => { f.filed.sources[0].locator = "p. 30, Budget Meetings"; },
    (f: typeof fixture) => { f.accepted.draft = "A superseded writer story"; },
  ]) {
    const input = structuredClone(fixture);
    change(input);
    assert.equal(checkRetainedDocumentaryStory(input).c11.state, "unavailable");
  }
});

it("keeps a wrong date and a wrong calendar role held despite numbers existing on the page", () => {
  for (const text of [
    fixture.accepted.claims[0].text.replace("October 6", "October 7"),
    fixture.accepted.claims[0].text.replace("October 6", "October 20"),
  ]) {
    const input = structuredClone(fixture);
    input.accepted.claims[0].text = text;
    input.filed.claims[0].text = text;
    assert.equal(checkRetainedDocumentaryStory(input).c11.status, "UNVERIFIED");
  }
});

it("does not certify an invented amount, adoption, missing document, or contested claim", () => {
  const amount = structuredClone(fixture);
  amount.accepted.claims[0].text += " The budget-meetings schedule assigns $672,625 for that public hearing.";
  amount.filed.claims[0].text = amount.accepted.claims[0].text;
  assert.equal(checkRetainedDocumentaryStory(amount).c11.status, "UNVERIFIED");
  const adoption = structuredClone(fixture);
  adoption.accepted.claims[0].text += " Council adopted the budget.";
  adoption.filed.claims[0].text = adoption.accepted.claims[0].text;
  assert.equal(checkRetainedDocumentaryStory(adoption).c11.state, "unavailable");
  const missing = structuredClone(fixture);
  missing.documents = [];
  assert.notEqual(checkRetainedDocumentaryStory(missing).c11.status, "VERIFIED");
  const contested = structuredClone(fixture);
  contested.filed.claims[0].status = "CONTESTED";
  assert.equal(checkRetainedDocumentaryStory(contested).c11.status, "CONTESTED");
  const notVerifiedByWriter = structuredClone(fixture);
  notVerifiedByWriter.accepted.claims[0].status = "UNVERIFIED";
  assert.equal(checkRetainedDocumentaryStory(notVerifiedByWriter).c11.status, "UNVERIFIED");
});

it("reloads derived checks with scoped read-only SQL and never runs model/meeting capture or writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "tr-document-check-"));
  const workspace = join(root, "request-15");
  await mkdir(workspace);
  try {
    await writeFile(join(workspace, "all-documents.json"), JSON.stringify(fixture.documents));
    await writeFile(join(workspace, "writer-citation-revision.txt"), JSON.stringify({ stories: [fixture.accepted] }));
    const pack = { packageVersion: 1, stories: [fixture.filed] };
    const calls: unknown[][] = [];
    const sql = { query: async (statement: string, values: unknown[]) => {
      assert.match(statement, /^select /i);
      assert.match(statement, /rp.newsroom_id=\$1 and rp.request_id=\$2/);
      calls.push(values);
      return [{ package: pack, workspace_dir: workspace }];
    } } as unknown as Sql;
    const first = await loadCurrentReportingDocumentChecks(sql, 947, 15);
    const second = await loadCurrentReportingDocumentChecks(sql, 947, 15);
    assert.equal(first[fixture.filed.id].c11.status, "VERIFIED");
    assert.equal(second[fixture.filed.id].c11.inputFingerprint, first[fixture.filed.id].c11.inputFingerprint);
    assert.deepEqual(calls, [[947, 15], [947, 15]]);
    await writeFile(join(workspace, "writer-raw.txt"), JSON.stringify({ stories: [{ ...fixture.accepted, cannotSay: "Different accepted candidate" }] }));
    const ambiguous = await loadCurrentReportingDocumentChecks(sql, 947, 15);
    assert.equal(ambiguous[fixture.filed.id].c11.state, "unavailable");
  } finally {
    await rm(root, { recursive: true });
  }
});
