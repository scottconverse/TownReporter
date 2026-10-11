import { createServerFn } from "@tanstack/react-start";
import { withTransaction } from "../db.ts";
import { assertOwner, deskMiddleware } from "./desk-auth.ts";
import { ForbiddenError } from "./membership.ts";
import { auditWithSql, ensureAuditEventsSchema } from "./ops.ts";
import { auditOverrides, checkOverride, type OverrideWarning } from "./override.ts";
import { captureTakedownInput } from "./request-input.ts";

/**
 * Taking down ONE evidence capture, at a publisher's request.
 *
 * The legal audit asked for two different things, and this is the second half
 * of the first one. U11a shrank what a public `/evidence/:id` page prints (a
 * short excerpt plus a link -- `PUBLIC_EXCERPT_MAX`, src/lib/news/evidence.ts).
 * What was still missing is the action for the day a publisher writes in and
 * objects to one captured page: the article-level legal-removal flow
 * (legal-removal-store.ts) removes OUR stories and their connected copies and
 * flags captured copies for an operator, and every one of its cases is keyed
 * to articles. There was no way to take down a single capture, and the
 * alternative -- an editor editing the database by hand -- is a write with no
 * actor, no reason and no trail.
 *
 * WHAT "TAKE DOWN" DOES, in one transaction:
 *
 *   1. Every stored copy of that capture's text that this database keys BY
 *      VERSION is PURGED. Not hidden: emptied.
 *
 *        - `artifact_versions.full_text` -- the capture itself.
 *        - `artifact_chunks.excerpt` -- its extracted passages.
 *        - `artifact_blobs.body_b64` -- the original bytes we took off their
 *          page; a takedown that left the bytes in place would keep the thing
 *          the publisher objected to, one download away from the excerpt a
 *          reader can no longer see.
 *        - `artifacts.full_text` -- the Dark Desk's own copy of the same fetch
 *          (`investigate.ts`'s capture path; `page-watch.ts`'s attach action).
 *        - `claims.excerpt` and `relationships.excerpt` -- the passage a Dark
 *          Desk claim or relationship recorded from that capture.
 *
 *      The first three are keyed by `version_id` alone; the last three carry a
 *      `newsroom_id` because every write to them does, so they are matched on
 *      both. A Sonnet legal/security audit of the first cut found the gap:
 *      `artifacts.full_text` holds the WHOLE page for an investigation-linked
 *      capture, and a claim or relationship excerpt is a verbatim passage of
 *      it, so a purge that stopped at `artifact_versions` left the publisher's
 *      text in the building while the public page said the excerpt was gone.
 *
 *      NOT purged, and said plainly in the manual and in `how-we-report`:
 *      `snapshots` (keyed by source, not by capture -- a different row
 *      identity, not this capture's copy); `claims.evidence` and
 *      `relationships.evidence` (the desk's own note of what the record says,
 *      which may quote it -- a working note, not the stored capture);
 *      `artifact_versions.title` (the page title stays: it is the record's
 *      name, and the address may still be shown); provider history, search
 *      caches and backups.
 *
 *      This is the honest boundary the audit asked for: what is keyed to this
 *      capture goes, what is a separate record with its own identity is listed
 *      rather than silently deleted -- the same line `legal-removal-store.ts`
 *      draws with its `capturedCopies` list.
 *
 *      FAIL-CLOSED, unchanged. The 0047 legal guard puts a trigger on
 *      `artifacts` (though not on `claims` or `relationships`), so if a
 *      legal-removal case already covers this page the `artifacts` update
 *      raises and the WHOLE transaction rolls back -- no partial purge, no
 *      audit row. `takeDownEvidenceCapture` catches that specific refusal and
 *      tells the owner a case covers the page (see `legalGuardRefusal`).
 *   2. The id, URL, timestamps, `byte_length` and content hashes STAY. That is
 *      what keeps the audit trail and the citations intact: a published story
 *      that cited this capture still renders its citation, and its evidence
 *      link still resolves -- to the notice, not to an excerpt. The public
 *      record reports `byte_length` as absent while taken down (the bytes are
 *      gone, and the page used to say we kept them), but the column keeps the
 *      number it recorded: it is a fact about what was captured, and the audit
 *      row that says the capture came down should not be the only place it can
 *      be read.
 *   3. The row is marked with `taken_down_at`, the editor's short reason, and
 *      whether the public notice keeps the link. See
 *      migrations/0110_evidence_capture_takedown.sql.
 *   4. One row lands in `audit_events` -- who, when, the reason, and the
 *      capture id -- which is the log the legal-removal flow already writes
 *      into and reads from (`ops.ts`'s `audit`; `legal-removal-store.ts` reads
 *      and deletes `audit_events` as part of a case). No parallel log table:
 *      an operator looking for what this desk did about a capture looks in the
 *      one place every other action is recorded. The reason is the row's
 *      `detail`; no captured text is written to the audit row.
 *
 * IRREVERSIBLE, BY DESIGN. There is no restore, and no column that would let
 * one be built by accident: the text is gone from this database. The confirm
 * step in the desk says so in words, and so does the manual. An owner who
 * needs the capture again re-captures the page, which is a different row with
 * a different hash -- exactly what the audit trail should show.
 *
 * ONLY THE OWNER. This purges evidence, so it is the same class of decision as
 * a legal removal and uses the same guard: `assertOwner`, the shared check
 * every owner-gated surface calls, which refuses exactly the role
 * `legal-removal-store.ts`'s `ownerRoom` refuses (anything but "owner").
 *
 * NO REASON IN PUBLIC. `taken_down_reason` is desk-side only. The public
 * notice says the publisher asked and names the original, and nothing about
 * what the editor typed; a reason may name the publisher, a lawyer or a
 * complaint, and it must not leak onto a public page (see `asPublicEvidence`
 * in evidence.ts, which never reads the column). The owner DOES see it, in the
 * desk's capture pane -- `loadFindingEvidenceCapture` returns it only for the
 * owner's call, and the pane prints it there.
 */

/** How long an editor's reason may be. */
export const TAKEDOWN_REASON_MAX = 400;

/** The `audit_events.action` every takedown writes, and no other action uses. */
export const TAKEDOWN_ACTION = "evidence-capture-takedown";

/** `audit_events.subject_kind`: the row the takedown acted on. */
export const TAKEDOWN_SUBJECT_KIND = "artifact_versions";


export const TAKEDOWN_BLANK_REASON_KEY = "takedown-blank-reason";

const TAKEDOWN_BLANK_REASON_WARNING =
  "This takedown has no reason recorded. The reason is the audit record of why the publisher's excerpt came down.";

export type TakeDownCaptureInput = {
  versionId: number;
  /** The editor's short plain-text reason. Never shown to a reader. */
  reason: string;
  /**
   * Tick "remove the link too". Default false: the notice keeps the link.
   * Optional on the wire for the same reason -- an absent field must mean
   * "keep".
   */
  removeLink?: boolean;
  /**
   * Warning keys this caller has already accepted. Absent on the first call,
   * which is what draws the blank-reason warning.
   */
  override?: string[];
};

export type TakedownRefusal = {
  ok: false;
  code:
    "forbidden" | "invalid-input" | "not-found" | "already-taken-down" | "legal-removal" | "error";
  error: string;
};

export type TakeDownCaptureResult =
  | {
      ok: true;
      versionId: number;
      takenDownAt: string;
      /** Whether the public notice keeps the link to the original. */
      linkKept: boolean;
      /** What the purge emptied, for the desk's own confirmation line. */
      purged: {
        chunks: number;
        blobs: number;
        artifacts: number;
        claims: number;
        relationships: number;
      };
    }
  | TakedownRefusal
  | OverrideWarning;

class TakedownError extends Error {
  readonly code: "invalid-input" | "not-found" | "already-taken-down";
  constructor(code: "invalid-input" | "not-found" | "already-taken-down", message: string) {
    super(message);
    this.name = "TakedownError";
    this.code = code;
  }
}

/**
 * Did the legal-removal guard refuse this write?
 *
 * `prevent_legal_resurrection()` (migrations/0047_legal_removal.sql, replayed
 * by `legal-removal-schema.ts`) is a BEFORE trigger on `artifacts` and
 * `artifact_versions` among others, and it raises one of two sentences, both
 * of which contain "covered by a legal removal". A takedown of a capture a
 * case already covers therefore fails as a Postgres error rather than as one
 * of this module's own refusals -- and the whole transaction rolls back, so
 * nothing is half-purged.
 *
 * Matched on the message text because that is all the guard leaves behind: it
 * raises a plain `raise exception`, and the driver surfaces it as the error's
 * message. It is our own sentence, in our own schema, and the worst a false
 * positive can do is name the legal-removal flow in a refusal.
 */
export function legalGuardRefusal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /covered by a legal removal/i.test(message);
}

/**
 * What the desk is told when a takedown fails.
 *
 * Apart from this module's own refusals, there is one failure worth naming:
 * the legal-removal guard. A page already inside a removal case is not ours to
 * delete here, and "the takedown could not be completed" would leave the owner
 * with nothing to do next. Everything else is deliberately vague -- a database
 * error's own text can carry a statement or a row, and this sentence is
 * rendered in the desk.
 *
 * Exported so the classification is provable without a server: the real-PG
 * proof shows the guard actually blocks the write, and the unit test shows
 * which sentence the owner then reads.
 */
export function takedownFailure(error: unknown): TakedownRefusal {
  if (error instanceof ForbiddenError)
    return { ok: false, code: "forbidden", error: error.message };
  if (error instanceof TakedownError) return { ok: false, code: error.code, error: error.message };
  if (legalGuardRefusal(error))
    return {
      ok: false,
      code: "legal-removal",
      error:
        "A legal-removal case already covers this page, so its captured copy is not ours to delete here. Nothing was removed. Open Legal removals to review the case.",
    };
  console.error("[evidence-takedown] take down failed", error);
  return {
    ok: false,
    code: "error",
    error:
      "The takedown could not be completed. Nothing was removed; reload the story and try again.",
  };
}

/**
 * A reason is one short plain-text line, and it is stored.
 *
 * Control characters are replaced rather than refused: an editor pasting a
 * reason out of a mail client should not meet an error about bytes, and the
 * value ends up in a database column, a log line and a desk screen. A NUL in
 * particular cannot survive the round trip into Postgres at all (the same
 * policy the NUL work elsewhere in this newsroom settled), so it is turned
 * into a space here and never reaches the insert.
 *
 * Written as a code-point test rather than a character class on purpose: a
 * character class holding those bytes is exactly the mangled-escape shape
 * `scripts/no-control-characters.test.mjs` exists to catch, and this file is
 * one edit away from carrying one.
 */
function cleanReason(raw: string): string {
  let plain = "";
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    plain += code < 32 || code === 127 ? " " : character;
  }
  return plain.replace(/\s+/g, " ").trim();
}

/**
 * The capture comes down.
 *
 * Throws `ForbiddenError` for a non-owner and `TakedownError` for a request
 * this desk refuses; `takeDownEvidenceCapture` below turns both into the
 * `{ ok: false, code, error }` shape the desk renders.
 */
export async function takeDownCapture(
  context: { userId: string; newsroomId: number; role: string },
  input: TakeDownCaptureInput,
): Promise<Extract<TakeDownCaptureResult, { ok: true }> | OverrideWarning> {
  // The same guard the legal-removal routes use, first, before any work.
  assertOwner(context.role);
  if (!Number.isInteger(input.versionId) || input.versionId < 1)
    throw new TakedownError("invalid-input", "Choose a captured record to take down.");
  /*
    The keys this call triggered AND the owner accepted. Audited after the
    takedown commits, so a warned-but-refused request leaves no override row.
  */
  const accepted: string[] = [];
  const reason = cleanReason(input.reason);

  if (!reason) {
    const warning = checkOverride(input, TAKEDOWN_BLANK_REASON_KEY, TAKEDOWN_BLANK_REASON_WARNING);
    if (warning) return warning;
    accepted.push(TAKEDOWN_BLANK_REASON_KEY);
  }
  if (reason.length > TAKEDOWN_REASON_MAX)
    throw new TakedownError(
      "invalid-input",
      `Keep the reason to ${TAKEDOWN_REASON_MAX} characters or fewer.`,
    );
  /*
    `auditWithSql` writes through the caller's transaction, so the audit row
    commits with the purge or not at all -- an audit trail that could survive a
    rolled-back purge would say a capture came down while it is still there.
    Its schema is ensured first, outside: that is DDL, and DDL cannot run
    inside this transaction.
  */
  await ensureAuditEventsSchema();
  const linkKept = input.removeLink !== true;
  const result = await withTransaction(async (tx) => {
    const [capture] = await tx<{
      id: number;
      taken_down_at: string | null;
    }>`
      select id, taken_down_at::text as taken_down_at from artifact_versions
      where id = ${input.versionId} and newsroom_id = ${context.newsroomId}
      for update
    `;
    if (!capture)
      throw new TakedownError(
        "not-found",
        "That captured record is not in this newsroom. Reload the story and try again.",
      );
    if (capture.taken_down_at)
      throw new TakedownError(
        "already-taken-down",
        "That excerpt was already taken down. There is no restore, and nothing further to remove.",
      );
    const [version] = await tx<{
      taken_down_at: string;
    }>`
      update artifact_versions
      set full_text = '', taken_down_at = now(), taken_down_reason = ${reason},
          taken_down_link_kept = ${linkKept}
      where id = ${input.versionId} and newsroom_id = ${context.newsroomId}
      returning taken_down_at::text as taken_down_at
    `;
    /*
      Keyed by `version_id`, not by `version_id and newsroom_id`.

      The version row above was just verified to be this newsroom's, under a
      row lock, and chunks and blobs are keyed by the version id, which names
      exactly one capture. Scoping the purge by `newsroom_id` as well would
      make it depend on a second copy of the same fact -- and a legacy row
      whose `newsroom_id` was backfilled to the default would keep third-party
      text in place while the audit row said the capture was removed.
      Completeness is the point of this write.
    */
    const purgedChunks = await tx<{ id: number }>`
      update artifact_chunks set excerpt = '' where version_id = ${input.versionId} returning id
    `;
    const purgedBlobs = await tx<{ id: number }>`
      update artifact_blobs set body_b64 = '' where version_id = ${input.versionId} returning id
    `;
    /*
      The three stores that carry the same page under a room-scoped row.

      `artifacts` is the Dark Desk's copy of the fetch itself; a claim and a
      relationship record the passage they took from it. All three are written
      with a real `newsroom_id`, so they are matched on it -- and the first is
      the one the 0047 trigger guards, which is what makes a takedown of a
      legally-removed page fail closed rather than leave a half-purge behind.
    */
    const purgedArtifacts = await tx<{ id: number }>`
      update artifacts set full_text = ''
      where version_id = ${input.versionId} and newsroom_id = ${context.newsroomId} returning id
    `;
    const purgedClaims = await tx<{ id: number }>`
      update claims set excerpt = ''
      where version_id = ${input.versionId} and newsroom_id = ${context.newsroomId} returning id
    `;
    const purgedRelationships = await tx<{ id: number }>`
      update relationships set excerpt = ''
      where version_id = ${input.versionId} and newsroom_id = ${context.newsroomId} returning id
    `;
    await auditWithSql(tx, context.userId, TAKEDOWN_ACTION, reason, context.newsroomId, {
      kind: TAKEDOWN_SUBJECT_KIND,
      id: input.versionId,
    });
    return {
      ok: true as const,
      versionId: input.versionId,
      takenDownAt: version.taken_down_at,
      linkKept,
      purged: {
        chunks: purgedChunks.length,
        blobs: purgedBlobs.length,
        artifacts: purgedArtifacts.length,
        claims: purgedClaims.length,
        relationships: purgedRelationships.length,
      },
    };
  });

  if (accepted.length > 0) {
    await auditOverrides(context, accepted, { kind: TAKEDOWN_SUBJECT_KIND, id: input.versionId });
  }
  return result;
}


export const takeDownEvidenceCapture = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((data: unknown) => captureTakedownInput.parse(data))
  .handler(async ({ context, data }): Promise<TakeDownCaptureResult> => {
    try {
      return await takeDownCapture(
        { userId: context.userId, newsroomId: context.newsroomId, role: context.role },
        data,
      );
    } catch (error) {
      return takedownFailure(error);
    }
  });
