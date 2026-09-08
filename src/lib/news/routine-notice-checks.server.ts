import { ensureSchemaOnce, getSql, withTransaction, type Sql } from "../db.ts";
import { sha256, sha256Bytes } from "./fetch-url.ts";
import { canonicalPublicUrl } from "./fetch-outcome.ts";
import { ingestDocument, type IngestDocument } from "./ingest.ts";
import { rememberCapture } from "./investigate.ts";
import { ensureLegalSchema } from "./legal-removal-schema.ts";
import { extractJsonLdEvents, type RoutineExtractionResult } from "./routine-notice-extract.ts";
import type {
  CheckRoutineNoticeInput,
  RoutineNoticeCandidateView,
  RoutineNoticeCheckErrorCode,
  RoutineNoticeCheckGroup,
} from "./routine-notice-checks.ts";
import {
  ROUTINE_NOTICE_FORMAT_KEYS,
  type RoutineNoticeFormatKey,
  type StructurallyValidRoutineNotice,
} from "./routine-notice-types.ts";

const ADAPTER_KEY = "schema-event-jsonld";
const ADAPTER_VERSION = 1;
const MAX_CAPTURE_TEXT = 512 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED = new Set<RoutineNoticeFormatKey>([
  "library-notice",
  "parks-recreation-notice",
  "community-arts-event-logistics",
]);
const FORMAT_KEYS = new Set<string>(ROUTINE_NOTICE_FORMAT_KEYS);

function captureUrlIdentity(url: string) {
  try {
    return canonicalPublicUrl(url);
  } catch {
    return url;
  }
}

export class RoutineNoticeCheckError extends Error {
  readonly code: RoutineNoticeCheckErrorCode;
  constructor(code: RoutineNoticeCheckErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const DDL = [
  `create table if not exists routine_notice_checks(id serial primary key,newsroom_id integer not null references newsrooms(id) on delete cascade,request_id uuid not null,source_id integer not null references sources(id) on delete cascade,source_url_hash text not null,format_key text not null check(format_key in ('library-notice','parks-recreation-notice','community-arts-event-logistics','registration-deadline','waste-recycling-schedule','public-meeting-logistics')),policy_revision integer not null,capture_event_id integer references capture_events(id) on delete cascade,artifact_version_id integer references artifact_versions(id) on delete cascade,artifact_blob_id integer references artifact_blobs(id) on delete cascade,captured_content_hash text,captured_text_digest text,raw_blob_sha256 text,adapter_key text not null,adapter_version integer not null,state text not null check(state in ('parsed','parsed-with-conflicts','refused','capture-failed')),refusal_summary_json text not null default '[]',actor text not null,created_at timestamptz not null default now(),unique(newsroom_id,request_id))`,
  `create table if not exists routine_notice_candidate_refs(id serial primary key,check_id integer not null references routine_notice_checks(id) on delete cascade,ordinal integer not null check(ordinal>=0),external_id_hash text not null,content_fingerprint text not null,outcome text not null check(outcome in ('parsed','conflict')),unique(check_id,ordinal))`,
  `create index if not exists routine_notice_checks_room_source_idx on routine_notice_checks(newsroom_id,source_id,format_key,id desc)`,
  `create index if not exists routine_notice_candidate_identity_idx on routine_notice_candidate_refs(external_id_hash,content_fingerprint)`,
  `create or replace function prevent_routine_notice_check_resurrection()
   returns trigger language plpgsql as $$
   begin
     if exists (
       select 1 from legal_removal_urls u
       left join sources s on s.id=NEW.source_id and s.newsroom_id=NEW.newsroom_id
       left join capture_events ce on ce.id=NEW.capture_event_id and ce.newsroom_id=NEW.newsroom_id
       left join artifact_versions av on av.id=NEW.artifact_version_id and av.newsroom_id=NEW.newsroom_id
       left join artifact_blobs ab on ab.id=NEW.artifact_blob_id and ab.newsroom_id=NEW.newsroom_id
       where u.newsroom_id=NEW.newsroom_id and u.url_hash in (
         md5(legal_article_url_identity(s.url)), md5(legal_article_url_identity(ce.source_url)),
         md5(legal_article_url_identity(av.url)), md5(legal_article_url_identity(ab.original_url))
       )
     ) then raise exception 'This routine notice evidence is covered by a legal removal.'; end if;
     return NEW;
   end $$`,
  `drop trigger if exists routine_notice_checks_legal_guard on routine_notice_checks`,
  `create trigger routine_notice_checks_legal_guard before insert or update on routine_notice_checks
   for each row execute function prevent_routine_notice_check_resurrection()`,
];

export async function ensureRoutineNoticeCheckSchema() {
  await ensureLegalSchema();
  const sql = await getSql();
  await ensureSchemaOnce(sql, "routine-notice-checks-0053", DDL);
}

type Actor = { userId: string; newsroomId: number };
type CheckInput = CheckRoutineNoticeInput;
type SourceRow = { id: number; title: string; url: string; status: string };

function cleanCheckInput(raw: unknown): CheckInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RoutineNoticeCheckError("invalid-input", "Routine notice check input was malformed.");
  }
  const value = raw as Record<string, unknown>;
  if (
    !UUID.test(typeof value.requestId === "string" ? value.requestId : "") ||
    !Number.isSafeInteger(value.sourceId) ||
    Number(value.sourceId) < 1 ||
    typeof value.sourceUrl !== "string" ||
    !value.sourceUrl.trim() ||
    value.sourceUrl.length > 4000 ||
    typeof value.formatKey !== "string" ||
    !FORMAT_KEYS.has(value.formatKey) ||
    !Number.isSafeInteger(value.expectedPolicyRevision) ||
    Number(value.expectedPolicyRevision) < 0
  ) {
    throw new RoutineNoticeCheckError("invalid-input", "Routine notice check input was malformed.");
  }
  return {
    requestId: String(value.requestId),
    sourceId: Number(value.sourceId),
    sourceUrl: value.sourceUrl,
    formatKey: value.formatKey as RoutineNoticeFormatKey,
    expectedPolicyRevision: Number(value.expectedPolicyRevision),
  };
}

function cleanListInput(raw: unknown) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  if (
    (value.sourceId !== undefined &&
      (!Number.isSafeInteger(value.sourceId) || Number(value.sourceId) < 1)) ||
    (value.formatKey !== undefined &&
      (typeof value.formatKey !== "string" || !FORMAT_KEYS.has(value.formatKey)))
  ) {
    throw new RoutineNoticeCheckError("invalid-input", "Routine notice check filters were malformed.");
  }
  return {
    sourceId: value.sourceId === undefined ? null : Number(value.sourceId),
    formatKey:
      value.formatKey === undefined ? null : (value.formatKey as RoutineNoticeFormatKey),
  };
}

async function assertOwner(sql: Sql, actor: Actor, lock = false) {
  const rows = await sql.query<{ role: string }>(
    `select role from newsroom_members where user_id=$1 and newsroom_id=$2${lock ? " for update" : ""}`,
    [actor.userId, actor.newsroomId],
  );
  if (rows[0]?.role !== "owner") {
    throw new RoutineNoticeCheckError(
      "forbidden",
      "Only the current newsroom owner can check routine notice sources.",
    );
  }
}

async function approvedSource(
  sql: Sql,
  actor: Actor,
  input: CheckInput,
  lock = false,
): Promise<{ source: SourceRow; paused: boolean; revision: number }> {
  const rows = await sql.query<SourceRow & { paused: boolean; revision: number; approved_url: string }>(
    `select s.id,s.title,s.url,s.status,p.paused,p.revision,a.source_url approved_url
       from routine_notice_policies p
       join routine_notice_approvals a on a.newsroom_id=p.newsroom_id and a.source_id=$2 and a.format_key=$3
       join sources s on s.id=a.source_id and s.newsroom_id=a.newsroom_id
      where p.newsroom_id=$1${lock ? " for update of p,a,s" : ""}`,
    [actor.newsroomId, input.sourceId, input.formatKey],
  );
  const row = rows[0];
  if (!row) {
    throw new RoutineNoticeCheckError("approval-invalid", "That source and format are not approved.");
  }
  if (row.paused) {
    throw new RoutineNoticeCheckError("policy-paused", "Routine notice checks are paused.");
  }
  if (row.revision !== input.expectedPolicyRevision) {
    throw new RoutineNoticeCheckError("conflict", "Routine notice permissions changed. Reload first.");
  }
  if (row.status !== "accepted" || row.url !== row.approved_url || row.url !== input.sourceUrl) {
    throw new RoutineNoticeCheckError(
      "approval-invalid",
      "The accepted source address changed. Review permissions before checking.",
    );
  }
  return { source: row, paused: row.paused, revision: row.revision };
}

function rawHtml(document: IngestDocument) {
  if (
    !document.rawBytes ||
    !/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(document.contentType) ||
    document.status < 200 ||
    document.status >= 300 ||
    document.outcome === "soft-404"
  ) {
    return null;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(document.rawBytes);
}

function adapterResults(
  html: string,
  input: CheckInput,
  actor: Actor,
  provenance: { captureEventId: number; artifactVersionId: number; contentHash: string },
) {
  const results = extractJsonLdEvents(html, {
    formatKey: input.formatKey as
      | "library-notice"
      | "parks-recreation-notice"
      | "community-arts-event-logistics",
    provenance: {
      newsroomId: actor.newsroomId,
      sourceId: input.sourceId,
      sourceUrl: input.sourceUrl,
      policyRevision: input.expectedPolicyRevision,
      captureEventId: provenance.captureEventId,
      artifactVersionId: provenance.artifactVersionId,
      contentHash: provenance.contentHash,
    },
  });
  return results.length
    ? results
    : ([
        { status: "refused", code: "structurally-invalid", locator: "document" },
      ] satisfies RoutineExtractionResult[]);
}

function parsedNotice(result: RoutineExtractionResult): StructurallyValidRoutineNotice | null {
  return result.status === "parsed" && result.validation.valid ? result.validation.notice : null;
}

async function contentFingerprint(notice: StructurallyValidRoutineNotice) {
  return sha256(
    JSON.stringify({
      formatKey: notice.formatKey,
      variant: notice.variant,
      fields: Object.fromEntries(
        Object.entries(notice.normalizedFields).sort(([left], [right]) => left.localeCompare(right)),
      ),
    }),
  );
}

function refusalSummary(results: RoutineExtractionResult[]) {
  const grouped = new Map<string, { code: string; locator: string; count: number }>();
  for (const result of results) {
    if (result.status !== "refused") continue;
    const key = `${result.code}\u0000${result.locator}`;
    const prior = grouped.get(key);
    if (prior) prior.count += 1;
    else grouped.set(key, { code: result.code, locator: result.locator, count: 1 });
  }
  return [...grouped.values()].slice(0, 100);
}

export type RoutineNoticeCheckDeps = {
  ingest?: typeof ingestDocument;
  beforeCommit?: () => Promise<void>;
};

export async function checkRoutineNoticeSourceForOwner(
  actor: Actor,
  raw: unknown,
  deps: RoutineNoticeCheckDeps = {},
): Promise<{ ok: true; check: RoutineNoticeCheckGroup }> {
  const input = cleanCheckInput(raw);
  if (!SUPPORTED.has(input.formatKey)) {
    throw new RoutineNoticeCheckError(
      "adapter-unavailable",
      "This approved format does not have a captured-data adapter yet.",
    );
  }
  await ensureRoutineNoticeCheckSchema();
  const sql = await getSql();
  await assertOwner(sql, actor);
  await approvedSource(sql, actor, input);
  const requestedUrlHash = await sha256(input.sourceUrl);
  const priorReplay = await sql.query<{
    id: number;
    source_id: number;
    source_url_hash: string;
    format_key: string;
    policy_revision: number;
  }>(
    "select id,source_id,source_url_hash,format_key,policy_revision from routine_notice_checks where newsroom_id=$1 and request_id=$2",
    [actor.newsroomId, input.requestId],
  );
  if (priorReplay[0]) {
    if (
      priorReplay[0].source_id !== input.sourceId ||
      priorReplay[0].source_url_hash !== requestedUrlHash ||
      priorReplay[0].format_key !== input.formatKey ||
      priorReplay[0].policy_revision !== input.expectedPolicyRevision
    ) {
      throw new RoutineNoticeCheckError("conflict", "That request ID belongs to another check.");
    }
    return { ok: true, check: await loadCheck(sql, actor, priorReplay[0].id) };
  }
  const document = await (deps.ingest ?? ingestDocument)(input.sourceUrl, {
    acceptRawHtml: (html) =>
      extractJsonLdEvents(html, {
        formatKey: input.formatKey as
          | "library-notice"
          | "parks-recreation-notice"
          | "community-arts-event-logistics",
        provenance: {
          newsroomId: actor.newsroomId,
          sourceId: input.sourceId,
          sourceUrl: input.sourceUrl,
          policyRevision: input.expectedPolicyRevision,
          captureEventId: 1,
          artifactVersionId: 1,
          contentHash: "preflight",
        },
      }).length > 0,
  });
  await deps.beforeCommit?.();
  const html = rawHtml(document);

  const checkId = await withTransaction(async (tx) => {
    await assertOwner(tx, actor, true);
    const { source } = await approvedSource(tx, actor, input, true);
    const replay = await tx.query<{
      id: number;
      source_id: number;
      source_url_hash: string;
      format_key: string;
      policy_revision: number;
    }>(
      "select id,source_id,source_url_hash,format_key,policy_revision from routine_notice_checks where newsroom_id=$1 and request_id=$2",
      [actor.newsroomId, input.requestId],
    );
    if (replay[0]) {
      if (
        replay[0].source_id !== input.sourceId ||
        replay[0].source_url_hash !== requestedUrlHash ||
        replay[0].format_key !== input.formatKey ||
        replay[0].policy_revision !== input.expectedPolicyRevision
      ) {
        throw new RoutineNoticeCheckError("conflict", "That request ID belongs to another check.");
      }
      return replay[0].id;
    }

    const preliminary = html
      ? adapterResults(html, input, actor, {
          captureEventId: 1,
          artifactVersionId: 1,
          contentHash: "preflight",
        })
      : [];
    const hasParsed = preliminary.some((result) => parsedNotice(result));
    const outcome = html ? (hasParsed ? "fetched" : "parse-failed") : document.outcome;
    const capture = await rememberCapture({
      sql: tx,
      userId: actor.userId,
      newsroomId: actor.newsroomId,
      investigationId: null,
      url: source.url,
      title: document.title || source.title,
      text: document.text,
      hash: "",
      status: document.status,
      outcome,
      triggerKind: "routine-notice-check",
      redirectChain: document.redirectChain,
      contentType: document.contentType,
      extractionMethod: html ? "routine-jsonld" : document.extractionMethod,
      rawBytes: document.rawBytes,
      extras: [],
      autoWatch: false,
    });
    if (!html || !capture.versionId || !document.rawBytes) {
      const created = await tx.query<{ id: number }>(
        `insert into routine_notice_checks(newsroom_id,request_id,source_id,source_url_hash,format_key,policy_revision,capture_event_id,artifact_version_id,adapter_key,adapter_version,state,refusal_summary_json,actor)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'capture-failed',$11,$12) returning id`,
        [
          actor.newsroomId,
          input.requestId,
          input.sourceId,
          requestedUrlHash,
          input.formatKey,
          input.expectedPolicyRevision,
          capture.captureEventId,
          capture.versionId,
          ADAPTER_KEY,
          ADAPTER_VERSION,
          JSON.stringify([{ code: "capture-failed", locator: "document", count: 1 }]),
          actor.userId,
        ],
      );
      await writeAudit(tx, actor, created[0]!.id, "capture-failed");
      return created[0]!.id;
    }

    const rawHash = await sha256Bytes(document.rawBytes);
    const versions = await tx.query<{
      id: number;
      url: string;
      content_hash: string;
      full_text: string;
      title: string;
    }>(
      "select id,url,content_hash,full_text,title from artifact_versions where id=$1 and newsroom_id=$2",
      [capture.versionId, actor.newsroomId],
    );
    const events = await tx.query<{
      id: number;
      source_url: string;
      version_id: number | null;
      content_hash: string | null;
      observed_at: string;
    }>(
      "select id,source_url,version_id,content_hash,observed_at from capture_events where id=$1 and newsroom_id=$2",
      [capture.captureEventId, actor.newsroomId],
    );
    const blobs = await tx.query<{
      id: number;
      version_id: number;
      sha256: string;
      original_url: string;
      byte_length: number;
      body_b64: string;
    }>(
      "select id,version_id,sha256,original_url,byte_length,body_b64 from artifact_blobs where version_id=$1 and newsroom_id=$2 and sha256=$3 order by id",
      [capture.versionId, actor.newsroomId, rawHash],
    );
    const version = versions[0];
    const event = events[0];
    const sourceCaptureUrl = captureUrlIdentity(source.url);
    const exactBlobs = blobs.filter(
      (blob) =>
        captureUrlIdentity(blob.original_url) === sourceCaptureUrl &&
        blob.byte_length === document.rawBytes!.byteLength &&
        Buffer.from(blob.body_b64, "base64").equals(Buffer.from(document.rawBytes!)),
    );
    if (
      !version ||
      !event ||
      exactBlobs.length !== 1 ||
      captureUrlIdentity(version.url) !== sourceCaptureUrl ||
      version.content_hash !== rawHash ||
      captureUrlIdentity(event.source_url) !== sourceCaptureUrl ||
      event.version_id !== version.id ||
      event.content_hash !== rawHash
    ) {
      throw new RoutineNoticeCheckError("conflict", "Captured evidence changed before it was recorded.");
    }
    const results = adapterResults(html, input, actor, {
      captureEventId: event.id,
      artifactVersionId: version.id,
      contentHash: rawHash,
    });
    const candidates = [] as Array<{
      ordinal: number;
      externalIdHash: string;
      contentFingerprint: string;
      conflict: boolean;
    }>;
    for (let ordinal = 0; ordinal < results.length; ordinal += 1) {
      const notice = parsedNotice(results[ordinal]!);
      if (!notice) continue;
      const externalIdHash = await sha256(notice.provenance.externalId);
      const fingerprint = await contentFingerprint(notice);
      if (
        candidates.some(
          (candidate) =>
            candidate.externalIdHash === externalIdHash &&
            candidate.contentFingerprint === fingerprint,
        )
      ) continue;
      candidates.push({ ordinal, externalIdHash, contentFingerprint: fingerprint, conflict: false });
    }
    for (const externalIdHash of new Set(candidates.map((candidate) => candidate.externalIdHash))) {
      const prior = await tx.query<{ content_fingerprint: string }>(
        `select r.content_fingerprint from routine_notice_candidate_refs r join routine_notice_checks c on c.id=r.check_id
          where c.newsroom_id=$1 and c.source_id=$2 and c.format_key=$3 and r.external_id_hash=$4`,
        [actor.newsroomId, input.sourceId, input.formatKey, externalIdHash],
      );
      const current = candidates.filter((candidate) => candidate.externalIdHash === externalIdHash);
      const fingerprints = new Set([
        ...prior.map((candidate) => candidate.content_fingerprint),
        ...current.map((candidate) => candidate.contentFingerprint),
      ]);
      if (fingerprints.size > 1) {
        for (const candidate of current) candidate.conflict = true;
      }
    }
    const conflicts = candidates.filter((candidate) => candidate.conflict).length;
    const state = candidates.length
      ? conflicts
        ? "parsed-with-conflicts"
        : "parsed"
      : "refused";
    const refusals = refusalSummary(results);
    const created = await tx.query<{ id: number }>(
      `insert into routine_notice_checks(newsroom_id,request_id,source_id,source_url_hash,format_key,policy_revision,capture_event_id,artifact_version_id,artifact_blob_id,captured_content_hash,captured_text_digest,raw_blob_sha256,adapter_key,adapter_version,state,refusal_summary_json,actor)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,$12,$13,$14,$15,$16) returning id`,
      [
        actor.newsroomId,
        input.requestId,
        input.sourceId,
        requestedUrlHash,
        input.formatKey,
        input.expectedPolicyRevision,
        event.id,
        version.id,
        exactBlobs[0]!.id,
        rawHash,
        await sha256(version.full_text),
        ADAPTER_KEY,
        ADAPTER_VERSION,
        state,
        JSON.stringify(refusals),
        actor.userId,
      ],
    );
    for (const candidate of candidates) {
      await tx.query(
        `insert into routine_notice_candidate_refs(check_id,ordinal,external_id_hash,content_fingerprint,outcome)
         values($1,$2,$3,$4,$5)`,
        [
          created[0]!.id,
          candidate.ordinal,
          candidate.externalIdHash,
          candidate.contentFingerprint,
          candidate.conflict ? "conflict" : "parsed",
        ],
      );
    }
    await writeAudit(tx, actor, created[0]!.id, state);
    return created[0]!.id;
  });
  return { ok: true, check: await loadCheck(await getSql(), actor, checkId) };
}

async function writeAudit(sql: Sql, actor: Actor, checkId: number, state: string) {
  await sql.query(
    `insert into audit_events(user_id,action,detail,newsroom_id,subject_kind,subject_id)
     values($1,'routine-notice-check',$2,$3,'routine-notice-check',$4)`,
    [actor.userId, `Manual structural check: ${state}`, actor.newsroomId, checkId],
  );
}

type CheckRow = {
  id: number;
  source_id: number;
  source_url_hash: string;
  source_title: string;
  source_url: string;
  source_status: string;
  format_key: RoutineNoticeFormatKey;
  policy_revision: number;
  capture_event_id: number | null;
  artifact_version_id: number | null;
  artifact_blob_id: number | null;
  captured_content_hash: string | null;
  captured_text_digest: string | null;
  raw_blob_sha256: string | null;
  adapter_key: string;
  adapter_version: number;
  state: RoutineNoticeCheckGroup["state"];
  refusal_summary_json: string;
  created_at: string;
  observed_at: string | null;
  current_revision: number | null;
  paused: boolean | null;
  approved_url: string | null;
};

async function checkRow(sql: Sql, actor: Actor, checkId: number) {
  const rows = await sql.query<CheckRow>(
    `select c.*,s.title source_title,s.url source_url,s.status source_status,ce.observed_at,
            p.revision current_revision,p.paused,a.source_url approved_url
       from routine_notice_checks c
       join sources s on s.id=c.source_id and s.newsroom_id=c.newsroom_id
       left join capture_events ce on ce.id=c.capture_event_id and ce.newsroom_id=c.newsroom_id
       left join routine_notice_policies p on p.newsroom_id=c.newsroom_id
       left join routine_notice_approvals a on a.newsroom_id=c.newsroom_id and a.source_id=c.source_id and a.format_key=c.format_key
      where c.id=$1 and c.newsroom_id=$2`,
    [checkId, actor.newsroomId],
  );
  if (!rows[0]) throw new RoutineNoticeCheckError("not-found", "Routine notice check not found.");
  return rows[0];
}

async function boundRawEvidence(sql: Sql, actor: Actor, row: CheckRow) {
  if (!row.capture_event_id || !row.artifact_version_id || !row.artifact_blob_id) return null;
  if ((await sha256(row.source_url)) !== row.source_url_hash) return null;
  const rows = await sql.query<{
    event_url: string;
    event_version_id: number | null;
    event_hash: string | null;
    version_url: string;
    version_hash: string;
    full_text: string;
    title: string;
    blob_version_id: number;
    blob_hash: string;
    blob_url: string;
    byte_length: number;
    body_b64: string;
  }>(
    `select ce.source_url event_url,ce.version_id event_version_id,ce.content_hash event_hash,
            av.url version_url,av.content_hash version_hash,av.full_text,av.title,
            ab.version_id blob_version_id,ab.sha256 blob_hash,ab.original_url blob_url,ab.byte_length,ab.body_b64
       from capture_events ce
       join artifact_versions av on av.id=$2 and av.newsroom_id=ce.newsroom_id
       join artifact_blobs ab on ab.id=$3 and ab.newsroom_id=ce.newsroom_id
      where ce.id=$1 and ce.newsroom_id=$4`,
    [row.capture_event_id, row.artifact_version_id, row.artifact_blob_id, actor.newsroomId],
  );
  const evidence = rows[0];
  if (!evidence) return null;
  const bytes = Buffer.from(evidence.body_b64, "base64");
  const rawHash = await sha256Bytes(bytes);
  const sourceCaptureUrl = captureUrlIdentity(row.source_url);
  if (
    captureUrlIdentity(evidence.event_url) !== sourceCaptureUrl ||
    captureUrlIdentity(evidence.version_url) !== sourceCaptureUrl ||
    captureUrlIdentity(evidence.blob_url) !== sourceCaptureUrl ||
    evidence.event_version_id !== row.artifact_version_id ||
    evidence.blob_version_id !== row.artifact_version_id ||
    evidence.event_hash !== row.captured_content_hash ||
    evidence.version_hash !== row.captured_content_hash ||
    evidence.blob_hash !== row.raw_blob_sha256 ||
    rawHash !== row.raw_blob_sha256 ||
    bytes.byteLength !== evidence.byte_length ||
    (await sha256(evidence.full_text)) !== row.captured_text_digest
  ) return null;
  return { ...evidence, bytes, html: new TextDecoder().decode(bytes) };
}

async function loadCheck(sql: Sql, actor: Actor, checkId: number): Promise<RoutineNoticeCheckGroup> {
  await assertOwner(sql, actor);
  const row = await checkRow(sql, actor, checkId);
  const refs = await sql.query<{
    id: number;
    ordinal: number;
    external_id_hash: string;
    content_fingerprint: string;
    outcome: string;
  }>("select id,ordinal,external_id_hash,content_fingerprint,outcome from routine_notice_candidate_refs where check_id=$1 order by ordinal", [checkId]);
  const evidence = await boundRawEvidence(sql, actor, row);
  const candidates: RoutineNoticeCandidateView[] = [];
  let state = row.state;
  if (evidence && row.adapter_key === ADAPTER_KEY && row.adapter_version === ADAPTER_VERSION) {
    const input: CheckInput = {
      requestId: "00000000-0000-4000-8000-000000000000",
      sourceId: row.source_id,
      sourceUrl: row.source_url,
      formatKey: row.format_key,
      expectedPolicyRevision: row.policy_revision,
    };
    const results = adapterResults(evidence.html, input, actor, {
      captureEventId: row.capture_event_id!,
      artifactVersionId: row.artifact_version_id!,
      contentHash: row.captured_content_hash!,
    });
    for (const ref of refs) {
      const result = results[ref.ordinal];
      const notice = result ? parsedNotice(result) : null;
      if (!notice || (await sha256(notice.provenance.externalId)) !== ref.external_id_hash ||
          (await contentFingerprint(notice)) !== ref.content_fingerprint) {
        state = "evidence-unavailable";
        candidates.length = 0;
        break;
      }
      candidates.push({
        id: ref.id,
        externalIdHash: ref.external_id_hash,
        formatKey: notice.formatKey,
        variant: notice.variant,
        fields: notice.fields,
        conflict: ref.outcome === "conflict",
      });
    }
  } else if (row.artifact_blob_id) {
    state = "evidence-unavailable";
  }
  const refusals = (() => {
    try {
      return JSON.parse(row.refusal_summary_json) as Array<{ code: string; locator: string; count: number }>;
    } catch {
      return [{ code: "invalid-receipt", locator: "check", count: 1 }];
    }
  })();
  const conflicts = refs.filter((ref) => ref.outcome === "conflict").length;
  const newer = row.capture_event_id
    ? await sql.query<{ found: boolean }>(
        "select exists(select 1 from capture_events where newsroom_id=$1 and source_url=$2 and id>$3) found",
        [actor.newsroomId, captureUrlIdentity(row.source_url), row.capture_event_id],
      )
    : [{ found: false }];
  const approvalValid =
    row.approved_url === row.source_url && row.source_status === "accepted" && !row.paused;
  return {
    checkId: row.id,
    source: {
      id: row.source_id,
      title: row.source_title,
      url: row.source_url,
      sourceHref: "/desk/sources",
    },
    formatKey: row.format_key,
    checkedAt: String(row.created_at),
    capture: row.capture_event_id
      ? {
          captureEventId: row.capture_event_id,
          artifactVersionId: row.artifact_version_id,
          observedAt: String(row.observed_at),
          evidenceHref: null,
          textAvailable: Boolean(evidence),
        }
      : null,
    state,
    counts: { parsed: candidates.length, refused: refusals.reduce((n, item) => n + item.count, 0), conflicts },
    refusals,
    candidates,
    newerCaptureAvailable: Boolean(newer[0]?.found),
    policy: { revision: row.current_revision ?? 0, paused: Boolean(row.paused), approvalValid },
    canCheck: approvalValid,
  };
}

export async function listRoutineNoticeChecksForOwner(actor: Actor, raw: unknown) {
  const filter = cleanListInput(raw);
  await ensureRoutineNoticeCheckSchema();
  const sql = await getSql();
  await assertOwner(sql, actor);
  const rows = await sql.query<{ id: number }>(
    `select id from routine_notice_checks where newsroom_id=$1
      and ($2::integer is null or source_id=$2) and ($3::text is null or format_key=$3)
      order by id desc limit 20`,
    [actor.newsroomId, filter.sourceId, filter.formatKey],
  );
  return Promise.all(rows.map((row) => loadCheck(sql, actor, row.id)));
}

export async function readRoutineNoticeCapturedTextForOwner(actor: Actor, raw: unknown) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  if (!Number.isSafeInteger(value.checkId) || Number(value.checkId) < 1) {
    throw new RoutineNoticeCheckError("not-found", "Routine notice check not found.");
  }
  await ensureRoutineNoticeCheckSchema();
  const sql = await getSql();
  await assertOwner(sql, actor);
  const row = await checkRow(sql, actor, Number(value.checkId));
  const evidence = await boundRawEvidence(sql, actor, row);
  if (!evidence) {
    throw new RoutineNoticeCheckError("conflict", "Captured evidence changed or is unavailable.");
  }
  const full = evidence.html;
  return {
    title: evidence.title || null,
    url: row.source_url,
    capturedAt: row.observed_at ? String(row.observed_at) : null,
    fullText: full.slice(0, MAX_CAPTURE_TEXT),
    textKind: "raw-html" as const,
    truncated: full.length > MAX_CAPTURE_TEXT,
  };
}
