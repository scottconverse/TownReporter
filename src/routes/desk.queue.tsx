import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { DraftBatchResult } from "@/components/draft-batch-result";
import { ModelPicker } from "@/components/model-picker";
import { Dialog } from "@/components/dialog";
import { DeskShell, Field, InkButton } from "@/components/desk-chrome";
import { DeskJobCard } from "@/components/JobCard";
import { invalidateDeskJobs, useDeskJobs } from "@/components/job-card-state";
import { leadStatusOptimistic, moveLeadStatusNow } from "@/components/desk-lead-status";
import { movedIndex, TRIAGE_LEGEND, useTriageKeys } from "@/components/desk-triage";
import { LeadRowView, SEEN_AGAIN_EXPLAINER } from "@/components/desk-leads";
import {
  AddLeadButton,
  DarkFileDialog,
  HoldLeadDialog,
  NewStoryButton,
  NewStoryDialog,
} from "@/components/dialogs";
import { announceOnly, announceToDesk } from "@/components/desk-chrome-utils";
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
  listQueuePage,
  listScans,
  runScan,
  setLeadStatus,
} from "@/lib/news/desk";
import { restoreTrashItem } from "@/lib/news/trash";
import {
  duplicateKillReason,
  editorActionError,
  mergeFocusSelection,
  printedDupChip,
  suggestFocusLeads,
  workingQueueEmptyCopy,
} from "@/lib/news/desk-copy";
import { PAGE_SIZE, showingLine } from "@/lib/news/list-window";
import type { QueueFilter, QueueSort } from "@/lib/news/queue-rows";
import {
  BULK_STATUS_TOAST_ID,
  BULK_STATUS_UNDO_LABEL,
  bulkStatusReport,
  bulkStatusSummary,
} from "@/lib/news/queue-bulk";
import { useEditorSections } from "@/lib/use-sections";
import { parseUrlList } from "@/lib/paper";
import type { LeadRow } from "@/lib/news/types";
import { usePaper } from "@/lib/paper-context-state";
import { newsInTownPlaceholder } from "@/lib/paper-phrases";
import { useDeskMutation } from "@/components/desk-action";
import { ActionButton, rowActionPhase } from "@/components/action-button";
import { deskErrorReason, deskToast } from "@/components/desk-toast";
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

/*
  The drawn tab set (README "3. Queue") and the three orders come from
  `queue-rows.ts` rather than being spelled again here (Unit CZ-long-lists):
  the server now decides which rows a page holds, so it has to know the tabs
  and the sorts, and two lists of the same five words drift the first time one
  is added. The module is the one source; this screen imports its types.
*/

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
/**
 * Is this lead one the Queue's row presses refuse?
 *
 * Hold, Kill and Edit all refuse a lead that has left the working set -- the
 * server says so and the row does not offer them (`desk-leads.tsx` gates the
 * menu on the same three) -- so the KEYS must not offer them either. A key that
 * opens a dialog the desk would only refuse is worse than a key that does
 * nothing, because it costs a press to find out.
 */
function closedOrHeld(lead: LeadRow): boolean {
  return lead.status === "held" || lead.status === "killed" || lead.status === "published";
}

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
  const scans = useQuery({ queryKey: ["scans"], queryFn: () => listScans() });
  const published = useQuery({ queryKey: ["published-desk"], queryFn: () => listPublishedDesk() });
  /*
    The drawn Queue header's own "Run scan now" (README "3. Queue", handoff
    Desk Screens.dc.html line 21). It is the same scan Today's button runs --
    the same server function and the same three invalidations -- so the two
    screens cannot disagree about what a scan updates.
  */
  /*
    FB6, item 3. FB0-Report Table B (Queue, ":646") calls this a LAZY BAR and a
    SILENT FAIL: the label swapped to "Scanning…", the screen drew no card of
    any kind, and a scan that refused to start reported nothing -- there was not
    even a `Busy` line on this screen. It goes through the shared family now, so
    a failure carries the server's reason, and the scan's own card appears under
    the header press (below) from the same `["desk-jobs"]` the rest of the desk
    reads.
  */
  const scan = useDeskMutation({
    mutationFn: () => runScan(),
    after: () => {
      void qc.invalidateQueries({ queryKey: ["scans"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
      // FB1: the card for the scan just queued. See invalidateDeskJobs.
      invalidateDeskJobs(qc);
    },
    pending: "Starting the scan…",
    done: () => "The scan is running. Watch its stages under the button.",
    failedLead: "Could not start the scan. ",
    what: "start the scan",
  });
  /*
    The Queue's own read of the one job query, for the scan card under the
    header and for nothing else -- every row-level job on this screen is drawn
    by its own control.
  */
  const deskJobs = useDeskJobs();
  const scanJob =
    (deskJobs.data ?? []).find(
      (row) => row.kind === "scan" && (row.status === "queued" || row.status === "running"),
    ) ?? null;
  /*
    FB5: the Queue reaches this mutation from its rows, its bulk Hold and its
    bulk Kill, and every one of those paths reported nothing at all when the
    write failed (FB0-REPORT.md Table B, "bulk Hold": "partial failure leaves
    rows held silently"). The shared action family reports the refusal with the
    server's own reason, so a partial failure is at least said out loud.
  */
  const setStatus = useDeskMutation({
    mutationFn: (input: {
      id: number;
      status: "held" | "killed" | "new";
      killReason?: string;
      killReasonUrl?: string;
    }) => setLeadStatus({ data: input }),
    /*
      FB6, item 2 (README:484). The row moves in the same paint as the press and
      moves back if the write does not take. `desk-lead-status.ts` owns the rule
      and Today uses the same call, so the two screens cannot drift on what
      "optimistic" means. It is also what makes the bulk strip's twelve
      concurrent presses safe: the undo is per LEAD, not a snapshot of the whole
      cache, so one failure cannot put back eleven successes.
    */
    ...leadStatusOptimistic(qc),
    after: () => qc.invalidateQueries({ queryKey: ["leads"] }),
    /*
      M7: while a bulk press is fanning out over the selection, each lead's own
      toast is suppressed -- the bulk path owns the outcome and says it once.
      A row's own Hold/Kill, which is the same mutation, is never muted.
    */
    muted: () => bulkMuted.current,
    pending: "Saving…",
    done: (_result, input) =>
      input.status === "new"
        ? "Undone: the lead is back on the Queue."
        : input.status === "held"
          ? "The lead is on hold, off the Queue until you release it."
          : "The lead moved to Killed, and its row keeps an Undo.",
    /*
      L4 of the batch-6 pre-merge audit: the Kill sentence names an Undo, and
      this toast now carries it. A killed lead leaves the "Open" tab on the
      invalidation, so the row that "keeps an Undo" is a row the editor has to
      go and find; the way back belongs on the sentence that says so.
    */
    undo: (_result, input) =>
      input.status === "new"
        ? null
        : {
            label: "Undo",
            run: async (): Promise<void> => {
              await setStatus.mutateAsync({ id: input.id, status: "new" });
            },
          },
    failedLead: "Could not change that lead. ",
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
  /**
   * True only while the bulk strip is fanning a status change out over the
   * selection, so `setStatus`'s own per-lead toasts stay quiet (M7).
   */
  const bulkMuted = useRef(false);
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
  /*
    How much of the list is on the screen (Unit CZ-long-lists). "Show 25 more"
    widens the window from the top rather than fetching a second page into
    another place, so the rows already read stay where the reader left them --
    the same shape the Published and Drafts screens use.
  */
  const [queueShown, setQueueShown] = useState(PAGE_SIZE);
  /*
    The search box is deferred so a fast typist does not fire a request per
    keystroke: the box keeps up with the typing and the query follows a beat
    behind. It has to be a request at all because the filter runs on the server
    before the window is cut -- searching only the 25 rows already drawn would
    report no matches for a lead that is simply further down the list.
  */
  const deferredSearch = useDeferredValue(search);
  /*
    THE QUEUE IS WINDOWED (Unit CZ-long-lists).

    The desk holds 41 live leads and this screen drew every one of them. It now
    asks the server for the first 25 and for one more page per press of the
    footer under the table, and the SERVER does the narrowing: the tab, the
    search box, the section select and the sort all run there, before the page
    is cut. A window cut here in the browser, before the filter, would page the
    unfiltered list and show the wrong leads -- and the tab counts would read 25,
    the size of the page, instead of the size of the queue. The rule that does
    the narrowing is `queue-rows.ts`, where a test can reach it.

    The key carries the tab, the section, the sort and how far the list has been
    opened, so each combination is cached on its own and going back to one
    already read is instant; `placeholderData` keeps the rows on screen while the
    next window is in flight, so pressing a pill or typing does not blank the
    table. The bare `["leads"]` prefix is deliberate and shared with every other
    reader of the leads list -- this screen's own batch pool below, the Sources
    screen's kill-pattern gate, and the invalidation every hold, kill, delete and
    scan does -- so a prefix match still catches this key.

    `batchPool` is the one thing here that still reads the whole list, and only
    while the batch dialog is open.
  */
  const leadsQuery = useQuery({
    queryKey: ["leads", filter, sectionFilter, sort, deferredSearch, queueShown],
    queryFn: () =>
      listQueuePage({
        data: {
          limit: queueShown,
          offset: 0,
          filter,
          search: deferredSearch,
          section: sectionFilter,
          sort,
        },
      }),
    placeholderData: keepPreviousData,
  });
  const { isPending, isError, error, refetch, isRefetching } = leadsQuery;
  /*
    The rows on the screen (`leads`) and how many the tab actually holds
    (`queueTotal`). `queueTotal` counts the whole match rather than the page:
    it is what the footer's "Showing 25 of 41" and the pills both read.
  */
  const leads = leadsQuery.data?.rows ?? [];
  const queueTotal = leadsQuery.data?.total ?? 0;
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
      // FB1: the Queue's own "Start N stories" and per-row redraft both land
      // here. Without this the card for the draft just queued waits out the
      // idle poll, which is what the report measured as "up to 30 s late".
      invalidateDeskJobs(qc);
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

  /*
    THE ROWS ON THE SCREEN. The server has already run the tab, the search, the
    section and the sort, and cut the page, so there is nothing left to narrow
    here: `shown` is what came back. Everything below that used to compute it --
    the tab filter, the section select, the search, the three orders and the
    "Killed sorts by what keeps coming back" rule -- is `queue-rows.ts` now, on
    the other side of the wire, because a window cut before the filter pages the
    unfiltered list and shows the wrong leads.
  */
  const shown = leads;
  /*
    THE TRIAGE KEYS (FB6, item 4; README "Interactions & behavior").

    FB0-Report Table B, Queue, first row: "keyboard triage -- **missing
    entirely** -- no `onKeyDown` in the file, against README:468". The rule is
    `desk-triage.ts`, the same one Today binds, so J means the same thing on
    both screens and the stand-downs are the same too -- typing, a modifier, a
    focused control, and any dialog or open `<details>` menu over the list (N4
    of the batch-7 re-audit; the hook asks the document for that one itself, so
    this screen does not have to name its own dialogs); "?" is the shell's and
    is already bound on every desk screen.

    `cursor` is an index into the rows ON SCREEN, and it is drawn as `.sel` on
    the row the way Today's is. It is clamped on read rather than stored clamped,
    so a row that leaves the list (a Hold drops it off the Open tab) cannot
    leave the cursor pointing past the end.

    WHAT EACH KEY DOES HERE, where the Queue differs from Today:
      S   queues a draft for the selected lead, exactly as Today's S does --
          the README's "S starts a story". The row's own visible "Start story"
          is a LINK to the workbench, so Enter is that press and S is the one
          that spends the model call. A held or killed lead cannot be drafted
          (the backend's rule), so S says so instead of refusing at the wire.
      U   puts a held or killed lead back. On an open lead there is nothing to
          undo, and a status write that changed nothing would be a press with no
          outcome -- so it says so rather than firing.
  */
  const [cursor, setCursor] = useState(0);
  const [newStoryOpen, setNewStoryOpen] = useState(false);
  useTriageKeys((action) => {
    const lead = shown[movedIndex(cursor, 0, shown.length)];
    const move = (next: number) => {
      if (shown.length === 0) return;
      const i = movedIndex(next, 0, shown.length);
      setCursor(i);
      announceOnly(`Selected: ${shown[i]!.headline}`);
    };
    switch (action.kind) {
      case "move":
        move(cursor + action.delta);
        break;
      case "start":
        if (!lead) break;
        if (lead.status === "held" || lead.status === "killed" || lead.status === "published") {
          announceToDesk(`"${lead.headline}" cannot be drafted from ${lead.status}.`, "err");
          break;
        }
        setDraftNotices((notices) => {
          const next = { ...notices };
          delete next[lead.id];
          return next;
        });
        queueDraft.mutate({
          leadId: lead.id,
          modelChoice: "auto",
          modelEffort: defaultModelEffort("auto"),
        });
        break;
      case "hold":
        if (lead && !closedOrHeld(lead)) setHoldFor(lead);
        break;
      case "kill":
        if (lead && !closedOrHeld(lead)) setKillFor(lead);
        break;
      case "undo":
        if (lead && (lead.status === "held" || lead.status === "killed")) {
          setStatus.mutate({ id: lead.id, status: "new" });
        } else {
          announceOnly("Nothing to undo on that lead.");
        }
        break;
      case "open":
        if (lead) void navigate({ to: "/desk/story/$leadId", params: { leadId: String(lead.id) } });
        break;
      case "new":
        // Same press as Today's N: the drawn New-story dialog, not the legacy
        // #file-lead form (which is a different form with different fields).
        closePanel();
        setNewStoryOpen(true);
        break;
    }
  });
  /*
    The batch dialog's own pool, and the ONE thing on this screen that still
    needs every lead: `suggestFocusLeads` balances a suggested set across the
    whole queue, and a window of 25 would balance it across whichever 25 rows
    sorted first. Kept lazy -- fetched only while the dialog is open -- so the
    screen never reads the full list to draw a table it is not showing. It is
    the same reader the screen used before the window (`listLeads`), so the
    suggestion it produces is unchanged.
  */
  const batchPool = useQuery({
    queryKey: ["leads", "batch-pool"],
    queryFn: () => listLeads(),
    enabled: panel === "batch",
  });
  const batchEligible = (batchPool.data ?? []).filter(
    (lead) => lead.status !== "held" && lead.status !== "killed" && lead.status !== "published",
  );
  const batchPoolPending = panel === "batch" && batchPool.isPending;
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
  const last = scans.data?.rows?.[0];
  /*
    THE PILLS COUNT THE LIST, NOT THE PAGE. These arrive counted on the server
    over every lead the newsroom holds -- the tab, the section and the search
    narrow the ROWS, never the counts -- so "All" still reads 41 while 25 rows
    are on the screen. Reading the page here would print 25 for a queue of 41
    the moment the window appeared.
  */
  const tabCounts = leadsQuery.data?.counts;
  const publishedCount = tabCounts?.publishedLeads ?? 0;
  const queueFilters: { key: QueueFilter; label: string; count: number }[] = [
    { key: "open", label: "Open", count: tabCounts?.open ?? 0 },
    { key: "held", label: "Held", count: tabCounts?.held ?? 0 },
    { key: "killed", label: "Killed", count: tabCounts?.killed ?? 0 },
    { key: "printed", label: "≈ Printed", count: tabCounts?.printed ?? 0 },
    { key: "all", label: "All", count: tabCounts?.all ?? 0 },
  ];
  const printed = published.data ?? [];
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
  /*
    M7 of the batch-6 pre-merge audit. This loop used to be
    `for (const lead of selectedLeads) setStatus.mutate({id, status})`, so a
    twelve-lead Hold raised twelve toasts into a three-toast stack and the
    editor could not tell how many had landed; a partial failure scrolled away
    behind the successes. One press is one outcome now: every lead goes through
    `setStatus.mutateAsync` (which is what runs the mutation, its retry and its
    invalidation), `Promise.allSettled` collects the results, and the batch is
    reported in one sentence under one id.
  */
  const bulkStatus = useMutation({
    mutationFn: async (input: {
      ids: number[];
      status: "held" | "killed";
      killReason?: string;
    }) => {
      /*
        The per-item toasts are suppressed for exactly as long as the batch is
        in flight: `setStatus` would otherwise speak once per lead, and this
        press reports the whole batch itself, one line below.
      */
      bulkMuted.current = true;
      try {
        const settled = await Promise.allSettled(
          input.ids.map((id) =>
            setStatus.mutateAsync({ id, status: input.status, killReason: input.killReason }),
          ),
        );
        return bulkStatusReport({
          status: input.status,
          ids: input.ids,
          settled,
          reason: (error) => deskErrorReason(error, input.status === "held" ? "hold that lead" : "kill that lead"),
        });
      } finally {
        bulkMuted.current = false;
      }
    },
    onSuccess: (report) => {
      const summary = bulkStatusSummary(report);
      deskToast(summary, {
        tone: report.failures.length ? "err" : "ok",
        // One line that updates, not a stack that disagrees with itself.
        id: BULK_STATUS_TOAST_ID,
        undo:
          report.undoIds.length > 0
            ? {
                label: BULK_STATUS_UNDO_LABEL,
                run: async () => {
                  const back = await Promise.allSettled(
                    report.undoIds.map((id) => setStatus.mutateAsync({ id, status: "new" })),
                  );
                  const failed = back.filter((r) => r.status === "rejected").length;
                  if (failed > 0)
                    throw new Error(
                      failed === 1
                        ? "one lead could not be put back"
                        : `${failed} leads could not be put back`,
                    );
                },
              }
            : null,
      });
    },
    onError: (error: Error) => {
      deskToast(`Could not change those leads. ${deskErrorReason(error, "change those leads")}`, {
        tone: "err",
        id: BULK_STATUS_TOAST_ID,
      });
    },
  });
  /**
   * The one reason a bulk Kill writes on every lead it takes.
   *
   * FB6, item 2: "bulk Kill of more than one lead asks for one shared reason
   * first". Killing four leads in one press is the one bulk action here that
   * leaves no record of WHY, and a kill record with no reason is the thing the
   * rest of this desk's kill path exists to avoid (the row's "Kill with a
   * reason", the drawn dialog's own requirement). One reason written to four
   * leads is a worse record than four separate ones, and a much better one than
   * none -- so the strip asks once, for the batch, and the empty box is a real
   * answer ("no reason"), which is the design's fast path.
   */
  const [bulkKillReason, setBulkKillReason] = useState<string | null>(null);
  const bulkSetStatus = (status: "held" | "killed", reason?: string) => {
    const ids = selectedLeads.map((lead) => lead.id);
    if (ids.length === 0) return;
    if (status === "killed" && reason !== undefined && reason.trim()) {
      bulkStatus.mutate({ ids, status, killReason: reason.trim() });
      return;
    }
    bulkStatus.mutate({ ids, status });
  };
  const bulkBusy =
    setStatus.isPending || bulkStatus.isPending || startBatch.isPending || bulkRemove.isPending;
  /*
    Unit UI1a2. The batch's own failure sentence for one of the two bulk presses,
    or null when that press took.

    The whole point of bulk Hold / Kill going through the shared `ActionButton`
    is that a partial failure is said AT the control that was pressed rather than
    only in the toast -- twelve leads go through one `Promise.allSettled`, and
    the report it builds already carries one sentence per lead that did not take.
    The toast still says it (and carries the Undo); this is the same answer in
    the second place the editor is looking.
  */
  const bulkProblemFor = (status: "held" | "killed"): string | null => {
    if (bulkStatus.variables?.status !== status) return null;
    if (bulkStatus.isError) {
      return bulkStatus.error instanceof Error
        ? bulkStatus.error.message
        : "That change did not reach the desk.";
    }
    const failures = bulkStatus.data?.failures ?? [];
    return failures.length ? failures.join(" ") : null;
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
          <InkButton
            tone="ghost"
            disabled={scan.isPending}
            pending={scan.isPending}
            pendingLabel="Starting the scan…"
            onClick={() => scan.mutate()}
          >
            Run scan now
          </InkButton>
          {/*
            Unit BN, item 3: the Queue's own "file a lead" control is the drawn
            dialog (phase 4's `AddLeadDialog`), one press from the header. The
            legacy `#file-lead` dialog below is kept as well -- see its own
            comment for why that door has to keep opening the form it opened
            before this unit.
          */}
          {/*
            FB6, owner report 7d: the same missing `onDone` as Today's mount --
            a lead filed from the Queue's own toolbar did not appear on the
            Queue until a reload, because the dialog told nobody and the query
            client has `refetchOnWindowFocus: false`.
          */}
          <AddLeadButton
            onDone={() => {
              void qc.invalidateQueries({ queryKey: ["leads"] });
              invalidateDeskJobs(qc);
            }}
          />
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

      {/*
        FB6, item 3: the scan's own card, in place, under the press that started
        it. The Queue used to give a scan nothing at all -- no stage, no count,
        no elapsed clock, and no Cancel anywhere on this screen.
      */}
      {scanJob ? (
        <div className="queue-scan-card">
          <DeskJobCard job={scanJob} compact />
        </div>
      ) : null}

      {/*
        FB6, item 4: the triage keys, printed on the screen rather than only in
        the "?" sheet -- README "Interactions & behavior". The words are Today's
        own (`TRIAGE_LEGEND`), so the two lists teach the same keys.
      */}
      {shown.length > 0 ? (
        <p className="queue-legend" aria-label="Keys for this list">
          <span className="today-legend-label">Keyboard</span>
          {TRIAGE_LEGEND.map(([key, what]) => (
            <span key={key}>
              <kbd>{key}</kbd> {what}
            </span>
          ))}
        </p>
      ) : null}

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
                {/*
                  FB6, owner report 7b: this button could read "Start 0 stories"
                  -- a press that would do nothing, labelled with a count of
                  nothing, next to a selection that is entirely held, killed or
                  printed. The count is left out when there is nothing to
                  count, the button stands down, and the line below the bar
                  (which was already there) says why.
                */}
                <InkButton
                  disabled={
                    startBatch.isPending || bulkDraftable.length === 0 || bulkDraftable.length > 5
                  }
                  ariaLabel={
                    bulkDraftable.length === 0
                      ? "Nothing in this selection can be drafted"
                      : `Start ${bulkDraftable.length} ${
                          bulkDraftable.length === 1 ? "story" : "stories"
                        } from the selected leads`
                  }
                  onClick={() => {
                    setBatchNotice(null);
                    setBatchLeadIds(bulkDraftable.map((l) => l.id));
                    setPanel("batch");
                  }}
                >
                  {startBatch.isPending
                    ? "Starting…"
                    : bulkDraftable.length === 0
                      ? "Start stories"
                      : `Start ${bulkDraftable.length} ${bulkDraftable.length === 1 ? "story" : "stories"}`}
                </InkButton>
                <ActionButton
                  tone="quiet"
                  /*
                    FB6, item 1: bulk Hold was `disabled` only and said nothing
                    while it worked -- twelve leads went through one
                    `Promise.allSettled` with no sign that anything was
                    happening. It stands down and says what it is doing now, as
                    does its sibling below.

                    Unit UI1a2: the shared `ActionButton`, so the press also
                    carries the batch's own failure sentence beside it. Its DONE
                    is the ROWS' -- a held lead leaves the selected list reading
                    "Held", which is the row data saying so, and the batch's own
                    one-line summary is the confirmation (the "one confirmation"
                    rule PUB2 set for Publish).
                  */
                  phase={rowActionPhase({
                    isPending: bulkStatus.isPending && bulkStatus.variables?.status === "held",
                    problem: bulkProblemFor("held"),
                  })}
                  workingLabel="Holding…"
                  disabled={bulkBusy}
                  disabledReason={
                    bulkStatus.isPending && bulkStatus.variables?.status !== "held"
                      ? "Another change to this selection is still being saved."
                      : null
                  }
                  onAct={() => {
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
                </ActionButton>
                <ActionButton
                  tone="quiet-danger"
                  phase={rowActionPhase({
                    isPending: bulkStatus.isPending && bulkStatus.variables?.status === "killed",
                    problem: bulkProblemFor("killed"),
                  })}
                  workingLabel="Killing…"
                  disabled={bulkBusy}
                  disabledReason={
                    bulkStatus.isPending && bulkStatus.variables?.status !== "killed"
                      ? "Another change to this selection is still being saved."
                      : null
                  }
                  onAct={() => {
                    /*
                      FB6, item 2: several leads in one kill press asks ONCE for
                      one reason they all carry. One lead keeps the row's own
                      path (the drawn "Kill with a reason" dialog above), which
                      is where a per-lead reason already lives.
                    */
                    if (selectedLeads.length > 1) setBulkKillReason("");
                    else bulkSetStatus("killed");
                  }}
                >
                  Kill
                </ActionButton>
                {bulkKillReason !== null ? (
                  <div className="queue-bulk-delete-confirm">
                    <label className="queue-bulk-reason">
                      <span>
                        Killing {selectedLeads.length} leads. Why? One reason is written on all of
                        them.
                      </span>
                      <input
                        value={bulkKillReason}
                        onChange={(event) => setBulkKillReason(event.target.value)}
                        placeholder="No reason — leave this empty"
                        aria-label="Why these leads are being killed"
                      />
                    </label>
                    <InkButton
                      tone="danger"
                      onClick={() => {
                        const reason = bulkKillReason;
                        setBulkKillReason(null);
                        bulkSetStatus("killed", reason);
                      }}
                    >
                      Yes, kill {selectedLeads.length}
                    </InkButton>
                    <InkButton tone="quiet" onClick={() => setBulkKillReason(null)}>
                      Keep
                    </InkButton>
                  </div>
                ) : null}
                {confirmingBulkDelete ? (
                  <div className="queue-bulk-delete-confirm">
                    <span>
                      Delete {selectedDeleteLeads.length} selected lead
                      {selectedDeleteLeads.length === 1 ? "" : "s"} and any drafts? Published
                      articles stay on the paper.
                    </span>
                    {/*
                      Unit UI1a2: the confirm press carries the states. Its DONE
                      is the rows leaving the Queue, which the list and the
                      removal's own one-line summary already say.
                    */}
                    <ActionButton
                      tone="danger"
                      phase={rowActionPhase({
                        isPending: bulkRemove.isPending,
                        problem:
                          bulkRemove.isError
                            ? bulkRemove.error instanceof Error
                              ? bulkRemove.error.message
                              : "Could not delete those leads."
                            : null,
                      })}
                      workingLabel="Deleting…"
                      onAct={() => bulkRemove.mutate(selectedDeleteLeads)}
                    >
                      {`Yes, delete ${selectedDeleteLeads.length}`}
                    </ActionButton>
                    <ActionButton
                      tone="quiet"
                      phase="idle"
                      disabled={bulkRemove.isPending}
                      disabledReason={
                        bulkRemove.isPending ? "The delete is still being saved." : null
                      }
                      onAct={() => setConfirmingBulkDelete(false)}
                    >
                      Keep
                    </ActionButton>
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
                    setBulkKillReason(null);
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

      {/* The note explains the rows it is printed above, so it is read off the
          page rather than off the whole list (Unit CZ-long-lists): on the
          Killed tab "best" puts resurfaced leads first, so a page that holds
          none of them is a page the note has nothing to say about. */}
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
            {shown.map((l, index) => {
              // U26b: the same paper's place the server's counts and the scan's
              // matcher use, so the chip and the "≈ Printed" tab agree. U28:
              // the same `printedDupChip` the server's counts now use, so a
              // pair the desk's duplicate check cleared is absent from the tab
              // AND from the row -- one rule, not two.
              const dupMatch = printedDupChip(l, printed, PAPER);
              return (
                <LeadRowView
                  key={l.id}
                  lead={l}
                  dup={dupMatch}
                  roomy
                  /*
                    FB6, item 4: where J and K have put the cursor. The row is
                    the same row; the class is the only difference, exactly as
                    on Today.
                  */
                  selected={index === movedIndex(cursor, 0, shown.length)}
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
                  /*
                    FB6, item 5: the row's own Release / Bring back says what it
                    is doing while it does it, and carries the failure sentence.
                    The state is the screen's because the mutation is.
                  */
                  backPending={setStatus.isPending && setStatus.variables?.id === l.id}
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
                  /*
                    Unit UI1a2: this row's own delete, as the shared piece draws
                    it. `remove` is one mutation for every row, so `variables` is
                    which row pressed it -- the same shape `statusId` and
                    `backPending` already use on this screen. The reason is the
                    screen's own `deleteError`, which is now read at the control
                    that was pressed as well as in the page's line.
                  */
                  deletePending={remove.isPending && remove.variables === l.id}
                  deleteReason={
                    remove.variables === l.id && !remove.isPending ? deleteError || null : null
                  }
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
          {/* The list is windowed (Unit CZ-long-lists), so the footer says how
              much of it is on the screen and offers the next page. Not drawn:
              the handoff's only footer is this screen's own "Load more"
              (Desk Screens.dc.html:67), and the brief names this button, so
              this is the brief's wording. Recorded in SPEC-GAPS-0681.md. */}
          {queueTotal > 0 ? (
            <div className="astra-list-foot">
              <span>{showingLine(shown.length, queueTotal, "leads")}</span>
              {shown.length < queueTotal ? (
                <button
                  type="button"
                  className="astra-list-more"
                  onClick={() => setQueueShown((n) => n + PAGE_SIZE)}
                >
                  Show {PAGE_SIZE} more
                </button>
              ) : null}
            </div>
          ) : null}
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
      {/*
        FB6, item 4: the N key's destination on this screen, mounted once like
        Today's -- the drawn New-story dialog, not the legacy #file-lead form.
      */}
      <NewStoryDialog open={newStoryOpen} onClose={() => setNewStoryOpen(false)} />

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
              placeholder={newsInTownPlaceholder(PAPER.city)}
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
          batchQueuedNow ||
          /*
            Unit CZ-long-lists: the eligible pool is now a second read, asked
            for when this dialog opens, because the screen behind it holds only
            a page. Until it lands `batchEligible` is empty, so
            `selectedBatchLeads` is empty too and the first three clauses
            already hold -- this names the reason, so that a future change to
            any of them cannot quietly arm a Start that queues the wrong leads.
          */
          batchPoolPending
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
                /*
                  The row's headline has to come from somewhere, and since Unit
                  CZ-long-lists the screen only HOLDS a page: a batch can carry
                  a lead whose page this screen is not showing. So the visible
                  page is asked first (it is already in memory) and the batch
                  pool second, which is every lead. `batchPool` is enabled only
                  while this dialog is open, which is where this line runs.
                */
                const lead =
                  leads.find((candidate) => candidate.id === item.leadId) ??
                  batchPool.data?.find((candidate) => candidate.id === item.leadId);
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
          onDone={() => {
            /*
              FB6, item 2: the row moves the moment the dialog's write answers,
              not one refetch later. There is nothing optimistic about waiting
              for the round trip the dialog already completed.
            */
            moveLeadStatusNow(qc, holdFor.id, "held");
            void qc.invalidateQueries({ queryKey: ["leads"] });
          }}
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
          onKilled={() => {
            moveLeadStatusNow(qc, killFor.id, "killed");
            void qc.invalidateQueries({ queryKey: ["leads"] });
          }}
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
