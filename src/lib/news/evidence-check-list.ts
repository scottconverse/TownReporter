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
import { PAPER } from "../paper.ts";
import type {
  ClaimEvidenceRow,
  FindingCaptureEvidence,
  FindingEvidenceRow,
  FindingJudgment,
  ManualClaimEvidenceRow,
} from "./finding-evidence-review.ts";
import type { NameCheck } from "./name-check.ts";
import type { NoteTodo } from "./notes.ts";

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
      return { chip: "! Needs review", tone: "warn" };
    default:
      return captures.some(captureIsReadable)
        ? { chip: "! Needs review", tone: "warn" }
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
 */
function paperClock(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")} ${part("dayPeriod").toUpperCase() === "AM" ? "a.m." : "p.m."}`;
}

/**
 * The line under "Evidence check": "Ran 8:14 a.m. · Claude Sonnet · checked
 * against 3 captures".
 *
 * Each piece is dropped when it is not known, and the whole line is empty when
 * none of them are, so the heading is never followed by "Ran · · ".
 */
export function evidenceRanLine(input: {
  checkedAt: string | null;
  modelLabel: string;
  captures: number;
  timeZone?: string;
}): string {
  const parts: string[] = [];
  const ran = paperClock(input.checkedAt, input.timeZone ?? PAPER.timezone);
  if (ran) parts.push(`Ran ${ran}`);
  if (input.modelLabel.trim()) parts.push(input.modelLabel.trim());
  if (input.captures > 0) {
    parts.push(`checked against ${input.captures} capture${input.captures === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
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
    const { chip, tone } = judgmentChip(row.judgment.value, row.captures);
    list.push({
      key: `claim:${row.key}`,
      chip,
      tone,
      what: row.claim.fact.trim() || "A claim recorded for this draft.",
      note:
        row.captures.length === 0
          ? "No captured record was cited for this claim."
          : (row.captures[0]?.title ?? row.claim.url ?? "Cited record"),
      action: openRecordAction(row.captures),
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
