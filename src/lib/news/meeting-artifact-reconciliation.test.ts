import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sql } from "../db.ts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

test("reconciliation verifies rows and quarantines unowned files without deleting evidence", async () => {
  const { reconcileMeetingArtifactStorage } = await import("./meeting-artifact-reconciliation.ts");
  const root = mkdtempSync(join(tmpdir(), "townreporter-meeting-reconcile-"));
  try {
    const videoDir = join(root, "newsroom-7", "video-1");
    mkdirSync(videoDir, { recursive: true });
    const validPath = join(videoDir, `transcript-${hash("valid")}.vtt`);
    const optionalPath = join(videoDir, `transcript-${hash("optional")}.vtt`);
    const missingSidecarPath = join(videoDir, `transcript-${hash("sidecar-missing")}.vtt`);
    const mismatchPath = join(videoDir, `transcript-${hash("expected")}.vtt`);
    const missingPath = join(videoDir, `transcript-${hash("missing")}.vtt`);
    const orphanPath = join(videoDir, `transcript-${hash("orphan")}.vtt`);
    const tempPath = join(videoDir, `transcript-${hash("temp")}.vtt.tmp-crash`);
    writeFileSync(validPath, "valid");
    writeFileSync(optionalPath, "optional");
    writeFileSync(missingSidecarPath, "sidecar-missing");
    writeFileSync(mismatchPath, "different");
    writeFileSync(orphanPath, "orphan");
    writeFileSync(tempPath, "partial");

    const status = new Map<number, string>();
    const findings: Array<{ kind: string; originalPath: string; quarantinePath: string | null }> = [];
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      if (/select storage_root/i.test(text)) return [{ storage_root: root }] as T[];
      if (/from meeting_transcript_artifacts/i.test(text) && /^\s*select/i.test(text)) {
        return [
          { id: 1, artifact_type: "transcript", is_legacy: false, newsroom_id: 7, storage_path: validPath, sha256: hash("valid"), info_path: null, info_sha256: null },
          { id: 2, artifact_type: "transcript", is_legacy: false, newsroom_id: 7, storage_path: missingPath, sha256: hash("missing"), info_path: null, info_sha256: null },
          { id: 3, artifact_type: "transcript", is_legacy: false, newsroom_id: 7, storage_path: mismatchPath, sha256: hash("expected"), info_path: null, info_sha256: null },
          { id: 4, artifact_type: "transcript", is_legacy: false, newsroom_id: 7, storage_path: validPath, sha256: hash("valid"), info_path: null, info_sha256: null },
          { id: 5, artifact_type: "transcript", is_legacy: false, newsroom_id: 7, storage_path: optionalPath, sha256: hash("optional"), info_path: null, info_sha256: null, info_missing_reason: "yt-dlp did not write an info sidecar for this capture" },
          { id: 6, artifact_type: "transcript", is_legacy: false, newsroom_id: 7, storage_path: missingSidecarPath, sha256: hash("sidecar-missing"), info_path: null, info_sha256: null, info_missing_reason: "info sidecar missing at storage time: C:/capture/info.json" },
        ] as T[];
      }
      if (/update meeting_transcript_artifacts/i.test(text)) {
        status.set(Number(params[0]), String(params[1]));
        return [] as T[];
      }
      if (/insert into meeting_artifact_storage_findings/i.test(text)) {
        findings.push({ kind: String(params[2]), originalPath: String(params[3]), quarantinePath: params[4] == null ? null : String(params[4]) });
        return [] as T[];
      }
      throw new Error(`unexpected query: ${text}`);
    };

    const result = await reconcileMeetingArtifactStorage(sql, 7, { orphanGraceMs: 0, now: () => new Date("2026-09-22T12:00:00Z") });

    assert.equal(status.get(1), "ambiguous-path");
    assert.equal(status.get(4), "ambiguous-path");
    assert.equal(status.get(2), "missing");
    assert.equal(status.get(3), "hash-mismatch");
    assert.equal(status.get(5), "valid", "reconciliation must keep an optional sidecar absence publishable");
    assert.equal(status.get(6), "sidecar-missing", "a sidecar that was expected but missing must stay blocked");
    assert.equal(result.valid, 1);
    assert.equal(result.missing, 2);
    assert.equal(result.mismatched, 1);
    assert.equal(result.ambiguous, 2);
    assert.equal(existsSync(orphanPath), false, "an unowned final file must leave the live artifact tree");
    assert.equal(existsSync(tempPath), false, "a stale interrupted temp file must leave the live artifact tree");
    const orphan = findings.find((finding) => finding.originalPath === orphanPath);
    const temporary = findings.find((finding) => finding.originalPath === tempPath);
    assert.ok(orphan?.quarantinePath && existsSync(orphan.quarantinePath));
    assert.ok(temporary?.quarantinePath && existsSync(temporary.quarantinePath));
    assert.equal(readFileSync(orphan!.quarantinePath!, "utf8"), "orphan");
    assert.equal(readFileSync(temporary!.quarantinePath!, "utf8"), "partial");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a recorded hash mismatch is not re-hashed or rewritten until the file changes", async () => {
  const { reconcileMeetingArtifactStorage } = await import("./meeting-artifact-reconciliation.ts");
  const root = mkdtempSync(join(tmpdir(), "townreporter-meeting-reconcile-mismatch-"));
  try {
    const videoDir = join(root, "newsroom-7", "video-1");
    mkdirSync(videoDir, { recursive: true });
    const mismatchPath = join(videoDir, `transcript-${hash("expected")}.vtt`);
    writeFileSync(mismatchPath, "different");
    const recordedCheck = "2026-10-20T15:58:34.000Z";
    const beforeCheck = new Date("2026-10-19T12:00:00.000Z");
    const afterCheck = new Date("2026-10-21T09:00:00.000Z");
    utimesSync(mismatchPath, beforeCheck, beforeCheck);

    const row = {
      id: 51, artifact_type: "transcript", is_legacy: false, newsroom_id: 7,
      storage_path: mismatchPath, sha256: hash("expected"), info_path: null, info_sha256: null,
      info_missing_reason: null, integrity_status: "hash-mismatch",
      integrity_detail: "Recorded transcript hash does not match the stored bytes.",
      integrity_checked_at: recordedCheck,
    };
    const updates: Array<{ id: number; checked: boolean }> = [];
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      if (/select storage_root/i.test(text)) return [{ storage_root: root }] as T[];
      if (/from meeting_transcript_artifacts/i.test(text) && /^\s*select/i.test(text)) return [row] as T[];
      if (/update meeting_transcript_artifacts/i.test(text)) {
        updates.push({ id: Number(params[0]), checked: true });
        return [] as T[];
      }
      if (/insert into meeting_artifact_storage_findings/i.test(text)) return [] as T[];
      throw new Error(`unexpected query: ${text}`);
    };

    const first = await reconcileMeetingArtifactStorage(sql, 7, { orphanGraceMs: 0 });
    const second = await reconcileMeetingArtifactStorage(sql, 7, { orphanGraceMs: 0 });
    assert.equal(first.mismatched, 1, "the recorded mismatch is still reported");
    assert.equal(second.mismatched, 1);
    assert.deepEqual(updates, [], "an unchanged file must not be re-hashed or rewritten");

    utimesSync(mismatchPath, afterCheck, afterCheck);
    const third = await reconcileMeetingArtifactStorage(sql, 7, { orphanGraceMs: 0 });
    assert.equal(third.mismatched, 1);
    assert.deepEqual(updates, [{ id: 51, checked: true }], "a file touched after the check is checked again");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
