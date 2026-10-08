/**
 * The Checks tab's evidence list, as data (unit CW, 0.6.81).
 *
 * The drawing (docs/design/handoff-2026-09-26/design/Desk Story.dc.html) shows
 * one row per claim under "Evidence check": a status chip, the sentence the
 * check was run on, the secondary line that says what it was checked against,
 * and the press that opens the record. The screen it replaces had two prose
 * blocks here -- "Claims & evidence" and "Claims of absence", each a paragraph
 * and a link -- so an editor could not see which claim had been checked, what
 * the desk found, or where the record was.
 *
 * Every row is built from a field the desk already stores. Four things the
 * drawing writes have nothing behind them and are absent here rather than
 * invented; they are listed in `design/SPEC-GAPS-0681.md` under CW:
 *
 *   - the per-row "Retry capture" press: nothing re-captures a story claim
 *     (the only re-capture in this app is the meeting-video `forced_recapture`),
 *   - the per-run count of captures the check ran against: no job result
 *     stores one. The count on the drawn line is the records the review
 *     itself cites, which is what `citedCaptureCount` returns and a different
 *     number from the one the drawing means,
 *   - the model, when no reconcile job is on the books for this lead -- the
 *     run line then simply omits it,
 *   - "Confirm spelling", the drawn press on the name row: the name check has
 *     no confirm mutation; a name is settled by redrafting, which re-runs it.
 *
 * Pure -- no DOM, no hooks -- so a test can prove the chip for every judgment
 * and the run line's pieces without a browser.
 */

import type { DraftAuditFinding } from "./draft-audit.ts";
import type { DraftGroundingRow } from "./draft-specifics.ts";
import type { EvidenceCheckState } from "./evidence-check-state.ts";
import { PAPER, formatClockTime } from "../paper.ts";
import type {
  ClaimEvidenceRow,
  FindingCaptureEvidence,
  FindingEvidenceRow,
  FindingJudgment,
  ManualClaimEvidenceRow,
} from "./finding-evidence-review.ts";
import type { NameCheck } from "./name-check.ts";
import type { NoteTodo } from "./notes.ts";

/** What a grounding row's kind is called on the Checks pane. */
const GROUNDING_KIND_LABEL: Record<DraftGroundingRow["kind"], string> = {
  address: "address",
  amount: "amount",
  date: "date",
  identifier: "identifier",
  name: "name",
  vote: "vote tally",
};

/**
 * The four chip shapes the drawing names. `ok` and `warn` are the two status
 * colors the desk already uses; `ink` is the drawing's solid chip -- "the
 * check ran and found nothing", which must not look like `fail`, "the check
 * could not run" (DECISIONS.md: quiet styling never carries meaning alone, and
 * "checked, nothing changed" must look different from "could not check").
 */
export type EvidenceChipTone = "ok" | "ink" | "fail" | "warn";

/**
 * A row's one press. `open-record` is a link to the captured version the claim
 * was checked against (`/evidence/<versionId>`, the same route the evidence
 * review panel opens); `style` is a press the page turns into a focus of the
 * style section's own "Fix these with the model" button, so the row is a way
 * to the work and never a second copy of it. A row with neither carries no
 * button at all.
 */
export type EvidenceRowAction =
  | { kind: "open-record"; label: string; href: string }
  | { kind: "style"; label: string };

/**
 * Which review row a list row was built from (unit CW2).
 *
 * The list is drawn from the review, and the row that opens under a list row
 * has to find its way back to the same review row -- that is where the record
 * checks and the judgment controls come from. `id` is the review row's own key
 * (`FindingEvidenceRow.key` and its two siblings), which is what the judgment
 * save takes.
 *
 * A row with no `ref` -- a claim of absence, the name row -- is a row the desk
 * measures but does not judge, so it opens to nothing. The style row is the one
 * row that opens to something which is not a judgment (unit CW2): the page's
 * own Style check section, which the route hands to the panel as markup because
 * it holds the tick state and the repair mutation. Its `id` is always
 * `STYLE_ROW_KEY`, so its disclosure comes out as `evidence-detail-style`.
 */
export type EvidenceRowRef =
  | { kind: "finding"; id: string }
  | { kind: "claim"; id: string }
  | { kind: "manual"; id: string }
  | { kind: "style"; id: string };

export type EvidenceListRow = {
  key: string;
  chip: string;
  tone: EvidenceChipTone;
  /** The sentence or claim the check was run on. */
  what: string;
  /** What it was checked against, or why it could not be. Never a verdict. */
  note: string;
  action: EvidenceRowAction | null;
  /** The review row behind this list row, or null when there is none. */
  ref: EvidenceRowRef | null;
};

/**
 * The style row's key, and the whole of its ref's `id` (unit CW2). It is a
 * constant because two places have to agree on it: the model pushes the row
 * with it, and the page's style press names the row's disclosure by it.
 */
export const STYLE_ROW_KEY = "style";

/**
 * The DOM id of one list row's disclosure (unit CW2).
 *
 * A row's key carries the kind of row it is and a colon (`finding:…`,
 * `claim:…`, `manual:…`, `absence:…`), which is not an id, so the colon becomes
 * a dash -- as does anything else that is not a letter, a digit, an underscore
 * or a dash. The one id a press outside the list has to name is the style row's,
 * and it comes out as `evidence-detail-style`.
 */
export function evidenceDetailId(key: string): string {
  return `evidence-detail-${key.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

/** A capture the check could actually read. */
export function captureIsReadable(capture: FindingCaptureEvidence): boolean {
  return capture.available && capture.readable;
}

/**
 * The words on the review chip, in one place because two rules read them: the
 * chip this file draws, and the count the publish blocker prints (unit U24,
 * `evidence-check-state.ts`). A rename here without a rename there would put
 * the bar and the pane back to disagreeing, which is the thing U24 exists for.
 */
export const NEEDS_REVIEW_CHIP = "! Needs review";

/**
 * Is this row one the pane chips `! Needs review`?
 *
 * The chip's own predicate, named so both the chip and the count read ONE
 * expression instead of two rules kept in step by hand: no judgment recorded,
 * and a captured record that could actually be read. A row with no readable
 * record is chipped `Could not check` instead -- there is nothing to judge it
 * against, so it is not review work and a "review the claims" press would be
 * a dead end.
 */
export function claimNeedsReview(
  judgment: FindingJudgment,
  captures: readonly FindingCaptureEvidence[],
): boolean {
  return judgment === "unreviewed" && captures.some(captureIsReadable);
}

/**
 * The chip for one judgment. The default arm is the interesting one: a row
 * with no recorded judgment and no readable capture has nothing the check
 * could have looked at, so it says "could not check" rather than sending the
 * editor to a record that is not there.
 */
export function judgmentChip(
  judgment: FindingJudgment,
  captures: readonly FindingCaptureEvidence[],
): { chip: string; tone: EvidenceChipTone } {
  switch (judgment) {
    case "supports":
      return { chip: "✓ Supported", tone: "ok" };
    case "does-not-support":
      /*
        Quiet ink, not the danger red: the check worked and this is its
        answer. The editor reads "the record is there and it does not say
        this", which is a different job from "nothing could be read".
      */
      return { chip: "Checked · not found", tone: "ink" };
    case "needs-reporting":
      return { chip: "Could not check", tone: "fail" };
    case "contradicts":
      return { chip: NEEDS_REVIEW_CHIP, tone: "warn" };
    default:
      return claimNeedsReview(judgment, captures)
        ? { chip: NEEDS_REVIEW_CHIP, tone: "warn" }
        : { chip: "Could not check", tone: "fail" };
  }
}

/** The press that opens the row's captured record, if it has one. */
export function openRecordAction(
  captures: readonly FindingCaptureEvidence[],
): EvidenceRowAction | null {
  const href = captures.find((capture) => capture.viewHref)?.viewHref;
  return href ? { kind: "open-record", label: "Open record", href } : null;
}

/**
 * How many distinct captured records the review holds for this draft. This is
 * the number the drawn "checked against N captures" can honestly carry today:
 * every one of them is a record the reconciliation was given, and the same
 * record cited twice counts once.
 */
export function citedCaptureCount(
  rows: readonly FindingEvidenceRow[],
  claimRows: readonly ClaimEvidenceRow[],
  manualClaimRows: readonly ManualClaimEvidenceRow[],
): number {
  const seen = new Set<number>();
  for (const row of [...rows, ...claimRows, ...manualClaimRows]) {
    for (const capture of row.captures) {
      if (capture.versionId != null) seen.add(capture.versionId);
    }
  }
  return seen.size;
}

/**
 * "8:14 a.m." in the paper's own time zone, so the server, the reader's
 * browser and CI (which runs in UTC) all print the same clock.
 *
 * UI1b-5: this was a second copy of the same clock face. It delegates to
 * `formatClockTime` (`src/lib/paper.ts`) now, so the desk has one place that
 * turns an instant into "8:14 a.m." and one place to change if the face ever
 * does.
 */
function paperClock(iso: string | null, timeZone: string): string {
  return formatClockTime(iso, timeZone);
}

/**
 * The line under "Evidence check": "Ran 8:14 a.m. · Claude Sonnet · checked
 * against 3 captures · 7 claims need review".
 *
 * Each piece is dropped when it is not known, and the whole line is empty when
 * none of them are, so the heading is never followed by "Ran · · ".
 *
 * UNIT U24: the line is now a reading of the SHARED state
 * (`evidence-check-state.ts`) rather than of its own facts. Before, it printed
 * "checked against N captures" off the cited-capture count alone, which said a
 * check had run even on the drafts where the publish bar was saying none had --
 * the two facts were computed here and in `check-gates.ts` and nothing made
 * them agree. `state.ran` is now the one answer both read, and the count of
 * claims waiting on a person is the same number the blocker prints.
 */
export function evidenceRanLine(input: {
  state: EvidenceCheckState;
  checkedAt: string | null;
  modelLabel: string;
  captures: number;
  timeZone?: string;
}): string {
  /* No run, no line. The heading then stands alone over the pane's own rows,
     which is honest: there is nothing to say about a check that did not
     happen. */
  if (!input.state.ran) return "";
  const parts: string[] = [];
  const ran = paperClock(input.checkedAt, input.timeZone ?? PAPER.timezone);
  if (ran) parts.push(`Ran ${ran}`);
  if (input.modelLabel.trim()) parts.push(input.modelLabel.trim());
  if (input.captures > 0) {
    parts.push(`checked against ${input.captures} capture${input.captures === 1 ? "" : "s"}`);
  }
  if (input.state.toReview > 0) {
    const n = input.state.toReview;
    parts.push(`${claimCount(n)} ${n === 1 ? "needs" : "need"} review`);
  }
  return parts.join(" · ");
}

/**
 * "1 claim" / "7 claims", the count exactly as the bar, the ran line and the
 * publish blocker print it. Here rather than in the state module so that the
 * chip file, the bar and the state module all read one spelling without a
 * circular import between them.
 */
export function claimCount(n: number): string {
  return `${n} claim${n === 1 ? "" : "s"}`;
}

/** The sentence a finding row is about, trimmed for one line of the list. */
function findingWhat(row: FindingEvidenceRow): string {
  return row.finding.text.trim() || "A finding recorded for this draft.";
}

/**
 * What the check compared a finding against. An excerpt is the recorded
 * passage; locators are where in the record it sits; a URL is the record. The
 * first one that exists is the secondary line -- never all three, which turned
 * the row into a paragraph.
 */
function findingNote(row: FindingEvidenceRow): string {
  if (row.captures.length === 0) {
    return "No captured record was cited for this sentence.";
  }
  const excerpt = row.finding.excerpt?.trim();
  if (excerpt) return excerpt;
  if (row.finding.locators.length) return row.finding.locators.join(" · ");
  const readable = row.captures.filter(captureIsReadable).length;
  if (readable === 0) return "The cited record could not be read.";
  return row.captures[0]?.title ?? row.finding.sourceUrls[0] ?? "Cited record";
}

/**
 * The whole list, in the order the drawing shows it: the draft's findings,
 * then its recorded claims, then the claims the editor added by hand, then the
 * claims of absence still waiting on a person, then the one name row and the
 * one style row the drawing puts last.
 *
 * The name and style rows are omitted when there is nothing behind them: a
 * draft with no recorded name check, and one the audit finds nothing in, would
 * both need copy the drawing does not have.
 */
export function evidenceCheckRows(input: {
  rows: readonly FindingEvidenceRow[];
  claimRows: readonly ClaimEvidenceRow[];
  manualClaimRows: readonly ManualClaimEvidenceRow[];
  /** `uncheckedGateTodos(notes)` -- the absence claims still unticked. */
  openClaims: readonly NoteTodo[];
  nameCheck: NameCheck | null;
  /** Every finding this draft's audit raises, fixes and reviews together. */
  styleFindings: readonly DraftAuditFinding[];
  /**
   * Round 2, item 5: the specifics the finished draft states (a name, a number,
   * a vote tally, a date, an address) that no text the check could read carries.
   * Measured in code at draft time (`draftGrounding` in the research memo) and
   * re-read here. Each is a thing the desk refuses to print unchecked, so it
   * wears the review chip and carries no record to open -- like an absence
   * claim, only a person can settle it.
   */
  groundingRows?: readonly DraftGroundingRow[];
}): EvidenceListRow[] {
  const list: EvidenceListRow[] = [];

  for (const row of input.rows) {
    const { chip, tone } = judgmentChip(row.judgment.value, row.captures);
    list.push({
      key: `finding:${row.key}`,
      chip,
      tone,
      what: findingWhat(row),
      note: findingNote(row),
      action: openRecordAction(row.captures),
      ref: { kind: "finding", id: row.key },
    });
  }

  for (const row of input.claimRows) {
    const transcript = row.claim.reporting?.transcriptEvidence;
    const record = row.claim.reporting?.recordEvidence;
    const closest = row.claim.reporting?.closestEvidence;
    const verifiedQuote = transcript?.quote.trim() || record?.quote.trim() || "";
    const verifiedUrl = transcript?.videoUrl || record?.url || "";
    const verifiedSeconds = transcript?.startSeconds ?? record?.startSeconds;
    const savedQuote = transcript?.quote.trim() || record?.quote.trim() || closest?.quote.trim() || "";
    const recordUrl = transcript?.videoUrl || record?.url || closest?.url || "";
    const recordSeconds = transcript?.startSeconds ?? record?.startSeconds ?? closest?.startSeconds;
    const transcriptSupported = row.claim.reporting?.status === "VERIFIED" && Boolean(
      verifiedQuote && verifiedUrl && (verifiedSeconds === undefined || (Number.isFinite(verifiedSeconds) && verifiedSeconds >= 0)),
    );
    const judged = transcriptSupported
      ? { chip: "✓ Supported", tone: "ok" as const }
      : judgmentChip(row.judgment.value, row.captures);
    const transcriptSeconds = recordSeconds !== undefined && Number.isFinite(recordSeconds)
      ? Math.floor(recordSeconds)
      : null;
    const transcriptClock = transcriptSeconds === null ? "" :
      `${Math.floor(transcriptSeconds / 3600)}:${String(Math.floor((transcriptSeconds % 3600) / 60)).padStart(2, "0")}:${String(transcriptSeconds % 60).padStart(2, "0")}`;
    const transcriptAction = recordUrl && transcriptSeconds !== null && transcriptClock
      ? {
          kind: "open-record" as const,
          label: `Play at ${transcriptClock}`,
          href: `${recordUrl}${recordUrl.includes("?") ? "&" : "?"}t=${transcriptSeconds}s`,
        }
      : recordUrl
        ? { kind: "open-record" as const, label: "Open record", href: recordUrl }
      : null;
    list.push({
      key: `claim:${row.key}`,
      chip: judged.chip,
      tone: judged.tone,
      what: row.claim.fact.trim() || "A claim recorded for this draft.",
      note: row.claim.reporting?.checkReason
        ? [row.claim.reporting.checkReason, row.claim.reporting.closestQuote || savedQuote]
            .filter(Boolean).join(" “") + (row.claim.reporting.closestQuote || savedQuote ? "”" : "")
        : savedQuote
          ? savedQuote
        : row.captures.length === 0
          ? "No captured record was cited for this claim."
          : (row.captures[0]?.title ?? row.claim.url ?? "Cited record"),
      action: transcriptAction ?? openRecordAction(row.captures),
      ref: { kind: "claim", id: row.key },
    });
  }

  for (const row of input.manualClaimRows) {
    const { chip, tone } = judgmentChip(row.judgment.value, row.captures);
    list.push({
      key: `manual:${row.key}`,
      chip,
      tone,
      what: row.claim.fact.trim() || "A claim you added to this draft.",
      note:
        row.captures.length === 0
          ? "No captured record is attached to this claim."
          : (row.captures[0]?.title ?? "Selected captured record"),
      action: openRecordAction(row.captures),
      ref: { kind: "manual", id: row.key },
    });
  }

  for (const todo of input.openClaims) {
    /*
      A claim of absence with nobody's name on it. It is not a claim that was
      checked and failed -- it is one the desk refuses to print until a person
      confirms it -- so the chip is the review chip and the note is what the
      gate searched (`q`), which is the same line the Reporting tab shows.
    */
    list.push({
      key: `absence:${todo.t}`,
      chip: "! Needs review",
      tone: "warn",
      what: todo.t.trim(),
      note: todo.q?.trim() ? `The gate searched: ${todo.q.trim()}` : "Confirmation is still outstanding.",
      action: null,
      ref: null,
    });
  }

  for (const row of input.groundingRows ?? []) {
    /*
      A specific the draft states that nothing the check could read carries --
      not a claim that failed a check but one the desk refuses to print until a
      person confirms it, the same shape as an absence claim above. It names the
      kind so an editor can tell an invented date from an invented name, and it
      opens to nothing: there is no record to open, only the source the writer
      should have had.
    */
    list.push({
      key: `grounding:${row.kind}:${row.text}`,
      chip: "! Needs review",
      tone: "warn",
      what: row.text.trim(),
      note: `Not in any source the check could read (${GROUNDING_KIND_LABEL[row.kind]}).`,
      action: null,
      ref: null,
    });
  }

  const check = input.nameCheck;
  if (check) {
    const pending = check.rows.filter((row) => row.status === "unresolved");
    list.push({
      key: "names",
      chip: pending.length ? "! Needs review" : "✓ Reviewed",
      tone: pending.length ? "warn" : "ok",
      what:
        pending.length === 1
          ? `Name: ${pending[0]!.name}`
          : pending.length
            ? `Names: ${pending.map((row) => row.name).join(", ")}`
            : `Names: ${check.rows.length} checked against the record`,
      note: pending.length
        ? pending
            .map((row) => `${row.name} — ${row.reason || "the spelling was not settled by the check"}`)
            .join(" ")
        : check.note.trim() || "Every name in this draft was matched to a written source.",
      action: null,
      ref: null,
    });
  }

  const styleIssues = input.styleFindings.length;
  if (styleIssues > 0) {
    list.push({
      key: STYLE_ROW_KEY,
      chip: `! Style: ${styleIssues} issue${styleIssues === 1 ? "" : "s"}`,
      tone: "warn",
      what: "Style check (measured in code)",
      note: input.styleFindings[0]!.message,
      action: { kind: "style", label: "Fix these with the model" },
      /*
        The style row opens (unit CW2): the drawn row's press is a way to the
        work, and the work -- the tick list and the repair press -- is the
        page's Style check section, which is the row's disclosure body now
        rather than a section further down the main column the drawing does
        not draw.
      */
      ref: { kind: "style", id: STYLE_ROW_KEY },
    });
  }

  return list;
}
