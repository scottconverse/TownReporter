import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { Sql } from "../db.ts";
import { resolveMeetingStorageRoot } from "./meeting-transcript-artifacts.ts";

type ArtifactRow = {
  id: number;
  storage_path: string;
  sha256: string;
  info_path: string | null;
  info_sha256: string | null;
};

type IntegrityStatus =
  | "valid"
  | "missing"
  | "hash-mismatch"
  | "sidecar-missing"
  | "sidecar-hash-mismatch"
  | "outside-root"
  | "ambiguous-path";

export type MeetingArtifactReconciliation = {
  valid: number;
  missing: number;
  mismatched: number;
  ambiguous: number;
  quarantined: number;
};

function hashBytes(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function findingKey(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function within(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== ".quarantine") walk(path);
      } else if (entry.isFile()) out.push(path);
    }
  };
  walk(root);
  return out;
}

async function recordFinding(sql: Sql, input: {
  newsroomId: number;
  artifactId: number | null;
  kind: string;
  originalPath: string;
  quarantinePath?: string | null;
  detail: string;
}) {
  const key = findingKey([input.newsroomId, input.artifactId, input.kind, resolve(input.originalPath), input.detail]);
  await sql.query(
    `insert into meeting_artifact_storage_findings
       (newsroom_id,artifact_id,finding_kind,original_path,quarantine_path,detail,finding_key)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict(finding_key) do update set quarantine_path=coalesce(excluded.quarantine_path,meeting_artifact_storage_findings.quarantine_path),last_seen_at=now()`,
    [input.newsroomId, input.artifactId, input.kind, input.originalPath, input.quarantinePath ?? null, input.detail, key],
  );
}

/**
 * Audit the durable meeting artifact tree against its database inventory.
 *
 * Ambiguous or unowned bytes are preserved in quarantine. Database rows are
 * marked honestly and never repointed to bytes merely because a filename looks
 * plausible. This makes recovery fail closed while retaining material for a
 * later operator decision or a source recapture.
 */
export async function reconcileMeetingArtifactStorage(
  sql: Sql,
  newsroomId: number,
  options: { orphanGraceMs?: number; now?: () => Date } = {},
): Promise<MeetingArtifactReconciliation> {
  const roots = await sql.query<{ storage_root: string | null }>(
    "select storage_root from meeting_capture_settings where newsroom_id=$1",
    [newsroomId],
  );
  const storageRoot = resolveMeetingStorageRoot(roots[0]?.storage_root ?? null);
  const newsroomRoot = join(storageRoot, `newsroom-${newsroomId}`);
  const artifacts = await sql.query<ArtifactRow>(
    "select id,storage_path,sha256,info_path,info_sha256 from meeting_transcript_artifacts where newsroom_id=$1 order by id",
    [newsroomId],
  );
  const pathOwners = new Map<string, number[]>();
  const known = new Set<string>();
  for (const artifact of artifacts) {
    for (const path of [artifact.storage_path, artifact.info_path].filter((value): value is string => Boolean(value))) {
      const absolute = resolve(path);
      known.add(absolute);
      pathOwners.set(absolute, [...(pathOwners.get(absolute) ?? []), artifact.id]);
    }
  }

  const totals: MeetingArtifactReconciliation = { valid: 0, missing: 0, mismatched: 0, ambiguous: 0, quarantined: 0 };
  for (const artifact of artifacts) {
    let status: IntegrityStatus = "valid";
    let detail = "Caption and optional sidecar match their immutable recorded hashes.";
    const owners = pathOwners.get(resolve(artifact.storage_path)) ?? [];
    if (owners.length > 1) {
      status = "ambiguous-path";
      detail = `Storage path is referenced by artifact rows ${owners.join(", ")}.`;
      totals.ambiguous += 1;
    } else if (!within(newsroomRoot, artifact.storage_path)) {
      status = "outside-root";
      detail = "Recorded storage path is outside the newsroom artifact root.";
      totals.mismatched += 1;
    } else if (!existsSync(artifact.storage_path)) {
      status = "missing";
      detail = "Recorded transcript file is absent.";
      totals.missing += 1;
    } else if (hashBytes(artifact.storage_path) !== artifact.sha256) {
      status = "hash-mismatch";
      detail = "Recorded transcript hash does not match the stored bytes.";
      totals.mismatched += 1;
    } else if (artifact.info_path && !existsSync(artifact.info_path)) {
      status = "sidecar-missing";
      detail = "Recorded information sidecar is absent.";
      totals.missing += 1;
    } else if (artifact.info_path && artifact.info_sha256 && hashBytes(artifact.info_path) !== artifact.info_sha256) {
      status = "sidecar-hash-mismatch";
      detail = "Recorded information sidecar hash does not match the stored bytes.";
      totals.mismatched += 1;
    } else {
      totals.valid += 1;
    }
    await sql.query(
      "update meeting_transcript_artifacts set integrity_status=$2,integrity_detail=$3,integrity_checked_at=now() where id=$1",
      [artifact.id, status, detail],
    );
    if (status !== "valid") {
      await recordFinding(sql, { newsroomId, artifactId: artifact.id, kind: status, originalPath: artifact.storage_path, detail });
    }
  }

  const now = (options.now ?? (() => new Date()))();
  const grace = options.orphanGraceMs ?? 60 * 60 * 1000;
  const quarantineRoot = join(storageRoot, ".quarantine", `newsroom-${newsroomId}`);
  const candidateName = /^(?:transcript-[a-f0-9]{64}\.(?:vtt|srv3)|info-[a-f0-9]{64}\.json|.+\.tmp-.+)$/i;
  for (const path of filesUnder(newsroomRoot)) {
    const absolute = resolve(path);
    if (known.has(absolute) || !candidateName.test(basename(path))) continue;
    if (grace > 0 && now.getTime() - statSync(path).mtimeMs < grace) continue;
    mkdirSync(quarantineRoot, { recursive: true });
    const quarantinePath = join(quarantineRoot, `${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}-${basename(path)}`);
    renameSync(path, quarantinePath);
    totals.quarantined += 1;
    const kind = basename(path).includes(".tmp-") ? "stale-temporary-file" : "orphan-final-file";
    await recordFinding(sql, {
      newsroomId,
      artifactId: null,
      kind,
      originalPath: path,
      quarantinePath,
      detail: "File had no owning database artifact row and was preserved in quarantine.",
    });
  }
  return totals;
}

export async function reconcileConfiguredMeetingArtifactStorage(sql: Sql): Promise<{
  checked: number;
  failed: Array<{ newsroomId: number; reason: string }>;
}> {
  const rooms = await sql.query<{ newsroom_id: number }>(
    "select newsroom_id from meeting_capture_settings where storage_root is not null and btrim(storage_root)<>'' order by newsroom_id",
  );
  const failed: Array<{ newsroomId: number; reason: string }> = [];
  for (const room of rooms) {
    try {
      await reconcileMeetingArtifactStorage(sql, room.newsroom_id);
    } catch (error) {
      failed.push({ newsroomId: room.newsroom_id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: rooms.length, failed };
}
