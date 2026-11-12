import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { deskMiddleware } from "./desk-auth.ts";
import type { Bounds, OperationResult, RecordEnvelope, Source } from "quorumrelay-client";

export type CivicConnectorDeskData = {
  sources: { id: number; title: string; url: string; source_json: Source | null; bounds_json: Bounds | null; mode: string | null; write_enabled: boolean | null }[];
  evidence: { id: number; source_id: number; import_id: number; record_json: RecordEnvelope; version_id: number | null; capture_event_id: number | null; lead_id: number | null }[];
  runs: { id: number; source_id: number; result_json: OperationResult }[];
  providers: OperationResult | null;
  serviceError: string | null;
  role: string;
};

// The engine intentionally types extension values as unknown. JSON transport
// preserves those values without weakening Start's serializability contract.
export async function decodeConnectorResponse<T>(response: Promise<string>): Promise<T> {
  return JSON.parse(await response) as T;
}

const id = z.number().int().positive();
const source = z.object({
  provider: z.string().min(1).max(100),
  url: z.string().url().max(4000),
  namespace: z.string().max(1000).optional(),
  body: z.string().max(1000).optional(),
  input_format: z.string().max(100).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
}).strict();
const bounds = z.object({
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  max_records: z.number().int().min(1).max(10000).optional(),
  max_pages: z.number().int().min(1).max(100).optional(),
  deadline_seconds: z.number().positive().max(120).optional(),
}).strict();

export const getCivicConnectorDesk = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("../db.ts");
    const integration = await import("./civic-connectors.ts");
    const sql = await getSql();
    const sources = await sql.query<{
      id: number; title: string; url: string; source_json: unknown; mode: string | null;
      write_enabled: boolean | null; bounds_json: unknown;
    }>(
      `select s.id,s.title,s.url,c.source_json,c.mode,c.write_enabled,c.bounds_json
       from sources s left join civic_connector_sources c on c.source_id=s.id and c.newsroom_id=s.newsroom_id
       where s.newsroom_id=$1 and s.status='accepted' order by s.id limit 1000`,
      [context.newsroomId],
    );
    const evidence = await sql.query<{
      id: number; source_id: number; import_id: number; record_json: RecordEnvelope;
      version_id: number | null; capture_event_id: number | null; lead_id: number | null;
    }>(
      `select id,source_id,import_id,record_json,version_id,capture_event_id,lead_id
       from civic_connector_evidence where newsroom_id=$1 order by id desc limit 100`,
      [context.newsroomId],
    );
    const runs = await sql.query<{ id: number; source_id: number; result_json: OperationResult }>(
      "select id,source_id,result_json from civic_connector_runs where newsroom_id=$1 order by id desc limit 10",
      [context.newsroomId],
    );
    let providers: unknown = null;
    let serviceError: string | null = null;
    try {
      const client = await integration.newsroomConnectorClient(context);
      providers = await client.execute("providers", {});
    } catch {
      serviceError = "Connector service is unavailable or not configured for this newsroom. Check the pinned service and server-side credentials.";
    }
    return JSON.stringify({ sources, evidence, runs, providers, serviceError, role: context.role });
  });

export const configureCivicConnectorSource = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => z.object({
    sourceId: id, source, bounds: bounds.optional(),
    mode: z.enum(["live", "saved"]), writeEnabled: z.boolean().default(false),
  }).strict().parse(input))
  .handler(async ({ context, data }) => {
    const integration = await import("./civic-connectors.ts");
    if (context.role !== "owner") throw new Error("Only the owner can configure provider operations.");
    const client = await integration.newsroomConnectorClient(context);
    const validation = await client.execute("validate_source", { source: data.source });
    if (validation.status !== "completed") return JSON.stringify({ saved: false, result: validation });
    const { getSql } = await import("../db.ts");
    const saved = await integration.saveConnectorSource(await getSql(), context, data.sourceId, data.source, data);
    return JSON.stringify({ ...saved, result: validation });
  });

export const readCivicConnectorSource = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => z.object({
    sourceId: id, contentBase64: z.string().max(22_369_624).optional(),
    preview: z.boolean().optional(), operation: z.enum(["discover", "fetch"]).optional(),
    fetchFields: z.object({ api_resource: z.string().max(100).optional(), external_id: z.string().max(1000).optional(),
      offset: z.number().int().nonnegative().optional(), filters: z.record(z.string(), z.unknown()).optional() }).strict().optional(),
  }).strict().parse(input))
  .handler(async ({ context, data }) => {
    const integration = await import("./civic-connectors.ts");
    const response = await integration.runConnectorRead(context, data.sourceId, data);
    return JSON.stringify({ ...response, result: integration.connectorResultReference(response.result) });
  });

export const searchCivicConnectorEvidence = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => z.object({
    sourceId: id,
    terms: z.array(z.string().min(1).max(500)).max(20).default([]),
    phrases: z.array(z.string().min(1).max(500)).max(20).default([]),
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    body: z.string().max(500).optional(),
    record_types: z.array(z.string().max(100)).max(10).optional(),
  }).strict().parse(input))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("../db.ts");
    const integration = await import("./civic-connectors.ts");
    const sql = await getSql();
    if (!await integration.configuredConnectorSource(sql, context, data.sourceId))
      throw new Error("Configure this connector source first.");
    const rows = await sql.query<{ record_json: RecordEnvelope }>(
      "select distinct on(identity_key) record_json from civic_connector_evidence where newsroom_id=$1 and source_id=$2 order by identity_key,id desc",
      [context.newsroomId, data.sourceId],
    );
    const [latest] = await sql.query<{ result_json: OperationResult }>(
      "select result_json from civic_connector_imports where newsroom_id=$1 and source_id=$2 order by id desc limit 1",
      [context.newsroomId, data.sourceId],
    );
    const client = await integration.newsroomConnectorClient(context);
    const { sourceId: _source, ...query } = data;
    return JSON.stringify(await client.execute("search", { records: rows.map((row) => row.record_json), query,
      coverage: { ...latest?.result_json.coverage, status: latest?.result_json.status ?? "partial",
        ...(!latest ? { failures: ["No captured source is available."], available_text: [] } : {}) } }));
  });

export const reopenCivicConnectorEvidence = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => id.parse(input))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("../db.ts");
    const { readConnectorEvidence } = await import("./civic-connectors.ts");
    return JSON.stringify(await readConnectorEvidence(await getSql(), context, data));
  });

export const fileCivicConnectorLead = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => id.parse(input))
  .handler(async ({ context, data }) => {
    const { withTransaction } = await import("../db.ts");
    const { fileConnectorEvidenceLead } = await import("./civic-connectors.ts");
    return withTransaction((sql) => fileConnectorEvidenceLead(sql, context, data));
  });

export const exportCivicConnectorEvidence = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => z.object({
    importId: id, format: z.enum(["json", "jsonl", "zip", "csv", "icalendar"]),
  }).strict().parse(input))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("../db.ts");
    const { exportConnectorEvidence } = await import("./civic-connectors.ts");
    return JSON.stringify(await exportConnectorEvidence(await getSql(), context, data.importId, data.format));
  });

export const writeCivicConnectorSource = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => z.object({
    sourceId: id, action: z.enum(["plan", "commit", "receipt"]),
    input: z.record(z.string(), z.unknown()),
  }).strict().parse(input))
  .handler(async ({ context, data }) => {
    if (JSON.stringify(data.input).length > 200_000) throw new Error("Provider write plan input is too large.");
    const { getSql } = await import("../db.ts");
    const { connectorWrite } = await import("./civic-connectors.ts");
    return JSON.stringify(await connectorWrite(await getSql(), context, data.sourceId, data.action, data.input));
  });
