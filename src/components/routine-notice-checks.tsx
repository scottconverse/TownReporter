import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InkButton, SecHead, announceToDesk } from "@/components/desk-chrome";
import {
  ROUTINE_NOTICE_FORMATS,
  type RoutineNoticeApproval,
  type RoutineNoticePolicy,
} from "@/lib/news/routine-notice-policy";
import {
  checkRoutineNoticeSource,
  getRoutineNoticeCapturedText,
  getRoutineNoticeChecks,
  type RoutineNoticeCheckGroup,
} from "@/lib/news/routine-notice-checks";

type CheckFeedback = { kind: "ok" | "error"; text: string; retryRequestId?: string };

function pairKey(approval: Pick<RoutineNoticeApproval, "sourceId" | "sourceUrl" | "formatKey">) {
  return `${approval.sourceId}:${approval.sourceUrl}:${approval.formatKey}`;
}

function groupKey(group: RoutineNoticeCheckGroup) {
  return `${group.source.id}:${group.source.url}:${group.formatKey}`;
}

function formatLabel(formatKey: RoutineNoticeApproval["formatKey"]) {
  return ROUTINE_NOTICE_FORMATS.find((format) => format.key === formatKey)?.label ?? formatKey;
}

function stateLabel(state: RoutineNoticeCheckGroup["state"]) {
  switch (state) {
    case "parsed":
      return "Parsed structurally";
    case "parsed-with-conflicts":
      return "Parsed structurally with conflicts";
    case "refused":
      return "Refused";
    case "capture-failed":
      return "Capture failed";
    case "adapter-unavailable":
      return "Adapter unavailable";
    case "evidence-unavailable":
      return "Captured evidence unavailable";
  }
}

function formatCheckedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** Manual, owner-only structural checks for already-approved routine source/format pairs. */
export function RoutineNoticeChecks({ policy }: { policy: RoutineNoticePolicy }) {
  const qc = useQueryClient();
  const checks = useQuery({
    queryKey: ["routine-notice-checks"],
    queryFn: () => getRoutineNoticeChecks({ data: {} }),
  });
  const [feedback, setFeedback] = useState<Record<string, CheckFeedback>>({});
  const [pendingPairs, setPendingPairs] = useState<Set<string>>(() => new Set());
  const [opened, setOpened] = useState<{
    checkId: number;
    result: Awaited<ReturnType<typeof getRoutineNoticeCapturedText>>;
  } | null>(null);

  const approvals = useMemo(
    () => policy.approvals.filter((approval) => approval.valid),
    [policy.approvals],
  );
  const groups = useMemo(() => (checks.data?.ok ? checks.data.groups : []), [checks.data]);
  const checksError = checks.data?.ok === false ? checks.data.error : null;
  const newestByPair = useMemo(() => {
    const out = new Map<string, RoutineNoticeCheckGroup>();
    for (const group of groups) {
      const key = groupKey(group);
      if (!out.has(key)) out.set(key, group);
    }
    return out;
  }, [groups]);

  const check = useMutation({
    mutationFn: ({ approval, requestId }: { approval: RoutineNoticeApproval; requestId: string }) =>
      checkRoutineNoticeSource({
        data: {
          requestId,
          sourceId: approval.sourceId,
          sourceUrl: approval.sourceUrl,
          formatKey: approval.formatKey,
          expectedPolicyRevision: policy.revision,
        },
      }),
    onMutate: (variables) => {
      const key = pairKey(variables.approval);
      setPendingPairs((current) => new Set(current).add(key));
    },
    onSuccess: (result, variables) => {
      const key = pairKey(variables.approval);
      if (!result.ok) {
        setFeedback((current) => ({ ...current, [key]: { kind: "error", text: result.error } }));
        announceToDesk(result.error);
        if (result.code === "conflict") void checks.refetch();
        return;
      }
      qc.setQueryData(["routine-notice-checks"], (current: unknown) => {
        const prior = current as { ok?: boolean; groups?: RoutineNoticeCheckGroup[] } | undefined;
        const existing = prior?.ok && Array.isArray(prior.groups) ? prior.groups : [];
        return {
          ok: true,
          groups: [
            result.check,
            ...existing.filter((group) => group.checkId !== result.check.checkId),
          ],
        };
      });
      const text = `${formatLabel(variables.approval.formatKey)} checked. Review the structural result below.`;
      setFeedback((current) => ({ ...current, [key]: { kind: "ok", text } }));
      announceToDesk(text);
    },
    onError: (error, variables) => {
      const key = pairKey(variables.approval);
      const text = error instanceof Error ? error.message : "Routine notice check did not finish.";
      setFeedback((current) => ({
        ...current,
        [key]: { kind: "error", text, retryRequestId: variables.requestId },
      }));
      announceToDesk(text);
    },
    onSettled: (_result, _error, variables) => {
      const key = pairKey(variables.approval);
      setPendingPairs((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    },
  });

  const capturedText = useMutation({
    mutationFn: (checkId: number) => getRoutineNoticeCapturedText({ data: { checkId } }),
    onSuccess: (result, checkId) => setOpened({ checkId, result }),
    onError: (error, checkId) => {
      const text = error instanceof Error ? error.message : "Could not open captured text.";
      setOpened({ checkId, result: { ok: false, code: "not-found", error: text } });
      announceToDesk(text);
    },
  });

  const startCheck = (approval: RoutineNoticeApproval, retryRequestId?: string) => {
    check.mutate({ approval, requestId: retryRequestId ?? crypto.randomUUID() });
  };

  return (
    <section id="routine-notice-checks" className="mt-6 max-w-3xl border-t border-rule pt-6">
      <SecHead
        title="Manual notice checks"
        sub="Check an approved source and format one time from this Server page."
      />
      <p className="mt-3 text-sm text-muted">
        Manual structural check only. It creates no lead, draft, article, scheduled work, or
        publication.
      </p>
      {checks.isError || checksError ? (
        <div className="mt-4 text-sm text-rust" role="alert">
          <p>{checks.isError ? "Could not read manual notice checks." : checksError}</p>
          <InkButton
            tone="quiet"
            small
            onClick={() => void checks.refetch()}
            disabled={checks.isFetching}
          >
            {checks.isFetching ? "Reloading…" : "Reload checks"}
          </InkButton>
        </div>
      ) : null}
      {approvals.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          Save an accepted source-and-format permission before running a manual check.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-rule border-y border-rule">
          {approvals.map((approval) => {
            const key = pairKey(approval);
            const latest = newestByPair.get(key);
            const note = feedback[key];
            const pendingForPair = pendingPairs.has(key);
            const blocked =
              policy.paused ||
              (latest != null &&
                (!latest.policy.approvalValid ||
                  latest.policy.paused ||
                  latest.canCheck === false));
            return (
              <li key={key} className="py-4">
                <p className="font-medium">{approval.sourceTitle || approval.sourceUrl}</p>
                <p className="mt-1 break-all text-sm text-muted">{approval.sourceUrl}</p>
                <p className="mt-1 text-sm text-muted">{formatLabel(approval.formatKey)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <InkButton
                    small
                    disabled={pendingForPair || blocked}
                    onClick={() => startCheck(approval)}
                  >
                    {pendingForPair ? "Checking…" : "Check captured notices"}
                  </InkButton>
                  <a
                    href={latest?.source.url ?? approval.sourceUrl}
                    className="text-sm underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open original source
                  </a>
                </div>
                {policy.paused || latest?.policy.paused ? (
                  <p className="mt-2 text-sm text-muted">
                    Checks are paused in routine notice permissions.
                  </p>
                ) : null}
                {!policy.paused && latest && (!latest.policy.approvalValid || !latest.canCheck) ? (
                  <p className="mt-2 text-sm text-rust">
                    This saved source and format cannot be checked until its current permission is
                    valid.
                  </p>
                ) : null}
                {note ? (
                  <div
                    className={
                      note.kind === "error" ? "mt-2 text-sm text-rust" : "mt-2 text-sm text-muted"
                    }
                    role={note.kind === "error" ? "alert" : "status"}
                  >
                    <p>{note.text}</p>
                    {note.retryRequestId ? (
                      <button
                        type="button"
                        className="mt-1 underline"
                        disabled={pendingForPair}
                        onClick={() => startCheck(approval, note.retryRequestId)}
                      >
                        Retry this check
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {latest ? (
                  <CheckGroup
                    group={latest}
                    opened={opened?.checkId === latest.checkId ? opened.result : null}
                    opening={capturedText.isPending && capturedText.variables === latest.checkId}
                    onRead={() => capturedText.mutate(latest.checkId)}
                    onClose={() => setOpened(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CheckGroup({
  group,
  opened,
  opening,
  onRead,
  onClose,
}: {
  group: RoutineNoticeCheckGroup;
  opened: Awaited<ReturnType<typeof getRoutineNoticeCapturedText>> | null;
  opening: boolean;
  onRead: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-4 border border-rule bg-paper-2 p-4 text-sm">
      <p className="font-medium">{stateLabel(group.state)}</p>
      <p className="mt-1 text-muted">Checked {formatCheckedAt(group.checkedAt)}</p>
      <p className="mt-2 text-muted">
        Parsed {group.counts.parsed} · Refused {group.counts.refused} · Conflicts{" "}
        {group.counts.conflicts}
      </p>
      {group.capture ? (
        <p className="mt-2 text-muted">
          Captured {formatCheckedAt(group.capture.observedAt)}.
          {group.newerCaptureAvailable ? " A newer capture is available." : ""}
        </p>
      ) : null}
      {group.capture ? (
        <p className="mt-3">
          <button type="button" className="underline" onClick={onRead} disabled={opening}>
            {opening ? "Opening captured text…" : "Read captured text"}
          </button>
        </p>
      ) : null}
      {opened ? (
        <div
          className="mt-3 border border-rule bg-paper p-3"
          role="region"
          aria-label="Captured text"
        >
          {opened.ok === true ? (
            <>
              <p className="font-medium">{opened.capture.title || "Captured source"}</p>
              <p className="mt-1 break-all text-muted">{opened.capture.url}</p>
              <p className="mt-1 text-muted">
                Raw captured HTML{opened.capture.truncated ? " (bounded at the capture limit)" : ""}
                .
              </p>
              <pre className="read-full mt-3">{opened.capture.fullText}</pre>
            </>
          ) : (
            <p className="text-rust" role="alert">
              {opened.error}
            </p>
          )}
          <InkButton tone="quiet" small onClick={onClose}>
            Close captured text
          </InkButton>
        </div>
      ) : null}
      {group.refusals.length ? (
        <div className="mt-4">
          <p className="font-medium">Grouped refusals</p>
          <ul className="mt-2 space-y-2">
            {group.refusals.map((refusal) => (
              <li key={`${refusal.code}:${refusal.locator}`}>
                <span className="font-medium">{refusal.code}</span> · {refusal.count} ·{" "}
                {refusal.locator}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {group.candidates.length ? (
        <div className="mt-4">
          <p className="font-medium">Recorded structural candidates</p>
          <p className="mt-1 text-muted">These are not publication eligibility decisions.</p>
          <ul className="mt-2 space-y-3">
            {group.candidates.map((candidate) => (
              <li key={candidate.id} className="border-l border-rule pl-3">
                <p>
                  <span className="font-medium">{candidate.variant}</span>
                  {candidate.conflict ? " · conflicting record" : ""}
                </p>
                <dl className="mt-1 space-y-1">
                  {Object.entries(candidate.fields).map(([name, field]) => (
                    <div key={name}>
                      <dt className="inline font-medium">{name}: </dt>
                      <dd className="inline">{field.value}</dd>
                      <dd className="block text-muted">Locator: {field.locator}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
