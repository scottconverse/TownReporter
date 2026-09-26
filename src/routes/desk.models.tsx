/**
 * Models -- "Who does what" and "Connections".
 *
 * The design is `design/Desk Models.dc.html` (approved 2026-09-26, KICKOFF
 * section C); this file is that drawing with the desk's real data behind it.
 * The two tabs are one screen on purpose: "which model does this job" and "is
 * that model actually connected" are the same question asked twice, and the
 * desk used to answer the second half only, on Server settings, in a panel
 * called Writing models.
 *
 * WHY A ROUTE OF ITS OWN. The owner's ask (README "10. Models") is a table of
 * ten jobs with three ranks each. Server settings is a stack of panels and
 * always was; a ten-row grid inside it would be the longest thing on a page
 * about sign-in expiry. The new desk navigation carries a link (lane 3), and
 * /desk/ops carries one too, so the screen is reachable both ways.
 *
 * THREE RULES THIS SCREEN OBEYS, ALL OF THEM THE BRIEF'S:
 *
 * 1. Nothing here names a model. Every option in every select comes from
 *    `jobModelOptions` (the registry, per job surface) plus the newsroom's own
 *    `custom:<uuid>` connections, and the effort select's options come from
 *    `jobEffortOptions` for the EXACT model behind the choice. A typed-out
 *    model name in a route file would be a second registry that nothing keeps
 *    in step -- and the prototype's names (Codex Sol, Gemini Pro) are exactly
 *    that, which is why none of them appear below.
 * 2. Grok is in no picker. It is `NO_SURFACE` in the registry, so it is in no
 *    menu this file can build, and the Connections tab shows its real card
 *    under sign-ins, retired from pickers, with its own actions intact.
 * 3. No Load and no Pull button, anywhere. TownReporter never loads a model
 *    into anyone's GPU (0.6.71). "Not loaded" is stated, and stated in the
 *    chip's help text, because the first call will load it and that takes a
 *    minute -- the editor should know before pressing anything, not after.
 *
 * The four things the screen WRITES (assignments, custom connections, sign-ins,
 * a connection test) are all owner actions, refused on the server by
 * `assertOwner` where they are not the editor's. Hiding a button is a courtesy;
 * it is never the protection.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DeskShell, InkButton } from "@/components/desk-chrome";
import { inputClass } from "@/components/desk-chrome-utils";
import { ListSkeleton } from "@/components/states";
import { CustomAiConnectionsPanel } from "@/components/custom-ai-connections-panel";
import { ProviderStatusCard } from "@/components/provider-status-card";
import { XaiOauthConnection } from "@/components/xai-oauth-connection";
import { myDesk } from "@/lib/news/claim";
import { getProviderStatuses } from "@/lib/news/provider-login";
import { getLocalModelChoice } from "@/lib/news/provider-settings";
import {
  localModelCatalog,
  providerAvailability,
  refreshLocalModelCatalog,
} from "@/lib/news/provider-availability";
import { PROVIDER_AVAILABILITY_QUERY_KEY } from "@/lib/news/provider-availability-key";
import {
  getCustomAiConnectionsFn,
  type PublicCustomAiConnection,
} from "@/lib/news/custom-ai-settings";
import { getXaiOauthStatusFn } from "@/lib/news/xai-oauth";
import { isCustomModelChoice } from "@/lib/news/model-choice";
import type { LocalModelEntry, LocalServer } from "@/lib/news/local-models";
import {
  JOB_STATUS_LABEL,
  MODEL_JOBS,
  cleanJobEffort,
  jobEffortOptions,
  jobModelOptions,
  jobStatusHelp,
  jobStatusKind,
  resolveJobModel,
  withCustomConnections,
  type JobStatusKind,
  type ModelAssignmentRow,
  type ModelJobKey,
} from "@/lib/news/model-assignments";
import {
  draftFromRows,
  emptyDraft,
  rowsFromDraft,
  unsavedJobCount,
  unsavedSummary,
  type DraftSlotName,
  type JobAssignmentDraft,
  type JobAssignmentSlot,
  type ModelAssignmentDraft,
} from "@/lib/news/model-assignment-draft";
import {
  MODEL_ASSIGNMENTS_QUERY_KEY,
  assignmentsFromSave,
  getModelAssignmentsFn,
  saveModelAssignmentsFn,
} from "@/lib/news/model-assignments-settings";
import {
  defaultModelEffort,
  modelEffortLabel,
  type ModelEffort,
  type ProviderSurface,
} from "@/lib/news/provider-registry";

export const Route = createFileRoute("/desk/models")({
  head: () => ({ meta: [{ title: "Models — TownReporter" }] }),
  /*
    `?tab=conn` is how another screen hands over with the Connections tab
    already open. Anything else in that slot is dropped rather than trusted --
    it decides what this page draws, and it arrives from the address bar. The
    design's own prototype keeps the tab in component state, so a click does
    not write to the URL; the parameter is only a way IN.

    Optional, not defaulted here, so `<Link to="/desk/models">` needs no
    `search` prop -- the same shape `{ signin?: … }` uses on Server settings,
    and the point matters more here because two other surfaces link to this
    screen (Server settings, and the new desk navigation).
  */
  validateSearch: (search: Record<string, unknown>): { tab?: ModelsTab } => ({
    tab: search.tab === "conn" ? "conn" : search.tab === "assign" ? "assign" : undefined,
  }),
  component: ModelsPage,
});

type ModelsTab = "assign" | "conn";

/** The two tab labels, as the design draws them. The count is real. */
const TAB_ASSIGN = "Who does what";

/* --------------------------------------------------------------------------
   The screen
   -------------------------------------------------------------------------- */

function ModelsPage() {
  const search = Route.useSearch();
  const qc = useQueryClient();
  const [tab, setTab] = useState<ModelsTab>(search.tab ?? "assign");
  const [note, setNote] = useState("");

  const me = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const isOwner = me.data?.role === "owner";

  /*
    The screen's own copies of the three reads the Connections tab draws.

    They are the SAME query keys the panels below use, so React Query serves
    one request per key and this costs nothing -- but they are what makes the
    tab label honest. "Connections · 12" in the design is the number of cards
    under it, and a number that is guessed is worse than no number: an editor
    counting three cards under a label that says twelve learns to stop reading
    the label.
  */
  const custom = useQuery({
    queryKey: ["custom-ai-connections"],
    queryFn: () => getCustomAiConnectionsFn(),
    enabled: isOwner,
  });
  const statuses = useQuery({
    queryKey: ["provider-statuses"],
    queryFn: () => getProviderStatuses(),
    enabled: isOwner,
    refetchInterval: 60_000,
  });
  const xai = useQuery({
    queryKey: ["xai-oauth-status"],
    queryFn: () => getXaiOauthStatusFn(),
    enabled: isOwner,
  });
  const catalog = useQuery({
    queryKey: ["local-model-catalog"],
    queryFn: () => localModelCatalog(),
  });

  /* Counted only once every read has answered, or an editor watching the page
     settle sees the number climb. Null draws the plain label. */
  const counted =
    custom.isSuccess && statuses.isSuccess && xai.isSuccess && catalog.isSuccess
      ? (custom.data?.length ?? 0) +
        (statuses.data?.length ?? 0) +
        (xai.data ? 1 : 0) +
        (catalog.data?.servers.length ?? 0)
      : null;

  /*
    "Test all connections" -- and what it deliberately does NOT do.

    A per-card Test is one real word to one model, which is the editor asking
    for it. Doing that for every connection at once is not a connection test,
    it is a bill: eleven prompts, some of them on a metered API key, from one
    press. So this reads instead: the sign-in statuses, the local servers on
    this machine, and the availability map every picker and chip is drawn from.
    All of them are reads, two already polled. The note says exactly what
    happened so no one assumes a green card means a model answered -- and the
    card's own Test is still one press away for the one connection in question.
  */
  const testAll = useMutation({
    mutationFn: async () => {
      const [fresh] = await Promise.all([
        refreshLocalModelCatalog(),
        qc.invalidateQueries({ queryKey: ["provider-statuses"], refetchType: "all" }),
        qc.invalidateQueries({ queryKey: ["xai-oauth-status"], refetchType: "all" }),
      ]);
      await qc.invalidateQueries({
        queryKey: PROVIDER_AVAILABILITY_QUERY_KEY,
        refetchType: "all",
      });
      return fresh;
    },
    onSuccess: (fresh) => {
      qc.setQueryData(["local-model-catalog"], fresh);
      setNote(
        "Re-read every sign-in and looked for local servers on this machine. Nothing was sent to any model — a card's own Test is what asks a model for one word.",
      );
    },
    onError: (e) =>
      setNote(e instanceof Error ? e.message : "Could not check the connections just now."),
  });

  return (
    <DeskShell title="Models" kicker="Server · Writing models">
      {/*
        The design puts these two buttons on the header line, beside the
        heading. DeskShell has no actions slot and is shared with every other
        desk surface, so they are the first row of the body instead -- same
        buttons, same order, one line lower.
      */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {isOwner ? (
          <button
            type="button"
            className="btn"
            disabled={testAll.isPending}
            onClick={() => testAll.mutate()}
          >
            {testAll.isPending ? "Checking…" : "Test all connections"}
          </button>
        ) : null}
        {isOwner ? (
          <InkButton
            onClick={() => {
              setTab("conn");
              /*
                After the paint, not before: the panel is `hidden` until the
                tab switches, and an element inside a hidden subtree has no box
                to scroll to.
              */
              window.setTimeout(() => {
                document.getElementById("add-connection")?.scrollIntoView({ block: "start" });
              }, 0);
            }}
          >
            + Add a connection
          </InkButton>
        ) : null}
      </div>

      {note ? (
        <p className="mt-3 max-w-3xl text-sm text-ink-2" role="status">
          {note}
        </p>
      ) : null}

      <div
        className="mt-4 flex self-start border border-rule"
        role="tablist"
        aria-label="Models"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          setTab(tab === "assign" ? "conn" : "assign");
        }}
      >
        {(["assign", "conn"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`models-tab-${key}`}
            aria-controls={`models-panel-${key}`}
            aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            className="text-base font-extrabold"
            style={{
              minHeight: "44px",
              padding: "0 16px",
              background: tab === key ? "var(--fg)" : "transparent",
              color: tab === key ? "var(--bg)" : "var(--fg)",
            }}
            onClick={() => setTab(key)}
          >
            {key === "assign"
              ? TAB_ASSIGN
              : counted === null
                ? "Connections"
                : `Connections · ${counted}`}
          </button>
        ))}
      </div>

      {/*
        Both panels stay mounted and are hidden, the way Server settings does
        its own panels: the count above has to be countable whether or not the
        tab is open, and a tab that refetches on every switch would put a
        skeleton where the editor just was.
      */}
      <div
        id="models-panel-assign"
        role="tabpanel"
        aria-labelledby="models-tab-assign"
        hidden={tab !== "assign"}
      >
        <AssignmentsTab isOwner={isOwner} connections={custom.data ?? []} onNote={setNote} />
      </div>
      <div
        id="models-panel-conn"
        role="tabpanel"
        aria-labelledby="models-tab-conn"
        hidden={tab !== "conn"}
      >
        <ConnectionsTab isOwner={isOwner} onNote={setNote} />
      </div>
    </DeskShell>
  );
}

/* --------------------------------------------------------------------------
   "Who does what"
   -------------------------------------------------------------------------- */

function AssignmentsTab({
  isOwner,
  connections,
  onNote,
}: {
  isOwner: boolean;
  connections: readonly PublicCustomAiConnection[];
  onNote: (text: string) => void;
}) {
  const qc = useQueryClient();
  const read = useQuery({
    queryKey: MODEL_ASSIGNMENTS_QUERY_KEY,
    queryFn: () => getModelAssignmentsFn(),
  });
  const [draft, setDraft] = useState<ModelAssignmentDraft>(emptyDraft);
  const [err, setErr] = useState("");

  const result = read.data;
  const rows = result && result.ok ? result.assignments : null;

  /*
    What was read, applied to the form -- but only when it is NEWS.

    React Query refetches on window focus, and a form that resets itself when
    the editor tabs away to look something up and back is a form that loses
    work. The stamp is the read rows as text: an identical refetch is ignored,
    and a genuine change (another editor saved, or this screen's own save came
    back) is applied. Comparing rows rather than trusting `isFetched` is what
    makes that second case work at all.
  */
  const applied = useRef("");
  useEffect(() => {
    if (!rows) return;
    const stamp = JSON.stringify(rows);
    if (stamp === applied.current) return;
    applied.current = stamp;
    setDraft(draftFromRows(rows));
    setErr("");
  }, [rows]);

  const saved = useMemo(() => draftFromRows(rows ?? []), [rows]);
  const count = unsavedJobCount(draft, saved);

  const save = useMutation({
    mutationFn: () => saveModelAssignmentsFn({ data: rowsFromDraft(draft) }),
    onMutate: () => setErr(""),
    onSuccess: (savedResult) => {
      const written = assignmentsFromSave(savedResult);
      if (!written) {
        setErr(savedResult.ok ? "Could not save the assignments." : savedResult.error);
        return;
      }
      /*
        Read back from the table, not echoed from the form: what the footer
        then says is saved has to be what a run would read. `setQueryData` also
        re-applies the draft through the same effect above, which is an
        identity round trip -- the count goes to zero, and nothing else moves.
      */
      applied.current = JSON.stringify(written);
      setDraft(draftFromRows(written));
      qc.setQueryData(MODEL_ASSIGNMENTS_QUERY_KEY, savedResult);
      onNote("Saved. Every job now runs what this screen shows.");
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not save the assignments."),
  });

  function patch(jobKey: ModelJobKey, slot: DraftSlotName, next: Partial<JobAssignmentSlot>) {
    setDraft((current) => {
      const job = current[jobKey];
      if (!job) return current;
      return { ...current, [jobKey]: { ...job, [slot]: { ...job[slot], ...next } } };
    });
  }

  if (read.isPending) return <ListSkeleton rows={4} />;
  /*
    A read that failed draws no form at all, which is the point: `rowsFromDraft`
    sends a FULL replace, so a Save pressed on top of an empty form would write
    an empty table over a real one. Nothing to read means nothing to edit.
  */
  if (!rows) {
    return (
      <div className="mt-4 flex flex-col items-start gap-3 border border-rule p-4" role="alert">
        <p>
          {result && !result.ok
            ? result.error
            : "Could not read which model does what. Nothing has changed."}
        </p>
        <InkButton tone="quiet" onClick={() => void read.refetch()}>
          Try again
        </InkButton>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <p className="max-w-[900px] text-base text-ink-2">
        Choose which model does each job, how hard it works (effort) and what to fall back to when
        it fails. The desk tries the first choice, then Fallback 1, then Fallback 2, and records
        which one actually ran. A content refusal is final and never falls back.
      </p>
      {!isOwner ? (
        <p className="text-base text-ink-2">
          Only the owner can change which model does what. Read-only here.
        </p>
      ) : null}

      <div
        className="text-sm font-extrabold tracking-[0.05em] text-ink-2 uppercase"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr) auto",
          gap: "0 14px",
          padding: "10px 0",
          borderBottom: "2px solid var(--fg)",
        }}
      >
        <span>Job</span>
        <span>First choice · effort</span>
        <span>Fallback 1</span>
        <span>Fallback 2</span>
        <span />
      </div>

      {MODEL_JOBS.map((job) => (
        <JobRow
          key={job.key}
          jobKey={job.key}
          savedRows={rows}
          draft={draft[job.key]}
          connections={connections}
          disabled={!isOwner}
          onPatch={patch}
        />
      ))}

      {err ? (
        <p className="text-sm" role="alert" style={{ color: "var(--danger)" }}>
          {err}
        </p>
      ) : null}

      <div
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        style={{ background: "var(--bg2)", border: "1px solid var(--line)" }}
      >
        <span className="text-base">{unsavedSummary(count)}</span>
        {isOwner ? (
          <div className="flex gap-2">
            <InkButton tone="quiet" disabled={!count} onClick={() => setDraft(saved)}>
              Reset
            </InkButton>
            {/*
              Disabled with nothing to save, which the drawing does not say. A
              Save that writes the same rows back is at best a no-op and at
              worst the press that empties a table the editor never touched --
              and `rowsFromDraft` sends a FULL replace, so "empty form, live
              write" is a real outcome, not a theoretical one.
            */}
            <InkButton disabled={!count || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save assignments"}
            </InkButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One job: three ranks, one chip, and the sentence that says when the desk
 * could not use what was saved.
 *
 * The chip is resolved from the SAVED rows, not from the form. The question it
 * answers is "what happens if this job runs now", and while there are unsaved
 * changes the answer is still the table -- which is exactly what the footer's
 * "Nothing changes until you save." means.
 */
function JobRow({
  jobKey,
  savedRows,
  draft,
  connections,
  disabled,
  onPatch,
}: {
  jobKey: ModelJobKey;
  savedRows: readonly ModelAssignmentRow[];
  draft: JobAssignmentDraft;
  connections: readonly PublicCustomAiConnection[];
  disabled: boolean;
  onPatch: (jobKey: ModelJobKey, slot: DraftSlotName, next: Partial<JobAssignmentSlot>) => void;
}) {
  const job = MODEL_JOBS.find((row) => row.key === jobKey);
  const surface: ProviderSurface = job?.surface ?? "story";

  /* The three stored values, in rank order -- which is also the order every
     menu in this row has to be able to SHOW. */
  const chosen = [draft.first.providerId, draft.fallback1.providerId, draft.fallback2.providerId];

  /*
    The local model, when any slot in this row can land on one.

    Enabled off the form as well as off the saved table: an editor who has just
    switched a job to "Local model" needs the effort list for whatever that
    server has in memory NOW, and the saved row is no longer the question. Five
    surfaces, so at most five of these queries exist however many rows ask.
  */
  const resolvedSaved = resolveJobModel({ jobKey, assignments: savedRows });
  const local = useQuery({
    queryKey: ["local-model-choice", surface],
    queryFn: () => getLocalModelChoice({ data: { scope: surface } }),
    enabled: chosen.includes("local-model") || resolvedSaved.providerId === "local-model",
    staleTime: 5 * 60 * 1000,
  });
  const localId = local.data
    ? (local.data.override?.id ?? local.data.catalog.defaultModel?.id ?? null)
    : null;
  const localEntry: LocalModelEntry | null = localId
    ? (local.data?.catalog.servers.flatMap((server) => server.models).find((m) => m.id === localId) ??
      null)
    : null;

  /** The exact model behind a choice, which is what the effort list needs. */
  function exactModelFor(providerId: string): string | null {
    if (!providerId) return null;
    if (providerId === "local-model") return localId;
    if (isCustomModelChoice(providerId)) {
      return connections.find((row) => `custom:${row.id}` === providerId)?.modelId ?? null;
    }
    return null;
  }

  /*
    Every stored value in this row, handed to the menu builder, so a value this
    build no longer offers still has a labelled option instead of an empty
    select -- which would read as "no fallback" when a fallback is stored.
  */
  const menu = withCustomConnections(jobModelOptions(jobKey), connections, chosen);

  const firstExact = exactModelFor(draft.first.providerId);
  const efforts = jobEffortOptions(draft.first.providerId, firstExact);
  /*
    What the select shows: the stored level when this model takes it, and
    otherwise the level a run would actually send (`cleanJobEffort` drops an
    unknown level to the model's default). Showing the stored one where the
    model does not take it would be a select that disagrees with the run.
  */
  const shownEffort = cleanJobEffort(draft.first.providerId, draft.first.effort, firstExact) ?? "";

  const availability = useQuery({
    queryKey: PROVIDER_AVAILABILITY_QUERY_KEY,
    queryFn: () => providerAvailability(),
    staleTime: 5 * 60 * 1000,
  });

  const facts = {
    built: job?.built ?? true,
    providerId: resolvedSaved.providerId,
    /* Undefined while the answer is in flight: a chip does not accuse a
       provider on the strength of a slow network call. */
    available: availability.data ? availability.data[resolvedSaved.providerId] !== false : null,
    localNotLoaded:
      resolvedSaved.providerId === "local-model" ? localEntry?.loaded === false : false,
  };
  const kind = jobStatusKind(facts);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr) auto",
        gap: "6px 14px",
        alignItems: "center",
        padding: "12px 0",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-extrabold">{job?.label ?? jobKey}</span>
        <span className="text-sm text-ink-2">{job?.note ?? ""}</span>
        {resolvedSaved.notice ? (
          <span className="text-sm" style={{ color: "var(--warn)" }}>
            ! {resolvedSaved.notice}
          </span>
        ) : null}
      </div>

      {job && !job.built ? (
        /* No backend yet, so no picker: a select that saved a model for a job
           that does not run would be a setting that does nothing. */
        <span className="text-sm text-ink-2">
          Not built yet — nothing to assign. The desk has no follow-up runner, so this row is the
          plan rather than a setting.
        </span>
      ) : (
        <div className="flex gap-1.5">
          <ModelSelect
            label={`First choice for ${job?.label ?? jobKey}`}
            value={draft.first.providerId}
            options={menu}
            disabled={disabled}
            onChange={(next) =>
              onPatch(jobKey, "first", {
                providerId: next,
                /* The design resets effort when the model changes, and it is
                   the right thing to do: "high" on a model that does not take
                   levels is a level for a run that cannot exist. */
                effort: defaultModelEffort(next, exactModelFor(next)) ?? "",
              })
            }
          />
          <select
            className={`${inputClass} shrink-0`}
            style={{ width: "130px" }}
            aria-label={`Effort for ${job?.label ?? jobKey}`}
            disabled={disabled || !efforts.length}
            value={efforts.length ? shownEffort : ""}
            onChange={(event) => onPatch(jobKey, "first", { effort: event.target.value })}
          >
            {efforts.length ? (
              efforts.map((effort: ModelEffort) => (
                <option key={effort} value={effort}>
                  {modelEffortLabel(effort, firstExact)}
                </option>
              ))
            ) : (
              /* No levels declared for this exact model: the desk sends
                 nothing and the provider decides. Naming that beats an empty
                 select, and it is the same answer the pickers give. */
              <option value="">Provider default</option>
            )}
          </select>
        </div>
      )}

      {job && !job.built ? (
        <span />
      ) : (
        <ModelSelect
          label={`Fallback 1 for ${job?.label ?? jobKey}`}
          value={draft.fallback1.providerId}
          options={menu}
          disabled={disabled}
          onChange={(next) => onPatch(jobKey, "fallback1", { providerId: next })}
        />
      )}
      {job && !job.built ? (
        <span />
      ) : (
        <ModelSelect
          label={`Fallback 2 for ${job?.label ?? jobKey}`}
          value={draft.fallback2.providerId}
          options={menu}
          disabled={disabled}
          onChange={(next) => onPatch(jobKey, "fallback2", { providerId: next })}
        />
      )}

      <StatusChip kind={kind} help={jobStatusHelp(facts)} />
    </div>
  );
}

/**
 * One model select.
 *
 * The option text is the plain label, with the detail on the option's `title`:
 * the grid column has room for a sentence, unlike the narrow pickers the
 * 34-character convention in ./model-choice.ts was measured for. The empty
 * value is "nothing saved", which is how Automatic and "not set" are both
 * expressed -- one option, because for this table they are the same thing.
 */
function ModelSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; detail?: string | null }[];
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <select
      className={`${inputClass} w-full min-w-0`}
      aria-label={label}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Not set — use the desk&rsquo;s default</option>
      {options.map((option) => (
        <option key={option.value} value={option.value} title={option.detail ?? undefined}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * The live status chip, drawn as the design draws it: mixed case, 14px, and
 * three colours that mean something. Not the desk's `.chip` class, which
 * uppercases and letter-spaces its text for a different vocabulary. The colours
 * are inline `var()`s because the `.desk-ltr` utilities remap `--ts` and the
 * paper palette but not the state colours, and these four flip in night mode.
 */
function StatusChip({ kind, help }: { kind: JobStatusKind; help: string }) {
  const look =
    kind === "ready"
      ? { color: "var(--ok)", border: "1px solid var(--ok)" }
      : kind === "slow"
        ? { color: "var(--warn)", border: "2px solid var(--warn)" }
        : kind === "signin"
          ? { color: "var(--danger)", border: "2px dashed var(--danger)" }
          : { color: "var(--fg2)", border: "1px solid var(--fg2)" };
  return (
    <span
      className="text-sm font-extrabold"
      title={help}
      style={{ ...look, padding: "1px 8px", whiteSpace: "nowrap" }}
    >
      {JOB_STATUS_LABEL[kind] ?? "—"}
    </span>
  );
}

/* --------------------------------------------------------------------------
   Connections
   -------------------------------------------------------------------------- */

function ConnectionsTab({
  isOwner,
  onNote,
}: {
  isOwner: boolean;
  onNote: (text: string) => void;
}) {
  if (!isOwner) {
    /*
      Not an apology and not a broken panel. An editor whose page said "Could
      not load your API connections" would be reading a lie about a 403, so the
      read is never attempted for them and the sentence says what is true.
    */
    return (
      <p className="mt-4 max-w-3xl text-base text-ink-2">
        Only the owner sees and changes the paper&rsquo;s connections. Which model the paper is
        allowed to write with is on the other tab, with each job&rsquo;s live state beside it.
      </p>
    );
  }
  return (
    <div className="mt-4 flex flex-col gap-7">
      <ConnectionGroup
        title="Frontier · API key"
        note="Pay per use. Key stored on the server; never shown again after saving."
      >
        <div
          id="add-connection"
          className="min-w-0"
          /* One column wide, not one card wide: this is a form and a stack of
             cards, and squeezed into a 320px grid cell the form's own rows
             would wrap for no reason. */
          style={{ gridColumn: "1 / -1" }}
        >
          <CustomAiConnectionsPanel showHeading={false} />
        </div>
      </ConnectionGroup>

      <ConnectionGroup
        title="Subscription sign-ins (OAuth)"
        note="Uses your existing plan instead of per-use billing. Sign-ins expire; the desk warns 3 days ahead."
        below={
          <>
            These sign-ins carry per-model time limits, which stay on{" "}
            <a className="inline-link" href="/desk/ops">
              Server settings
            </a>
            .
          </>
        }
      >
        {/*
          The same card Server settings draws, with the same countdowns and the
          same one-time codes -- one implementation, so a fix lands on both.
          `times={[]}` because the per-provider time limits belong to the panel
          that owns them on /desk/ops; this is the place they are LINKED to, not
          a second place to edit them.
        */}
        <SubscriptionCards onNote={onNote} />
        <XaiOauthConnection onNote={onNote} />
      </ConnectionGroup>

      <ConnectionGroup
        title="Local & self-hosted"
        note="Runs on this machine or your own servers. Free per use; speed depends on the hardware."
      >
        <LocalServers onNote={onNote} />
      </ConnectionGroup>
    </div>
  );
}

/**
 * One drawn group: the heading rule, the note, then the cards.
 *
 * `below` is for the sentence that belongs to the group but not to any card --
 * the OAuth group's pointer at the time-limit fields, which stay where they
 * are. It sits outside the card grid so the grid's own columns are untouched.
 */
function ConnectionGroup({
  title,
  note,
  children,
  below,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
  below?: React.ReactNode;
}) {
  return (
    <section role="group" aria-label={title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 pb-2" style={{ borderBottom: "2px solid var(--fg)" }}>
        <span className="text-2xl font-extrabold">{title}</span>
        <span className="text-base text-ink-2">{note}</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
          gap: "14px",
          alignItems: "start",
        }}
      >
        {children}
      </div>
      {below ? <p className="text-sm text-ink-2">{below}</p> : null}
    </section>
  );
}

/**
 * The CLI sign-ins, read from the same statuses query the whole desk uses.
 *
 * The cards are `li`s because the component that draws them is the one Server
 * settings draws, markup included -- `li[data-provider]` is what
 * scripts/provider-signin-e2e.mjs drives. So the grid here is a real list.
 */
function SubscriptionCards({ onNote }: { onNote: (text: string) => void }) {
  const statuses = useQuery({
    queryKey: ["provider-statuses"],
    queryFn: () => getProviderStatuses(),
    refetchInterval: 60_000,
  });
  if (statuses.isPending) return <ListSkeleton rows={2} />;
  if (statuses.isError && !statuses.data) {
    return (
      <div className="flex flex-col items-start gap-3 border border-rule p-4" role="alert">
        <p>Could not read the sign-ins. Existing drafts are unchanged.</p>
        <InkButton tone="quiet" onClick={() => void statuses.refetch()}>
          Try again
        </InkButton>
      </div>
    );
  }
  return (
    <ul
      className="m-0 grid list-none gap-3.5 p-0"
      style={{ gridColumn: "1 / -1", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}
    >
      {(statuses.data ?? []).map((status) => (
        <ProviderStatusCard
          key={status.provider}
          status={status}
          onNote={onNote}
          times={[]}
          chip={
            <StatusChip
              kind={status.signedIn ? "ready" : "signin"}
              help={
                status.signedIn
                  ? "This sign-in works, so jobs assigned to it can run."
                  : "This sign-in has lapsed; every job assigned to it will fail until it is fixed."
              }
            />
          }
        />
      ))}
    </ul>
  );
}

/**
 * The local servers this machine can see, one card each.
 *
 * Straight from `localModelCatalog()`: what is answering, what it has, and what
 * is in memory. No Load and no Pull button anywhere on this card, on purpose
 * and by rule (0.6.71) -- TownReporter reads what a server reports and never
 * tells it to load anything. "not loaded" is stated plainly instead, and the
 * effort chips are the levels that exact model takes, from the same function
 * the pickers use.
 */
function LocalServers({ onNote }: { onNote: (text: string) => void }) {
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: ["local-model-catalog"],
    queryFn: () => localModelCatalog(),
    staleTime: 5 * 60 * 1000,
  });
  const refresh = useMutation({
    mutationFn: () => refreshLocalModelCatalog(),
    onSuccess: (fresh) => {
      qc.setQueryData(["local-model-catalog"], fresh);
      onNote("Looked for local servers again.");
    },
    onError: () => onNote("Could not look for local servers just now."),
  });

  if (catalog.isPending) return <ListSkeleton rows={2} />;
  const servers: LocalServer[] = catalog.data?.servers ?? [];
  if (!servers.length) {
    return (
      <div
        className="flex flex-col items-start gap-2 border border-rule p-4"
        style={{ gridColumn: "1 / -1" }}
      >
        <p className="text-base font-extrabold">No local server answering</p>
        <p className="text-sm text-ink-2">
          Nothing on this machine&rsquo;s loopback or the configured address answered. Start LM
          Studio or Ollama and check again — TownReporter never starts a server and never loads a
          model for you.
        </p>
        <InkButton tone="quiet" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending ? "Checking…" : "Check again"}
        </InkButton>
      </div>
    );
  }
  return (
    <>
      {servers.map((server) => (
        <LocalServerCard key={`${server.kind}-${server.baseUrl}`} server={server} />
      ))}
    </>
  );
}

const SERVER_KIND_LABEL: Record<string, string> = {
  lmstudio: "LM Studio",
  ollama: "Ollama",
  llamacpp: "llama.cpp",
  "openai-compatible": "OpenAI-compatible server",
};

function LocalServerCard({ server }: { server: LocalServer }) {
  const kindLabel = SERVER_KIND_LABEL[server.kind] ?? server.kind;
  const loopback = isLoopback(server.baseUrl);
  const origin = originOf(server.baseUrl);
  const inMemory = server.models.filter((model) => model.loaded === true).length;
  return (
    <div
      className="flex flex-col gap-2.5 p-4"
      style={{ background: "var(--bg2)", border: "1px solid var(--line)" }}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-lg font-extrabold">
            {kindLabel} · {loopback ? "this machine" : "remote"}
          </span>
          <span className="text-sm break-all text-ink-2">
            {hostOf(server.baseUrl)}
            {server.reachable
              ? inMemory
                ? ` · ${inMemory} in memory`
                : " · nothing in memory"
              : " · not reachable"}
          </span>
        </div>
        <StatusChip
          kind={!server.reachable ? "signin" : inMemory ? "ready" : "slow"}
          help={
            !server.reachable
              ? "This address did not answer. Check that the server is running and that the address in Server settings is right."
              : inMemory
                ? "A model is already in memory, so the first call starts working straight away."
                : "The server answers but nothing is in memory. The first call loads a model, which can take a minute or more."
          }
        />
      </div>

      <div className="flex flex-col">
        {server.models.length === 0 ? (
          <p className="py-2 text-sm text-ink-2" style={{ borderTop: "1px solid var(--line)" }}>
            {server.reachable ? "No chat models on this server." : "Nothing to list."}
          </p>
        ) : (
          server.models.map((model) => (
            <div
              key={model.id}
              /*
                Two fraction columns, NOT `1fr auto`. The right-hand column is
                the long one on real data -- "load state unknown · 256K context
                · reads images · thinks by default" -- and an `auto` track is
                sized to its max-content BEFORE the `1fr` gets anything, so on a
                card that is narrower than that sentence the model's own name
                collapsed to one character per line and the page grew to 5000px
                of single letters. A bounded column makes the sentence wrap
                instead, which is what it should have done.
              */
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)",
                gap: "2px 10px",
                padding: "8px 0",
                borderTop: "1px solid var(--line)",
              }}
            >
              <span className="text-base font-bold break-words">{model.label || model.id}</span>
              <span className="text-right text-sm text-ink-2">
                {model.loaded === null
                  ? "load state unknown"
                  : model.loaded
                    ? "in memory"
                    : "not loaded"}
                {model.contextLength ? ` · ${Math.round(model.contextLength / 1024)}K context` : ""}
                {model.vision ? " · reads images" : ""}
                {model.thinking ? " · thinks by default" : ""}
              </span>
              <div className="flex flex-wrap gap-1" style={{ gridColumn: "1 / -1" }}>
                {jobEffortOptions("local-model", model.id).map((effort) => (
                  <span
                    key={effort}
                    className="text-sm font-bold"
                    style={{
                      border: "1px solid var(--line)",
                      color: "var(--fg2)",
                      padding: "0 6px",
                    }}
                  >
                    {modelEffortLabel(effort, model.id)}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/*
        "Open LM Studio ↗" and "Open Ollama ↗" -- hand-off links, which is all a
        browser can honestly do here: the server's own console lives at that
        address, and there is deliberately no Load and no Pull button. The
        Settings link goes to the address field these two are read from.
      */}
      <div className="flex flex-wrap gap-1.5">
        {server.reachable ? (
          <a
            className="btn"
            href={origin}
            target="_blank"
            rel="noreferrer noopener"
            title={`Open ${origin} — the ${kindLabel} server's own address`}
          >
            {server.kind === "lmstudio"
              ? "Open LM Studio ↗"
              : server.kind === "ollama"
                ? "Open Ollama ↗"
                : `Open ${kindLabel} ↗`}
          </a>
        ) : null}
        <a className="btn quiet" href="/desk/ops">
          Settings
        </a>
      </div>
    </div>
  );
}

function isLoopback(baseUrl: string): boolean {
  const host = hostOf(baseUrl);
  return host.startsWith("127.0.0.1") || host.startsWith("localhost") || host.startsWith("[::1]");
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}
