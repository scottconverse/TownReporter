import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { DraftBatchResult } from "@/components/draft-batch-result";
import { ModelPicker } from "@/components/model-picker";
import { Dialog } from "@/components/dialog";
import { DeskShell, Field, InkButton } from "@/components/desk-chrome";
import { LeadRowView, SEEN_AGAIN_EXPLAINER } from "@/components/desk-leads";
import {
  AddLeadButton,
  DarkFileDialog,
  HoldLeadDialog,
  NewStoryButton,
} from "@/components/dialogs";
/*
  Unit BW, item 2: the drawn Kill dialog, imported from its own module rather
  than through the `@/components/dialogs` barrel, which re-exports
  `editor-dialogs` only. `/desk/story/$leadId` and Today import it the same way.
*/
import { KillDialog } from "@/components/dialogs/KillDialog";
import { EditLeadDialog } from "@/components/dialogs/EditLeadDialog";
import { AddFollowUpButton } from "@/components/add-follow-up-button";
import { ListSkeleton, Notice, ScreenError } from "@/components/states";
import {
  deleteLead,
  draftLead,
  fileLead,
  listLeads,
  listPublishedDesk,
  listScans,
  runScan,
  setLeadStatus,
} from "@/lib/news/desk";
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
import { parseUrlList } from "@/lib/paper";
import type { LeadRow } from "@/lib/news/types";
import { usePaper } from "@/lib/paper-context-state";
import { modelChoiceLabel, type StoryModelChoice } from "@/lib/news/model-choice";
import { defaultModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import { myDesk } from "@/lib/news/claim";
import {
  dismissDraftBatch,
  getDraftBatch,
  startDraftBatch,
  visibleDraftBatchItems,
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

/**
 * Unit BN2, item 4: what a row's "Send to Dark Desk" already knows, handed to
 * `DarkFileDialog` so the editor does not retype it.
 *
 * The tip is a *starting point* -- the field's own placeholder is "Link,
 * document, post or what you heard" -- so it leads with the first source URL
 * the lead carries: that is the thing an investigation can actually fetch. A
 * lead filed by hand with no link falls back to this desk's own story path, so
 * the tip is never empty (`darkProblem` wants eight characters) and never
 * pretends to be a link it is not.
 *
 * The question is left blank on purpose: it is the one field only the editor
 * can answer, and it is what the drawing's dialog asks for first.
 */
function darkPrefill(lead: LeadRow): { tip: string } {
  const source = parseUrlList(lead.source_urls)[0];
  return { tip: `${lead.headline}\n${source ?? `/desk/story/${lead.id}`}` };
}

function QueuePage() {
  const { sections } = useEditorSections();
  const TOPICS = sections.map((s) => s.key);
  const PAPER = usePaper();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const desk = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const newsroomId = desk.data?.ok ? desk.data.newsroomId : null;
  const {
    data: leads = [],
    isPending,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["leads"],
    queryFn: () => listLeads(),
    placeholderData: keepPreviousData,
  });
  const scans = useQuery({ queryKey: ["scans"], queryFn: () => listScans() });
  const published = useQuery({ queryKey: ["published-desk"], queryFn: () => listPublishedDesk() });
  /*
    The drawn Queue header's own "Run scan now" (README "3. Queue", handoff
    Desk Screens.dc.html line 21). It is the same scan Today's button runs --
    the same server function and the same three invalidations -- so the two
    screens cannot disagree about what a scan updates.
  */
  const scan = useMutation({
    mutationFn: () => runScan(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["scans"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });
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
  const [draftNotices, setDraftNotices] = useState<
    Record<number, { kind: "ok" | "err"; text: string }>
  >({});
  const [draftingIds, setDraftingIds] = useState<number[]>([]);
  /*
    Unit BF2, defect 8: the Queue's two standing panels -- "File a lead
    yourself" and "Draft selected leads" -- are dialogs now. Nothing sits
    between the header and the table any more; each is opened by a press on
    the page (the filter row's file button, the bulk bar's Start N stories)
    or by a hash, so Today's "+ Add a lead" still lands on the form it names.
  */
  const [panel, setPanel] = useState<"file-lead" | "batch" | null>(null);
  const [batchLeadIds, setBatchLeadIds] = useState<number[]>([]);
  /*
    The ids the dialog has already queued, so the same five leads cannot be
    queued twice from one press. Cleared when the dialog opens again or when
    the batch list changes.
  */
  const [batchQueued, setBatchQueued] = useState<number[] | null>(null);
  /*
    Unit BN: the two rows of the drawn lead menu ("Hold with a reason", "Send to
    Dark Desk") open dialogs that belong to the page, not to the row -- one
    dialog serves every row, so the row only says *which* lead it was pressed
    for. The lead is kept whole rather than as an id so the dialog can print the
    headline it was opened for, the way the drawn footnote does.
  */
  const [holdFor, setHoldFor] = useState<LeadRow | null>(null);
  const [darkFor, setDarkFor] = useState<LeadRow | null>(null);
  /*
    Unit BW, item 2: the third of those dialogs. The row's "Kill with a reason"
    press pointed at an immediate `setLeadStatus` while phase 2b's drawn Kill
    dialog was still on its own branch; that branch is on main now (0.6.76), so
    the press opens the dialog and the reason it writes reaches the lead.
  */
  const [killFor, setKillFor] = useState<LeadRow | null>(null);
  /*
    Design review note 2 (0.6.80): the fourth of those dialogs, and the
    drawing's first-listed row menu item. Mounted the same way as
    holdFor/darkFor/killFor above -- once for the table, re-pointed by the
    lead this press was for.
  */
  const [editFor, setEditFor] = useState<LeadRow | null>(null);
  const fileFormRef = useRef<HTMLFormElement>(null);
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
      return result.batch.items.some(
        (item) => item.status === "queued" || item.status === "running",
      )
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
    const open = current.items.some(
      (item) => item.status === "queued" || item.status === "running",
    );
    if (open || leadRefreshAfterTerminalBatch.current === current.id) return;
    leadRefreshAfterTerminalBatch.current = current.id;
    void qc.invalidateQueries({ queryKey: ["leads"] });
  }, [batch.data, qc]);
  const startBatch = useMutation({
    mutationFn: (input: {
      leadIds: number[];
      runtime: DraftBatchRuntime;
      modelEffort: ModelEffort | null;
    }) =>
      startDraftBatch({
        data: {
          items: input.leadIds.map((leadId) => ({ leadId })),
          runtime: input.runtime,
          modelEffort: input.modelEffort,
        },
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        setBatchNotice({
          kind: "err",
          text: `${result.error}${result.leadId ? ` (lead #${result.leadId})` : ""}`,
        });
        return;
      }
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
  /*
   * Unit BS: the Dismiss button on the batch panel. The write is the server's
   * (`dismiss_draft_batch.dismissed_at`), so a reload agrees and the next
   * batch this newsroom starts shows normally. The invalidate is what makes
   * the panel go without a reload.
   */
  const dismissBatch = useMutation({
    mutationFn: (batchId: number) => dismissDraftBatch({ data: { batchId } }),
    onSuccess: (result) => {
      if (result?.ok === false) {
        setBatchNotice({ kind: "err", text: result.error });
        return;
      }
      void qc.invalidateQueries({ queryKey: ["draft-batch"] });
    },
    onError: (error) =>
      setBatchNotice({
        kind: "err",
        text: error instanceof Error ? error.message : "That batch did not dismiss.",
      }),
  });
  const queueDraft = useMutation({
    mutationFn: (input: {
      leadId: number;
      modelChoice: StoryModelChoice;
      modelEffort?: ModelEffort | null;
      fromBatch?: boolean;
    }) =>
      draftLead({
        data: {
          leadId: input.leadId,
          modelChoice: input.modelChoice,
          modelEffort: input.modelEffort,
        },
      }),
    onMutate: ({ leadId }) =>
      setDraftingIds((ids) => [...ids.filter((id) => id !== leadId), leadId]),
    onSuccess: (res, { leadId, modelChoice, fromBatch }) => {
      if (res?.ok) {
        if (fromBatch)
          setBatchNotice({
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
        if (fromBatch)
          setBatchNotice({
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
    onSettled: (_data, _error, { leadId }) =>
      setDraftingIds((ids) => ids.filter((id) => id !== leadId)),
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
  /*
    The list the batch dialog is about to queue: the bulk bar's selection,
    held still while the dialog is open so that adding suggested focus to it
    cannot change what the press behind it would have done. Every entry is a
    lead the backend will accept -- a held, killed or printed lead cannot be
    drafted, which is the backend's rule, so it is filtered here rather than
    failing at the press.
  */
  const selectedBatchLeads = batchLeadIds.filter((leadId) =>
    batchEligible.some((lead) => lead.id === leadId),
  );
  /*
    The same selection as rows, so the dialog can name what it is about to
    queue instead of only counting it: "3 of 5 selected" tells an editor how
    much model work the press costs, and this tells them what it is spent on.
  */
  const selectedBatchLeadRows = batchEligible.filter((lead) =>
    selectedBatchLeads.includes(lead.id),
  );
  const batchQueuedNow =
    batchQueued !== null &&
    batchQueued.length === selectedBatchLeads.length &&
    batchQueued.every((leadId) => selectedBatchLeads.includes(leadId));
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
  const filtered =
    sectionFilter === "all" ? bySearch : bySearch.filter((l) => l.topic === sectionFilter);
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
  /*
   * Unit BS. What the batch panel may show, decided once, here:
   *
   *   - a batch the editor dismissed is not drawn at all;
   *   - of the rest, only items whose story is still theirs to work
   *     (`visibleDraftBatchItems` -- published and killed stories drop out);
   *   - and if that leaves nothing, the panel goes, not just the rows. A
   *     panel headed "Batch #3" with no list under it is the same bug in a
   *     quieter costume.
   *
   * `Dismiss` is offered only once the batch has finished: a running batch is
   * shown as it always was, and putting it away mid-run would hide work that
   * is still arriving.
   */
  const currentBatch = batch.data?.ok ? batch.data.batch : null;
  const batchItems = currentBatch ? visibleDraftBatchItems(currentBatch.items) : [];
  const batchPanelVisible = Boolean(currentBatch && !currentBatch.dismissed && batchItems.length > 0);
  const batchRunning = batchItems.some((item) => item.status === "queued" || item.status === "running");

  const shownIds = shown.map((lead) => lead.id);
  const selectedDeleteLeads = selectedDeleteLeadIds.filter((leadId) => shownIds.includes(leadId));
  const allShownSelected =
    shownIds.length > 0 && shownIds.every((leadId) => selectedDeleteLeadIds.includes(leadId));
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
    Open the dialog a hash names.

    Today's "+ Add a lead" links to /desk/queue#file-lead, and phase 0's
    dialogs are unmounted while shut, so there is nothing for a hash to scroll
    to -- the hash has to open the dialog instead. That is the whole
    behavior, and it keeps the link landing on the form it names.

    Read from the router's location rather than a `hashchange` listener: a
    same-path hash change is a `pushState` the router owns, and no
    `hashchange` fires for it (the same reason Today reads `useLocation`).
  */
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === "file-lead") setPanel("file-lead");
  }, [hash]);
  /*
    Shutting one leaves the address tidy, the way Today's composer does: a
    stale #file-lead would re-open the form on the next reload.
  */
  const closePanel = () => {
    setPanel(null);
    if (window.location.hash) void navigate({ to: "/desk/queue", replace: true });
  };

  return (
    <DeskShell
      title="Queue"
      kicker="Every open lead"
      actions={
        <>
          <InkButton tone="ghost" disabled={scan.isPending} onClick={() => scan.mutate()}>
            {scan.isPending ? "Scanning…" : "Run scan now"}
          </InkButton>
          {/*
            Unit BN, item 3: the Queue's own "file a lead" control is the drawn
            dialog (phase 4's `AddLeadDialog`), one press from the header. The
            legacy `#file-lead` dialog below is kept as well -- see its own
            comment for why that door has to keep opening the form it opened
            before this unit.
          */}
          <AddLeadButton />
          <Link to="/desk" hash="story-composer" className="btn solid">
            + New story
          </Link>
        </>
      }
    >
      {/*
        BF3, defect 2: one controls row, drawn order -- the tabs at the left,
        then search, Sort and Section at the right -- with the words inside
        the controls ("Sort: Best first", "Section: All") rather than as
        labels sitting above them. The drawn controls are a single line at
        1280 (measured: all six share one top y), so nothing here wraps until
        the phone width, where the strip and the three filters stack.

        "File a lead yourself" is not on this row any more: the drawing has
        it behind Today's "+ Add a lead", and /desk/queue#file-lead still
        opens the same dialog on load for anything that links here.
      */}
      <div className="queue-controls">
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
              <span
                className={"filter-badge" + (f.key === "held" && f.count > 0 ? " waiting" : "")}
              >
                {f.count}
              </span>
            </button>
          ))}
        </div>
        <div className="queue-filters">
          <input
            type="search"
            className="queue-search"
            aria-label="Search leads"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSelectedDeleteLeadIds([]);
              setConfirmingBulkDelete(false);
              setBulkDeleteNotice("");
            }}
            placeholder="Search leads, places, records…"
          />
          <div className="queue-sel">
            <span className="queue-lab" aria-hidden="true">
              Sort:
            </span>
            <select
              aria-label="Sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as QueueSort)}
            >
              <option value="best">Best first</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
          <div className="queue-sel">
            <span className="queue-lab" aria-hidden="true">
              Section:
            </span>
            <select
              aria-label="Section"
              value={sectionFilter}
              onChange={(event) => setSectionFilter(event.target.value)}
            >
              <option value="all">All</option>
              {sections.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {shown.length > 0 ? (
        <section
          className="queue-bulk-delete queue-bulk"
          aria-label="Bulk actions for the leads shown"
        >
          {/*
            BF3: the "Select all …" label that sat here is the header row's
            checkbox now (the drawing has no yellow strip where nothing is
            selected). What is left of the strip is what it always was
            underneath -- the count, Start N stories, Hold, Kill, Delete
            selected and Clear -- so it renders only once something is
            selected. The section itself stays mounted whenever the table has
            rows, and `:empty` in desk-astra.css keeps the empty amber band
            off the screen: mounting it costs nothing and the desk's walks
            still find the bar's presses in the same place after a selection.
          */}
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

                  Since unit BF2 (defect 8) the press opens the batch dialog
                  and the QUEUEING happens there, in the same press as the
                  writing model the old "Draft selected leads" panel asked
                  for. The selection is copied into the dialog as it opens, so
                  what the dialog is about to queue cannot drift from what the
                  bar said it would.
                */}
                <InkButton
                  disabled={
                    startBatch.isPending || bulkDraftable.length === 0 || bulkDraftable.length > 5
                  }
                  ariaLabel={`Start ${bulkDraftable.length} ${
                    bulkDraftable.length === 1 ? "story" : "stories"
                  } from the selected leads`}
                  onClick={() => {
                    setBatchNotice(null);
                    setBatchLeadIds(bulkDraftable.map((l) => l.id));
                    setPanel("batch");
                  }}
                >
                  {startBatch.isPending
                    ? "Starting…"
                    : `Start ${bulkDraftable.length} ${bulkDraftable.length === 1 ? "story" : "stories"}`}
                </InkButton>
                <InkButton
                  tone="quiet"
                  disabled={setStatus.isPending}
                  onClick={() => {
                    /*
                      Unit BN, item 3: "Bulk bar Hold uses the hold path." One
                      selected lead is the row's own Hold -- the drawn dialog,
                      so the reason is recorded. Several leads at once have no
                      drawn dialog (the design's hold with a reason asks for one
                      reason per lead, and a single reason written for five
                      leads would be a different record than the desk drew), so
                      that press keeps the immediate hold it has today.
                    */
                    const only = selectedLeads.length === 1 ? selectedLeads[0] : null;
                    if (only) setHoldFor(only);
                    else bulkSetStatus("held");
                  }}
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
                      Delete {selectedDeleteLeads.length} selected lead
                      {selectedDeleteLeads.length === 1 ? "" : "s"} and any drafts? Published
                      articles stay on the paper.
                    </span>
                    <InkButton
                      tone="danger"
                      disabled={bulkRemove.isPending}
                      onClick={() => bulkRemove.mutate(selectedDeleteLeads)}
                    >
                      {bulkRemove.isPending
                        ? "Deleting…"
                        : `Yes, delete ${selectedDeleteLeads.length}`}
                    </InkButton>
                    <InkButton
                      tone="quiet"
                      disabled={bulkRemove.isPending}
                      onClick={() => setConfirmingBulkDelete(false)}
                    >
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
              {/*
                Unit BN, item 3: the drawn empty queue offers the composer as
                well as the two doors above -- a queue with nothing in it is
                exactly where an editor is about to write something the scanner
                never found. The drawn button mounts the drawn dialog; the link
                in the header still goes to the Desk screen's own composer.
              */}
              <span className="queue-empty-new">
                <NewStoryButton />
              </span>
            </>
          ) : (
            `No ${filter} leads.`
          )}
        </p>
      ) : (
        <>
          {/*
            The header row, as drawn: one line of column labels above the rows
            and the select-all box in the checkbox column. "Select all" used to
            be a yellow strip below the controls; the drawing puts it here, in
            the same 44px box every row's own checkbox sits in, so the two read
            as the same control at two heights. It still selects exactly the
            leads the table is showing, which is what the strip's label said.
          */}
          <div className="queue-head">
            {/* BF4, defect 2: same box as every row's own -- the drawn 24px
                square inside the 44px press area (see `.queue-check` in
                desk-astra.css). */}
            <label className="queue-check">
              <input
                type="checkbox"
                className="queue-pick"
                checked={allShownSelected}
                aria-label={`Select all${bulkSelectLabel(filter) ? ` ${bulkSelectLabel(filter)}` : ""} leads shown (${shown.length})`}
                onChange={(event) => {
                  setConfirmingBulkDelete(false);
                  setBulkDeleteNotice("");
                  setSelectedDeleteLeadIds(event.target.checked ? shownIds : []);
                }}
              />
              <span className="queue-box" aria-hidden="true">
                {allShownSelected ? "✓" : null}
              </span>
            </label>
            <span>Score</span>
            <span>Lead</span>
            <span>Evidence</span>
            <span>Filed</span>
            <span className="queue-head-acts">Actions</span>
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
                    BF3: the `more` array that used to sit here (Open the story
                    workbench / Hold this lead / Kill this lead / Put it back /
                    Delete this lead) is gone -- every one of those calls the
                    handler this row's own menu already calls, so the row was
                    printing each action twice under two sets of words. The
                    menu the brief asks for is the one LeadRowView builds.

                    Unit BN2, item 2: the drawn lead menu's own rows (phase 4's
                    `MORE_LEAD_ITEMS`, in the design's order) come back as named
                    props, not as a caller's array. The array could not put the
                    drawn "Merge with a printed story" *between* "Hold with a
                    reason" and "Send to Dark Desk": the merge press needs the
                    duplicate the ROW matched (`dup`, and with it the row's
                    three-state saved/failed line), which only the row holds. So
                    the row owns the order and this screen supplies the handlers.
                    `onHold` is not passed (its plain "Hold" would be the same
                    action with the reason dropped) and `onKill` is not passed
                    either: this menu's kill row is the drawn "Kill with a
                    reason" below.
                  */
                  onBack={() => setStatus.mutate({ id: l.id, status: "new" })}
                  onHoldWithReason={() => setHoldFor(l)}
                  onEdit={() => setEditFor(l)}
                  onDarkDesk={() => setDarkFor(l)}
                  /*
                    The drawn row is a button that owns its own dialog, which a
                    word-and-a-handler pair cannot mount, so the row renders this
                    node as the menu's block item the way the draft control does.
                  */
                  followUp={<AddFollowUpButton leadId={l.id} headline={l.headline} />}
                  /*
                    Unit BW, item 2: the drawn "Kill with a reason" dialog (phase
                    2b, PR #124) is on main now, so this press opens it and the
                    reason is written with the kill. The dialog is mounted once
                    below and re-pointed by `killFor`, the way this row's Hold
                    and Dark Desk presses are -- and `onKilled` refreshes
                    `["leads"]` because the write lands inside the dialog.
                  */
                  onKillWithReason={() => setKillFor(l)}
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
                  /*
                The row's own "Include in batch draft" box went with the panel
                that consumed it (unit BF2, defect 8): one selection mechanism
                now, the drawn bulk strip above the table, which is also what
                Hold, Kill and Delete act on.
              */
                />
              );
            })}
          </div>
        </>
      )}

      {/*
        Filing a lead by hand, in the one dialog the redesign has (phase 0's
        `Dialog`, Radix underneath). The form keeps its field labels and its
        native validation: the dialog's primary presses the form's own submit
        through `requestSubmit`, so `required`/`minLength` still run and the
        browser still says which field is short.

        Unit BN kept this door opening THIS form. The brief asks for
        `#file-lead` to open the drawn `AddLeadDialog`, and that is a different
        form: no Headline/Why-now fields, and it does not land on the saved
        story page. Ten CI scripts set their whole fixture up through this exact
        hash (fill "Headline", fill "Why now", press "File lead", wait for the
        story page's "Body"), so re-pointing the hash would rewrite their
        fixtures and, for one of them (a script this harness is forbidden to
        run), leave the change unverifiable here. The Queue's own toolbar now
        mounts the drawn dialog, so the drawn form is reachable one press away;
        `questions/BN.md` names the scripts and asks which door the hash should
        be.
      */}
      <Dialog
        open={panel === "file-lead"}
        onClose={closePanel}
        title="File a lead"
        subtitle={
          <>
            Have a transcript, packet or documents?{" "}
            <Link to="/desk" className="inline-link">
              Write a story from text or uploaded documents on the Desk
            </Link>
            . Already written somewhere else?{" "}
            <Link to="/desk/import" className="inline-link">
              Import finished stories
            </Link>{" "}
            — paste one story or a whole report and check each one before it lands here.
          </>
        }
        primaryLabel="File lead"
        primaryDisabled={file.isPending}
        onPrimary={() => fileFormRef.current?.requestSubmit()}
        footNote="A filed lead lands at the top of the Open queue, scored like any other."
      >
        <form
          id="file-lead"
          ref={fileFormRef}
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            setFormError(null);
            file.mutate();
          }}
        >
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
                  {sections.find((s) => s.key === t)?.name ?? t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source URL (optional)">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
            />
          </Field>
        </form>
        {formError ? <Notice kind="err">{formError}</Notice> : null}
      </Dialog>

      {/*
        The old "Draft selected leads" panel (unit BF2, defect 8). Its picker
        is the same `ModelPicker` with the same 0.6.71 behavior -- scope
        "forced", no Automatic, the lead's own stored research scope kept --
        and the press beneath it queues the same batch of jobs the bulk bar's
        Start N stories named. What the dialog is about to queue was copied
        out of that selection when it opened.
      */}
      <Dialog
        open={panel === "batch"}
        onClose={closePanel}
        title="Draft the selected leads"
        subtitle="Choose up to five eligible queue leads and one writing runtime. Each lead keeps its own stored research scope. This queues drafts for editor review; it does not publish anything."
        primaryLabel={
          batchQueuedNow
            ? "Batch started"
            : startBatch.isPending
              ? "Starting…"
              : `Start ${selectedBatchLeads.length} ${selectedBatchLeads.length === 1 ? "story" : "stories"}`
        }
        primaryDisabled={
          newsroomId === null ||
          selectedBatchLeads.length === 0 ||
          selectedBatchLeads.length > 5 ||
          startBatch.isPending ||
          batchQueuedNow
        }
        onPrimary={() => {
          const leadIds = selectedBatchLeads;
          setBatchNotice(null);
          startBatch.mutate(
            { leadIds, runtime: batchRuntime, modelEffort: batchEffort },
            {
              onSuccess: (result) => {
                if (!result.ok) return;
                setBatchQueued(leadIds);
                // The batch is queued: the strip behind the dialog is no
                // longer "about to do" anything, so it stands down rather
                // than staying armed for a second press.
                setSelectedDeleteLeadIds([]);
                setConfirmingBulkDelete(false);
              },
            },
          );
        }}
      >
        <div className="draft-batch-panel" id="draft-batch">
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
              Suggestions balance existing lead scores and sections. Review the evidence before
              drafting.
            </p>
            <InkButton
              small
              disabled={
                startBatch.isPending ||
                focusAddable.length === 0 ||
                selectedBatchLeads.length >= 5 ||
                batchQueuedNow
              }
              onClick={() =>
                setBatchLeadIds((ids) =>
                  mergeFocusSelection(
                    ids,
                    batchEligible.map((lead) => lead.id),
                    suggestedFocus.map((lead) => lead.id),
                    5,
                  ),
                )
              }
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
          {/*
            BF5: name the leads the press below will draft. Until the batch
            moved into this dialog the panel's own checkboxes showed which
            leads were queued -- including the ones "Add suggested focus"
            picked -- so the count alone left an editor unable to see what the
            model calls were about to be spent on. Each lead keeps its stored
            research scope, so the list is the whole of what Start queues.
          */}
          {selectedBatchLeadRows.length > 0 ? (
            <ul className="meta" aria-label="Leads in this batch">
              {selectedBatchLeadRows.map((lead) => (
                <li key={lead.id}>{lead.headline}</li>
              ))}
            </ul>
          ) : null}
          {batchNotice ? <Notice kind={batchNotice.kind}>{batchNotice.text}</Notice> : null}
          {desk.isPending || batch.isPending ? (
            <p className="meta">Loading the latest draft batch…</p>
          ) : batch.isError ? (
            <Notice kind="err">Could not load the latest draft batch.</Notice>
          ) : batch.data && !batch.data.ok ? (
            <Notice kind="err">{batch.data.error}</Notice>
          ) : currentBatch && !batchPanelVisible ? (
            /*
             * Unit BS: the editor put this batch away, or every story in it
             * has since been printed or killed. Either way there is no work
             * left to list, so there is no panel -- not an empty one under a
             * heading that still says "Batch #3". In phase 2a this block is
             * the body of the "Draft the selected leads" dialog, so what the
             * editor gets is the picker and the press, with the batch's own
             * list gone.
             */
            null
          ) : currentBatch ? (
            <div className="lead-list roomy" aria-label="Draft batch results">
              <p className="meta">
                Batch #{currentBatch.id} · {currentBatch.runtime.label}
              </p>
              {currentBatch.runtime.runtime === "local" ? (
                <p className="meta">
                  This batch keeps the saved local model shown above.{" "}
                  <Link to="/desk/ops" className="inline-link">
                    Review local models on Server
                  </Link>{" "}
                  before starting another batch.
                </p>
              ) : null}
              {/*
                Unit BS: the panel is a list of work, not a log. A job whose
                lead has since been printed or killed drops out here, so an
                editor is never offered "Redraft" for a story the paper is
                already carrying.
              */}
              {batchItems.map((item) => {
                const lead = leads.find((candidate) => candidate.id === item.leadId);
                return (
                  <DraftBatchResult
                    key={item.jobId}
                    item={item}
                    headline={lead?.headline ?? `lead #${item.leadId}`}
                    redraftLabel={modelChoiceLabel(batchRuntime)}
                    redrafting={draftingIds.includes(item.leadId)}
                    onRedraft={() => {
                      setBatchNotice(null);
                      /*
                        Kept on one line: `scripts/draft-batch-result-render.test.mjs`
                        pins this exact call, trailing comma and all, as the proof
                        that a redraft sends the runtime the picker is showing.
                      */
                      queueDraft.mutate({ leadId: item.leadId, modelChoice: batchRuntime, modelEffort: batchEffort, fromBatch: true });
                    }}
                  />
                );
              })}
              {!batchRunning ? (
                /*
                 * Unit BS: putting a finished batch away. `tone="quiet"` is
                 * the audit's BS-001 -- Dismiss drawn as the yellow primary
                 * read louder than the "Redraft with …" presses that are the
                 * real work on this screen. Quiet is the same plain 1px
                 * outlined style as the dialog's own Cancel.
                 */
                <div className="wire-sum">
                  <InkButton
                    small
                    tone="quiet"
                    type="button"
                    disabled={dismissBatch.isPending}
                    onClick={() => {
                      setBatchNotice(null);
                      dismissBatch.mutate(currentBatch.id);
                    }}
                  >
                    {dismissBatch.isPending ? "Dismissing…" : "Dismiss"}
                  </InkButton>
                  <p className="meta">
                    Puts this batch away for good. The next batch you start shows normally.
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="meta">No draft batch has been started in this newsroom.</p>
          )}
        </div>
      </Dialog>

      {/*
        Unit BN, item 3: the two drawn dialogs a row's menu opens. Both are
        mounted once for the table and re-pointed by `holdFor`/`darkFor`, so a
        page with 200 rows does not carry 200 shut dialogs; each opens on the
        lead it was pressed for.

        `DarkFileDialog` takes no `lead` prop -- its own contract is `open`,
        `onClose`, `prefill`, `onOpened` -- so the row's press hands over the
        two fields it already knows as `prefill` (unit BN2, item 4) and the
        dialog does the rest. What happens after the file opens is what the
        dialog's own doc says the mounting screen does: put the editor on the
        file page, where the round is started and the activity log and the stop
        live.

        `onDone` is not decoration: `holdLead` writes the status and returns,
        and nothing in the dialog reaches the query cache, so without this the
        row would sit in the open list until the page was reloaded. It is the
        same `["leads"]` invalidation the row's own `setStatus` path does.
      */}
      {holdFor ? (
        <HoldLeadDialog
          leadId={holdFor.id}
          headline={holdFor.headline}
          open
          onClose={() => setHoldFor(null)}
          onDone={() => void qc.invalidateQueries({ queryKey: ["leads"] })}
        />
      ) : null}
      {darkFor ? (
        <DarkFileDialog
          open
          prefill={darkPrefill(darkFor)}
          onClose={() => setDarkFor(null)}
          onOpened={() => void navigate({ to: "/desk/dark" })}
        />
      ) : null}
      {/*
        Unit BW, item 2: the drawn Kill dialog, the third one a row's menu opens
        and mounted the same way -- once for the table, re-pointed by `killFor`.
        `KillDialog` takes `onOpenChange` rather than this screen's `onClose`
        convention; closing is the only transition it reports, and a re-pointed
        `killFor` is what opens it, so nothing is lost in the mapping.
      */}
      {killFor ? (
        <KillDialog
          leadId={killFor.id}
          open
          onOpenChange={(open) => {
            if (!open) setKillFor(null);
          }}
          onKilled={() => void qc.invalidateQueries({ queryKey: ["leads"] })}
        />
      ) : null}
      {/*
        Design review note 2 (0.6.80): "Edit the lead", mounted once for the
        table and re-pointed by `editFor`, the same shape as `holdFor` above.
      */}
      {editFor ? (
        <EditLeadDialog
          leadId={editFor.id}
          headline={editFor.headline}
          why={editFor.why}
          topic={editFor.topic}
          sourceUrls={editFor.source_urls}
          open
          onOpenChange={(open) => {
            if (!open) setEditFor(null);
          }}
          onSaved={() => void qc.invalidateQueries({ queryKey: ["leads"] })}
        />
      ) : null}
    </DeskShell>
  );
}
