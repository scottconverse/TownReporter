import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Field, InkButton, SecHead, announceToDesk, inputClass } from "@/components/desk-chrome";
import { ListSkeleton } from "@/components/states";
import { myDesk } from "@/lib/news/claim";
import { listSources } from "@/lib/news/desk";
import {
  getDailyScanPolicy,
  pauseDailyScan,
  resumeDailyScan,
  saveDailyScanPolicy,
  type DailyScanPolicy,
  type DailyScanRuntime,
} from "@/lib/news/daily-scan";

const RUNTIME_OPTIONS: ReadonlyArray<{ value: DailyScanRuntime; label: string }> = [
  { value: "local", label: "Local model" },
  { value: "claude-cli", label: "Claude Code subscription" },
  { value: "codex-terra", label: "Codex Terra subscription" },
  { value: "codex-sol", label: "Codex Sol subscription" },
];

type Draft = Pick<
  DailyScanPolicy,
  "enabled" | "localTime" | "runtime" | "sourceCap" | "selectedSourceIds"
>;

function policyDraft(policy: DailyScanPolicy): Draft {
  return {
    enabled: policy.enabled,
    localTime: policy.localTime,
    runtime: policy.runtime,
    sourceCap: policy.sourceCap,
    selectedSourceIds: policy.selectedSourceIds,
  };
}

function formatTime(value: string | null, timezone: string): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone,
        timeZoneName: "short",
      }).format(date);
}

function sameScheduleConfig(a: Draft, b: Draft): boolean {
  return (
    a.enabled === b.enabled &&
    a.localTime === b.localTime &&
    a.runtime === b.runtime &&
    a.sourceCap === b.sourceCap &&
    a.selectedSourceIds.length === b.selectedSourceIds.length &&
    a.selectedSourceIds.every((id, index) => id === b.selectedSourceIds[index])
  );
}

function runStatus(policy: DailyScanPolicy): string {
  if (policy.openRun) return `${policy.openRun.status} for ${policy.openRun.localDay}`;
  if (!policy.lastRun) return "No daily scan has run yet.";
  const run = policy.lastRun;
  return `${run.status} for ${run.localDay}${run.error ? `: ${run.error}` : ""}`;
}

/** Owner-only editor for the daily lead scan; authorization also lives in the RPCs. */
export function DailyScanSettings() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const isOwner = me.data?.role === "owner";
  const policy = useQuery({
    queryKey: ["daily-scan-policy"],
    queryFn: () => getDailyScanPolicy(),
    enabled: isOwner,
    refetchInterval: 15_000,
  });
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => listSources(),
    enabled: isOwner,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseDraft, setBaseDraft] = useState<Draft | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "error";
    text: string;
    reload?: boolean;
  } | null>(null);

  useEffect(() => {
    if (policy.data?.ok && !dirty) {
      const next = policyDraft(policy.data.policy);
      setDraft(next);
      setBaseDraft(next);
      setBaseRevision(policy.data.policy.revision);
    }
  }, [policy.data, dirty]);

  const accepted = useMemo(
    () => (sources.data ?? []).filter((source) => source.status === "accepted"),
    [sources.data],
  );
  const selected = draft?.selectedSourceIds ?? [];
  const tooManySelected = selected.length > (draft?.sourceCap ?? 0);
  const unavailableSelected = selected.filter((id) => !accepted.some((source) => source.id === id));

  const changeDraft = (next: Draft) => {
    setDraft(next);
    setDirty(true);
    setFeedback(null);
  };

  const receivePolicy = (
    result: { ok: boolean; policy?: DailyScanPolicy; error?: string; code?: string },
    success: string,
  ) => {
    if (result.ok === false || !result.policy) {
      const text =
        result.ok === false
          ? (result.error ?? "That change did not save.")
          : "That change did not save.";
      setFeedback({
        kind: "error",
        text,
        reload: result.ok === false && result.code === "conflict",
      });
      announceToDesk(text);
      return;
    }
    const next = policyDraft(result.policy);
    setDraft(next);
    setBaseDraft(next);
    setBaseRevision(result.policy.revision);
    setDirty(false);
    qc.setQueryData(["daily-scan-policy"], result);
    setFeedback({ kind: "ok", text: success });
    announceToDesk(success);
  };

  const save = useMutation({
    mutationFn: () => {
      if (!draft || baseRevision === null)
        throw new Error("Daily scan settings are still loading.");
      return saveDailyScanPolicy({
        data: { ...draft, expectedRevision: baseRevision },
      });
    },
    onSuccess: (result) => receivePolicy(result, "Daily scan settings saved."),
    onError: (error) => {
      const text = error instanceof Error ? error.message : "That change did not save.";
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
          : new Error("Could not reload settings.");
      }
      return refreshed.data;
    },
    onMutate: () => {
      const text = "Reloading latest settings…";
      setFeedback({ kind: "ok", text });
      announceToDesk(text);
    },
    onSuccess: (result) => {
      if (!result?.ok) {
        const text = result?.error ?? "Could not reload settings.";
        setFeedback({ kind: "error", text, reload: true });
        announceToDesk(text);
        return;
      }
      const next = policyDraft(result.policy);
      setDraft(next);
      setBaseDraft(next);
      setBaseRevision(result.policy.revision);
      setDirty(false);
      const text = "Latest settings reloaded.";
      setFeedback({ kind: "ok", text });
      announceToDesk(text);
    },
    onError: (error) => {
      const text = error instanceof Error ? error.message : "Could not reload settings.";
      setFeedback({ kind: "error", text, reload: true });
      announceToDesk(text);
    },
  });
  const receivePauseResult = (
    result: { ok: boolean; policy?: DailyScanPolicy; error?: string; code?: string },
    success: string,
  ) => {
    if (result.ok === false || !result.policy) {
      receivePolicy(result, success);
      return;
    }
    qc.setQueryData(["daily-scan-policy"], result);
    const next = policyDraft(result.policy);
    if (dirty && baseDraft && sameScheduleConfig(baseDraft, next)) {
      setBaseRevision(result.policy.revision);
      setFeedback({ kind: "ok", text: `${success} Unsaved edits retained.` });
      announceToDesk(`${success} Unsaved edits retained.`);
      return;
    }
    if (dirty) {
      setFeedback({
        kind: "error",
        text: `${success} The saved schedule changed elsewhere; your unsaved edits were retained. Reload the latest settings before saving.`,
        reload: true,
      });
      announceToDesk(`${success} Saved schedule changed elsewhere.`);
      return;
    }
    receivePolicy(result, success);
  };
  const pause = useMutation({
    mutationFn: () => {
      if (!policy.data?.ok) throw new Error("Daily scan settings are still loading.");
      return pauseDailyScan({ data: { expectedRevision: policy.data.policy.revision } });
    },
    onSuccess: (result) => receivePauseResult(result, "Daily scan paused."),
    onError: (error) =>
      receivePolicy(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Could not pause the daily scan.",
        },
        "",
      ),
  });
  const resume = useMutation({
    mutationFn: () => {
      if (!policy.data?.ok) throw new Error("Daily scan settings are still loading.");
      return resumeDailyScan({ data: { expectedRevision: policy.data.policy.revision } });
    },
    onSuccess: (result) => receivePauseResult(result, "Daily scan resumed."),
    onError: (error) =>
      receivePolicy(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Could not resume the daily scan.",
        },
        "",
      ),
  });

  if (!isOwner) return null;
  if (policy.isError || sources.isError || (policy.data && !policy.data.ok)) {
    return (
      <section className="mt-12" aria-labelledby="daily-scan-heading">
        <SecHead title="Daily scan" />
        <p id="daily-scan-heading" className="mt-4 text-rust" role="alert">
          {policy.isError
            ? "Could not read the daily scan settings."
            : sources.isError
              ? "Could not read accepted sources for the daily scan."
              : policy.data && !policy.data.ok
                ? policy.data.error
                : "Could not read the daily scan settings."}
        </p>
      </section>
    );
  }
  if (policy.isPending || sources.isPending || !draft || baseRevision === null)
    return <ListSkeleton rows={4} />;
  const current = policy.data.policy;

  return (
    <section className="mt-12 border-t border-rule pt-8" aria-labelledby="daily-scan-heading">
      <SecHead
        title="Daily scan"
        sub="A scheduled reporter pass for leads only. It does not draft or publish anything."
      />
      <p id="daily-scan-heading" className="mt-3 max-w-2xl text-sm text-muted">
        This machine uses its local model or an existing Claude Code or Codex subscription. It does
        not fall back to paid APIs.
      </p>
      <div className="mt-5 max-w-2xl space-y-4">
        <label className="flex items-start gap-3 border border-rule p-4">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5"
            checked={draft.enabled}
            onChange={(event) => changeDraft({ ...draft, enabled: event.target.checked })}
          />
          <span>
            <span className="block font-medium">Run once each day</span>
            <span className="mt-1 block text-sm text-muted">
              Disabled by default. The scheduler chooses the next eligible run.
            </span>
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Local time" hint={`Timezone: ${current.timezone}`}>
            <input
              className={`${inputClass} mt-1 w-full`}
              type="time"
              value={draft.localTime}
              onChange={(event) => changeDraft({ ...draft, localTime: event.target.value })}
            />
          </Field>
          <Field label="Runtime" hint="Only the selected runtime is used.">
            <select
              className={`${inputClass} mt-1 w-full`}
              value={draft.runtime}
              onChange={(event) =>
                changeDraft({ ...draft, runtime: event.target.value as DailyScanRuntime })
              }
            >
              {RUNTIME_OPTIONS.map((runtime) => (
                <option key={runtime.value} value={runtime.value}>
                  {runtime.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Daily source limit"
          hint={`${selected.length} selected / ${draft.sourceCap} daily limit. This first supported schedule reads every selected source, up to 12, in one pass.`}
        >
          <input
            className={`${inputClass} mt-1 w-32`}
            type="number"
            min={1}
            max={12}
            step={1}
            value={draft.sourceCap}
            onChange={(event) => changeDraft({ ...draft, sourceCap: Number(event.target.value) })}
          />
        </Field>
        <fieldset className="border border-rule p-4">
          <legend className="px-1 font-medium">
            Accepted community sources ({accepted.length})
          </legend>
          <p className="mt-1 text-sm text-muted">
            Choose every source this schedule may scan. All accepted sources are shown; none are
            hidden by beat or format.
          </p>
          {accepted.length === 0 ? (
            <p className="mt-3 text-sm text-muted">There are no accepted sources yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-rule border-y border-rule">
              {accepted.map((source) => {
                const checked = selected.includes(source.id);
                return (
                  <li key={source.id} className="py-2">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-5 w-5"
                        checked={checked}
                        onChange={() =>
                          changeDraft({
                            ...draft,
                            selectedSourceIds: checked
                              ? selected.filter((id) => id !== source.id)
                              : [...selected, source.id],
                          })
                        }
                      />
                      <span className="min-w-0">
                        <span className="block">{source.title}</span>
                        <span className="block break-all text-sm text-muted">{source.url}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
        {unavailableSelected.length > 0 ? (
          <div className="border border-rust p-3 text-sm" role="alert">
            <p>
              {unavailableSelected.length} saved source
              {unavailableSelected.length === 1 ? " is" : "s are"} no longer accepted and cannot
              run.
            </p>
            <p className="mt-1 text-muted">
              Remove them, then choose currently accepted sources if needed.
            </p>
            <InkButton
              tone="quiet"
              small
              onClick={() =>
                changeDraft({
                  ...draft,
                  selectedSourceIds: selected.filter((id) => !unavailableSelected.includes(id)),
                })
              }
            >
              Remove unavailable sources
            </InkButton>
          </div>
        ) : null}
        {tooManySelected ? (
          <p className="text-sm text-rust" role="alert">
            {selected.length} sources are selected, but the daily limit is {draft.sourceCap}.
            Increase the limit or deselect sources; nothing will be silently skipped.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <InkButton
            disabled={
              save.isPending ||
              reloadLatest.isPending ||
              pause.isPending ||
              resume.isPending ||
              tooManySelected ||
              unavailableSelected.length > 0 ||
              draft.sourceCap > 12 ||
              draft.sourceCap < 1
            }
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save daily scan"}
          </InkButton>
          {current.paused ? (
            <InkButton
              tone="quiet"
              disabled={resume.isPending || save.isPending}
              onClick={() => resume.mutate()}
            >
              {resume.isPending ? "Resuming…" : "Resume daily scan"}
            </InkButton>
          ) : (
            <InkButton
              tone="quiet"
              disabled={pause.isPending || save.isPending}
              onClick={() => pause.mutate()}
            >
              {pause.isPending ? "Pausing…" : "Pause daily scan"}
            </InkButton>
          )}
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
      <div className="mt-6 max-w-2xl border-y border-rule py-4 text-sm">
        <p>
          <span className="text-muted">Schedule:</span>{" "}
          {current.paused
            ? `Paused${current.pauseReason ? ` — ${current.pauseReason}` : ""}`
            : current.enabled
              ? "Enabled"
              : "Disabled"}
        </p>
        <p className="mt-1">
          <span className="text-muted">Next run:</span>{" "}
          {formatTime(current.nextRunAt, current.timezone)}
        </p>
        <p className="mt-1">
          <span className="text-muted">Current or last run:</span> {runStatus(current)}
        </p>
        <p className="mt-3">
          <Link to="/desk/scan" className="underline">
            Open scan history
          </Link>{" "}
          ·{" "}
          <Link to="/desk/queue" className="underline">
            Open the queue
          </Link>
        </p>
      </div>
    </section>
  );
}
