import type { FindingCaptureEvidence } from "./finding-evidence-review.ts";

/**
 * Audit item 14: the one label for a judgment an editor recorded knowing it
 * from OUTSIDE the captures. It is printed wherever a judgment is shown, so the
 * desk never implies the captured records ground a judgment they do not.
 */
export const NO_CAPTURE_JUDGMENT_LABEL = "editor's judgment, no capture";

/** That label, or null for an ordinary record-grounded judgment. */
export function noCaptureJudgmentLabel(judgment: {
  noCapture?: boolean;
}): string | null {
  return judgment.noCapture ? NO_CAPTURE_JUDGMENT_LABEL : null;
}

export type DisplayCaptureGroup<T extends FindingCaptureEvidence = FindingCaptureEvidence> = {
  capture: T;
  captures: T[];
  artifactVersionReference: boolean;
  captureEventIds: number[];
};

function hasSameDisplayState(a: FindingCaptureEvidence, b: FindingCaptureEvidence) {
  return (
    a.available === b.available &&
    a.readable === b.readable &&
    a.excerptState === b.excerptState &&
    a.url === b.url &&
    a.title === b.title &&
    a.capturedAt === b.capturedAt &&
    a.viewHref === b.viewHref &&
    a.newerCapture?.versionId === b.newerCapture?.versionId &&
    a.newerCapture?.capturedAt === b.newerCapture?.capturedAt
  );
}

export function groupDisplayCaptures<T extends FindingCaptureEvidence>(
  captures: T[],
): DisplayCaptureGroup<T>[] {
  const groups: DisplayCaptureGroup<T>[] = [];

  for (const capture of captures) {
    const existing =
      capture.available && capture.versionId != null
        ? groups.find(
            (group) =>
              group.capture.available &&
              group.capture.versionId === capture.versionId &&
              hasSameDisplayState(group.capture, capture),
          )
        : undefined;
    if (!existing) {
      groups.push({
        capture,
        captures: [capture],
        artifactVersionReference: capture.versionId != null && capture.captureEventId == null,
        captureEventIds: capture.captureEventId == null ? [] : [capture.captureEventId],
      });
      continue;
    }
    existing.captures.push(capture);
    if (capture.captureEventId == null) existing.artifactVersionReference = true;
    else if (!existing.captureEventIds.includes(capture.captureEventId)) {
      existing.captureEventIds.push(capture.captureEventId);
    }
  }

  return groups;
}

/**
 * What the desk says about one captured record, in an editor's words (PUB1).
 *
 * "No recorded excerpt to compare" was the line on the owner's story, above a
 * precise capture time and a version number, and it explains nothing: it reads
 * as a defect in the capture rather than as a claim that never carried an
 * excerpt to compare. It is replaced by a sentence that says what the card IS
 * -- the saved copy the draft was written from -- and what is missing from it.
 *
 * The rest are the states a person can act on and keep their own words: the
 * record was taken down at the publisher's request, the record exists but its
 * text could not be read, or the excerpt the check recorded was (or was not)
 * found in the copy cited.
 */
export function captureStateSentence(
  capture: FindingCaptureEvidence,
  recordLabel = "Cited capture",
): string {
  if (!capture.available) return `${recordLabel} unavailable`;
  /*
    Taken down before "not readable", because it is the reason this record has
    no readable text -- and "exists, but no readable captured text is
    available" would read as a defect in the capture rather than a decision the
    owner recorded, with a reason, in the audit trail.
  */
  if (capture.takenDown) return "Excerpt removed at the publisher's request";
  if (!capture.readable) return `${recordLabel} exists, but no readable captured text is available`;
  if (capture.excerptState === "found") return "Recorded excerpt found in cited version";
  if (capture.excerptState === "not-found") return "Recorded excerpt not found in cited version";
  return "No excerpt was saved with this claim, so there is nothing to put side by side. This is the saved copy the draft was written from.";
}

/**
 * The newsroom's own time zone, for reading a captured record (FA10).
 *
 * The desk serves one newsroom in Mountain time; a capture timestamp stored as
 * a raw GMT string is unreadable there -- "Sat, 11 Oct 2026 17:58:00 GMT" makes
 * an editor do arithmetic against their own clock to know whether the copy is
 * from today. The readable date is shown FIRST and the raw string is kept
 * beside it, so nothing is lost.
 */
export const NEWSROOM_TIME_ZONE = "America/Denver";

/**
 * Read a stored capture timestamp as the moment it records.
 *
 * WHY THIS IS NOT `new Date(value)`. A capture stored as "Sat, 11 Oct 2026
 * 17:58:00 GMT" is not read the same way everywhere: this machine's runtime
 * turns it into 11:58 MOUNTAIN (a bug in the runtime's handling of that
 * format), while the ISO form of the same moment reads correctly. An editor
 * comparing the copy's time with the story's clock would be hours out. So the
 * RFC/GMT form is converted to the ISO form the runtime reads as written, and
 * anything else is handed to `Date` unchanged.
 */
function parseCaptureTimestamp(value: string): Date {
  const trimmed = value.trim();
  const gmt = /^(\w{3}),\s+(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+GMT$/.exec(
    trimmed,
  );
  if (gmt) {
    const months = [
      "jan", "feb", "mar", "apr", "may", "jun",
      "jul", "aug", "sep", "oct", "nov", "dec",
    ];
    const month = months.indexOf(gmt[3]!.toLowerCase()) + 1;
    if (month > 0) {
      const iso = `${gmt[4]}-${String(month).padStart(2, "0")}-${gmt[2]!.padStart(2, "0")}T${gmt[5]}:${gmt[6]}:${gmt[7]}Z`;
      return new Date(iso);
    }
  }
  let normalized = trimmed.replace(" ", "T");
  normalized = normalized.replace(/(\.\d{3})\d+/, "$1");
  normalized = normalized.replace(/([+-]\d{2})$/, "$1:00");
  return new Date(normalized);
}

/**
 * A captured-record timestamp in Mountain time, in the words an editor reads
 * back to a source ("Oct. 11, 2026, 11:58 a.m.").
 *
 * Returns null for a value that does not carry a real moment, so the caller
 * keeps the original string instead of printing a fabricated date.
 */
export function formatCaptureMountainTime(
  value: string | null | undefined,
  timeZone: string = NEWSROOM_TIME_ZONE,
): string | null {
  if (!value?.trim()) return null;
  const date = parseCaptureTimestamp(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  })
    .format(date)
    .replace(/^(\w{3}) (\d)/, "$1. $2");
}

/**
 * The plain lead line at the top of one captured record (walk row A10).
 *
 * WHY. The owner's walk found the record cards opened with a raw GMT string,
 * saved-copy and capture-event numbers, "Exact draft provenance" and repeated
 * mechanical explanations, so the editor had to sift through all of it to reach
 * the one thing they came for. This line says, in order: WHEN the copy was
 * taken, WHAT it is (the passage, or the record's title), and WHAT TO DO with
 * it. Every identifier and explanation below the line is kept.
 */
export function capturedRecordLeadLine(input: {
  kind: "passage" | "record";
  title?: string | null;
  capturedAt?: string | null;
  action: string;
  timeZone?: string;
}): string {
  const when = formatCaptureMountainTime(input.capturedAt, input.timeZone);
  const title = input.title?.trim() || null;
  const what =
    input.kind === "passage"
      ? title
        ? `Captured copy of “${title}” for the passage below`
        : "Captured copy for the passage below"
      : title
        ? `Captured copy of “${title}”`
        : "Captured copy";
  const parts: string[] = [];
  if (when) parts.push(`Saved ${when} Mountain time.`);
  parts.push(`${what}. ${input.action}`);
  return `${parts.join(" ")}`;
}

/**
 * The ids behind one captured record, for a person to quote (PUB1).
 *
 * "Artifact version 4645 · Capture event 12 (version 4645)" is the desk's
 * private vocabulary. The numbers are worth keeping -- an editor asking
 * support to look at a capture needs to name it -- so they are kept, said in
 * words rather than column names, on their own smaller line labelled "For
 * support" (see `CitedRecordChecks`).
 */
export function captureSupportLine(group: DisplayCaptureGroup): string {
  const versionId = group.capture.versionId ?? null;
  const parts: string[] = [];
  if (group.artifactVersionReference && versionId != null) {
    parts.push(`Saved copy number ${versionId} of the page`);
  }
  for (const captureEventId of group.captureEventIds) {
    parts.push(versionId != null ? `capture event ${captureEventId} (saved copy ${versionId})` : `capture event ${captureEventId}`);
  }
  return parts.join(" · ");
}

/** The smallest thing the desk needs from a DOM node to reveal a panel. */
export type Revealable = {
  scrollIntoView?: (options?: { block?: "start" | "center" }) => void;
  focus?: () => void;
};

/**
 * Bring the opened captured text into view and put the cursor on it (PUB1).
 *
 * The owner pressed "View exact captured version" in the narrow Checks sidebar
 * and nothing appeared: the captured text WAS rendered, at the foot of a panel
 * far below the link, so on a long review the editor saw a flash and no text.
 * The panel renders itself at the bottom of "Claims & evidence" and the link
 * that opens it sits in the middle of it, so nothing but a scroll can join the
 * two.
 *
 * Focus, not just the scroll, because the reason for pressing is to read what
 * is there -- a scroll with the cursor left on a button leaves the next Tab
 * starting from the link the editor just used.
 */
export function revealOpenedCapture(element: Revealable | null | undefined): void {
  if (!element) return;
  element.focus?.();
  element.scrollIntoView?.({ block: "start" });
}
