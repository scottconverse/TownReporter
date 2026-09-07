import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  getFindingEvidenceCapture,
  getFindingEvidenceReview,
  saveFindingEvidenceJudgment,
  type FindingEvidenceCaptureResult,
  type FindingEvidenceReview,
  type FindingJudgment,
} from "@/lib/news/finding-evidence-review";
import { InkButton } from "@/components/desk-chrome";
import { BusyLine, Notice } from "@/components/states";

type JudgmentDraft = {
  value: FindingJudgment;
  reason: string;
  contraryVersionId: number | null;
};

type CurrentDraft = {
  headline: string;
  dek: string;
  body: string;
  topic: string;
};

const judgmentLabels: Record<FindingJudgment, string> = {
  unreviewed: "Unreviewed",
  supports: "Supports",
  "does-not-support": "Does not support",
  contradicts: "Contradicts",
  "needs-reporting": "Needs reporting",
};

function sameDraft(current: CurrentDraft, review: FindingEvidenceReview) {
  return (
    current.headline === review.canonicalDraft.headline &&
    current.dek === review.canonicalDraft.dek &&
    current.body === review.canonicalDraft.body &&
    current.topic === review.canonicalDraft.topic
  );
}

function captureState(capture: FindingEvidenceReview["rows"][number]["captures"][number]) {
  if (!capture.available) return "Cited capture unavailable";
  if (!capture.readable) return "Cited capture exists, but no readable captured text is available";
  if (capture.excerptState === "found") return "Recorded excerpt found in cited version";
  if (capture.excerptState === "not-found") return "Recorded excerpt not found in cited version";
  return "No recorded excerpt to compare";
}

function draftsFrom(review: FindingEvidenceReview): Record<string, JudgmentDraft> {
  return Object.fromEntries(
    review.rows.map((row) => [
      row.key,
      {
        value: row.judgment.value,
        reason: row.judgment.reason,
        contraryVersionId: row.judgment.contraryVersionId,
      },
    ]),
  );
}

export function FindingEvidenceReviewPanel({
  leadId,
  currentDraft,
  disabled = false,
}: {
  leadId: number;
  currentDraft: CurrentDraft;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, JudgmentDraft>>({});
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(
    null,
  );
  const [reloadRequired, setReloadRequired] = useState(false);
  const [openedCapture, setOpenedCapture] = useState<FindingEvidenceCaptureResult | null>(null);
  const dirtyKeys = useRef(new Set<string>());
  const draftToken = useRef("");
  const reviewAtDraftStart = useRef<FindingEvidenceReview | null>(null);
  const discardOnReload = useRef(false);
  const appliedToken = useRef("");
  const reviewQuery = useQuery({
    queryKey: ["finding-evidence-review", leadId],
    queryFn: () => getFindingEvidenceReview({ data: { leadId } }),
    retry: false,
  });
  const review = reviewQuery.data?.ok ? reviewQuery.data.review : null;
  const localDraftChanged = review ? !sameDraft(currentDraft, review) : false;

  useEffect(() => {
    if (!review || appliedToken.current === review.evidenceToken) return;
    const fromServer = draftsFrom(review);
    if (discardOnReload.current || dirtyKeys.current.size === 0) {
      setDrafts(fromServer);
      dirtyKeys.current.clear();
      draftToken.current = "";
      reviewAtDraftStart.current = null;
      discardOnReload.current = false;
      setReloadRequired(false);
    } else {
      setDrafts((current) => {
        for (const key of dirtyKeys.current) {
          if (current[key]) fromServer[key] = current[key];
        }
        return fromServer;
      });
      setReloadRequired(true);
    }
    appliedToken.current = review.evidenceToken;
  }, [review]);

  const reload = async () => {
    discardOnReload.current = true;
    setFeedback({ kind: "warn", text: "Reloading the current evidence review…" });
    const result = await reviewQuery.refetch();
    if (!result.isError && result.data?.ok) {
      setDrafts(draftsFrom(result.data.review));
      appliedToken.current = result.data.review.evidenceToken;
      dirtyKeys.current.clear();
      draftToken.current = "";
      reviewAtDraftStart.current = null;
      discardOnReload.current = false;
      setReloadRequired(false);
      setFeedback({ kind: "ok", text: "Current evidence review loaded." });
      return;
    }
    discardOnReload.current = false;
    setFeedback({
      kind: "err",
      text:
        result.data && !result.data.ok
          ? result.data.error
          : "Could not reload the evidence review.",
    });
  };

  const captureRead = useMutation({
    mutationFn: (versionId: number) => {
      if (!review) throw new Error("The evidence review is not ready yet.");
      return getFindingEvidenceCapture({ data: { leadId, draftId: review.draftId, versionId } });
    },
    onMutate: () => setOpenedCapture(null),
    onSuccess: (result) => setOpenedCapture(result),
    onError: () =>
      setOpenedCapture({
        ok: false,
        code: "not-found",
        error: "Could not open that captured version.",
      }),
  });

  const save = useMutation({
    mutationFn: ({
      findingKey,
      judgment,
      hasReadableCapture,
    }: {
      findingKey: string;
      judgment: JudgmentDraft;
      hasReadableCapture: boolean;
    }) => {
      if (!review) throw new Error("The evidence review is not ready yet.");
      if (judgment.value === "supports" && !hasReadableCapture) {
        throw new Error("A support judgment needs a readable cited captured record.");
      }
      return saveFindingEvidenceJudgment({
        data: {
          leadId,
          draftId: review.draftId,
          findingKey,
          judgment: judgment.value,
          reason: judgment.reason,
          contraryVersionId: judgment.value === "contradicts" ? judgment.contraryVersionId : null,
          evidenceToken: draftToken.current || review.evidenceToken,
        },
      });
    },
    onSuccess: async (result, variables) => {
      if (!result.ok) {
        if (result.code === "conflict") {
          setFeedback({
            kind: "warn",
            text: "The draft or cited evidence changed. Reload the current review before recording a fresh judgment.",
          });
          setReloadRequired(true);
          return;
        }
        setFeedback({ kind: "err", text: result.error });
        return;
      }
      dirtyKeys.current.delete(variables.findingKey);
      const peerKeys = [...dirtyKeys.current];
      const previous = reviewAtDraftStart.current;
      const peersUnchanged = Boolean(
        previous &&
        previous.draftId === result.review.draftId &&
        previous.contentToken === result.review.contentToken &&
        peerKeys.every((key) => {
          const before = previous.rows.find((row) => row.key === key);
          const after = result.review.rows.find((row) => row.key === key);
          return JSON.stringify(before) === JSON.stringify(after);
        }),
      );
      qc.setQueryData(["finding-evidence-review", leadId], result);
      appliedToken.current = result.review.evidenceToken;
      if (peerKeys.length > 0 && peersUnchanged) {
        setDrafts((current) => {
          const refreshed = draftsFrom(result.review);
          for (const key of peerKeys) if (current[key]) refreshed[key] = current[key];
          return refreshed;
        });
        draftToken.current = result.review.evidenceToken;
        reviewAtDraftStart.current = result.review;
        setReloadRequired(false);
        setFeedback({
          kind: "ok",
          text: "Evidence judgment saved. Unsaved edits to another finding were retained.",
        });
      } else if (peerKeys.length > 0) {
        setReloadRequired(true);
        setFeedback({
          kind: "ok",
          text: "Evidence judgment saved. Unsaved edits remain visible, but their review changed; reload before saving them.",
        });
      } else {
        draftToken.current = "";
        reviewAtDraftStart.current = null;
        setDrafts(draftsFrom(result.review));
        setFeedback({ kind: "ok", text: "Evidence judgment saved." });
      }
    },
    onError: (error) => {
      setFeedback({
        kind: "err",
        text: error instanceof Error ? error.message : "Evidence judgment could not be saved.",
      });
    },
  });

  function updateDraft(key: string, update: Partial<JudgmentDraft>) {
    if (!dirtyKeys.current.size && review) {
      draftToken.current = review.evidenceToken;
      reviewAtDraftStart.current = review;
    }
    dirtyKeys.current.add(key);
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? { value: "unreviewed", reason: "", contraryVersionId: null }),
        ...update,
      },
    }));
  }

  return (
    <section
      id="evidence-review"
      className="mt-8 border-t border-rule pt-5"
      aria-labelledby="finding-evidence-review-heading"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="kick">Recorded findings</p>
          <h2 id="finding-evidence-review-heading" className="h2">
            Finding evidence review
          </h2>
        </div>
        {review ? (
          <p className="meta">
            {review.rows.length} recorded {review.rows.length === 1 ? "finding" : "findings"}
          </p>
        ) : null}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        This list contains only recorded findings. A passage match confirms that the recorded words
        appear in a cited version; it does not decide whether a finding is true. A missing capture
        or passage is a mechanical state, not a contradiction. A newer capture is material to
        review, not proof that the cited record is false.
      </p>

      {reviewQuery.isPending ? <BusyLine label="Loading recorded finding evidence…" /> : null}
      {reviewQuery.isError ? (
        <Notice kind="err">
          Could not load the evidence review.{" "}
          <button
            type="button"
            className="inline-link"
            onClick={() => void reload()}
            disabled={reviewQuery.isRefetching}
          >
            Try again
          </button>
        </Notice>
      ) : null}
      {reviewQuery.data && !reviewQuery.data.ok ? (
        <Notice kind="err">
          {reviewQuery.data.error}
          {reviewQuery.data.code !== "invalid-input" ? (
            <>{" "}<button
              type="button"
              className="inline-link"
              onClick={() => void reload()}
              disabled={reviewQuery.isRefetching}
            >
              Try again
            </button></>
          ) : null}
        </Notice>
      ) : null}
      {feedback ? <Notice kind={feedback.kind}>{feedback.text}</Notice> : null}

      {captureRead.isPending ? <BusyLine label="Opening captured text…" /> : null}
      {openedCapture ? (
        <div className="mt-4 border border-rule bg-paper-2 p-4" role="region" aria-label="Captured text">
          {openedCapture.ok ? (
            <>
              <p className="font-medium text-ink">{openedCapture.capture.title ?? "Captured version"}</p>
              <p className="mt-1 break-all text-sm text-muted">{openedCapture.capture.url}</p>
              <p className="mt-1 text-sm text-muted">
                {openedCapture.capture.capturedAt
                  ? `Captured ${openedCapture.capture.capturedAt}`
                  : "Capture time unavailable"}
              </p>
              {openedCapture.capture.fullText.trim() ? (
                <pre className="read-full mt-3">{openedCapture.capture.fullText}</pre>
              ) : (
                <p className="mt-3 text-sm text-muted">This captured version has no readable text.</p>
              )}
            </>
          ) : (
            <Notice kind="err">{openedCapture.error}</Notice>
          )}
          <InkButton tone="quiet" small onClick={() => setOpenedCapture(null)}>
            Close captured text
          </InkButton>
        </div>
      ) : null}

      {review && localDraftChanged ? (
        <Notice kind="warn">
          Save the current headline, dek, body, and section before recording a judgment. Judgments
          bind to the exact saved draft and cited evidence.
        </Notice>
      ) : null}
      {review && reloadRequired ? (
        <Notice kind="warn">
          The saved review changed while this page has unsaved judgment edits.{" "}
          <button
            type="button"
            className="inline-link"
            onClick={() => void reload()}
            disabled={reviewQuery.isRefetching}
          >
            Reload current review and discard unsaved judgment edits
          </button>
        </Notice>
      ) : null}

      {review && review.rows.length === 0 ? (
        <div className="mt-4 border border-rule bg-paper-2 p-4" role="status">
          <p className="font-medium text-ink">No recorded findings for this draft.</p>
          <p className="mt-1 text-sm text-muted">
            This review does not inventory every claim in the story.
          </p>
        </div>
      ) : null}

      {review?.rows.map((row, index) => {
        const judgment = drafts[row.key] ?? {
          value: row.judgment.value,
          reason: row.judgment.reason,
          contraryVersionId: row.judgment.contraryVersionId,
        };
        const citedVersions = row.captures.filter(
          (capture, captureIndex, captures) =>
            capture.available &&
            capture.readable &&
            capture.versionId != null &&
            captures.findIndex((candidate) => candidate.versionId === capture.versionId) ===
              captureIndex,
        );
        const maySave = !disabled && !localDraftChanged && !reloadRequired && !save.isPending;
        return (
          <article key={row.key} className="mt-5 border border-rule bg-paper p-4 sm:p-5">
            <p className="text-sm font-medium tracking-[0.14em] text-muted uppercase">
              Finding {index + 1}
            </p>
            <p className="mt-2 whitespace-pre-wrap font-medium text-ink">{row.finding.text}</p>
            {row.finding.excerpt ? (
              <blockquote className="mt-3 border-l-2 border-rust pl-3 text-sm text-ink-2">
                <span className="font-medium">Recorded passage: </span>
                {row.finding.excerpt}
              </blockquote>
            ) : (
              <p className="mt-3 text-sm text-muted">
                No recorded passage was supplied for this finding.
              </p>
            )}
            {row.finding.locators.length ? (
              <p className="mt-2 text-sm text-muted">Locator: {row.finding.locators.join(" · ")}</p>
            ) : null}
            {row.finding.sourceUrls.length ? (
              <p className="mt-2 break-all text-sm text-muted">
                Source: {row.finding.sourceUrls.join(" · ")}
              </p>
            ) : null}

            <div className="mt-4 border-t border-rule pt-3">
              <p className="text-sm font-medium tracking-[0.14em] text-muted uppercase">
                Mechanical record checks
              </p>
              {row.captures.length ? (
                <ul className="mt-2 space-y-3">
                  {row.captures.map((capture, captureIndex) => (
                    <li
                      key={`${capture.versionId ?? "missing"}-${capture.captureEventId ?? captureIndex}`}
                      className="border-l border-rule pl-3 text-sm"
                    >
                      <p className="font-medium text-ink">
                        {capture.title ?? capture.url ?? "Cited capture"}
                      </p>
                      <p className="mt-1 text-muted">
                        {captureState(capture)}
                        {capture.capturedAt ? ` · captured ${capture.capturedAt}` : ""}
                      </p>
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        {capture.viewHref && capture.versionId != null ? (
                          <button
                            type="button"
                            className="inline-link"
                            onClick={() => captureRead.mutate(capture.versionId!)}
                            disabled={captureRead.isPending}
                          >
                            View cited captured version
                          </button>
                        ) : null}
                        {capture.newerCapture ? (
                          <button
                            type="button"
                            className="inline-link"
                            onClick={() => captureRead.mutate(capture.newerCapture!.versionId)}
                            disabled={captureRead.isPending}
                          >
                            Review newer capture
                            {capture.newerCapture.capturedAt
                              ? ` (${capture.newerCapture.capturedAt})`
                              : ""}
                          </button>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted">
                  No cited captured version or capture event was recorded for this finding.
                </p>
              )}
            </div>

            <div className="mt-5 border-t border-rule pt-4">
              <p className="text-sm font-medium tracking-[0.14em] text-muted uppercase">
                Editor judgment
              </p>
              <label
                className="mt-2 block text-sm font-medium text-ink"
                htmlFor={`finding-judgment-${index}`}
              >
                Judgment
              </label>
              <select
                id={`finding-judgment-${index}`}
                className="mt-1 min-h-11 w-full border border-rule bg-paper px-3 text-sm sm:max-w-sm"
                value={judgment.value}
                disabled={disabled || save.isPending}
                onChange={(event) =>
                  updateDraft(row.key, {
                    value: event.target.value as FindingJudgment,
                    contraryVersionId:
                      event.target.value === "contradicts" ? judgment.contraryVersionId : null,
                  })
                }
              >
                {(Object.keys(judgmentLabels) as FindingJudgment[]).map((value) => (
                  <option key={value} value={value}>
                    {judgmentLabels[value]}
                  </option>
                ))}
              </select>
              <label
                className="mt-3 block text-sm font-medium text-ink"
                htmlFor={`finding-reason-${index}`}
              >
                Reason{" "}
                {judgment.value === "contradicts" ? "(required for contradiction)" : "(optional)"}
              </label>
              <textarea
                id={`finding-reason-${index}`}
                className="mt-1 min-h-24 w-full border border-rule bg-paper p-3 text-sm"
                value={judgment.reason}
                maxLength={2000}
                disabled={disabled || save.isPending}
                onChange={(event) => updateDraft(row.key, { reason: event.target.value })}
              />
              {judgment.value === "contradicts" ? (
                <>
                  <label
                    className="mt-3 block text-sm font-medium text-ink"
                    htmlFor={`finding-contrary-${index}`}
                  >
                    Cited contrary captured evidence
                  </label>
                  <select
                    id={`finding-contrary-${index}`}
                    className="mt-1 min-h-11 w-full border border-rule bg-paper px-3 text-sm sm:max-w-sm"
                    value={judgment.contraryVersionId ?? ""}
                    disabled={disabled || save.isPending}
                    onChange={(event) =>
                      updateDraft(row.key, {
                        contraryVersionId: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                  >
                    <option value="">Choose a cited captured version</option>
                    {citedVersions.map((capture) => (
                      <option key={capture.versionId} value={capture.versionId!}>
                        {capture.title ?? capture.url ?? `Captured version ${capture.versionId}`}
                      </option>
                    ))}
                  </select>
                  {!citedVersions.length ? (
                    <p className="mt-1 text-sm text-muted">
                      No available cited capture can support a contradiction judgment.
                    </p>
                  ) : null}
                </>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-3">
                <InkButton
                  disabled={!maySave}
                  onClick={() =>
                    save.mutate({
                      findingKey: row.key,
                      judgment,
                      hasReadableCapture: citedVersions.length > 0,
                    })
                  }
                >
                  {save.isPending ? "Saving judgment…" : "Save judgment"}
                </InkButton>
                {localDraftChanged ? (
                  <span className="self-center text-sm text-muted">Save the draft first.</span>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
