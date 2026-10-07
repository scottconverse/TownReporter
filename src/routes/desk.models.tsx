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
 * 2. Grok is in no picker -- and, since GR-C removed Grok (xAI) as a provider,
 *    the retired id has no registry entry at all, so it is in no menu this file
 *    can build and no card on this screen offers it. A row that still stores
 *    the id reads as Automatic with the note model-choice.ts owns.
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

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DeskShell, InkButton } from "@/components/desk-chrome";
import { Dialog } from "@/components/dialog";
import { ListSkeleton } from "@/components/states";
import { CustomAiConnectionsPanel } from "@/components/custom-ai-connections-panel";
import { LocalModelsOnThisComputer } from "@/components/first-run-model";
import { ProviderStatusCard } from "@/components/provider-status-card";
import { ModelPicker } from "@/components/model-picker";
import { Chip, type ChipTone } from "@/components/status-chip";
import { myDesk } from "@/lib/news/claim";
import { getProviderStatuses } from "@/lib/news/provider-login";
import { getLocalModelChoice } from "@/lib/news/provider-settings";
import {
  localModelCatalog,
  providerAvailability,
  refreshLocalModelCatalog,
} from "@/lib/news/provider-availability";
import { modelReadiness, type ReadinessFacts } from "@/lib/news/model-readiness";
import { PROVIDER_AVAILABILITY_QUERY_KEY } from "@/lib/news/provider-availability-key";
import {
  deleteCustomAiConnectionFn,
  getCustomAiConnectionsFn,
  testCustomAiConnectionFn,
  type PublicCustomAiConnection,
} from "@/lib/news/custom-ai-settings";
import {
  isCustomModelChoice,
  modelChoiceLabel,
  type StoryModelChoice,
} from "@/lib/news/model-choice";
import type { LocalModelEntry, LocalServer } from "@/lib/news/local-models";
import {
  MODEL_JOBS,
  cleanJobEffort,
  connectionWord,
  jobEffortLabel,
  jobEffortOptionTitle,
  jobEffortOptions,
  jobStatusHelp,
  jobStatusKind,
  resolveJobModel,
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
  providersFor,
  type ModelEffort,
  type ProviderEntry,
  type ProviderKind,
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
  /*
    The Connections tab's one dialog, held up here because TWO buttons open it:
    the header's "+ Add a connection", which the design draws beside the
    heading, and the empty state's "Set up" and each card's Settings, which live
    inside the tab. One piece of state, so those buttons cannot disagree about
    what is open.
  */
  const [connDialog, setConnDialog] = useState<ConnectionDialog | null>(null);

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
  const catalog = useQuery({
    queryKey: ["local-model-catalog"],
    queryFn: () => localModelCatalog(),
  });

  /* Counted only once every read has answered, or an editor watching the page
     settle sees the number climb. Null draws the plain label. */
  const counted =
    custom.isSuccess && statuses.isSuccess && catalog.isSuccess
      ? (custom.data?.length ?? 0) +
        (statuses.data?.length ?? 0) +
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
          /*
            Opens the form rather than scrolling to it: the design draws the
            button on the header line, and the form it opens is a dialog now, so
            there is nothing on the page to scroll to.
          */
          <InkButton
            onClick={() => {
              setTab("conn");
              setConnDialog({ kind: "add" });
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
        {/*
          Unit F3 / Option A item 4: what is actually on this machine, in a
          read-only list, whichever provider any picker is on. The Connections
          tab has its own server cards; this is the Models tab's answer to
          "which models could I run here at all".
        */}
        <LocalModelsOnThisComputer headingLevel={2} />
        <AssignmentsTab isOwner={isOwner} connections={custom.data ?? []} onNote={setNote} />
      </div>
      <div
        id="models-panel-conn"
        role="tabpanel"
        aria-labelledby="models-tab-conn"
        hidden={tab !== "conn"}
      >
        <h2 className="mt-4 text-2xl font-extrabold">Connections</h2>
        <ConnectionsTab isOwner={isOwner} onNote={setNote} onOpen={setConnDialog} />

        {/*
          The one dialog for this tab, in the phase 0 component. It is rendered
          here rather than inside the tab so that the header's button and the
          tab's own buttons open the same thing, and `open` gates the panel
          inside: Radix mounts no portal while closed, so the setup form's
          queries do not run on a page nobody is editing.
        */}
        <Dialog
          open={connDialog !== null}
          onClose={() => setConnDialog(null)}
          title={connDialog?.kind === "connection" ? "Connection settings" : "Add a connection"}
          subtitle={
            connDialog?.kind === "connection" ? undefined : (
              <>
                Connect an OpenAI-compatible endpoint, including LiteLLM or Gemini. Saving does not
                call a model, spend provider credit, or change the desk default.
              </>
            )
          }
          primaryLabel="Done"
          onPrimary={() => setConnDialog(null)}
        >
          <CustomAiConnectionsPanel
            showHeading={false}
            /* A card's Settings opens the same form with that connection already
               in edit: one form, two ways in. */
            initialEditId={connDialog?.kind === "connection" ? connDialog.id : undefined}
          />
        </Dialog>
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
        Choose each job's model, thinking effort and fallbacks.
      </p>
      {!isOwner ? (
        <p className="text-base text-ink-2">
          Only the owner can change which model does what. Read-only here.
        </p>
      ) : null}

      {/*
        Wide screens keep the measured five-column table. Below 1280px its
        rows become labelled cards, so every assignment remains visible
        without horizontal scrolling or clipped select text.
      */}
      <div className="models-table" role="region" aria-label="Which model does what" tabIndex={0}>
        <div className="models-table-inner" style={{ minWidth: MODEL_TABLE_MIN }}>
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
        </div>
      </div>

      <p className="max-w-[900px] text-sm text-ink-2">
        Transcription runs on TextFlowKit (Whisper). The chat model picker does not apply.
      </p>

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
    ? (local.data?.catalog.servers
        .flatMap((server) => server.models)
        .find((m) => m.id === localId) ?? null)
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

  const statuses = useQuery({
    queryKey: ["provider-statuses"],
    queryFn: () => getProviderStatuses(),
    enabled: !disabled,
    staleTime: 60_000,
  });
  function readinessFor(providerId: string): ReadinessFacts {
    const kind = providersFor(surface).find((entry) => entry.id === providerId)?.kind;
    const signin = kind === "claude-code" ? "claude" : kind === "codex" ? "codex" : null;
    return {
      status: statuses.data?.find((row) => row.provider === signin),
      connection: connections.find((row) => `custom:${row.id}` === providerId),
      available: availability.data?.[providerId],
    };
  }
  const readinessLabel = modelReadiness(readinessFor(resolvedSaved.providerId));

  const facts = {
    built: job?.built ?? true,
    providerId: resolvedSaved.providerId,
    /* Undefined while the answer is in flight: a chip does not accuse a
       provider on the strength of a slow network call. */
    available: availability.data ? availability.data[resolvedSaved.providerId] !== false : null,
    localNotLoaded:
      resolvedSaved.providerId === "local-model" ? localEntry?.loaded === false : false,
    /* "Nothing saved" is not the same claim as "ready": see the chip below. */
    fromDefault: resolvedSaved.source === "surface-default",
  };
  const kind = jobStatusKind(facts);

  /*
    Unit CX item 3: the word the empty first choice carries.

    Nothing saved is not the word "Default" to the editor reading the row -- it
    is the model the desk will actually run, and the drawing names a model in
    every cell (`Desk Models.dc.html`: "Codex Sol · sign-in", "qwen3 32B · LM
    Studio"). The STORED value is still "" (the desk's own default is what
    resolves it), so only the option's word changes: the resolved model's own
    label, from the same `resolveJobModel` answer the chip underneath reads, so
    the box and the chip cannot name two different models.

    Two cases keep the slot's own word, because naming a model there would be a
    claim rather than an answer: a row that is not running on the desk's
    default (the editor saved a choice, and the saved value is what the box
    holds), and a row where nothing could be resolved at all.
  */
  return (
    <div
      className="model-job-row"
      style={{
        ...ROW_GRID,
        padding: "12px 0",
        borderBottom: "1px solid var(--fg2)",
      }}
    >
      <div className="model-job-name flex flex-col gap-0.5">
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
        <div className="model-job-first">
          <div className="model-job-field">
            <span className="model-job-label">First choice</span>
            <ModelPicker
              scope={surface}
              label={`First choice for ${job?.label ?? jobKey}`}
              value={(draft.first.providerId || "auto") as StoryModelChoice}
              disabled={disabled}
              onChange={(next) =>
                onPatch(jobKey, "first", {
                  providerId: next === "auto" ? "" : next,
                  /* The design resets effort when the model changes, and it is
                     the right thing to do: "high" on a model that does not take
                     levels is a level for a run that cannot exist. */
                  effort: defaultModelEffort(next, exactModelFor(next)) ?? "",
                })
              }
            />
          </div>
          <div className="model-job-field model-job-effort">
            <span className="model-job-label">Effort</span>
            <select
              className="shrink-0"
              style={{ ...SELECT_STYLE, width: EFFORT_WIDTH }}
              aria-label={`Effort for ${job?.label ?? jobKey}`}
              title={
                efforts.length
                  ? shownEffort
                    ? jobEffortOptionTitle(shownEffort)
                    : "This model declares no effort levels; the desk sends none"
                  : PROVIDER_DEFAULT_HELP
              }
              disabled={disabled || !efforts.length}
              value={efforts.length ? shownEffort : ""}
              onChange={(event) => onPatch(jobKey, "first", { effort: event.target.value })}
            >
              {efforts.length ? (
                /*
                  The drawn single word ("medium"), not the registry's sentence
                  ("Medium — balanced"): the sentence is 105px in a 130px box and
                  the word is 53px. Each option keeps the sentence as its `title`,
                  and the closed control wears the selected option's title.
                */
                efforts.map((effort: ModelEffort) => (
                  <option key={effort} value={effort} title={jobEffortOptionTitle(effort)}>
                    {jobEffortLabel(effort)}
                  </option>
                ))
              ) : (
                /* No levels declared for this exact model: the desk sends
                   nothing and the provider decides. Naming that beats an empty
                   select, and it is the same answer the pickers give. */
                <option value="">Default</option>
              )}
            </select>
          </div>
        </div>
      )}

      {job && !job.built ? (
        <span />
      ) : (
        <div className="model-job-field">
          <span className="model-job-label">Fallback 1</span>
          <ModelPicker
            scope={surface}
            label={`Fallback 1 for ${job?.label ?? jobKey}`}
            value={(draft.fallback1.providerId || "none") as StoryModelChoice}
            noneOption
            onClear={() => onPatch(jobKey, "fallback1", { providerId: "" })}
            disabled={disabled}
            onChange={(next) => onPatch(jobKey, "fallback1", { providerId: next })}
          />
        </div>
      )}
      {job && !job.built ? (
        <span />
      ) : (
        <div className="model-job-field">
          <span className="model-job-label">Fallback 2</span>
          <ModelPicker
            scope={surface}
            label={`Fallback 2 for ${job?.label ?? jobKey}`}
            value={(draft.fallback2.providerId || "none") as StoryModelChoice}
            noneOption
            onClear={() => onPatch(jobKey, "fallback2", { providerId: "" })}
            disabled={disabled}
            onChange={(next) => onPatch(jobKey, "fallback2", { providerId: next })}
          />
        </div>
      )}

      {job?.built && resolvedSaved.providerId && readinessLabel ? (
        <div className="model-job-status">
          <StatusChip
            label={readinessLabel}
            help={jobStatusHelp(facts)}
            /* Name the resolved default without making it a readiness state. */
            below={
              kind === "default" ? modelChoiceLabel(resolvedSaved.providerId, surface) : undefined
            }
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The prototype's select box (`sel` in `design/Desk Models.dc.html`), shared by
 * the model select and the effort select beside it: 44px tall, one ink rule,
 * 15px at weight 700 on the page's own background, and the prototype's own 8px
 * side padding.
 *
 * Not `inputClass`, whose 14px text and 12px side padding are sized for a form.
 * The 8px is measured rather than copied: an earlier version used 18px on the
 * right to keep the browser's arrow off the last word, and the probe in
 * `models-screen-shots.mjs` showed that 10px bought nothing -- Chromium paints
 * the arrow in the text's own box and clips the text before it -- while costing
 * 10px of the room the longest option needs.
 */
const SELECT_STYLE: CSSProperties = {
  minHeight: "44px",
  padding: "0 8px",
  background: "var(--bg)",
  /*
    UI1b-4. `--ink` is the READER's token (`reader-astra.css`), not the desk's:
    it is declared on `.reader` and its children only, so neither of these two
    declarations ever resolved here. A `var()` that does not resolve makes the
    whole declaration invalid at computed-value time, and for the `border`
    shorthand that means `border-style: none` -- which is how the ten model
    selects and the ten effort selects on this page ended up with NO border at
    all (measured: 0px on all four sides, edge ratio 0) rather than with an ink
    one. `--fg`/`--fg2` are the desk's own tokens, and `--fg2` is the Quiet
    button's edge that README §6 gives a select.
  */
  color: "var(--fg)",
  border: "1px solid var(--fg2)",
  borderRadius: 0,
  fontFamily: "inherit",
  fontWeight: 700,
  fontSize: "15px",
};

/** Job identity and status span three readable picker columns. */
const EFFORT_WIDTH = "112px";
const ROW_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "16px",
  alignItems: "start",
};
const MODEL_TABLE_MIN = 0;

/** Why the effort box has nothing to choose, on its `title`. */
const PROVIDER_DEFAULT_HELP =
  "This exact model declares no effort levels, so the desk sends none and the provider decides.";

/**
 * One model select.
 *
 * The line it shows is the desk's own short line (`jobOptionLabel`: "Codex Sol
 * · sign-in", "Automatic (ladder)"), not the registry's sentence: no CSS wraps
 * or scrolls a native `<select>`, it clips the closed control 15px short of its
 * content box, and the full line -- provider half-line and all -- is the
 * option's and the select's `title`.
 *
 * The empty value is the SLOT's word, not one sentence for both: an empty first
 * choice means the desk's default runs the job, and an empty fallback means
 * there is none. "Not set — use the desk's default" was 203px in that box.
 */
/**
 * The live status chip, drawn as the design draws it: mixed case, 14px, and
 * three colors that mean something. Not the desk's `.chip` class, which
 * uppercases and letter-spaces its text for a different vocabulary. The colors
 * are inline `var()`s because the `.desk-ltr` utilities remap `--ts` and the
 * paper palette but not the state colors, and these four flip in night mode.
 */
function StatusChip({
  label,
  help,
  below,
}: {
  label: string;
  help: string;
  /**
   * A second line under the chip. Only "Default" uses it, and it carries the
   * one fact the word "Default" leaves out: which model that is.
   */
  below?: string;
}) {
  /*
    A job's chip and a connection's are the same chip with a different word in
    it, so they share one implementation and one color table: the four looks
    live in `chipLook` and the stacking lives in `Chip`, both below, and neither
    screen can drift from the other.
  */
  return <Chip tone="quiet" label={label} help={help} below={below} />;
}

/* --------------------------------------------------------------------------
   Connections
   -------------------------------------------------------------------------- */

/**
 * Which of this tab's two ways into the setup form is open, if any.
 *
 * One value rather than two booleans: the tab shows one dialog at a time, so a
 * card must not be able to leave "Add" and a connection's Settings open at
 * once. There is no third case: the two ways in are the same two the design
 * draws, and the Grok sign-in card is gone with the provider (GR-C).
 */
type ConnectionDialog = { kind: "add" } | { kind: "connection"; id: string };

/**
 * The surface a card's model list is read from.
 *
 * A connection card answers "what can this sign-in run", so it lists every
 * entry the registry offers for that transport. `story` is used because every
 * entry offered on any surface is offered here -- it is the widest menu -- and
 * because the card is a sign-in's inventory, not one job's menu. Which model a
 * particular job uses is the other tab's question.
 */
const CONNECTION_SURFACE: ProviderSurface = "story";

function ConnectionsTab({
  isOwner,
  onNote,
  onOpen,
}: {
  isOwner: boolean;
  onNote: (text: string) => void;
  onOpen: (dialog: ConnectionDialog) => void;
}) {
  if (!isOwner) {
    /*
      Not an apology and not a broken panel. An editor whose page said "Could
      not load your API connections" would be reading a lie about a 403, so the
      read is never attempted for them and the sentence says what is true.

      The first sentence is the one the server refuses with
      (`ONLY_OWNER_CHANGES_MODEL_CONNECTIONS`, src/lib/news/membership.ts):
      every connection write AND every key-using action is owner-only, so this
      tab names no action for an editor to press.
    */
    return (
      <p className="mt-4 max-w-3xl text-base text-ink-2">
        Only the owner can change model connections. Which model the paper is allowed to write with
        is on the other tab, with each job&rsquo;s live state beside it.
      </p>
    );
  }
  return (
    <div className="mt-4 flex flex-col gap-7">
      <ConnectionGroup
        title="Frontier · API key"
        note="Pay per use. Key stored on the server; never shown again after saving."
      >
        <ApiKeyConnections onNote={onNote} onOpen={onOpen} />
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
        <SignInConnections onNote={onNote} />
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

/* The four tones and the chip itself live in @/components/status-chip since
   unit CX -- Server draws the same chip on each writing model's card, so the
   four words ("ready", "slow", "signin", "quiet") have one home rather than two
   that could drift. This file imports them like any other. */

/**
 * The words a CONNECTION card's chip says.
 *
 * Deliberately NOT the job vocabulary in `JOB_STATUS_LABEL`: "✓ Ready" is a
 * claim about a job whose model can actually run, and a connection card that
 * said it would be the same kind of lie Defect 3 was about. A connection is
 * "✓ Connected", "✓ Signed in", "✓ Running", "Not set up", "Turned off" or
 * "Could not reach"; the job it feeds is a separate question and has its own
 * chip on the other tab.
 *
 * There was a "Retired" chip too, and it is gone with the card that drew it
 * (the Grok sign-in, GR-C). Its help said "only its transport stays
 * registered" -- true while SuperGrok was retired-but-wired, and false the
 * moment the provider was removed, which is exactly the kind of stale claim a
 * chip nobody draws any more keeps making.
 */
type ConnectionChipKind = "connected" | "signedin" | "running" | "off" | "notset" | "unreachable";

const CONNECTION_CHIP: Readonly<
  Record<ConnectionChipKind, { tone: ChipTone; label: string; help: string }>
> = {
  connected: {
    tone: "ready",
    label: "✓ Connected",
    help: "A key is stored on the server and this connection is switched on, so a job assigned to it can run.",
  },
  signedin: {
    tone: "ready",
    label: "✓ Signed in",
    help: "This sign-in works, so a job assigned to it can run.",
  },
  running: {
    tone: "ready",
    label: "✓ Running",
    help: "This server answers and a model is already in memory, so the first call starts working straight away.",
  },
  off: {
    tone: "quiet",
    label: "Turned off",
    help: "This connection is switched off. No picker offers it and no job can run on it until it is switched on again in Settings.",
  },
  notset: {
    tone: "quiet",
    label: "Not set up",
    help: "Nothing is stored for this connection yet, so no job can run on it. Set it up to make its models available.",
  },
  unreachable: {
    tone: "signin",
    label: "Could not reach",
    help: "This address did not answer. Check that the server is running and that the address in Settings is right.",
  },
};

function ConnectionChip({
  kind,
  label,
  help,
}: {
  kind: ConnectionChipKind;
  label?: string;
  help?: string;
}) {
  const look = CONNECTION_CHIP[kind];
  return <Chip tone={look.tone} label={label ?? look.label} help={help ?? look.help} />;
}

/**
 * One drawn connection card: name, how it is connected, its chip, its models,
 * its own actions.
 *
 * `min-w-0` on the flex column and on the name block is load-bearing: a long
 * base URL or a long model id in an `auto`-sized grid track would otherwise
 * push the card wider than its column and take the page sideways with it.
 */
function ConnectionCard({
  title,
  how,
  chip,
  children,
  actions,
}: {
  title: string;
  how: string;
  chip: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-2.5 p-4"
      style={{ background: "var(--bg2)", border: "1px solid var(--line)" }}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-lg font-extrabold">{title}</span>
          <span className="text-sm text-ink-2">{how}</span>
        </div>
        {chip}
      </div>
      {children}
      {actions ? <div className="flex flex-wrap gap-1.5">{actions}</div> : null}
    </div>
  );
}

/** The registry's entries for one transport, in picker order. */
function entriesOfKind(kind: ProviderKind): readonly ProviderEntry[] {
  return providersFor(CONNECTION_SURFACE).filter((entry) => entry.kind === kind);
}

/**
 * The effort levels one exact model takes, as chips.
 *
 * The same function the pickers and the assignment table use, so a level shown
 * on a card is a level the run will actually send. No levels means no chips --
 * "this model declares none" is not a fact a two-word chip can carry, and the
 * card's model row already says what the transport is.
 */
function EffortChips({
  providerId,
  exactModel,
}: {
  providerId: string;
  exactModel?: string | null;
}) {
  const efforts = jobEffortOptions(providerId, exactModel);
  if (!efforts.length) return null;
  return (
    <div className="flex flex-wrap gap-1" style={{ gridColumn: "1 / -1" }}>
      {efforts.map((effort) => (
        <span
          key={effort}
          title={jobEffortOptionTitle(effort)}
          className="text-sm font-bold"
          style={{ border: "1px solid var(--line)", color: "var(--fg2)", padding: "0 6px" }}
        >
          {jobEffortLabel(effort)}
        </span>
      ))}
    </div>
  );
}

/**
 * The models a transport brings, one row each.
 *
 * The row says the registry's own label and half-line, and the transport it
 * arrives by ("sign-in" / "API" / "on this computer") -- the connection word
 * the whole screen shares. The prototype draws "200K context · tools" here;
 * this build has no per-model context or tool table for a hosted provider, and
 * inventing one would be the second registry rule 3 forbids, so the row states
 * what the registry actually declares.
 */
function ProviderModelRows({ entries }: { entries: readonly ProviderEntry[] }) {
  const [showAll, setShowAll] = useState(false);
  return (
    <div className="flex flex-col">
      {(showAll ? entries : entries.slice(0, 5)).map((entry) => (
        <div
          key={entry.id}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr)",
            gap: "2px 10px",
            padding: "8px 0",
            borderTop: "1px solid var(--line)",
          }}
        >
          <span className="text-base font-bold">{entry.label}</span>
          <span className="text-sm text-ink-2" title={entry.detail}>
            {entry.optionDetail ?? entry.detail} · {connectionWord(entry.kind)}
          </span>
          <EffortChips providerId={entry.id} />
        </div>
      ))}
      {entries.length > 5 ? (
        <InkButton tone="quiet" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show all ${entries.length}`}
        </InkButton>
      ) : null}
    </div>
  );
}

/**
 * The API-key connections, one card each.
 *
 * A card is a saved connection, because that is the record the desk keeps: it
 * has a name the owner typed, a base URL, a model id and a key. The prototype
 * draws three named provider cards (Anthropic, OpenAI, Google); this build's
 * store is one generic OpenAI-compatible connection, so a card is that
 * connection and its title is the name its owner gave it. Nothing here names a
 * service, for the same reason nothing here names a model.
 */
function ApiKeyConnections({
  onNote,
  onOpen,
}: {
  onNote: (text: string) => void;
  onOpen: (dialog: ConnectionDialog) => void;
}) {
  const qc = useQueryClient();
  const connections = useQuery({
    queryKey: ["custom-ai-connections"],
    queryFn: () => getCustomAiConnectionsFn(),
  });

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["custom-ai-connections"] });
    void qc.invalidateQueries({ queryKey: PROVIDER_AVAILABILITY_QUERY_KEY, refetchType: "all" });
  }

  const remove = useMutation({
    mutationFn: (row: PublicCustomAiConnection) =>
      deleteCustomAiConnectionFn({ data: { id: row.id } }),
    onSuccess: (_res, row) => {
      onNote(`${row.name} was removed.`);
      refresh();
    },
    onError: () => onNote("That connection could not be removed."),
  });
  const test = useMutation({
    mutationFn: (row: PublicCustomAiConnection) =>
      testCustomAiConnectionFn({ data: { id: row.id } }),
    onSuccess: (res, row) => {
      onNote(
        res.ok
          ? `${row.name} answered in ${(res.latencyMs / 1000).toFixed(1)} seconds.`
          : `${row.name} did not answer: ${res.message}`,
      );
      refresh();
    },
    onError: () => onNote("That check did not run."),
  });
  if (connections.isPending) return <ListSkeleton rows={2} />;
  if (connections.isError && !connections.data) {
    return (
      <div
        className="flex flex-col items-start gap-3 border border-rule p-4"
        role="alert"
        style={{ gridColumn: "1 / -1" }}
      >
        <p>Could not read the API connections. Existing writing models are unchanged.</p>
        <InkButton tone="quiet" onClick={() => void connections.refetch()}>
          Try again
        </InkButton>
      </div>
    );
  }
  const rows = connections.data ?? [];
  return (
    <>
      {rows.map((row) => (
        <ConnectionCard
          key={row.id}
          title={row.name}
          how={`${row.hasApiKey ? "API key — stored on the server" : "No API key"} · ${hostOf(row.baseUrl)}${row.modelId ? ` · ${row.modelId}` : ""}`}
          chip={
            <ConnectionChip
              kind={!row.hasApiKey ? "notset" : row.enabled ? "connected" : "off"}
              label={!row.hasApiKey ? undefined : row.enabled ? undefined : "Turned off"}
            />
          }
          actions={
            <>
              <InkButton
                tone="quiet"
                disabled={test.isPending || !row.hasApiKey}
                onClick={() => {
                  if (
                    !confirm(
                      `Testing sends a small prompt to ${row.name} and may incur a charge. Continue?`,
                    )
                  )
                    return;
                  test.mutate(row);
                }}
              >
                {test.isPending ? "Testing…" : "Test"}
              </InkButton>
              <InkButton tone="quiet" onClick={() => onOpen({ kind: "connection", id: row.id })}>
                Settings
              </InkButton>
              <InkButton
                tone="quiet-danger"
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm(`Remove ${row.name}? This cannot be undone.`)) remove.mutate(row);
                }}
              >
                {remove.isPending ? "Removing…" : "Remove"}
              </InkButton>
            </>
          }
        >
          <EffortChips providerId={`custom:${row.id}`} exactModel={row.modelId} />
        </ConnectionCard>
      ))}

      {/*
        A provider with nothing configured is a card with one button, not a
        form: an empty form on a page nobody is editing reads as unfinished
        work. The brief draws exactly this card, and "+ Add a connection" above
        is the same door.
      */}
      {!rows.length ? (
        <ConnectionCard
          title="No API connection yet"
          how="Nothing is stored on this server"
          chip={<ConnectionChip kind="notset" />}
          actions={<InkButton onClick={() => onOpen({ kind: "add" })}>Set up</InkButton>}
        />
      ) : null}
    </>
  );
}

/**
 * The CLI sign-ins: the same card Server settings draws.
 *
 * The cards are `li`s because the component that draws them is the one Server
 * settings draws, markup included -- `li[data-provider]` is what
 * scripts/provider-signin-e2e.mjs drives. So the grid here is a real list.
 * `times={[]}` because the per-provider time limits belong to the panel that
 * owns them on /desk/ops; this is the place they are LINKED to, not a second
 * place to edit them.
 */
function SignInConnections({ onNote }: { onNote: (text: string) => void }) {
  const statuses = useQuery({
    queryKey: ["provider-statuses"],
    queryFn: () => getProviderStatuses(),
    refetchInterval: 60_000,
  });
  if (statuses.isPending) return <ListSkeleton rows={2} />;
  if (statuses.isError && !statuses.data) {
    return (
      <div
        className="flex flex-col items-start gap-3 border border-rule p-4"
        role="alert"
        style={{ gridColumn: "1 / -1" }}
      >
        <p>Could not read the sign-ins. Existing drafts are unchanged.</p>
        <InkButton tone="quiet" onClick={() => void statuses.refetch()}>
          Try again
        </InkButton>
      </div>
    );
  }
  return (
    <>
      <ul
        className="m-0 grid list-none grid-cols-1 gap-3.5 p-0 md:grid-cols-2"
        style={{ gridColumn: "1 / -1" }}
      >
        {(statuses.data ?? []).map((status) => (
          <ProviderStatusCard
            key={status.provider}
            status={status}
            onNote={onNote}
            times={[]}
            chip={
              <ConnectionChip
                kind={status.signedIn ? "signedin" : status.installed ? "notset" : "unreachable"}
                label={status.installed ? undefined : "Not installed"}
                help={
                  status.signedIn
                    ? CONNECTION_CHIP.signedin.help
                    : status.installed
                      ? "This sign-in has not been made yet, so a job assigned to it cannot run."
                      : "This machine has no such command installed, so no job assigned to it can run."
                }
              />
            }
          >
            {/* What this sign-in can actually run: the registry's own entries
                for that transport, not a typed-out list of model names. */}
            <ProviderModelRows
              entries={entriesOfKind(status.provider === "claude" ? "claude-code" : "codex")}
            />
          </ProviderStatusCard>
        ))}
      </ul>
    </>
  );
}

/**
 * One drawn group: the heading rule, the note, then the cards.
 *
 * `below` is for the sentence that belongs to the group but not to any card --
 * the OAuth group's pointer at the time-limit fields, which stay where they
 * are. It sits outside the card grid so the grid's own columns are untouched.
 * There is no action slot: the design puts "+ Add a connection" on the PAGE
 * header, beside "Test all connections", not on a group rule.
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
        <h3 className="text-2xl font-extrabold">{title}</h3>
        <span className="text-base text-ink-2">{note}</span>
      </div>
      {/*
        TWO columns above 768px, one below, per the design.

        Not `auto-fit`: a 360px floor in a 1240px group fits THREE tracks, and
        the design draws two cards per row -- "as drawn" is the whole point of
        this unit, so the count is fixed and the columns are fractions. Below
        768px one column is the only thing that does not squeeze a card's host
        line into a one-word-per-line column.
      */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">{children}</div>
      {below ? <p className="text-sm text-ink-2">{below}</p> : null}
    </section>
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
    /*
      The empty state is a card too, in the same grid as a server card, so the
      group looks the same whether or not anything answered -- and it carries
      the two honest actions: look again, or go change the address.
    */
    return (
      <ConnectionCard
        title="No local server answering"
        how="Nothing on this machine's loopback or the configured address answered"
        chip={<ConnectionChip kind="unreachable" />}
        actions={
          <>
            <InkButton tone="quiet" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
              {refresh.isPending ? "Checking…" : "Check again"}
            </InkButton>
            <a className="inline-link" href="/desk/ops">
              Settings
            </a>
          </>
        }
      >
        <p className="text-sm text-ink-2">
          Start LM Studio or Ollama and check again — TownReporter never starts a server and never
          loads a model for you.
        </p>
      </ConnectionCard>
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
  const [showAll, setShowAll] = useState(false);
  const kindLabel = SERVER_KIND_LABEL[server.kind] ?? server.kind;
  const loopback = isLoopback(server.baseUrl);
  const origin = originOf(server.baseUrl);
  const inMemory = server.models.filter((model) => model.loaded === true).length;
  return (
    <ConnectionCard
      title={`${kindLabel} · ${loopback ? "this machine" : "remote"}`}
      how={
        hostOf(server.baseUrl) +
        (server.reachable
          ? inMemory
            ? ` · ${inMemory} in memory`
            : " · nothing in memory"
          : " · not reachable")
      }
      chip={
        <ConnectionChip
          kind={!server.reachable ? "unreachable" : "running"}
          label={server.reachable ? "Ready" : undefined}
          help={
            server.reachable
              ? "This server answers. Its models and load states are listed below."
              : undefined
          }
        />
      }
      actions={
        <>
          {/*
            "Open LM Studio ↗" and "Open Ollama ↗" -- hand-off links, which is
            all a browser can honestly do here: the server's own console lives
            at that address, and there is deliberately no Load and no Pull
            button. The Settings link goes to the address field these two are
            read from.
          */}
          {server.reachable ? (
            <a
              className="inline-link"
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
          <a className="inline-link" href="/desk/ops">
            Settings
          </a>
        </>
      }
    >
      <div className="flex flex-col">
        {server.models.length === 0 ? (
          <p className="py-2 text-sm text-ink-2" style={{ borderTop: "1px solid var(--line)" }}>
            {server.reachable ? "No chat models on this server." : "Nothing to list."}
          </p>
        ) : (
          (showAll ? server.models : server.models.slice(0, 5)).map((model) => (
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
                gridTemplateColumns: "minmax(0,1fr)",
                gap: "2px 10px",
                padding: "8px 0",
                borderTop: "1px solid var(--line)",
              }}
            >
              <span className="text-base font-bold">{model.label || model.id}</span>
              <span className="text-sm text-ink-2">
                {model.loaded === null
                  ? "load state unknown"
                  : model.loaded
                    ? "in memory"
                    : "not loaded"}
                {model.contextLength ? ` · ${Math.round(model.contextLength / 1024)}K context` : ""}
                {model.vision ? " · reads images" : ""}
                {model.thinking ? " · thinks by default" : ""}
              </span>
              <EffortChips providerId="local-model" exactModel={model.id} />
            </div>
          ))
        )}
      </div>
      {server.models.length > 5 ? (
        <InkButton tone="quiet" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show all ${server.models.length}`}
        </InkButton>
      ) : null}
    </ConnectionCard>
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
