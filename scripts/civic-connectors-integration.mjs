import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { inspect } from "node:util";
import { QuorumRelayClient } from "quorumrelay-client";
import { startConnectorFixture, libraryRoot } from "./civic-connectors-service.fixture.mjs";
import "../src/lib/test-support/pglite-migrations.ts";
import { getSql, getPglite, withTransaction } from "../src/lib/db.ts";
import {
  saveConnectorSource, runConnectorRead, readConnectorEvidence, exportConnectorEvidence,
  connectorIngestForSource, connectorWrite, fileConnectorEvidenceLead, connectorRecords,
} from "../src/lib/news/civic-connectors.ts";

assert.equal(process.env.TOWNREPORTER_TEST_ENV_VERIFIED, "1");
assert.equal(process.env.DATABASE_URL, "");
const fixture = await startConnectorFixture();
const owner = { userId: "synthetic-connector-owner", newsroomId: 944251, role: "owner" };
const other = { ...owner, newsroomId: owner.newsroomId + 1 };
process.env.CIVIC_CONNECTORS_URL = fixture.baseUrl;
process.env.CIVIC_CONNECTORS_NEWSROOM_TOKENS = JSON.stringify({ [owner.newsroomId]: fixture.tokens[0], [other.newsroomId]: fixture.tokens[1] });
const sql = await getSql();
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ?
  Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
async function source(actor, url, reuse = true) {
  if (reuse) {
    const [existing] = await sql.query("select id from sources where newsroom_id=$1 and url=$2", [actor.newsroomId, url]);
    if (existing) return existing.id;
  }
  const [row] = await sql.query("insert into sources(user_id,newsroom_id,url,title,status) values($1,$2,$3,'Synthetic connector source','accepted') returning id",
    [actor.userId, actor.newsroomId, url]);
  return row.id;
}
try {
  for (const actor of [owner, other]) await sql.query("insert into newsrooms(id,name) values($1,$2)", [actor.newsroomId, `Synthetic integration ${actor.newsroomId}`]);
  const roster = await fixture.client.execute("providers");
  assert.equal(roster.data.providers.length, 31);
  const cases = JSON.parse(await readFile(join(libraryRoot, "tests/fixtures/baseline/cases.json"), "utf8"));
  assert.equal(cases.length, 34);
  assert.deepEqual(new Set(roster.data.formats.map((row) => `${row.connector}/${row.input_format}`)),
    new Set(cases.map((row) => `${row.connector}/${row.input_format}`)));
  const selectedCases = process.env.CIVIC_CONNECTORS_DEBUG_SKIP_BASELINE === "1" ? [] :
    process.env.CIVIC_CONNECTORS_CASE ? cases.filter((row) => row.connector === process.env.CIVIC_CONNECTORS_CASE) : cases;
  if (process.env.CIVIC_CONNECTORS_CASE) assert.equal(selectedCases.length, 1, "case selector must match exactly one original fixture");
  for (const item of selectedCases) {
    const bytes = await readFile(join(libraryRoot, "tests/fixtures/baseline", item.file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256);
    // Each original-format case gets its own accepted source row and configuration,
    // so shared fixture URLs cannot conflate one connector's records with another's.
    // The source URL stays byte-identical: the pinned original-output hash covers it,
    // and sources has no unique URL constraint, so a fresh row is enough.
    const id = await source(owner, item.source_url, false);
    try {
      await saveConnectorSource(sql, owner, id, { provider: item.connector, url: item.source_url, input_format: item.input_format }, { mode: "saved" });
      const result = await runConnectorRead(owner, id, { contentBase64: bytes.toString("base64") });
      assert.ok(["completed", "partial"].includes(result.result.status), JSON.stringify(result));
      const bundle = result.result.data.bundle;
      const capture = bundle.bundles?.[0] ?? bundle;
      assert.equal(hash(capture.compatibility), item.original_output_sha256, "must match independently pinned original output");
      assert.equal(capture.capture.sha256, item.sha256);
      if (item.connector === "first-party") {
        assert.equal(result.result.status, "partial");
        assert.equal(result.result.coverage.truncated, true);
        assert.ok(capture.records.length < item.original_record_count);
      } else if (item.connector === "tyler-meeting-manager") {
        // Rich output retains cancelled/adjourned events that the v1 projection skips.
        assert.ok(capture.records.length > item.original_record_count);
      } else {
        assert.equal(capture.records.length, item.original_record_count);
      }
      const [saved] = await sql.query(
        `select id,record_json from civic_connector_evidence
         where newsroom_id=$1 and source_id=$2 and record_json->'identity'->>'external_id'=$3
         order by id desc limit 1`,
        [owner.newsroomId, id, capture.records[0].identity.external_id],
      );
      assert.ok(saved, "imported record must be saved as cited evidence");
      assert.deepEqual(saved.record_json, capture.records[0]);
      assert.equal((await readConnectorEvidence(sql, owner, saved.id)).record_json.capture_sha256, item.sha256);
      console.log(`PASS original-format ${item.connector}/${item.input_format}`);
    } catch (error) {
      throw new Error(`original-format ${item.connector}/${item.input_format}: ${inspect(error, { depth: 5 })}`);
    }
  }
  for (const [provider, url, fields, expectedRecords] of [
    ["telvue", "https://connect.telvue.com", { api_resource: "videos" }, 1],
    ["municode-meetings", "https://meetingsgov.devmunicode.com", { api_resource: "meeting", external_id: "42" }, 0],
  ]) {
    const accountSource = await source(owner, url, false);
    await saveConnectorSource(sql, owner, accountSource, { provider, url, namespace: "fixture-account" }, { mode: "live" });
    const fetched = await runConnectorRead(owner, accountSource, { operation: "fetch", fetchFields: fields });
    assert.equal(fetched.result.status, "partial", JSON.stringify(fetched));
    assert.equal(fetched.saved, expectedRecords);
    assert.ok(fetched.importId, "partial account capture must be stored even without normalized records");
    const [stored] = await sql.query("select result_json from civic_connector_imports where newsroom_id=$1 and id=$2", [owner.newsroomId, fetched.importId]);
    assert.equal(stored.result_json.status, "partial");
    assert.doesNotMatch(JSON.stringify(stored), /synthetic-account-token|synthetic-passphrase|synthetic-access-key/);
    await assert.rejects(() => runConnectorRead(other, accountSource, { operation: "fetch", fetchFields: fields }), /newsroom|source/i);
    console.log(`PASS synthetic account fetch ${provider}`);
  }
  const documentUrl = "https://synthetic.escribemeetings.com/";
  const documentSource = await source(owner, documentUrl);
  await saveConnectorSource(sql, owner, documentSource, { provider: "escribe", url: documentUrl,
    input_format: "escribe-calendar-json" }, { mode: "saved" });
  const calendar = Buffer.from(JSON.stringify({ d: [{ ID: "doc-1", MeetingName: "Council",
    StartDate: "2026/11/11 19:00:00", Url: "/Meeting.aspx?Id=doc-1",
    MeetingDocumentLink: [{ Type: "Agenda", Title: "Agenda", Url: "/agenda.txt" },
      { Type: "Document", Title: "Unavailable", Url: "/missing.txt" }] }] }));
  await runConnectorRead(owner, documentSource, { contentBase64: calendar.toString("base64") });
  const documentIngest = await connectorIngestForSource(sql, owner, documentSource);
  assert.match(documentIngest.text, /Harbor sidewalk allocation/);
  assert.match(documentIngest.text, /Some document text was unavailable/);
  assert.equal(documentIngest.connectorResult.status, "partial");
  const coverage = documentIngest.connectorResult.coverage.document_scan;
  assert.equal(coverage.requested, 2);
  assert.equal(coverage.captured, 1);
  assert.equal(coverage.incomplete, true);
  assert.equal(coverage.maximum_documents, 100);
  assert.equal(coverage.failures.length, 1);
  assert.equal(coverage.failures[0].index, 1);
  const [doc] = await sql.query("select id from artifact_versions where newsroom_id=$1 and full_text like $2", [owner.newsroomId, "%Harbor sidewalk allocation%"]);
  assert.ok(doc, "document capture must be stored in the owning newsroom");
  const [chunk] = await sql.query("select id from artifact_chunks where version_id=$1 and excerpt like $2", [doc.id, "%Harbor sidewalk allocation%"]);
  assert.ok(chunk, "document must enter existing searchable evidence chunks");
  const [foreignDoc] = await sql.query("select id from artifact_versions where newsroom_id=$1 and id=$2", [other.newsroomId, doc.id]);
  assert.equal(foreignDoc, undefined);
  const [documentEvidence] = await sql.query("select id from civic_connector_evidence where newsroom_id=$1 and source_id=$2", [owner.newsroomId, documentSource]);
  const reopenedDocument = await readConnectorEvidence(sql, owner, documentEvidence.id);
  assert.equal(reopenedDocument.documents.length, 1);
  assert.match(reopenedDocument.documents[0].full_text, /Harbor sidewalk allocation/);
  await assert.rejects(() => readConnectorEvidence(sql, other, documentEvidence.id), /newsroom/i);
  await connectorIngestForSource(sql, owner, documentSource);
  assert.equal((await readConnectorEvidence(sql, owner, documentEvidence.id)).documents.length, 1);
  const url = "https://webapi.legistar.com/v1/synthetic-city/events";
  const id = await source(owner, url);
  const connectorSource = { provider: "legistar", url, namespace: "//webapi.legistar.com/v1/synthetic-city", input_format: "legistar-events-json" };
  await saveConnectorSource(sql, owner, id, connectorSource, { mode: "saved", writeEnabled: true });
  const bytes = Buffer.from(JSON.stringify([{ EventId: 701, EventBodyName: "Council", EventDate: "2026-11-11T00:00:00", EventTime: "7:00 PM", EventRowVersion: "synthetic-r1", unknown: [null, false, 0, "", "café"] }]));
  const preview = await runConnectorRead(owner, id, { contentBase64: bytes.toString("base64"), preview: true });
  assert.equal(preview.saved, 0);
  const first = await runConnectorRead(owner, id, { contentBase64: bytes.toString("base64") });
  assert.equal(first.saved, 1, JSON.stringify(first.result));
  assert.equal(first.result.status, "partial");
  assert.match(first.result.coverage.scope, /saved capture.*not a complete/i);
  const again = await runConnectorRead(owner, id, { contentBase64: bytes.toString("base64") });
  assert.equal(again.saved, 0);
  const [saved] = await sql.query("select id,version_id from civic_connector_evidence where newsroom_id=$1 and source_id=$2", [owner.newsroomId, id]);
  const reopened = await readConnectorEvidence(sql, owner, saved.id);
  assert.deepEqual(reopened.record_json.original.unknown, [null, false, 0, "", "café"]);
  await assert.rejects(() => readConnectorEvidence(sql, other, saved.id), /newsroom/i);
  await assert.rejects(() => exportConnectorEvidence(sql, other, first.importId, "zip"), /newsroom/i);
  await assert.rejects(() => runConnectorRead(other, id), /newsroom|source/i);
  const search = await fixture.client.execute("search", { records: [reopened.record_json], query: { terms: ["Council"] }, coverage: first.result.coverage });
  assert.equal(search.data.hits.length, 1);
  assert.equal(search.status, "partial");
  const foreign = new QuorumRelayClient({ baseUrl: fixture.baseUrl, token: fixture.tokens[1] });
  assert.deepEqual((await foreign.execute("search", { query: { terms: ["Council"] } })).data.hits, []);
  const exported = await exportConnectorEvidence(sql, owner, first.importId, "zip");
  const reimported = await fixture.client.execute("import_bundle", { format: "zip", content_base64: exported.data.content_base64, persist: true });
  assert.equal(reimported.data.changes[0].outcome, "unchanged");
  const exactBundle = await fixture.client.execute("export", { bundle_key: reopened.bundle_key, format: "json" });
  assert.deepEqual(connectorRecords({ data: JSON.parse(Buffer.from(exactBundle.data.content_base64, "base64").toString()) })[0].original.unknown,
    [null, false, 0, "", "café"]);
  const broken = await runConnectorRead(owner, id, { contentBase64: Buffer.from("{broken").toString("base64") });
  assert.ok(["failed", "partial"].includes(broken.result.status));
  assert.equal(broken.saved, 0);
  const retried = await runConnectorRead(owner, id, { contentBase64: bytes.toString("base64") });
  assert.equal(retried.saved, 0);
  assert.match((await connectorIngestForSource(sql, owner, id)).text, /PARTIAL \/ SAVED CAPTURE/);
  const change = { changes: [{ key: "synthetic-event-1", entity: "event", operation: "create", fields: { EventDate: "2026-11-11T00:00:00", EventBodyId: 4 } }] };
  const planned = await connectorWrite(sql, owner, id, "plan", change);
  assert.equal(planned.status, "completed", JSON.stringify(planned));
  const approval = { plan_id: planned.data.plan_id, plan_hash: planned.data.plan_hash };
  await assert.rejects(() => connectorWrite(sql, owner, id, "commit", approval), /approval/i);
  await assert.rejects(() => connectorWrite(sql, { ...owner, role: "editor" }, id, "commit", { ...approval, approved: true }), /owner/i);
  await assert.rejects(() => connectorWrite(sql, other, id, "receipt", approval), /source|newsroom/i);
  const committed = await connectorWrite(sql, owner, id, "commit", { ...approval, approved: true });
  assert.equal(committed.status, "completed", JSON.stringify(committed));
  assert.equal(committed.data.mock, true);
  assert.equal(committed.data.live_acceptance, "NOT_RUN");
  assert.equal(committed.data.items[0].readback.EventBodyId, 4);
  assert.equal((await connectorWrite(sql, owner, id, "commit", { ...approval, approved: true })).status, "completed");
  assert.deepEqual((await connectorWrite(sql, owner, id, "receipt", approval)).data, committed.data);
  const calls = (await readFile(join(fixture.root, "synthetic-calls.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(calls.filter((row) => row.method === "POST").length, 1);
  await fixture.restart();
  assert.deepEqual((await exportConnectorEvidence(sql, owner, first.importId, "zip")).coverage, exported.coverage);
  assert.deepEqual((await connectorWrite(sql, owner, id, "receipt", approval)).data, committed.data);
  for (const table of ["articles", "drafts", "leads", "desk_jobs", "source_monitors"]) {
    const [count] = await sql.query(`select count(*)::integer as count from ${table} where newsroom_id=$1`, [owner.newsroomId]);
    assert.equal(count.count, 0, `${table} must remain unchanged by connector reads/writes`);
  }
  const lead = await withTransaction((transaction) => fileConnectorEvidenceLead(transaction, owner, saved.id));
  assert.ok(lead.leadId);
  assert.equal((await withTransaction((transaction) => fileConnectorEvidenceLead(transaction, owner, saved.id))).unchanged, true);
  console.log(JSON.stringify({ status: "PASS", originalFormats: selectedCases.length, providers: 31, partialCoverage: true,
    isolation: true, duplicateRetry: true, serviceRestart: true, explicitMockWriteReceipt: true,
    publication: "none", reviewLead: "explicit idempotent action only", liveAcceptance: "NOT_RUN" }));
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  const preserve = process.exitCode === 1;
  await fixture.close({ preserve });
  if (preserve) console.error(`Synthetic fixture evidence retained at ${fixture.root}`);
  await (await getPglite()).close();
}
