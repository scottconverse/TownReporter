import {
  captureStateSentence,
  captureSupportLine,
  formatCaptureTimestamp,
  groupDisplayCaptures,
} from "@/lib/news/finding-evidence-display";
import type {
  FindingCaptureEvidence,
  ManualClaimReferenceRelation,
} from "@/lib/news/finding-evidence-review";

type CaptureRow = FindingCaptureEvidence & { relation?: ManualClaimReferenceRelation };

const citedRecordCopy = {
  finding: {
    heading: "Sources for this finding",
    fallback: "Saved source copy",
    empty: "No saved source copy is attached to this finding yet.",
  },
  claim: {
    heading: "Sources for this claim",
    fallback: "Saved source copy",
    empty: "No saved source copy is attached to this claim yet.",
  },
} as const;

const relationLabel: Record<ManualClaimReferenceRelation, string> = {
  corroborating: "Supports this claim",
  contrary: "Raises a question about this claim",
  context: "Provides context",
};

export function CitedRecordChecks({
  variant,
  captures,
  passage,
  onOpen,
  pending,
}: {
  variant: "finding" | "claim";
  captures: readonly CaptureRow[];
  passage?: string | null;
  onOpen: (versionId: number) => void;
  pending: boolean;
}) {
  const copy = citedRecordCopy[variant];
  const displayedCaptures = groupDisplayCaptures([...captures]);
  return (
    <section className="mt-4 border-t border-rule pt-3" aria-label={copy.heading}>
      <h3 className="text-lg font-semibold text-ink">{copy.heading}</h3>
      {displayedCaptures.length ? (
        <ul className="mt-2 space-y-3">
          {displayedCaptures.map((group, captureIndex) => {
            const capture = group.capture;
            const savedAt = formatCaptureTimestamp(capture.capturedAt);
            const passageIsActionable = capture.available && capture.readable && !capture.takenDown;
            const stateShownBeforeDetails = !passage || !passageIsActionable;
            return (
              <li
                key={`${capture.versionId ?? "missing"}-${capture.captureEventId ?? captureIndex}`}
                className="border-l border-rule pl-3 text-base"
              >
                {capture.relation ? (
                  <p className="font-medium text-muted">{relationLabel[capture.relation]}</p>
                ) : null}
                <h4 className="font-medium text-ink">
                  {capture.title ?? capture.url ?? copy.fallback}
                </h4>
                {savedAt ? <p className="mt-1 text-muted">Saved {savedAt}</p> : null}
                {passage && passageIsActionable ? (
                  <blockquote className="mt-2 border-l-2 border-rule pl-3 text-ink">
                    <span className="block text-sm font-medium text-muted">Passage to review</span>
                    <span className="whitespace-pre-wrap">{passage}</span>
                  </blockquote>
                ) : null}
                {!passage || !passageIsActionable ? (
                  <p className="mt-1 text-muted">{captureStateSentence(capture)}</p>
                ) : null}
                {capture.viewHref && capture.versionId != null ? (
                  <p className="mt-2">
                    <button
                      type="button"
                      className="inline-link"
                      onClick={() => onOpen(capture.versionId!)}
                      disabled={pending}
                    >
                      Open the saved source copy
                    </button>
                  </p>
                ) : null}
                {capture.newerCapture ? (
                  <p className="mt-1">
                    <button
                      type="button"
                      className="inline-link"
                      onClick={() => onOpen(capture.newerCapture!.versionId)}
                      disabled={pending}
                    >
                      Review a newer saved copy
                      {formatCaptureTimestamp(capture.newerCapture.capturedAt)
                        ? ` from ${formatCaptureTimestamp(capture.newerCapture.capturedAt)}`
                        : ""}
                    </button>
                  </p>
                ) : null}
                {pending ? (
                  <p className="mt-1 text-base text-muted" role="status">
                    Opening the saved copy…
                  </p>
                ) : null}
                <details className="mt-2 text-sm text-muted">
                  <summary className="cursor-pointer">Details for support</summary>
                  <div className="mt-1 space-y-1">
                    {!stateShownBeforeDetails ? <p>{captureStateSentence(capture)}</p> : null}
                    {capture.url ? <p className="break-all">Source link: {capture.url}</p> : null}
                    {group.artifactVersionReference || group.captureEventIds.length ? (
                      <p>{captureSupportLine(group)}</p>
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-base text-muted">{copy.empty}</p>
      )}
    </section>
  );
}
