import { createHash } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { rememberCapture } from "./investigate.ts";

const httpUrl = z.string().url().refine(value => ["http:", "https:"].includes(new URL(value).protocol));
export const townrecordPackage = z.object({
  schema: z.literal("townrecord-evidence-v1"),
  instance_id: z.string().regex(/^[a-f0-9]{32}$/),
  meeting_id: z.number().int().positive(),
  revision: z.number().int().positive(),
  public_url: httpUrl,
  evidence: z.object({
    detail: z.object({ meeting: z.object({
      title: z.string().min(1).max(2000),
    }).passthrough() }).passthrough(),
  }).passthrough(),
}).strict();

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]),
  );
  return value;
}

/** No network fetch or model call. The supplied evidence remains an attributed
 * capture, and an editor must decide whether it supports a story. */
export async function receiveTownrecordEvidence(
  sql: Sql, actor: { userId: string; newsroomId: number; role: string }, input: unknown,
) {
  if (!["owner", "editor"].includes(actor.role)) throw new Error("Newsroom editor access is required.");
  if (JSON.stringify(input).length > 2_000_000) throw new Error("TownRecord package exceeds 2 MB.");
  const data = townrecordPackage.parse(input);
  const encoded = JSON.stringify(canonical(data));
  const hash = createHash("sha256").update(encoded).digest("hex");
  const key = [actor.newsroomId, data.instance_id, data.meeting_id, data.revision];
  // The caller supplies one transaction; this insert serializes concurrent retries.
  await sql.query(`insert into townrecord_handoffs
    (newsroom_id,instance_id,meeting_id,revision,package_hash,package_json)
    values($1,$2,$3,$4,$5,$6::jsonb) on conflict do nothing`, [...key, hash, encoded]);
  const [saved] = await sql.query<{ package_hash: string; lead_id: number | null }>(
    `select package_hash,lead_id from townrecord_handoffs
     where newsroom_id=$1 and instance_id=$2 and meeting_id=$3 and revision=$4 for update`, key,
  );
  if (saved!.package_hash !== hash) throw new Error("This meeting revision already has different evidence. Export a new reviewed revision.");
  if (saved!.lead_id) return { leadId: saved!.lead_id, unchanged: true };
  const title = data.evidence.detail.meeting.title;
  const text = `TownRecord reviewed meeting record, revision ${data.revision}.\n` +
    `Supplied by an operator; verify against the original sources before publication.\n` +
    `Community record: ${data.public_url}\n\n${JSON.stringify(data.evidence, null, 2)}`;
  const citations = new Set<string>([data.public_url]);
  function collect(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["citation_url", "source_url", "url"].includes(key) && typeof child === "string" && httpUrl.safeParse(child).success) citations.add(child);
      else if (child && typeof child === "object") collect(child);
    }
  }
  collect(data.evidence);
  const capture = await rememberCapture({
    sql, userId: actor.userId, newsroomId: actor.newsroomId, investigationId: null,
    url: data.public_url, title, text, hash, status: 200, outcome: "fetched",
    contentType: "application/json", extractionMethod: "townrecord:operator-supplied-reviewed-snapshot",
    observedAt: new Date(), triggerKind: "townrecord-handoff", autoWatch: false,
  });
  const [lead] = await sql.query<{ id: number }>(
    `insert into leads(user_id,newsroom_id,headline,why,source_urls,evidence,status,origin,notes_json)
     values($1,$2,$3,$4,$5,$6,'new','townrecord',$7) returning id`,
    [actor.userId, actor.newsroomId, title, "Community meeting evidence awaiting editorial review.",
      JSON.stringify([...citations]), text, JSON.stringify({ townrecord: {
        instanceId: data.instance_id, meetingId: data.meeting_id, revision: data.revision,
        packageHash: hash, versionId: capture.versionId, captureEventId: capture.captureEventId,
      } })],
  );
  await sql.query(`update townrecord_handoffs set lead_id=$5,version_id=$6,capture_event_id=$7
    where newsroom_id=$1 and instance_id=$2 and meeting_id=$3 and revision=$4`,
    [...key, lead!.id, capture.versionId, capture.captureEventId]);
  return { leadId: lead!.id, unchanged: false };
}
