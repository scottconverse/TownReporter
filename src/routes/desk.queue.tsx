import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { DraftBatchResult } from "@/components/draft-batch-result";
import { ModelPicker } from "@/components/model-picker";
import { DeskShell, Field, InkButton } from "@/components/desk-chrome";
import { LeadRowView, SEEN_AGAIN_EXPLAINER } from "@/components/desk-leads";
import { ListSkeleton, Notice, ScreenError } from "@/components/states";
import { deleteLead, draftLead, fileLead, listLeads, listPublishedDesk, listScans, setLeadStatus } from "@/lib/news/desk";
import { restoreTrashItem } from "@/lib/news/trash";
import {
  duplicateKillReason,
  editorActionError,
  mergeFocusSelection,
  nearDuplicate,
  openLeads,
  suggestFocusLeads,
  workingQueueEmptyCopy,
} from "@/lib/news/desk-copy";
import { useEditorSections } from "@/lib/use-sections";
import type { LeadRow } from "@/lib/news/types";
import { usePaper } from "@/lib/paper-context-state";
import { modelChoiceLabel, type StoryModelChoice } from "@/lib/news/model-choice";
import { defaultModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import { myDesk } from "@/lib/news/claim";
import {
  getDraftBatch,
  startDraftBatch,
  type DraftBatchRuntime,
} from "@/lib/news/draft-batch";

export const Route = createFileRoute("/desk/queue")({ component: QueuePage });

/** The drawn tab set (README "3. Queue"). */
type QueueFilter = "open" | "held" | "killed" | "printed" | "all";

/** Sort: Best first is the score the scanner gave; the other two are the age
 *  of the lead, for an editor who came back after a day away. */
type QueueSort = "best" | "newest" | "oldest";

/**
 * What "Select all ... leads shown" calls the tab it is selecting. "all" says
 * nothing extra, so it is left out rather than printed as "all leads shown".
 */
function bulkSelectLabel(filter: QueueFilter): string {
  if (filter === "open") return "open";
  if (filter === "printed") return "matching printed";
  if (filter === "all") return "";
  return filter;
}

function QueuePage() {
  const { sections } = useEditorSections();
  const TOPICS = sections.map(s=>s.key);
  const PAPER = usePaper();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const desk = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const newsroomId = desk.data?.ok ? desk.data.newsroomId : null;
  const { data: leads = [], isPending, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["leads"],
    queryFn: () => listLeads(),
    placeholderData: keepPreviousData,
  });
  const scans = useQuery({ queryKey: ["scans"], queryFn: () => listScans() });
  const published = useQuery({ queryKey: ["published-desk"], queryFn: () => listPublishedDesk() });
  const setStatus = useMutation({
    mutationFn: (input: {
      id: number;
      status: "held" | "killed" | "new";
      killReason?: string;
      killReasonUrl?: string;
    }) => setLeadStatus({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
  /*
   * Unit AK item 4: "Kill as duplicate" is the same kill with a reason
   * recorded (migration 0094). It rejects on failure so the row can say
   * "That did not save." instead of looking like it worked.
   */
  const killAsDuplicate = useMutation({
    mutationFn: (input: { id: number; killReason: string }) =>
      setLeadStatus({ data: { id: input.id, status: "killed", killReason: input.killReason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteLead({ data: id }),
    onSuccess: (res) => {
      if (!res?.ok) {
        setDeleteError(res?.error ?? "That did not delete.");
        setUndo(null);
      } else {
        // Undo where the delete happened. The trash on the Server page is the
        // durable net; this is the one an editor will actually reach for.
        setDeleteError("");
        setUndo(res.trashId);
      }
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => setDeleteError(e instanceof Error ? e.message : "That did not delete."),
  });
  const [deleteError, setDeleteError] = useState("");
  const [bulkDeleteNotice, setBulkDeleteNotice] = useState("");
  const [selectedDeleteLeadIds, setSelectedDeleteLeadIds] = useState<number[]>([]);
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [undo, setUndo] = useState<number | null>(null);
  const bulkRemove = useMutation({
    mutationFn: async (leadIds: number[]) => {
      const deletedIds: number[] = [];
      const failures: string[] = [];
      for (const leadId of leadIds) {
        try {
          const result = await deleteLead({ data: leadId });
          if (result?.ok) deletedIds.push(leadId);
          else failures.push(result?.error ?? `Lead #${leadId} did not delete.`);
        } catch (cause) {
          failures.push(cause instanceof Error ? cause.message : `Lead #${leadId} did not delete.`);
        }
      }
      return { deletedIds, failures };
    },
    onSuccess: async ({ deletedIds, failures }) => {
      setConfirmingBulkDelete(false);
      setSelectedDeleteLeadIds((ids) => ids.filter((id) => !deletedIds.includes(id)));
      setUndo(null);
      setBulkDeleteNotice(
        deletedIds.length > 0
          ? `Deleted ${deletedIds.length} lead${deletedIds.length === 1 ? "" : "s"}. Recoverable for 30 days under Server > Recently deleted.`
          : "",
      );
      setDeleteError(failures.join(" "));
      await qc.invalidateQueries({ queryKey: ["leads"] });
      await qc.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: (cause) => {
      setConfirmingBulkDelete(false);
      setDeleteError(cause instanceof Error ? cause.message : "The selected leads did not delete.");
    },
  });
  const undoDelete = useMutation({
    mutationFn: (id: number) => restoreTrashItem({ data: id }),
    onSuccess: (res) => {
      setUndo(null);
      if (!res?.ok) setDeleteError(res?.error ?? "That would not go back.");
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: (e) => setDeleteError(e instanceof Error ? e.message : "That would not go back."),
  });
  /*
    Redesign phase 2a (README "3. Queue"): the tabs are Open, Held, Killed,
    ≈ Printed and All -- the working set first, then the three ways a lead
    leaves it, then everything including what has printed. Two filters the old
    strip carried are gone as TABS (New and Drafted) because both are the Open
    set; every row still chips its own status, and the search and section
    controls cover narrowing within Open.
  */
  const [filter, setFilter] = useState<QueueFilter>("open");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<QueueSort>("best");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [focusTarget, setFocusTarget] = useState<3 | 4 | 5>(3);
  const [headline, setHeadline] = useState("");
  const [why, setWhy] = useState("");
  const [topic, setTopic] = useState("council");
  const [url, setUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [draftNotices, setDraftNotices] = useState<Record<number, { kind: "ok" | "err"; text: string }>>({});
  const [draftingIds, setDraftingIds] = useState<number[]>([]);
  const [selectedBatchLeadIds, setSelectedBatchLeadIds] = useState<number[]>([]);
  const [batchRuntime, setBatchRuntime] = useState<DraftBatchRuntime>("local-model");
  const [batchEffort, setBatchEffort] = useState<ModelEffort | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null);
  const [batchNotice, setBatchNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const leadRefreshAfterTerminalBatch = useRef<number | null>(null);
  const hydratedBatchId = useRef<number | null>(null);
  const batch = useQuery({
    queryKey: ["draft-batch", newsroomId, activeBatchId ?? "latest"],
    queryFn: () => getDraftBatch({ data: activeBatchId ? { batchId: activeBatchId } : {} }),
    enabled: newsroomId !== null,
    refetchInterval: (query) => {
      const result = query.state.data;
      if (!result?.ok || !result.batch) return false;
      return result.batch.items.some((item) => item.status === "queued" || item.status === "running")
        ? 1_500
        : false;
    },
  });
  useEffect(() => {
    const current = batch.data?.ok ? batch.data.batch : null;
    if (!current || hydratedBatchId.current === current.id) return;
    hydratedBatchId.current = current.id;
    setBatchRuntime(current.runtime.modelChoice);
    setBatchEffort(current.runtime.modelEffort);
  }, [batch.data]);
  useEffect(() => {
    const current = batch.data?.ok ? batch.data.batch : null;
    if (!current) return;
    const open = current.items.some((item) => item.status === "queued" || item.status === "running");
    if (open || leadRefreshAfterTerminalBatch.current === current.id) return;
    leadRefreshAfterTerminalBatch.current = current.id;
    void qc.invalidateQueries({ queryKey: ["leads"] });
  }, [batch.data, qc]);
  const startBatch = useMutation({
    mutationFn: (input: { leadIds: number[]; runtime: DraftBatchRuntime; modelEffort: ModelEffort | null }) =>
      startDraftBatch({
        data: { items: input.leadIds.map((leadId) => ({ leadId })), runtime: input.runtime, modelEffort: input.modelEffort },
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        setBatchNotice({
          kind: "err",
          text: `${result.error}${result.leadId ? ` (lead #${result.leadId})` : ""}`,
        });
        return;
      }
      setSelectedBatchLeadIds([]);
      setActiveBatchId(result.batch.id);
      leadRefreshAfterTerminalBatch.current = null;
      setBatchNotice({
        kind: "ok",
        text: `Draft batch started with ${result.batch.runtime.label}.`,
      });
      qc.setQueryData(["draft-batch", newsroomId, result.batch.id], result);
    },
    onError: (error) => {
      setBatchNotice({
        kind: "err",
        text: error instanceof Error ? error.message : "That draft batch did not start.",
      });
    },
  });
  const queueDraft = useMutation({
    mutationFn: (input: { leadId: number; modelChoice: StoryModelChoice; modelEffort?: ModelEffort | null; fromBatch?: boolean }) =>
      draftLead({ data: { leadId: input.leadId, modelChoice: input.modelChoice, modelEffort: input.modelEffort } }),
    onMutate: ({ leadId }) => setDraftingIds((ids) => [...ids.filter((id) => id !== leadId), leadId]),
    onSuccess: (res, { leadId, modelChoice, fromBatch }) => {
      if (res?.ok) {
        if (fromBatch) setBatchNotice({
          kind: "ok",
          text: `Redraft queued with ${modelChoiceLabel(modelChoice)}. Open the story workbench to watch it arrive; if a technical fallback is needed, the workbench records the model used.`,
        });
        setDraftNotices((notices) => ({
          ...notices,
          [leadId]: {
            kind: "ok",
            text: `Draft queued with ${modelChoiceLabel(res.modelChoice)}. Open the lead to watch it arrive.`,
          },
        }));
      } else {
        if (fromBatch) setBatchNotice({
          kind: "err",
          text: res?.error ?? "That redraft did not queue.",
        });
        setDraftNotices((notices) => ({
          ...notices,
          [leadId]: {
            kind: "err",
            text: res?.error
              ? `${res.error}${"detail" in res && res.detail ? `\n\n${res.detail}` : ""}`
              : "That draft did not queue.",
          },
        }));
      }
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (error, { leadId, fromBatch }) => {
      const text = error instanceof Error ? error.message : "That draft did not queue.";
      if (fromBatch) setBatchNotice({ kind: "err", text });
      setDraftNotices((notices) => ({ ...notices, [leadId]: { kind: "err", text } }));
    },
    onSettled: (_data, _error, { leadId }) => setDraftingIds((ids) => ids.filter((id) => id !== leadId)),
  });
  const file = useMutation({
    mutationFn: () => fileLead({ data: { headline, why, topic, url } }),
    onSuccess: async (res) => {
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      setHeadline("");
      setWhy("");
      setUrl("");
      setFormError(null);
      await qc.invalidateQueries({ queryKey: ["leads"] });
      await navigate({ to: "/desk/story/$leadId", params: { leadId: String(res.id) } });
    },
    onError: (err) => {
      /*
        `fileLeadInput` caps the headline, the why-now, the section and the
        URL, and none of those three inputs carries a `maxLength`: an editor
        who types past a bound got the issues array in the form's error line.
      */
      setFormError(
        editorActionError(err instanceof Error ? err.message : "", "file that lead") ??
          "Could not file that lead.",
      );
    },
  });

  const working = openLeads(leads);
  const batchEligible = leads.filter(
    (lead) => lead.status !== "held" && lead.status !== "killed" && lead.status !== "published",
  );
  const selectedBatchLeads = selectedBatchLeadIds.filter((leadId) =>
    batchEligible.some((lead) => lead.id === leadId),
  );
  const suggestedFocus = suggestFocusLeads(batchEligible, sections, focusTarget);
  const focusAddable = suggestedFocus.filter((lead) => !selectedBatchLeads.includes(lead.id));
  const publishedCount = leads.filter((l) => l.status === "published").length;
  const last = scans.data?.rows?.[0];
  const counts = {
    all: working.length,
    new: leads.filter((l) => l.status === "new").length,
    drafted: leads.filter((l) => l.status === "drafted").length,
    held: leads.filter((l) => l.status === "held").length,
    killed: leads.filter((l) => l.status === "killed").length,
  };
  const printed = published.data ?? [];
  /*
    "≈ Printed": the leads the desk already matches to a piece that ran
    (the same `nearDuplicate` the row's chip and "Kill as duplicate" use).
    It is a real, checkable set on this screen, not a count of nothing.
  */
  const printedMatches = leads.filter((l) => nearDuplicate(l, printed) !== null);
  const queueFilters: { key: QueueFilter; label: string; count: number }[] = [
    { key: "open", label: "Open", count: working.length },
    { key: "held", label: "Held", count: counts.held },
    { key: "killed", label: "Killed", count: counts.killed },
    { key: "printed", label: "≈ Printed", count: printedMatches.length },
    { key: "all", label: "All", count: leads.length },
  ];
  const byFilter =
    filter === "killed"
      ? leads.filter((l) => l.status === "killed")
      : filter === "held"
        ? leads.filter((l) => l.status === "held")
        : filter === "printed"
          ? printedMatches
          : filter === "open"
            ? working
            : leads;
  const needle = search.trim().toLowerCase();
  const bySearch = needle
    ? byFilter.filter((l) =>
        `${l.headline} ${l.why ?? ""} ${l.topic ?? ""}`.toLowerCase().includes(needle),
      )
    : byFilter;
  const filtered = sectionFilter === "all" ? bySearch : bySearch.filter((l) => l.topic === sectionFilter);
  const byAge = (a: LeadRow, b: LeadRow) =>
    sort === "newest"
      ? Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id
      : Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id;
  const shown =
    sort === "best" && filter === "killed"
      ? // What keeps coming back belongs on top of the Killed tab -- that is
        // the whole point of stamping a resurfaced lead instead of quietly
        // hiding it. Leads never resurfaced (last_resurfaced_at null) sort
        // after ones that have, oldest kill first within that group.
        [...filtered].sort((a, b) => {
          const at = a.last_resurfaced_at ? Date.parse(a.last_resurfaced_at) : -1;
          const bt = b.last_resurfaced_at ? Date.parse(b.last_resurfaced_at) : -1;
          if (at !== bt) return bt - at;
          return b.id - a.id;
        })
      : [...filtered].sort(
          sort === "best" ? (a, b) => (b.newsworthiness ?? 0) - (a.newsworthiness ?? 0) : byAge,
        );
  const shownIds = shown.map((lead) => lead.id);
  const selectedDeleteLeads = selectedDeleteLeadIds.filter((leadId) => shownIds.includes(leadId));
  const allShownSelected = shownIds.length > 0 && shownIds.every((leadId) => selectedDeleteLeadIds.includes(leadId));
  /*
    The bulk strip acts on the rows the checkbox column has selected -- the
    same selection bulk Delete uses, so there is one checkbox per row and one
    bar, and every press in the bar is a press the row itself already offers.
  */
  const selectedLeads = leads.filter((lead) => selectedDeleteLeads.includes(lead.id));
  const bulkDraftable = selectedLeads.filter(
    (lead) => lead.status !== "held" && lead.status !== "killed" && lead.status !== "published",
  );
  const bulkBusy = setStatus.isPending || startBatch.isPending || bulkRemove.isPending;
  const bulkSetStatus = (status: "held" | "killed") => {
    for (const lead of selectedLeads) setStatus.mutate({ id: lead.id, status });
  };
  /*
    Open the section a hash names.

    Today's "+ Add a lead" links to /desk/queue#file-lead. A hash on its own
    scrolls to a shut <details> and leaves it shut, so the link would land on a
    label instead of the form it names. The one element on this page that is a
    <details> is the file form; opening whatever the hash names is the whole
    behaviour, and it stays correct if another one is added.
  */
  useEffect(() => {
    const reveal = () => {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      const target = document.getElementById(hash);
      if (!(target instanceof HTMLDetailsElement)) return;
      target.open = true;
      target.scrollIntoView({ block: "start" });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);

  return (
    <DeskShell title="The queue" kicker="Leads">
      <p className="lede">
        Everything that might be news, scored and sorted. The scanner and Dark Desk file leads
        here; so do you. Printed stories move to Published. Nothing prints until you open a lead
        and publish it.
      </p>

      {/* id: Today's "+ Add a lead" lands here rather than at the top of the
          Queue, so the link opens the form it names (redesign phase 2a). */}
      <details className="file-form" id="file-lead">
        <summary>File a lead yourself</summary>
        <p>Have a transcript, packet or documents? <Link to="/desk">Write a story from text or uploaded documents on the Desk.</Link></p>
        <p>
          Already written somewhere else? <Link to="/desk/import">Import finished stories</Link> — paste
          one story or a whole report and check each one before it lands here.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setFormError(null);
            file.mutate();
          }}
        >
          <div className="form-grid">
            <Field label="Headline">
              <input
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                required
                minLength={8}
                placeholder="What happened"
              />
            </Field>
            <Field label="Why now">
              <input
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                required
                minLength={8}
                placeholder={`Why this is news in ${PAPER.city} today`}
              />
            </Field>
            <Field label="Topic">
              <select value={topic} onChange={(e) => setTopic(e.target.value)}>
                {TOPICS.filter((t) => t !== "about").map((t) => (
                  <option key={t} value={t}>
                    {sections.find(s=>s.key===t)?.name??t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source URL (optional)">
              <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
            </Field>
          </div>
          {formError ? <Notice kind="err">{formError}</Notice> : null}
          <InkButton disabled={file.isPending} type="submit">
            {file.isPending ? "Filing…" : "File lead"}
          </InkButton>
        </form>
      </details>

      <section id="draft-batch" aria-labelledby="draft-batch-heading">
        <h2 id="draft-batch-heading">Draft selected leads</h2>
        <p className="wire-sum">
          Choose up to five eligible queue leads and one writing runtime. Each lead keeps its own
          stored research scope. This queues drafts for editor review; it does not publish anything.
        </p>
        <div className="wire-sum">
          <Field label="Suggested focus size">
            <select
              value={focusTarget}
              onChange={(event) => setFocusTarget(Number(event.target.value) as 3 | 4 | 5)}
              disabled={startBatch.isPending}
            >
              {[3, 4, 5].map((size) => (
                <option key={size} value={size}>
                  {size} leads
                </option>
              ))}
            </select>
          </Field>
          <p className="meta">
            Suggestions balance existing lead scores and sections. Review the evidence before drafting.
          </p>
          <InkButton
            small
            disabled={startBatch.isPending || focusAddable.length === 0 || selectedBatchLeads.length >= 5}
            onClick={() => {
              setSelectedBatchLeadIds((ids) =>
                mergeFocusSelection(
                  ids,
                  batchEligible.map((lead) => lead.id),
                  suggestedFocus.map((lead) => lead.id),
                  5,
                ),
              );
            }}
          >
            Add suggested focus ({Math.min(focusAddable.length, 5 - selectedBatchLeads.length)})
          </InkButton>
        </div>
        <ModelPicker
          scope="forced"
          value={batchRuntime}
          onChange={(choice) => {
            const runtime = choice as DraftBatchRuntime;
            setBatchRuntime(runtime);
            setBatchEffort(defaultModelEffort(runtime));
          }}
          effort={batchEffort}
          onEffortChange={setBatchEffort}
          disabled={startBatch.isPending}
          compact
          excludeAutomatic
        />
        <p className="meta">{selectedBatchLeads.length} of 5 selected</p>
        <InkButton
          disabled={newsroomId === null || selectedBatchLeads.length === 0 || startBatch.isPending}
          onClick={() => {
            setBatchNotice(null);
            startBatch.mutate({ leadIds: selectedBatchLeads, runtime: batchRuntime, modelEffort: batchEffort });
          }}
        >
          {startBatch.isPending ? "Starting batch…" : "Draft selected"}
        </InkButton>
        {batchNotice ? <Notice kind={batchNotice.kind}>{batchNotice.text}</Notice> : null}
        {desk.isPending || batch.isPending ? (
          <p className="meta">Loading the latest draft batch…</p>
        ) : batch.isError ? (
          <Notice kind="err">Could not load the latest draft batch.</Notice>
        ) : batch.data && !batch.data.ok ? (
          <Notice kind="err">{batch.data.error}</Notice>
        ) : batch.data?.ok && batch.data.batch ? (
          <div className="lead-list roomy" aria-label="Draft batch results">
            <p className="meta">
              Batch #{batch.data.batch.id} · {batch.data.batch.runtime.label}
            </p>
            {batch.data.batch.runtime.runtime === "local" ? (
              <p className="meta">
                This batch keeps the saved local model shown above.{" "}
                <Link to="/desk/ops" className="inline-link">
                  Review local models on Server
                </Link>{" "}
                before starting another batch.
              </p>
            ) : null}
            {batch.data.batch.items.map((item) => {
              const lead = leads.find((candidate) => candidate.id === item.leadId);
               return <DraftBatchResult
                 key={item.jobId}
                 item={item}
                 headline={lead?.headline ?? `lead #${item.leadId}`}
                 redraftLabel={modelChoiceLabel(batchRuntime)}
                 redrafting={draftingIds.includes(item.leadId)}
                 onRedraft={() => {
                   setBatchNotice(null);
                   queueDraft.mutate({ leadId: item.leadId, modelChoice: batchRuntime, modelEffort: batchEffort, fromBatch: true });
                 }}
               />;
            })}
          </div>
        ) : (
          <p className="meta">No draft batch has been started in this newsroom.</p>
        )}
      </section>

      <div className="queue-controls">
        <Field label="Search leads">
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSelectedDeleteLeadIds([]);
              setConfirmingBulkDelete(false);
              setBulkDeleteNotice("");
            }}
            placeholder="Headline, why now or section"
          />
        </Field>
        <Field label="Sort">
          <select value={sort} onChange={(event) => setSort(event.target.value as QueueSort)}>
            <option value="best">Best first</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </Field>
        <Field label="Section">
          <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}>
            <option value="all">All sections</option>
            {sections.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="seg-strip queue-tabs" role="group" aria-label="Filter leads">
          {queueFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              className={filter === f.key ? "on" : ""}
              aria-pressed={filter === f.key}
              title={
                f.key === "held" && f.count > 0
                  ? `${f.count} lead${f.count === 1 ? "" : "s"} waiting on you under Held`
                  : undefined
              }
              onClick={() => {
                setFilter(f.key);
                setSelectedDeleteLeadIds([]);
                setConfirmingBulkDelete(false);
                setBulkDeleteNotice("");
              }}
            >
              {f.label} ·{" "}
              {/*
                Unit AK item 7: the Held count is a badge, not one more number
                in a row of numbers -- a lead sitting in Held is waiting on the
                editor, which is the state the owner could not see. The visible
                text is still "held <n>", so anything that finds the tab by its
                words is unchanged.
              */}
              <span className={"filter-badge" + (f.key === "held" && f.count > 0 ? " waiting" : "")}>
                {f.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {shown.length > 0 ? (
        <section className="queue-bulk-delete queue-bulk" aria-label="Bulk actions for the leads shown">
          <span className="queue-bulk-what">
            <label>
              <input
                type="checkbox"
                className="queue-check"
                checked={allShownSelected}
                onChange={(event) => {
                  setConfirmingBulkDelete(false);
                  setBulkDeleteNotice("");
                  setSelectedDeleteLeadIds(event.target.checked ? shownIds : []);
                }}
              />{" "}
              Select all{bulkSelectLabel(filter) ? ` ${bulkSelectLabel(filter)}` : ""} leads shown (
              {shown.length})
            </label>
          </span>
          {selectedDeleteLeads.length > 0 ? (
            <>
              <span className="queue-bulk-count">{selectedDeleteLeads.length} selected</span>
              <div className="queue-bulk-acts">
                {/*
                  Start N stories is the same batch the desk has always run
                  (startDraftBatch, one job per lead, five at a time); the bar
                  is a second way to reach it, not a new mechanism. A held,
                  killed or printed lead cannot be drafted -- that is the
                  backend's rule, so the press says so instead of failing.
                */}
                <InkButton
                  disabled={
                    startBatch.isPending ||
                    bulkDraftable.length === 0 ||
                    bulkDraftable.length > 5
                  }
                  ariaLabel={`Start ${bulkDraftable.length} ${
                    bulkDraftable.length === 1 ? "story" : "stories"
                  } from the selected leads`}
                  onClick={() =>
                    startBatch.mutate({
                      leadIds: bulkDraftable.map((l) => l.id),
                      runtime: batchRuntime,
                      modelEffort: batchEffort,
                    })
                  }
                >
                  {startBatch.isPending
                    ? "Starting…"
                    : `Start ${bulkDraftable.length} ${bulkDraftable.length === 1 ? "story" : "stories"}`}
                </InkButton>
                <InkButton
                  tone="quiet"
                  disabled={setStatus.isPending}
                  onClick={() => bulkSetStatus("held")}
                >
                  Hold
                </InkButton>
                <InkButton
                  tone="quiet-danger"
                  disabled={setStatus.isPending}
                  onClick={() => bulkSetStatus("killed")}
                >
                  Kill
                </InkButton>
                {confirmingBulkDelete ? (
                  <div className="queue-bulk-delete-confirm">
                    <span>
                      Delete {selectedDeleteLeads.length} selected lead{selectedDeleteLeads.length === 1 ? "" : "s"} and any drafts? Published articles stay on the paper.
                    </span>
                    <InkButton
                      tone="danger"
                      disabled={bulkRemove.isPending}
                      onClick={() => bulkRemove.mutate(selectedDeleteLeads)}
                    >
                      {bulkRemove.isPending ? "Deleting…" : `Yes, delete ${selectedDeleteLeads.length}`}
                    </InkButton>
                    <InkButton tone="quiet" disabled={bulkRemove.isPending} onClick={() => setConfirmingBulkDelete(false)}>
                      Keep
                    </InkButton>
                  </div>
                ) : (
                  <InkButton tone="quiet-danger" onClick={() => setConfirmingBulkDelete(true)}>
                    Delete selected ({selectedDeleteLeads.length})
                  </InkButton>
                )}
                <InkButton
                  tone="quiet"
                  disabled={bulkBusy}
                  onClick={() => {
                    setSelectedDeleteLeadIds([]);
                    setConfirmingBulkDelete(false);
                    setBulkDeleteNotice("");
                  }}
                >
                  Clear
                </InkButton>
              </div>
              {bulkDraftable.length !== selectedDeleteLeads.length ? (
                <span className="queue-bulk-what">
                  {selectedDeleteLeads.length - bulkDraftable.length} of these cannot be drafted
                  (held, killed or already printed).
                </span>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      <div className="queue-head" aria-hidden="true">
        <span>Score</span>
        <span>Lead</span>
        <span>Evidence · Filed · Actions</span>
      </div>

      {filter === "killed" && shown.some((l) => (l.resurfaced_count ?? 0) > 0) ? (
        <p className="meta seen-again-note">{SEEN_AGAIN_EXPLAINER}</p>
      ) : null}

      {deleteError ? <Notice kind="err">{deleteError}</Notice> : null}
      {bulkDeleteNotice ? <Notice kind="ok">{bulkDeleteNotice}</Notice> : null}
      {undo != null ? (
        <Notice kind="ok">
          Deleted, and kept for 30 days.{" "}
          <button
            type="button"
            className="inline-link"
            disabled={undoDelete.isPending}
            onClick={() => undoDelete.mutate(undo)}
          >
            {undoDelete.isPending ? "Putting it back…" : "Undo"}
          </button>
        </Notice>
      ) : null}

      {isError && leads.length === 0 ? (
        <ScreenError
          message={error instanceof Error ? error.message : "Could not load the queue."}
          onRetry={() => void refetch()}
          retrying={isRefetching}
        />
      ) : isPending && leads.length === 0 ? (
        <ListSkeleton rows={4} />
      ) : shown.length === 0 ? (
        <p className="wire-sum">
          {filter === "all" ? (
            <>
              {workingQueueEmptyCopy({
                publishedCount,
                lastScan: last
                  ? {
                      leads_created: last.leads_created,
                      sources_fetched: last.sources_fetched,
                      error: last.error,
                    }
                  : null,
              })}{" "}
              {publishedCount > 0 ? (
                <Link to="/desk/published" className="inline-link">
                  Published
                </Link>
              ) : null}
              <span>
                Already have the story written?{" "}
                <Link to="/desk/import" className="inline-link">
                  Import finished stories
                </Link>{" "}
                — paste it, check it, and it lands here.
              </span>
            </>
          ) : (
            `No ${filter} leads.`
          )}
        </p>
      ) : (
        <>
        <div className="queue-head" aria-hidden="true">
          <span>Score</span>
          <span>Lead</span>
          <span>Evidence · Filed · Actions</span>
        </div>
        <div className="lead-list roomy">
          {shown.map((l) => {
            const dupMatch = nearDuplicate(l, printed);
            return (
            <LeadRowView
              key={l.id}
              lead={l}
              dup={dupMatch}
              roomy
              /*
                "More ▾ opens the lead menu" (README "3. Queue"). The labels
                are deliberately different words from the visible buttons --
                the desk's own flows find the row's Delete/Hold/Kill by name,
                and a menu that repeated them exactly would make those queries
                ambiguous. Every item calls the handler its visible twin calls.
              */
              more={[
                {
                  label: "Open the story workbench",
                  onSelect: () =>
                    void navigate({
                      to: "/desk/story/$leadId",
                      params: { leadId: String(l.id) },
                    }),
                },
                ...(l.status !== "held" && l.status !== "killed" && l.status !== "published"
                  ? [
                      {
                        label: "Hold this lead",
                        onSelect: () => setStatus.mutate({ id: l.id, status: "held" }),
                      },
                      {
                        label: "Kill this lead",
                        onSelect: () => setStatus.mutate({ id: l.id, status: "killed" }),
                      },
                    ]
                  : [
                      {
                        label: "Put it back in the new queue",
                        onSelect: () => setStatus.mutate({ id: l.id, status: "new" }),
                      },
                    ]),
                { label: "Delete this lead", onSelect: () => remove.mutate(l.id) },
              ]}
              onHold={() => setStatus.mutate({ id: l.id, status: "held" })}
              onBack={() => setStatus.mutate({ id: l.id, status: "new" })}
              onKill={() => setStatus.mutate({ id: l.id, status: "killed" })}
              onKillAsDuplicate={
                /* Unit AK item 4: the reason names the piece the desk matched,
                   so the kill record on the story page means something to
                   whoever reads it next. */
                dupMatch
                  ? async () => {
                      await killAsDuplicate.mutateAsync({
                        id: l.id,
                        killReason: duplicateKillReason(dupMatch.headline),
                      });
                    }
                  : undefined
              }
              onDelete={() => remove.mutate(l.id)}
              deleteSelected={selectedDeleteLeads.includes(l.id)}
              onDeleteSelect={(selected) => {
                setConfirmingBulkDelete(false);
                setBulkDeleteNotice("");
                setSelectedDeleteLeadIds((ids) =>
                  selected
                    ? [...ids.filter((id) => id !== l.id), l.id]
                    : ids.filter((id) => id !== l.id),
                );
              }}
              onDraft={(modelChoice, modelEffort) => {
                setDraftNotices((notices) => {
                  const next = { ...notices };
                  delete next[l.id];
                  return next;
                });
                queueDraft.mutate({ leadId: l.id, modelChoice, modelEffort });
              }}
              drafting={draftingIds.includes(l.id)}
              draftNotice={draftNotices[l.id] ?? null}
              batchSelected={selectedBatchLeads.includes(l.id)}
              batchDisabled={
                startBatch.isPending ||
                (!selectedBatchLeads.includes(l.id) && selectedBatchLeads.length >= 5)
              }
              onBatchSelect={
                l.status !== "held" && l.status !== "killed" && l.status !== "published"
                  ? (selected) => {
                      setSelectedBatchLeadIds((ids) => {
                        if (selected) return [...ids.filter((id) => id !== l.id), l.id];
                        return ids.filter((id) => id !== l.id);
                      });
                    }
                  : undefined
              }
            />
            );
          })}
        </div>
        </>
      )}
    </DeskShell>
  );
}
