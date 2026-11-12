import { createHash } from "node:crypto";
import { QuorumRelayClient } from "quorumrelay-client";
import type { Bounds, OperationResult, RecordEnvelope, Source } from "quorumrelay-client";
import type { Sql } from "../db.ts";
import { withTransaction } from "../db.ts";
import { rememberCapture } from "./investigate.ts";
import { storableText } from "./storable-text.ts";
import type { IngestResult } from "./ingest.ts";

export const CONNECTOR_SERVICE_VERSION = "0.1.0.dev6";
export const CONNECTOR_SCHEMA_VERSION = "2.0.0";
export type ConnectorActor = { userId: string; newsroomId: number; role?: string };
type Json = { [key: string]: unknown };
export type ConnectorConfiguration = {
  source_json: Source;
  bounds_json: Bounds;
  mode: "live" | "saved";
  write_enabled: boolean;
  revision: number;
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}
function hash(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object")
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
    return item;
  };
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
function owner(actor: ConnectorActor): void {
  if (actor.role !== "owner") throw new Error("Only the owner can configure provider operations.");
}

export function connectorConfigurationForNewsroom(
  newsroomId: number,
  env: NodeJS.ProcessEnv = process.env,
): { baseUrl: string; token: string } {
  if (!env.CIVIC_CONNECTORS_URL?.trim())
    throw new Error("No connector service is configured. Ask the operator to set CIVIC_CONNECTORS_URL.");
  let tokens: Json;
  try {
    tokens = object(JSON.parse(env.CIVIC_CONNECTORS_NEWSROOM_TOKENS || "{}"));
  } catch {
    throw new Error("Connector newsroom credentials are not valid JSON. Ask the operator to repair configuration.");
  }
  const token = tokens[String(newsroomId)];
  if (typeof token !== "string" || !token.trim())
    throw new Error("No connector service credential is configured for this newsroom.");
  const url = new URL(env.CIVIC_CONNECTORS_URL);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("The connector service requires a configured HTTP(S) root without credentials.");
  return { baseUrl: url.href.replace(/\/$/, ""), token };
}

export async function newsroomConnectorClient(actor: Pick<ConnectorActor, "newsroomId">) {
  const client = new QuorumRelayClient(connectorConfigurationForNewsroom(actor.newsroomId));
  const info = await client.info();
  if (object(info.data).version !== CONNECTOR_SERVICE_VERSION || info.schema_version !== CONNECTOR_SCHEMA_VERSION)
    throw new Error("Connector service version does not match the pinned 0.1.0.dev6 / schema 2.0.0 candidate.");
  return client;
}

async function acceptedSource(sql: Sql, actor: ConnectorActor, sourceId: number) {
  const [row] = await sql.query<{ id: number; url: string; status: string }>(
    "select id,url,status from sources where newsroom_id=$1 and id=$2",
    [actor.newsroomId, sourceId],
  );
  if (!row || row.status !== "accepted") throw new Error("This is not an accepted source in your newsroom.");
  return row;
}

export async function saveConnectorSource(
  sql: Sql, actor: ConnectorActor, sourceId: number, source: Source,
  settings: { bounds?: Bounds; mode?: "live" | "saved"; writeEnabled?: boolean } = {},
) {
  owner(actor);
  const row = await acceptedSource(sql, actor, sourceId);
  if (source.url !== row.url) throw new Error("Connector source URL must match the accepted source.");
  if (!source.provider || !/^https?:/.test(source.url)) throw new Error("Choose a provider and public source URL.");
  await sql.query(
    `insert into civic_connector_sources(newsroom_id,source_id,source_json,bounds_json,mode,write_enabled)
     values($1,$2,$3::jsonb,$4::jsonb,$5,$6)
     on conflict(newsroom_id,source_id) do update set source_json=excluded.source_json,
       bounds_json=excluded.bounds_json,mode=excluded.mode,write_enabled=excluded.write_enabled,
       revision=civic_connector_sources.revision+1`,
    [actor.newsroomId, sourceId, JSON.stringify(source), JSON.stringify(settings.bounds ?? {}),
      settings.mode ?? "live", settings.writeEnabled === true],
  );
  return { saved: true };
}

export async function configuredConnectorSource(sql: Sql, actor: ConnectorActor, sourceId: number) {
  await acceptedSource(sql, actor, sourceId);
  const [row] = await sql.query<ConnectorConfiguration>(
    "select source_json,bounds_json,mode,write_enabled,revision from civic_connector_sources where newsroom_id=$1 and source_id=$2",
    [actor.newsroomId, sourceId],
  );
  return row ?? null;
}

export function connectorRecords(result: OperationResult): RecordEnvelope[] {
  const data = object(result.data);
  const bundle = object(data.bundle);
  const records = data.records ?? bundle.records;
  if (!Array.isArray(records)) return [];
  return records as RecordEnvelope[];
}

// Capture bytes stay in the authenticated service store. Do not remove similarly
// named unknown fields from original provider records or extensions.
export function connectorResultReference(result: OperationResult): OperationResult {
  const copy = structuredClone(result);
  const data = object(copy.data);
  const bundleKey = data.bundle_key;
  const capture = (value: unknown) => {
    const row = object(value);
    if (typeof row.content_base64 === "string") {
      delete row.content_base64;
      row.storage_reference = { owner: "connector-service", bundle_key: bundleKey ?? null, sha256: row.sha256 };
    }
  };
  const bundle = (value: unknown) => {
    const row = object(value);
    capture(row.capture);
    if (Array.isArray(row.captures)) row.captures.forEach(capture);
    if (Array.isArray(row.bundles)) row.bundles.forEach(bundle);
  };
  bundle(data);
  if (data.bundle) bundle(data.bundle);
  return copy;
}

export function connectorEvidenceText(record: RecordEnvelope): string {
  const segments = record.text ?? [];
  const heading = String(record.normalized.title ?? record.normalized.name ?? record.identity.external_id);
  const metadata = JSON.stringify(record.normalized, null, 2);
  const text = segments.map((segment) =>
    `${segment.page != null ? `Page ${segment.page}. ` : ""}${segment.timestamp != null ? `Time ${String(segment.timestamp)}. ` : ""}${segment.text}\nCitation: ${segment.citation_url}\nCoverage: ${segment.completeness ?? "not supplied"}`,
  ).join("\n\n");
  return storableText(`${heading}\nSource metadata:\n${metadata}\n\n${text || "Metadata only. No document text or transcript supplied; not a complete document search."}`);
}

export async function persistConnectorResult(
  sql: Sql, actor: ConnectorActor, sourceId: number, result: OperationResult,
) {
  const configured = await configuredConnectorSource(sql, actor, sourceId);
  if (!configured) throw new Error("Configure this connector source before importing evidence.");
  const data = object(result.data);
  if (data.persisted !== true || typeof data.bundle_key !== "string")
    throw new Error("The connector service did not persist a lossless bundle; evidence was not saved.");
  if (!["completed", "partial"].includes(result.status))
    throw new Error("Failed or cancelled connector results are not successful imports.");
  const records = connectorRecords(result);
  for (const record of records) {
    if (record.identity.provider !== configured.source_json.provider)
      throw new Error("The imported provider does not match the configured source.");
    if (configured.source_json.namespace && record.identity.namespace !== configured.source_json.namespace)
      throw new Error("The imported namespace does not match the configured source.");
  }
  const [imported] = await sql.query<{ id: number }>(
    `insert into civic_connector_imports(newsroom_id,source_id,bundle_key,result_json)
     values($1,$2,$3,$4::jsonb) on conflict(newsroom_id,source_id,bundle_key)
     do update set bundle_key=excluded.bundle_key returning id`,
    [actor.newsroomId, sourceId, data.bundle_key, JSON.stringify(connectorResultReference(result))],
  );
  let saved = 0;
  for (const record of records) {
    const identity = record.identity;
    const identityKey = hash([identity.provider, identity.namespace, identity.record_type, identity.external_id, identity.parent ?? null]);
    const { captured_at: _observed, ...stable } = record;
    const recordHash = hash(stable);
    const [existing] = await sql.query<{ id: number }>(
      "select id from civic_connector_evidence where newsroom_id=$1 and source_id=$2 and identity_key=$3 and record_hash=$4",
      [actor.newsroomId, sourceId, identityKey, recordHash],
    );
    if (existing) continue;
    const text = connectorEvidenceText(record);
    const capture = await rememberCapture({
      sql, userId: actor.userId, newsroomId: actor.newsroomId, investigationId: null,
      url: record.source_url, title: String(record.normalized.title ?? identity.external_id),
      text, hash: recordHash, status: 200, outcome: "fetched",
      contentType: "application/json", extractionMethod: "civic-connector:normalized-projection",
      observedAt: new Date(record.captured_at), triggerKind: "civic-connector", autoWatch: false,
      pages: record.text?.filter((segment) => segment.page != null).map((segment) => ({ page: segment.page!, text: segment.text })),
    });
    await sql.query(
      `insert into civic_connector_evidence(newsroom_id,source_id,import_id,identity_key,record_hash,
       capture_sha256,record_json,version_id,capture_event_id)
       values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
       on conflict(newsroom_id,source_id,identity_key,record_hash) do nothing`,
      [actor.newsroomId, sourceId, imported!.id, identityKey, recordHash, record.capture_sha256,
        JSON.stringify(record), capture.versionId, capture.captureEventId],
    );
    saved++;
  }
  return { importId: imported!.id, saved, result: connectorResultReference(result) };
}

export async function runConnectorRead(
  actor: ConnectorActor, sourceId: number, input: { contentBase64?: string; preview?: boolean; operation?: "discover" | "fetch";
    fetchFields?: { api_resource?: string; external_id?: string; offset?: number; filters?: Record<string, unknown> } } = {},
) {
  const { getSql } = await import("../db.ts");
  const sql = await getSql();
  const config = await configuredConnectorSource(sql, actor, sourceId);
  if (!config) throw new Error("Configure this connector source first.");
  if (config.mode === "saved" && !input.contentBase64) {
    if (input.operation === "fetch") throw new Error("Choose live mode before an authorized provider fetch.");
    const [saved] = await sql.query<{ result_json: OperationResult; id: number }>(
      "select id,result_json from civic_connector_imports where newsroom_id=$1 and source_id=$2 order by id desc limit 1",
      [actor.newsroomId, sourceId],
    );
    if (!saved) throw new Error("This saved-capture source needs an explicit capture before it can be read.");
    return { importId: saved.id, saved: 0, result: saved.result_json };
  }
  const client = await newsroomConnectorClient(actor);
  if (input.fetchFields && input.operation !== "fetch") throw new Error("Provider request fields are supported only for fetch.");
  const discovered = await client.execute(input.operation ?? "discover", {
    source: config.source_json, bounds: input.operation === "fetch" ? {} : config.bounds_json,
    ...(input.fetchFields ?? {}),
    ...(input.contentBase64 ? { content_base64: input.contentBase64 } : {}),
  }).catch((error: unknown) => { throw new Error("Connector discovery request failed", { cause: error }); });
  if (input.preview) return { saved: 0, result: await client.execute("import_preview", { result: discovered }) };
  const hasCapture = Boolean(object(discovered.data).capture || object(discovered.data).bundles);
  if (!["completed", "partial"].includes(discovered.status) || (!connectorRecords(discovered).length && !hasCapture)) {
    await sql.query(
      "insert into civic_connector_runs(newsroom_id,source_id,operation,result_json) values($1,$2,'discover',$3::jsonb)",
      [actor.newsroomId, sourceId, JSON.stringify(connectorResultReference(discovered))],
    );
    return { saved: 0, result: connectorResultReference(discovered) };
  }
  const imported = await client.execute("import_bundle", { result: discovered, persist: true })
    .catch((error: unknown) => { throw new Error("Connector evidence import request failed", { cause: error }); });
  return withTransaction(async (transaction) => {
    // Lock configuration/source so a concurrent edit or removal cannot relabel a capture.
    const [current] = await transaction.query<{ revision: number }>(
      "select c.revision from civic_connector_sources c join sources s on s.id=c.source_id and s.newsroom_id=c.newsroom_id where c.newsroom_id=$1 and c.source_id=$2 and s.status='accepted' for update",
      [actor.newsroomId, sourceId],
    );
    if (current?.revision !== config.revision) throw new Error("Source configuration changed; review and retry this import.");
    return persistConnectorResult(transaction, actor, sourceId, imported);
  });
}

export async function connectorIngestForSource(
  sql: Sql, actor: ConnectorActor, sourceId: number,
): Promise<(IngestResult & { connectorResult: OperationResult }) | null> {
  const config = await configuredConnectorSource(sql, actor, sourceId);
  if (!config) return null;
  const response = await runConnectorRead(actor, sourceId);
  const result = response.result;
  const records = connectorRecords(result);
  if (!records.length || !["completed", "partial"].includes(result.status))
    throw new Error(`Connector ${result.status}: ${result.errors.map((error) => error.message).join("; ") || "No captured records available."}`);
  const client = await newsroomConnectorClient(actor);
  const documents: string[] = [];
  const documentFailures: { record_key: string; index: number; reason: string }[] = [];
  let unavailable = false;
  let requested = 0;
  for (const record of records) {
    const identity = (value: Json): unknown => ({
      provider: value.provider, namespace: value.namespace, record_type: value.record_type,
      external_id: value.external_id, parent: value.parent ? identity(object(value.parent)) : null,
    });
    const listed = Array.isArray(record.normalized.documents) ? record.normalized.documents : [];
    for (let index = 0; index < listed.length; index++) {
      const recordKey = hash(identity(record.identity));
      if (requested >= 100) {
        unavailable = true;
        documentFailures.push({ record_key: recordKey, index, reason: "document scan limit reached" });
        break;
      }
      requested++;
      let fetched: OperationResult;
      try {
        fetched = await client.execute("fetch", {
          source: config.source_json, bounds: config.bounds_json,
          attachment: { record_key: recordKey, index, kind: "documents" },
        });
      } catch {
        unavailable = true;
        documentFailures.push({ record_key: recordKey, index, reason: "connector service request failed" });
        continue;
      }
      const attachment = object(object(fetched.data).attachment);
      if (!["completed", "partial"].includes(fetched.status) || typeof attachment.citation_url !== "string") {
        unavailable = true;
        documentFailures.push({ record_key: recordKey, index,
          reason: fetched.errors.map((error) => error.message).join("; ") || "attachment unavailable" });
        continue;
      }
      if (fetched.status === "partial") {
        unavailable = true;
        documentFailures.push({ record_key: recordKey, index, reason: "attachment text is partial" });
      }
      const raw = typeof attachment.content_base64 === "string"
        ? Buffer.from(attachment.content_base64, "base64") : Buffer.from(String(attachment.text ?? ""));
      const digest = createHash("sha256").update(raw).digest("hex");
      if (digest !== attachment.sha256) throw new Error("Fetched document hash mismatch.");
      const mime = String(attachment.content_type ?? "").split(";")[0].toLowerCase();
      let text = typeof attachment.text === "string" ? attachment.text : "";
      let pages: { page: number | null; text: string }[] | undefined;
      if (mime === "application/pdf" || raw.subarray(0, 5).toString() === "%PDF-") {
        const parsed = await (await import("./ingest.ts")).extractPdfBetter(raw, null);
        text = parsed.text;
        pages = parsed.pages;
      } else if (mime === "text/plain" || mime === "text/vtt") {
        text = raw.toString("utf8");
      } else if (mime === "text/html" || mime === "application/xhtml+xml") {
        text = (await import("./article-extract.ts")).extractArticleText(raw.toString("utf8"), attachment.citation_url).text;
      }
      const captured = await rememberCapture({ sql, userId: actor.userId, newsroomId: actor.newsroomId,
        investigationId: null, url: attachment.citation_url, title: `Document from ${config.source_json.provider}`,
        text, hash: digest, status: 200, outcome: "fetched", contentType: mime,
        extractionMethod: "civic-connector:document", rawBytes: raw, pages,
        triggerKind: "civic-connector", autoWatch: false });
      if (captured.versionId === null) throw new Error("The fetched document could not be stored as evidence.");
      const sourceIdentity = record.identity;
      const identityKey = hash([sourceIdentity.provider, sourceIdentity.namespace, sourceIdentity.record_type,
        sourceIdentity.external_id, sourceIdentity.parent ?? null]);
      await sql.query(`insert into civic_connector_documents(newsroom_id,evidence_id,version_id,capture_event_id)
        select $1,id,$4,$5 from civic_connector_evidence where newsroom_id=$1 and source_id=$2 and identity_key=$3
        order by id desc limit 1 on conflict(newsroom_id,evidence_id,version_id) do nothing`,
      [actor.newsroomId, sourceId, identityKey, captured.versionId, captured.captureEventId]);
      documents.push(`Document: ${attachment.citation_url}\n${text || "Text unavailable; captured bytes require further extraction."}`);
      if (!text) {
        unavailable = true;
        documentFailures.push({ record_key: recordKey, index, reason: "document text unavailable" });
      }
    }
  }
  const limited = result.status !== "completed" || config.mode === "saved" || unavailable;
  return {
    text: `${limited ? "PARTIAL / SAVED CAPTURE, not a complete live catalog.\n" : ""}Coverage: ${JSON.stringify(result.coverage)}\nErrors: ${JSON.stringify(result.errors)}${unavailable ? "\nSome document text was unavailable or exceeded the 100-document scan limit." : ""}\n\n${records.map(connectorEvidenceText).join("\n\n")}\n\n${documents.join("\n\n")}`,
    titleHint: `${config.source_json.provider} captured records`,
    extras: [] as string[],
    connectorResult: {
      ...result, status: limited ? "partial" : result.status,
      coverage: { ...result.coverage, document_scan: { requested, captured: documents.length,
        incomplete: unavailable, maximum_documents: 100, failures: documentFailures } },
    },
  };
}

export async function readConnectorEvidence(sql: Sql, actor: ConnectorActor, id: number) {
  const [row] = await sql.query<{
    id: number; source_id: number; record_json: RecordEnvelope; version_id: number;
    capture_event_id: number; result_json: OperationResult; bundle_key: string;
  }>(
    `select e.id,e.source_id,e.record_json,e.version_id,e.capture_event_id,i.result_json,i.bundle_key
     from civic_connector_evidence e join civic_connector_imports i
     on i.id=e.import_id and i.newsroom_id=e.newsroom_id
     where e.newsroom_id=$1 and e.id=$2`,
    [actor.newsroomId, id],
  );
  if (!row) throw new Error("No saved connector evidence exists in your newsroom.");
  const documents = await sql.query(
    `select v.id,v.url,v.title,v.content_hash,v.full_text,v.content_type,v.extraction_method
     from civic_connector_documents d join artifact_versions v on v.id=d.version_id and v.newsroom_id=d.newsroom_id
     where d.newsroom_id=$1 and d.evidence_id=$2 order by v.id`, [actor.newsroomId, id],
  );
  return { ...row, documents };
}

export async function fileConnectorEvidenceLead(sql: Sql, actor: ConnectorActor, id: number) {
  const row = await readConnectorEvidence(sql, actor, id);
  const [locked] = await sql.query<{ lead_id: number | null }>(
    "select lead_id from civic_connector_evidence where newsroom_id=$1 and id=$2 for update",
    [actor.newsroomId, id],
  );
  if (locked?.lead_id) return { leadId: locked.lead_id, unchanged: true };
  const record = row.record_json;
  const [lead] = await sql.query<{ id: number }>(
    `insert into leads(user_id,newsroom_id,headline,why,source_urls,evidence,status,origin,notes_json)
     values($1,$2,$3,$4,$5,$6,'new','civic-connector',$7) returning id`,
    [actor.userId, actor.newsroomId, String(record.normalized.title ?? record.identity.external_id),
      "Captured civic source, awaiting editorial verification. Import does not establish a story or a vote.",
      JSON.stringify([...new Set([record.source_url, ...record.citation_urls])]),
      connectorEvidenceText(record), JSON.stringify({ civicConnector: { evidenceId: id, versionId: row.version_id,
        captureEventId: row.capture_event_id, captureSha256: record.capture_sha256, coverage: row.result_json.coverage } })],
  );
  await sql.query("update civic_connector_evidence set lead_id=$3 where newsroom_id=$1 and id=$2",
    [actor.newsroomId, id, lead!.id]);
  return { leadId: lead!.id, unchanged: false };
}

export async function exportConnectorEvidence(sql: Sql, actor: ConnectorActor, importId: number, format: string) {
  const [row] = await sql.query<{ bundle_key: string; result_json: OperationResult }>(
    "select bundle_key,result_json from civic_connector_imports where newsroom_id=$1 and id=$2",
    [actor.newsroomId, importId],
  );
  if (!row) throw new Error("No saved connector bundle exists in your newsroom.");
  const client = await newsroomConnectorClient(actor);
  return client.execute("export", { bundle_key: row.bundle_key, format, coverage: row.result_json.coverage });
}

export async function connectorWrite(
  sql: Sql, actor: ConnectorActor, sourceId: number,
  action: "plan" | "commit" | "receipt", input: Json,
) {
  owner(actor);
  const config = await configuredConnectorSource(sql, actor, sourceId);
  if (!config?.write_enabled) throw new Error("Provider write operations are not explicitly enabled for this source.");
  const client = await newsroomConnectorClient(actor);
  if (action === "plan") {
    const result = await client.execute("plan_write", { source: config.source_json, changes: input.changes });
    const data = object(result.data);
    const plan = data;
    if (typeof plan.plan_id === "string" && typeof plan.plan_hash === "string") {
      await sql.query(
        `insert into civic_connector_plans(newsroom_id,source_id,plan_id,plan_hash,source_revision,result_json)
         values($1,$2,$3,$4,$5,$6::jsonb) on conflict(newsroom_id,plan_id) do nothing`,
        [actor.newsroomId, sourceId, plan.plan_id, plan.plan_hash, config.revision, JSON.stringify(result)],
      );
    }
    return result;
  }
  const [plan] = await sql.query<{ plan_hash: string; source_revision: number }>(
    "select plan_hash,source_revision from civic_connector_plans where newsroom_id=$1 and source_id=$2 and plan_id=$3",
    [actor.newsroomId, sourceId, input.plan_id],
  );
  if (!plan || plan.source_revision !== config.revision) throw new Error("No current authorized plan exists for this source in your newsroom.");
  if (action === "commit" && (input.approved !== true || input.plan_hash !== plan.plan_hash))
    throw new Error("Explicit approval of the exact saved plan ID and hash is required.");
  const result = await client.execute(action === "commit" ? "commit_write" : "receipt",
    action === "commit" ? { plan_id: input.plan_id, plan_hash: plan.plan_hash } : { plan_id: input.plan_id });
  await sql.query(
    "update civic_connector_plans set receipt_json=$3::jsonb where newsroom_id=$1 and plan_id=$2",
    [actor.newsroomId, input.plan_id, JSON.stringify(result)],
  );
  return result;
}
