import type { FindingCaptureEvidence } from "./finding-evidence-review.ts";

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
