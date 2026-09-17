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
