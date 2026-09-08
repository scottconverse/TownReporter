import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { InkButton, SecHead, announceToDesk } from "@/components/desk-chrome";
import { ListSkeleton } from "@/components/states";
import {
  isCurrentRoutineApproval,
  replaceRoutineApproval,
  withoutRoutineApproval,
} from "@/components/routine-notice-permissions-state";
import { myDesk } from "@/lib/news/claim";
import { listSources } from "@/lib/news/desk";
import {
  ROUTINE_NOTICE_APPROVAL_LIMIT,
  ROUTINE_NOTICE_FORMATS,
  getRoutineNoticePolicy,
  saveRoutineNoticePolicy,
  type RoutineNoticeFormatKey,
  type RoutineNoticePolicy,
  type RoutineNoticePolicyResult,
  type SaveRoutineNoticePolicyInput,
} from "@/lib/news/routine-notice-policy";

type Draft = Pick<SaveRoutineNoticePolicyInput, "paused" | "approvals">;
type Feedback = { kind: "ok" | "error"; text: string; reload?: boolean };

function policyDraft(policy: RoutineNoticePolicy): Draft {
  return {
    paused: policy.paused,
    approvals: policy.approvals.map(({ sourceId, sourceUrl, formatKey }) => ({
      sourceId,
      sourceUrl,
      formatKey,
    })),
  };
}

function approvalKey(sourceId: number, formatKey: RoutineNoticeFormatKey) {
  return `${sourceId}:${formatKey}`;
}

function changeLabel(action: RoutineNoticePolicy["recentChanges"][number]["action"]) {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function formatChangedAt(value: string) {
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

/** Owner-only source-and-format permissions. They do not activate publication. */
export function RoutineNoticePermissions() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const isOwner = me.data?.role === "owner";
  const policy = useQuery({
    queryKey: ["routine-notice-policy"],
    queryFn: () => getRoutineNoticePolicy(),
    enabled: isOwner,
  });
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => listSources(),
    enabled: isOwner,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const applyPolicy = (next: RoutineNoticePolicy) => {
    setDraft(policyDraft(next));
    setBaseRevision(next.revision);
    setDirty(false);
  };

  useEffect(() => {
    if (policy.data?.ok && !dirty) applyPolicy(policy.data.policy);
  }, [policy.data, dirty]);

  const accepted = useMemo(
    () => (sources.data ?? []).filter((source) => source.status === "accepted"),
    [sources.data],
  );
  const current = policy.data?.ok ? policy.data.policy : null;
  const invalidApprovals = current?.approvals.filter((approval) => !approval.valid) ?? [];
  const tooMany = (draft?.approvals.length ?? 0) > ROUTINE_NOTICE_APPROVAL_LIMIT;

  const changeDraft = (next: Draft) => {
    setDraft(next);
    setDirty(true);
    setFeedback(null);
  };

  const receive = (result: RoutineNoticePolicyResult, fallback: string) => {
    if (!result.ok) {
      setFeedback({
        kind: "error",
        text: result.error,
        reload: result.code === "conflict",
      });
      announceToDesk(result.error);
      return;
    }
    applyPolicy(result.policy);
    qc.setQueryData(["routine-notice-policy"], result);
    const text = result.notice ?? fallback;
    setFeedback({ kind: "ok", text });
    announceToDesk(text);
  };

  const save = useMutation({
    mutationFn: () => {
      if (!draft || baseRevision === null)
        throw new Error("Routine permissions are still loading.");
      return saveRoutineNoticePolicy({
        data: { ...draft, expectedRevision: baseRevision },
      });
    },
    onSuccess: (result) => receive(result, "Routine permissions saved."),
    onError: (error) => {
      const text = error instanceof Error ? error.message : "Routine permissions did not save.";
      setFeedback({ kind: "error", text });
      announceToDesk(text);
    },
  });

  const reloadLatest = useMutation({
    mutationFn: async () => {
      const refreshed = await policy.refetch();
      if (refreshed.isError) {
        throw refreshed.error instanceof Error
          ? refreshed.error
          : new Error("Could not reload routine permissions.");
      }
      return refreshed.data;
    },
    onMutate: () => {
      const text = "Reloading latest routine permissions…";
      setFeedback({ kind: "ok", text });
      announceToDesk(text);
    },
    onSuccess: (result) => {
      if (!result?.ok) {
        const text = result?.error ?? "Could not reload routine permissions.";
        setFeedback({ kind: "error", text, reload: true });
        announceToDesk(text);
        return;
      }
      applyPolicy(result.policy);
      const text = "Latest routine permissions reloaded.";
      setFeedback({ kind: "ok", text });
      announceToDesk(text);
    },
    onError: (error) => {
      const text = error instanceof Error ? error.message : "Could not reload routine permissions.";
      setFeedback({ kind: "error", text, reload: true });
      announceToDesk(text);
    },
  });

  const editingLocked = save.isPending || reloadLatest.isPending;

  const toggle = (source: { id: number; url: string }, formatKey: RoutineNoticeFormatKey) => {
    if (!draft) return;
    const isCurrentAddress = isCurrentRoutineApproval(draft.approvals, source, formatKey);
    changeDraft({
      ...draft,
      approvals: isCurrentAddress
        ? withoutRoutineApproval(draft.approvals, source, formatKey)
        : replaceRoutineApproval(draft.approvals, source, formatKey),
    });
  };

  if (me.isPending) return <ListSkeleton rows={3} />;
  if (!isOwner) {
    return (
      <section
        id="routine-notice-permissions"
        className="mt-12 border-t border-rule pt-8"
        aria-labelledby="routine-notice-heading"
      >
        <SecHead
          title="Routine notice permissions"
          sub="Owner-managed source and format permissions."
        />
        <p id="routine-notice-heading" className="mt-3 max-w-2xl text-sm text-muted">
          The newsroom owner manages these permissions. Automatic publication is not available in
          this version.
        </p>
      </section>
    );
  }
  if (policy.isError || sources.isError || (policy.data && !policy.data.ok)) {
    const text = policy.isError
      ? "Could not read routine notice permissions."
      : sources.isError
        ? "Could not read accepted sources."
        : policy.data && !policy.data.ok
          ? policy.data.error
          : "Could not read routine notice permissions.";
    return (
      <section
        id="routine-notice-permissions"
        className="mt-12 border-t border-rule pt-8"
        aria-labelledby="routine-notice-heading"
      >
        <SecHead title="Routine notice permissions" />
        <p id="routine-notice-heading" className="mt-3 text-rust" role="alert">
          {text}
        </p>
      </section>
    );
  }
  if (policy.isPending || sources.isPending || !draft || baseRevision === null || !current)
    return <ListSkeleton rows={5} />;

  return (
    <section
      id="routine-notice-permissions"
      className="mt-12 border-t border-rule pt-8"
      aria-labelledby="routine-notice-heading"
    >
      <SecHead
        title="Routine notice permissions"
        sub="Choose the exact accepted source and format pairs an owner may approve."
      />
      <p id="routine-notice-heading" className="mt-3 max-w-2xl text-sm text-muted">
        Automatic publication is not available in this version; no items will publish from these
        settings. Saving permissions creates no job, draft, article, or reader-facing product.
      </p>
      <div className="mt-5 max-w-3xl space-y-4">
        <label className="flex items-start gap-3 border border-rule p-4">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5"
            checked={draft.paused}
            disabled={editingLocked}
            onChange={(event) => changeDraft({ ...draft, paused: event.target.checked })}
          />
          <span>
            <span className="block font-medium">Pause routine notice permissions</span>
            <span className="mt-1 block text-sm text-muted">
              Pausing preserves saved pairs. Nothing can publish from these settings in this
              version.
            </span>
          </span>
        </label>
        <fieldset className="border border-rule p-4">
          <legend className="px-1 font-medium">Accepted source and format pairs</legend>
          <p className="mt-1 text-sm text-muted">
            {draft.approvals.length} of {ROUTINE_NOTICE_APPROVAL_LIMIT} permissions selected. Every
            checked pair records this source address exactly.
          </p>
          {accepted.length === 0 ? (
            <p className="mt-3 text-sm text-muted">There are no accepted sources to approve yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-rule border-y border-rule">
              {accepted.map((source) => (
                <li key={source.id} className="py-3">
                  <p className="font-medium">{source.title || source.url}</p>
                  <p className="break-all text-sm text-muted">{source.url}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {ROUTINE_NOTICE_FORMATS.map((format) => {
                      const checked = isCurrentRoutineApproval(
                        draft.approvals,
                        source,
                        format.key,
                      );
                      return (
                        <label key={format.key} className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4"
                            checked={checked}
                            disabled={editingLocked}
                            aria-label={`${source.title || source.url} — ${format.label}`}
                            onChange={() => toggle(source, format.key)}
                          />
                          <span>
                            <span className="block font-medium">{format.label}</span>
                            <span className="block text-muted">{format.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        {invalidApprovals.length ? (
          <div className="border border-rust p-4 text-sm" role="alert">
            <p className="font-medium">Saved permissions need attention</p>
            <p className="mt-1 text-muted">
              These recorded pairs stay inert until you explicitly revoke them or, when a source has
              a new accepted address, replace the saved address by selecting that current source and
              format pair.
            </p>
            <ul className="mt-2 space-y-3">
              {invalidApprovals.map((approval) => {
                const key = approvalKey(approval.sourceId, approval.formatKey);
                const retained = draft.approvals.some(
                  (item) =>
                    approvalKey(item.sourceId, item.formatKey) === key &&
                    item.sourceUrl === approval.sourceUrl,
                );
                const currentSource = accepted.find((source) => source.id === approval.sourceId);
                const replacementSelected = currentSource
                  ? draft.approvals.some(
                      (item) =>
                        approvalKey(item.sourceId, item.formatKey) === key &&
                        item.sourceUrl === currentSource.url,
                    )
                  : false;
                return (
                  <li key={key} className="border-t border-rule pt-3 first:border-t-0 first:pt-0">
                    <p>
                      <span className="font-medium">
                        {approval.sourceTitle || approval.sourceUrl}
                      </span>{" "}
                      —{" "}
                      {
                        ROUTINE_NOTICE_FORMATS.find((format) => format.key === approval.formatKey)
                          ?.label
                      }{" "}
                      ({approval.sourceState})
                    </p>
                    <p className="mt-1 break-all text-muted">Saved address: {approval.sourceUrl}</p>
                    {retained ? (
                      <InkButton
                        tone="danger"
                        small
                        disabled={editingLocked}
                        onClick={() =>
                          changeDraft({
                            ...draft,
                            approvals: draft.approvals.filter(
                              (item) =>
                                !(
                                  approvalKey(item.sourceId, item.formatKey) === key &&
                                  item.sourceUrl === approval.sourceUrl
                                ),
                            ),
                          })
                        }
                      >
                        Revoke saved permission
                      </InkButton>
                    ) : replacementSelected ? (
                      <p className="mt-1 text-muted">
                        The current accepted address is marked to replace this saved permission when
                        you save.
                      </p>
                    ) : (
                      <p className="mt-1 text-muted">Marked to revoke when you save.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {tooMany ? (
          <p className="text-sm text-rust" role="alert">
            Choose at most {ROUTINE_NOTICE_APPROVAL_LIMIT} source and format permissions before
            saving.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <InkButton disabled={editingLocked || tooMany} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save routine permissions"}
          </InkButton>
          <Link to="/desk/sources" className="text-sm underline">
            Open Sources
          </Link>
        </div>
        {feedback ? (
          <div
            className={feedback.kind === "error" ? "text-sm text-rust" : "text-sm text-ink-2"}
            role={feedback.kind === "error" ? "alert" : "status"}
          >
            <p>{feedback.text}</p>
            {feedback.reload ? (
              <InkButton
                tone="quiet"
                small
                disabled={reloadLatest.isPending}
                onClick={() => reloadLatest.mutate()}
              >
                {reloadLatest.isPending ? "Reloading…" : "Reload latest settings"}
              </InkButton>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-6 max-w-3xl border-y border-rule py-4 text-sm">
        <p>
          <span className="text-muted">Status:</span> {current.paused ? "Paused" : "Not paused"} ·
          Revision {current.revision}
        </p>
        {current.updatedAt ? (
          <p className="mt-1 text-muted">
            Last saved {formatChangedAt(current.updatedAt)}
            {current.updatedBy ? ` by ${current.updatedBy}` : ""}.
          </p>
        ) : null}
        <p className="mt-3 text-muted">
          Recent permission changes are an audit of these saved settings, not a publication history.
        </p>
        {current.recentChanges.length ? (
          <ul className="mt-2 divide-y divide-rule border-y border-rule">
            {current.recentChanges.map((change, index) => (
              <li
                key={`${change.revision}-${change.action}-${change.sourceId ?? "policy"}-${index}`}
                className="py-2"
              >
                <span className="font-medium">{changeLabel(change.action)}</span>{" "}
                {change.formatKey
                  ? `— ${ROUTINE_NOTICE_FORMATS.find((format) => format.key === change.formatKey)?.label ?? change.formatKey}`
                  : ""}
                {change.sourceUrl ? (
                  <span className="block break-all text-muted">{change.sourceUrl}</span>
                ) : null}
                <span className="block text-muted">
                  Revision {change.revision} · {change.actor} · {formatChangedAt(change.changedAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-muted">No source-and-format permissions are saved.</p>
        )}
      </div>
    </section>
  );
}
