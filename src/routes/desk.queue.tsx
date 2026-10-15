import { startDraftBatch } from "@/components/scoped-actions";
import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { DraftBatchResult } from "@/components/draft-batch-result";
import { useEscapeToCancel } from "@/components/escape-to-cancel";
import { sectionDisplayName } from "@/components/sections-setup-copy";
import { ModelPicker } from "@/components/model-picker";
import { useBatchModelChoice } from "@/components/batch-model-choice";
import { useJobModelAssignment } from "@/components/use-job-model-assignment";
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
import { announceOnly } from "@/components/desk-chrome-utils";
/*
  Unit BW, item 2: the drawn Kill dialog, imported from its own module rather
  than through the `@/components/dialogs` barrel, which re-exports
  `editor-dialogs` only. `/desk/story/$leadId` and Today import it the same way.
*/
import { KillDialog } from "@/components/dialogs/KillDialog";
import { EditLeadDialog } from "@/components/dialogs/EditLeadDialog";
import { AddFollowUpButton } from "@/components/add-follow-up-button";
import { ListSkeleton, Notice, ScreenError } from "@/components/states";
import { deleteLead, listLeads, listPublishedDesk, listQueuePage, listScans, restoreKilledLead, setLeadStatus } from "@/lib/news/desk";
import { draftLead, fileLead, runScan } from "@/components/scoped-actions";
import { restoreTrashItem } from "@/lib/news/trash";
import {
  duplicateKillReason,
  BULK_START_NOTE,
  editorActionError,
  mergeFocusSelection,
  PRINTED_TAB_NOTE,
  printedDupChip,
  queueTabCountText,
  suggestFocusLeads,
  workingQueueEmptyCopy,
} from "@/lib/news/desk-copy";
import { PAGE_SIZE, showingLine } from "@/lib/news/list-window";
import { queueKeepsRowsWhileLoading, queueRowTick, queueSelectAllShown, type QueueFilter, type QueueSort } from "@/lib/news/queue-rows";
import {
  BULK_STATUS_TOAST_ID,
  BULK_STATUS_UNDO_LABEL,
  bulkStatusReport,
  bulkDeleteReasonLines,
  bulkStatusSummary,
  settleBulkKill,
  undoBulkKill,
} from "@/lib/news/queue-bulk";
import { useEditorSections } from "@/lib/use-sections";
import { parseUrlList } from "@/lib/paper";
import { darkLeadPrefill } from "@/lib/news/dark-seed";
import type { LeadRow } from "@/lib/news/types";
import { usePaper } from "@/lib/paper-context-state";
import { createLeadWrites } from "@/lib/lead-writes-in-flight";
import { newsInTownPlaceholder } from "@/lib/paper-phrases";
import { useDeskMutation } from "@/components/desk-action";
import { ActionButton, rowActionPhase } from "@/components/action-button";
import { deskErrorReason, deskToast, dismissDeskToast } from "@/components/desk-toast";
import {
  KILL_TOAST_MS,
  KillReasonChips,
  killPress,
  killUndoPress,
  holdPress,
  holdUndoPress,
  holdStampRestore,
  bringBackPress,
  restoreStatus,
  undoPressFor,
  type KillReasonRequest,
  type KillUndoPress,
  type LastPress,
  type RestoreStatus,
} from "@/components/fast-kill";
import { bulkDeskWarnings, bulkDeskRetry, bulkWarningSentence, deskWarning, withDeskOverride, type BulkDeskWarning } from "@/lib/news/desk-warning";
import { modelChoiceLabel, type StoryModelChoice } from "@/lib/news/model-choice";
import { defaultModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import { myDesk } from "@/lib/news/claim";
import { dismissDraftBatch, getDraftBatch, visibleDraftBatchItems, type DraftBatchRuntime } from "@/lib/news/draft-batch";

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
 * The lead headline becomes the question and its first source becomes the
 * starting point. When no source exists the starting point stays empty so the
 * editor can supply one; a story-screen path is not a public source.
 */

function darkPrefill(lead: LeadRow) {
  const source = parseUrlList(lead.source_urls)[0];
  return darkLeadPrefill(lead.headline, source ?? null);
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
  const [scanModel, setScanModel] = useState<StoryModelChoice>("auto");
  const [scanModelEffort, setScanModelEffort] = useState<ModelEffort | null>(defaultModelEffort("auto"));
  const scanModelTouched = useRef(false);
  useJobModelAssignment<StoryModelChoice>({
    jobKey: "scan",
    touched: scanModelTouched,
    setChoice: setScanModel,
    setEffort: setScanModelEffort,
  });
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
    mutationFn: () => runScan({ data: { modelChoice: scanModel, modelEffort: scanModelEffort, modelChoiceExplicit: scanModelTouched.current } }),
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
    The chips' own write: the fast kill's reason, one tap later.

    Owner, 2026-10-03. It is a second write on purpose -- the kill is already
    done when these chips are drawn, and the editor's whole complaint was that
    the reason stood between them and the kill. Same server function and same
    `after` as the kill itself, so a reason lands on the lead the kill just
    moved and the Killed tab shows both.

    `done` returns "" so this press raises NO toast of its own. The chip's
    answer is the "Reason kept: …" line drawn in place of the chips inside the
    kill's toast, and a second toast would both cover the row the editor is
    moving to and take the kill's Undo off the screen. A FAILURE still speaks
    (the shared family reports a refusal whatever `done` says), because a reason
    that did not save must never look like one that did.
  */
  const saveKillReason = useDeskMutation({
    mutationFn: (request: KillReasonRequest) => setLeadStatus({ data: request.data }),
    warningAction: "Kill",
    overrideVariables: (request, keys) => ({ ...request, data: withDeskOverride(request.data, keys) }),
    after: () => qc.invalidateQueries({ queryKey: ["leads"] }),
    pending: "Keeping the reason…",
    done: () => "",
    failedLead: "Could not keep that reason. ",
    what: "keep that reason",
  });
  /*
    What the screen remembers about a kill it just made, per lead: the status the
    lead held before the press.

    Owner, 2026-10-03. Every kill the rows and the keyboard make carries that
    status on the press itself (`killPress(id, restoreStatus(l.status))`), which
    is what the toast's own Undo reads. The U key is the one way back that holds
    no press to read it from -- it acts on the row the cursor is on, and by then
    that row is already killed -- so this is the memory it looks in. It is this
    session's memory only: after a reload a killed lead's U key falls back to
    `new`, which is where it put every lead before this fix.
  */
  const killedFrom = useRef(new Map<number, RestoreStatus>());
  /*
    TIA-2: the same memory, for the same reason, on the OTHER press. A Hold has
    no `RestoreStatus` of its own worth remembering (a held lead is on hold and
    that IS the answer, so `heldFrom` holds only the ids this screen has held and
    is a set), but the U key needs to know whether the held lead under the cursor
    is one THIS screen held a moment ago or one it found that way. The first is
    the press U is taking back; the second is a released-style press and keeps the
    drawn behaviour.
  */
  const heldFrom = useRef(new Set<number>());
  /*
    THT-7, THT-9: the last kill this screen pressed. A killed lead leaves the
    Open list at once, so the cursor is on the next lead by the time U is
    pressed; U reads this instead, so the hint's own promise holds.
  */
  const lastKill = useRef<{ id: number; restore: RestoreStatus; bulk?: true } | null>(null);
  /* THU-4: the report of the bulk Kill in flight; its Undo and the U key wait for it. */
  const bulkKillReport = useRef<{ promise: Promise<{ undoIds: number[] }>; settle: (r: { undoIds: number[] }) => void } | null>(null);
  /* THT-8: each lead's status write that has not answered yet; a restore waits for it. */
  const leadWrites = useRef(createLeadWrites());
  /*
    THU-3: the most recent KILL or HOLD this screen pressed, whichever came last.

    The legend says "U undo" (`TRIAGE_LEGEND`) and means the one press that just
    happened. Before this, U read the held cursor first and `lastKill` only
    second, so a hold pressed after a kill was the one U took back only when the
    cursor happened to be on it -- and a kill pressed after a hold was taken back
    only if no held lead was under the cursor. Two memories with a fixed order
    between them cannot answer "whichever came last"; one memory stamped at the
    press can.

    The shape is `LastPress` (fast-kill.ts), the same value `undoPressFor` reads
    and turns back into a write, so the press this screen stamps and the request
    the U key sends cannot disagree about what a press is.
  */
  const lastPress = useRef<(LastPress & { bulk?: true }) | null>(null);
  const killLead = (lead: { id: number; status: string }) => {
    const restore = restoreStatus(lead.status);
    killedFrom.current.set(lead.id, restore);
    lastKill.current = { id: lead.id, restore };
    lastPress.current = { kind: "kill", id: lead.id, restore };
    return killPress(lead.id, restore);
  };
  /*
    TIA-2: the Hold, as a press that carries where it goes back to -- the same
    shape the Kill has had since 2026-10-03 (`killLead` above), read off the row
    at the moment of the press because by Undo time the row is held and its prior
    status is gone. Every Hold this screen makes goes through here, so the toast's
    Undo and the U key both have a value to read instead of a guess.

    THU-3: the same press is stamped as the most recent one, so a U pressed after
    a Hold takes the Hold back even when a Kill came before it.
  */
  const holdLead = (lead: { id: number; status: string }) => {
    const restore = holdRestore(lead);
    heldFrom.current.add(lead.id);
    lastPress.current = { kind: "hold", id: lead.id, restore };
    return holdPress(lead.id, restore);
  };
  /*
    THU-3, the walk's own H. The key handler holds the lead `shown` names for
    the cursor, not the full row -- a projection with the headline and nothing
    else. Stamping `lastPress` from that object directly is what made the key
    path silently different from the row's Hold: `holdRestore` reads
    `lead.status`, the projection has none, so the stamp carried
    `{restore: undefined}`. `undoPressFor` then built a hold undo with no
    `status`, and the restore write was sent asking the server to guess -- an
    Undo that answers nothing on a lead whose draft makes `new` wrong. Every
    Hold on this screen -- the keyboard's H, the row's own, and the row menu's
    dialog -- goes through here, so the press the key stamps is the press the
    row's Hold makes, and `holdRestore` is the one place the status is read.
  */
  const holdLeadById = (id: number) => {
    const lead = leads.find((l) => l.id === id);
    const row = lead ?? { id, status: "held" };
    return holdLead(row);
  };
  /*
    Where a held lead goes back to, for a lead that is held NOW. `restoreStatus`
    reads a row before the press; this reads it after, so the two statuses a Hold
    can hide are the two it can put back -- `drafted` is still on the lead, and an
    open lead (whatever opened it) is `new`. A lead whose status is neither is a
    hold this screen did not make, and it stays where it is rather than being
    guessed at (`undefined`), which the server answers with `new`.
  */
  const holdRestore = (lead: { status: string }): RestoreStatus | undefined =>
    holdStampRestore(lead.status);
  /*
    The way back from a kill, putting the lead where it was (owner, 2026-10-03).
    A `drafted` lead an editor killed came back as `new` with its draft orphaned,
    because the way back was `setLeadStatus` -- whose input has no `drafted` in it,
    and should not: `drafted` is written by the desk's drafting pass, never picked
    by a screen. This is the one write that may put a lead back into `drafted`,
    and the server holds it to the two conditions the screen cannot: the lead must
    be killed right now, and a lead going back to `drafted` must still have its
    draft (`restoreKilledLead`, desk.ts).

    It carries the same optimistic rule as `setStatus`, so the row returns to the
    Open tab in the same paint as the Undo press and moves back if the server
    refuses -- leaving the lead killed and the toast saying why.
  */
  /* An Undo press may carry no status: the server then puts the lead back where it was before the kill. */
  const undoOptimistic = leadStatusOptimistic(qc);
  const undoMove = (press: KillUndoPress) => ({ id: press.id, status: press.status ?? "new" as const });
  /*
    THU-2 / DHK-2: the one name a lead's kill toast carries, so its Undo can
    REPLACE that toast in place instead of stacking a second one beside it.

    The old shape raised the kill under no id at all and the "Restoring…" line
    under `desk-restoring-<id>` -- two names, so sonner drew two cards: the
    "Killed 1 lead. Undo" sentence the editor had just answered, and, over the
    rows, a "Restoring…" the kill toast knew nothing about. Naming both from
    one place is what makes the second press a replacement.

    Deliberately NOT the same name as `desk-restoring-<id>`, because the bulk
    path already owns that one for its own single line and the two must not
    coalesce into each other.
  */
  const killToastId = (id: number) => `desk-kill-toast-${id}`;
  const undoKill = useDeskMutation({
    mutationFn: async (press: KillUndoPress) => {
      // The lead is being put back, so U must not aim at it again.
      if (lastKill.current?.id === press.id) lastKill.current = null;
      if (lastPress.current?.id === press.id) lastPress.current = null;
      /*
        THT-8, DHJ-2: the toast says "Restoring…" in the same paint as the press,
        and goes when the write answers (the done or failed toast takes over).
        A bulk press owns its own outcome, so it stays quiet here.

        THU-2 / DHK-2: raised under the KILL toast's own name, which is what
        makes it a replacement rather than a second card. `killToastId(press.id)`
        is the same name `setStatus` gave the "The lead moved to Killed." toast,
        so sonner swaps that card's sentence where it stands: no stale "Undo"
        and no second line over the rows.
      */
      const restoringId = killToastId(press.id);
      if (!bulkMuted.current) deskToast("Restoring…", { id: restoringId, duration: Infinity });
      try {
        /*
          THT-8: the restore reads the lead's status on the server, and a slow
          kill write (several seconds under load) lands AFTER a U pressed right
          behind it -- the restore found nothing killed, then the kill landed and
          U was lost. The way back waits for this lead's own write first.
        */
        await leadWrites.current.settled(press.id);
        return await restoreKilledLead({ data: { id: press.id, status: press.status, keepRecord: press.keepRecord } });
      } finally {
        dismissDeskToast(restoringId);
      }
    },
    optimistic: (press: KillUndoPress) => undoOptimistic.optimistic(undoMove(press)),
    rollback: (context: unknown, press?: KillUndoPress) => undoOptimistic.rollback(context, press && undoMove(press)),
    after: () => qc.invalidateQueries({ queryKey: ["leads"] }),
    pending: "Undoing…",
    done: () => "Undone: the lead is back on the Queue.",
    failedLead: "Could not put that lead back. ",
    what: "put that lead back",
  });
  /*
    FB5: the Queue reaches this mutation from its rows, its bulk Hold and its
    bulk Kill, and every one of those paths reported nothing at all when the
    write failed (FB0-REPORT.md Table B, "bulk Hold": "partial failure leaves
    rows held silently"). The shared action family reports the refusal with the
    server's own reason, so a partial failure is at least said out loud.
  */
  const [releasedId, setReleasedId] = useState<number | null>(null);
  const setStatus = useDeskMutation({
    mutationFn: (input: {
      id: number;
      status: "held" | "killed" | "new";
      killReason?: string;
      killReasonUrl?: string;
      override?: string[];
      release?: boolean;
      /*
        Carried by a kill press only, and never sent from here: it is the status
        the kill's own Undo will restore (`killPress`), read by the `undo` copy
        below and handed to `undoKill`, which is the write allowed to restore
        `drafted`. `leadStatusInput` has no `drafted` in it, so forwarding this
        to `setLeadStatus` would be a refusal waiting to happen.
      */
      restore?: RestoreStatus;
    }) => {
      const write = setLeadStatus({ data: {
        id: input.id,
        status: input.status,
        killReason: input.killReason,
        killReasonUrl: input.killReasonUrl,
        override: input.override,
      } });
      // Remembered per lead so a restore pressed behind it waits its turn (THT-8).
      leadWrites.current.track(input.id, write);
      return write;
    },
    /*
      FB6, item 2 (README:484). The row moves in the same paint as the press and
      moves back if the write does not take. `desk-lead-status.ts` owns the rule
      and Today uses the same call, so the two screens cannot drift on what
      "optimistic" means. It is also what makes the bulk strip's twelve
      concurrent presses safe: the undo is per LEAD, not a snapshot of the whole
      cache, so one failure cannot put back eleven successes.
    */
    ...leadStatusOptimistic(qc),
    after: async (_result, input) => {
      await qc.invalidateQueries({ queryKey: ["leads"] });
      if (input.release) setReleasedId(input.id);
    },
    /*
      M7: while a bulk press is fanning out over the selection, each lead's own
      toast is suppressed -- the bulk path owns the outcome and says it once.
      A row's own Hold/Kill, which is the same mutation, is never muted.
    */
    muted: () => bulkMuted.current,
    warningAction: (input) => input.release ? "Release" : input.status === "killed" ? "Kill" : input.status === "held" ? "Hold" : "Reopen",
    pending: "Saving…",
    done: (_result, input) =>
      input.release
        ? ""
        : input.status === "new"
          ? "Undone: the lead is back on the Queue."
          : input.status === "held"
            ? "The lead is on hold, off the Queue until you release it."
            : /*
                Owner, 2026-10-03, the fast kill: the kill left the Open tab in
                the same paint, so the sentence names the two things that are on
                the toast in front of the editor rather than a row that is gone
                -- the Undo, and the chips that put a reason on the record.
              */
              "The lead moved to Killed. Undo is here, and you can say why in one tap.",
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
              /*
                A RELEASED lead goes back to `held` -- that is what a Release
                takes back, and it goes through `setStatus`, the ordinary write,
                exactly as it always has.

                A HOLD's Undo does NOT (TIA-2, walk step TIA-2). It used to: it
                re-sent the Hold's own write reversed, `setStatus` with `new`.
                That is the ordinary status path, and for the ordinary held lead
                -- one with a written draft -- the server raises its drafted
                warning and refuses, `leadStatusOptimistic` rolls the row back,
                and the walker saw the lead stay held with nothing said. The way
                back from a hold is now the same write as a kill's: `undoKill`,
                carrying the status the row held when the Hold was pressed, read
                from the press and not guessed. A Hold on a row that carried a
                draft comes back `drafted`; one on an open lead comes back `new`.
              */
              if (input.release) {
                await setStatus.mutateAsync({ id: input.id, status: "held", override: input.override });
                return;
              }
              if (input.status === "held") {
                await undoKill.mutateAsync(holdUndoPress(holdPress(input.id, input.restore), input.override));
                return;
              }
              await undoKill.mutateAsync(killUndoPress(input.id, input.restore));
            },
          },
    /*
      Owner, 2026-10-03, the fast kill: the reason is offered AFTER the kill,
      as chips in the toast that reports it. Only a kill gets them -- a hold or
      an undo has no "why" to ask -- and only for a press that actually took,
      because `deskToast` drops the chips on a failure.
    */
    chips: (_result, input) =>
      input.status === "killed" ? (
        <KillReasonChips leadId={input.id} save={(request) => saveKillReason.mutate({ ...request, data: withDeskOverride(request.data, input.override ?? []) })} />
      ) : null,
    /*
      And that toast lives longer than an ordinary one, because it is the only
      one that asks a question the editor has to read and answer. Undo stays on
      it for the whole life.
    */
    duration: (_result, input) => (input.status === "killed" ? KILL_TOAST_MS : undefined),
    /*
      THU-2 / DHK-2: a kill's toast is named for its lead, so the press's own
      Undo can replace it in place with "Restoring…" (`undoKill` raises that
      under the same name). Nothing else on this screen names its toast, and a
      Hold -- which has no follow-up sentence -- goes on stacking as before.
    */
    toastId: (input) => (input.status === "killed" ? killToastId(input.id) : undefined),
    failedLead: "Could not change that lead. ",
  });
  /*
   * Unit AK item 4: "Kill as duplicate" is the same kill with a reason
   * recorded (migration 0094). It rejects on failure so the row can say
   * "That did not save." instead of looking like it worked.
   */
  const killAsDuplicate = useDeskMutation({
    mutationFn: (input: { id: number; killReason: string; override?: string[]; restore?: RestoreStatus }) =>
      setLeadStatus({ data: { ...input, status: "killed" } }),
    warningAction: "Kill",
    after: () => qc.invalidateQueries({ queryKey: ["leads"] }),
    pending: "Killing…",
    done: () => "The lead moved to Killed.",
    undo: (_result, input) => ({ label: "Undo", run: async () => { await undoKill.mutateAsync(killUndoPress(input.id, input.restore)); } }),
    failedLead: "Could not kill that lead. ",
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
  const [bulkDeleteReasons, setBulkDeleteReasons] = useState<Record<number, string>>({});
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
    onMutate: () => setBulkDeleteReasons({}),
    mutationFn: async (leadIds: number[]) => {
      const deletedIds: number[] = [];
      const failures: string[] = [];
      const reasons: Record<number, string> = {};
      for (const leadId of leadIds) {
        try {
          const result = await deleteLead({ data: leadId });
          if (result?.ok) deletedIds.push(leadId);
          else {
            reasons[leadId] = result?.error ?? `Lead #${leadId} did not delete.`;
            failures.push(reasons[leadId]);
          }
        } catch (cause) {
          reasons[leadId] = cause instanceof Error ? cause.message : `Lead #${leadId} did not delete.`;
          failures.push(reasons[leadId]);
        }
      }
      return { deletedIds, failures, reasons };
    },
    onSuccess: async ({ deletedIds, failures, reasons }) => {
      setBulkDeleteReasons(reasons);
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
    // DHE1-6: the old rows stay only for the same tab, section and sort. A
    // tab press shows the loading rows, not the other tab's leads.
    placeholderData: (previousData, previousQuery) => {
      const [, fromFilter, fromSection, fromSort] = previousQuery?.queryKey ?? [];
      return queueKeepsRowsWhileLoading(
        previousQuery ? { filter: fromFilter, section: fromSection, sort: fromSort } : undefined,
        { filter, section: sectionFilter, sort },
      )
        ? previousData
        : undefined;
    },
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
  /*
    B3. The new-run picker opens on Automatic, and STAYS where the editor put
    it for this session. It used to be hydrated from whatever batch happened to
    be on screen (`batch.data`), so opening the panel to start a new run
    silently inherited the last batch's runtime/effort instead of the Automatic
    ladder the editor expects. The historic batch read still drives the RUNNING
    panel's progress and its "started with X" line (below); it no longer writes
    the picker's state, which is the editor's alone until they submit.
  */
  // DHE1-10 / DHD1-2: the strip and the dialog read and write this one state, so
  // the model and effort shown in either are the ones Start runs.
  const {
    runtime: batchRuntime,
    effort: batchEffort,
    setEffort: setBatchEffort,
    pick: pickBatchRuntime,
    touched: batchRuntimeTouched,
  } = useBatchModelChoice();
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null);
  const [batchNotice, setBatchNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const leadRefreshAfterTerminalBatch = useRef<number | null>(null);
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
      modelChoiceExplicit: boolean;
    }) =>
      startDraftBatch({
        data: {
          items: input.leadIds.map((leadId) => ({ leadId })),
          runtime: input.runtime,
          modelEffort: input.modelEffort,
          modelChoiceExplicit: input.modelChoiceExplicit,
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
      modelChoiceExplicit?: boolean;
      fromBatch?: boolean;
    }) =>
      draftLead({
        data: {
          leadId: input.leadId,
          modelChoice: input.modelChoice,
          modelEffort: input.modelEffort,
          modelChoiceExplicit: input.modelChoiceExplicit,
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
          that spends the model call. The server returns policy warnings through
          the same consent flow used by the visible draft control.
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
        // TIA-2: the same press the row's Hold makes, so the keyboard's H and
        // the button beside it both leave a way back the Undo can read.
        // THU-3: `holdLeadById` reads the LEAD's own row for the status, the
        // projection the key holds has none (see `holdLeadById` above).
        if (lead) setStatus.mutate(holdLeadById(lead.id));
        break;
      case "kill":
        /*
          Owner, 2026-10-03, the fast kill: X is the ROW's kill now, not the
          dialog. The legend has always promised "X kill" (`TRIAGE_LEGEND`,
          desk-triage.ts) and the drawn LeadRow prints the same key hint on its
          inline Kill, so the key does what the button beside it does: kills at
          once, with the Undo and the reason chips on the toast. The dialog is
          still there for a written reason, in the row's More ▾ menu.
        */
        // THT-8: X on a focused row Kill button kills that row (`rowId`), not the cursor row.
        {
          const target = action.rowId == null ? lead : shown.find((l) => String(l.id) === action.rowId);
          if (target) setStatus.mutate(killLead(target));
        }
        break;
      case "undo": {
        /*
          THU-3: U takes back the MOST RECENT kill or hold, whichever came last.

          The order below is the whole fix. It used to be "held cursor first,
          then last kill", which answers a fixed priority rather than "whichever
          came last": press H then X and U took the HOLD back if a held lead was
          under the cursor, and press X then H and U took the KILL back only when
          no held lead was. `lastPress` is stamped by `killLead` and `holdLead`
          at the press, so the key reads the press that actually came last.
        */
        const pressed = lastPress.current;
        if (pressed?.kind === "hold") {
          /*
            TIA-2, walk step TIA-2. The toast's Undo for a hold is `undoHoldPress`,
            carrying the status the row held when the Hold was pressed -- not the
            ordinary `setStatus` write, which for a lead with a written draft is
            refused with the drafted warning and leaves the row held with nothing
            said. A hold this screen pressed is taken back by the same write as
            the toast's Undo, so the key and the button cannot be the one that
            stayed put.

            THU-3, THE WALK'S THIRD FINDING. The branch used to require the held
            lead to be on screen: `shown.find(...)` or the cursor row. It never
            is. A hold's optimistic patch (`leadStatusOptimistic`) takes the row
            off the Open tab in the same paint as the press, and `shown` IS the
            server's Open page, so by the time U is pressed the search finds
            nothing, the cursor is on the next row, and the press falls through
            to the kill branch -- a U that did nothing on a hold, which is what
            the walk walked into. The stamp is the whole memory a press needs:
            the lead left the list, not the screen, and the write `undoPressFor`
            builds goes by id.

            The request itself is built by `undoPressFor` (fast-kill.ts), the one
            place the Kill and the Hold agree on how a press becomes a write, so
            the key and the toast's Undo cannot drift apart. `holdLeadById` read
            the row's status at the press, so `pressed.restore` is the answer
            even though the row is gone.
          */
          lastPress.current = null;
          const press = undoPressFor(pressed);
          if (press) void undoKill.mutate(press);
        } else if (pressed?.kind === "kill" && pressed.bulk && bulkKillReport.current) {
          // THU-4: U puts back every lead the bulk press killed, the same as its toast's Undo.
          lastPress.current = null;
          lastKill.current = null;
          void runBulkKillUndo();
        } else if (pressed?.kind === "kill") {
          // THT-7, THT-9: the kill just pressed, even though its lead has left the list.
          lastPress.current = null;
          const press = undoPressFor(pressed);
          if (press) void undoKill.mutate(press);
        } else if (lead && lead.status === "held") {
          /*
            No press this screen remembers, so U falls back to the cursor the way
            it always did. A held lead this screen held takes the toast's own way
            back; one carried in from the Held tab (or held in another tab) keeps
            the drawn `release`, and the "Released." strip offers the way back
            from there.
          */
          if (heldFrom.current.has(lead.id)) {
            void undoKill.mutate(
              holdUndoPress(holdPress(lead.id, holdRestore(lead))),
            );
          } else {
            setStatus.mutate({ id: lead.id, status: "new", release: true });
          }
        } else if (lastKill.current) {
          // THT-7, THT-9: a kill pressed before `lastPress` existed on screen.
          const last = lastKill.current;
          if (last.bulk && bulkKillReport.current) {
            lastKill.current = null;
            void runBulkKillUndo();
          } else {
            void undoKill.mutate(killUndoPress(last.id, last.restore));
          }
        } else if (lead && lead.status === "killed") {
          /*
            A kill's way back, through the same write the row's own Undo uses --
            and the one entry point with no press to read the pre-kill status
            from, so it reads this session's memory (`killedFrom`) and falls back
            to `new` for a lead killed before the screen knew.
          */
          void undoKill.mutate(killUndoPress(lead.id, killedFrom.current.get(lead.id)));
        } else {
          announceOnly("Nothing to undo on that lead.");
        }
        break;
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
  const batchEligible = batchPool.data ?? [];
  const batchPoolPending = panel === "batch" && batchPool.isPending;
  /*
    The list the batch dialog is about to queue: the bulk bar's selection,
    held still while the dialog is open so that adding suggested focus to it
    cannot change what the press behind it would have done. Every entry is a
    lead still on this desk. Saved lifecycle state is warned about by the
    server and does not remove an editor's selection.
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
  const queueFilters: { key: QueueFilter; label: string; count: number | null }[] = [
    { key: "open", label: "Open", count: tabCounts?.open ?? null },
    { key: "held", label: "Held", count: tabCounts?.held ?? null },
    { key: "killed", label: "Killed", count: tabCounts?.killed ?? null },
    { key: "printed", label: "≈ Printed", count: tabCounts?.printed ?? null },
    { key: "all", label: "All", count: tabCounts?.all ?? null },
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
  const bulkDraftable = selectedLeads;
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
  type BulkPress = { ids: number[]; status: "held" | "killed"; killReason?: string;
    overrideById?: Record<number, string[]>; completedIds?: number[]; previousFailures?: string[]; restores?: Record<number, RestoreStatus> };
  const [bulkWarnings, setBulkWarnings] = useState<{ warnings: BulkDeskWarning[]; press: BulkPress } | null>(null);
  const bulkStatus = useMutation({
    mutationFn: async (input: BulkPress) => {
      /*
        The per-item toasts are suppressed for exactly as long as the batch is
        in flight: `setStatus` would otherwise speak once per lead, and this
        press reports the whole batch itself, one line below.
      */
      bulkMuted.current = true;
      try {
        const sendAll = (ids: readonly number[], overrideById: Record<number, string[]>) =>
          Promise.allSettled(
            ids.map((id) =>
              setStatus.mutateAsync({ id, status: input.status, killReason: input.killReason, override: overrideById[id], restore: input.restores?.[id] }),
            ),
          );
        // D2-a: a Kill answers its written-draft warnings inside this press, so no lead is left waiting on one.
        const { settled, drafted } = input.status === "killed"
          ? await settleBulkKill(input.ids, sendAll, input.overrideById ?? {})
          : { settled: await sendAll(input.ids, input.overrideById ?? {}), drafted: [] };
        const warnings = bulkDeskWarnings(input.ids, settled);
        const allowed = input.ids.map((id, index) => ({ id, outcome: settled[index] })).filter(({ outcome }) => outcome.status !== "fulfilled" || !deskWarning(outcome.value));
        const report = bulkStatusReport({
          status: input.status, ids: allowed.map(item => item.id), settled: allowed.map(item => item.outcome),
          reason: (error) => deskErrorReason(error, input.status === "held" ? "hold that lead" : "kill that lead"),
        });
        const undoIds = [...new Set([...(input.completedIds ?? []), ...report.undoIds])];
        return { ...report, done: undoIds.length, undoIds, warnings, drafted, failures: [...(input.previousFailures ?? []), ...report.failures] };
      } finally {
        bulkMuted.current = false;
      }
    },
    onSuccess: (report, input) => {
      bulkKillReport.current?.settle({ undoIds: report.undoIds });
      setBulkWarnings(report.warnings.length ? { warnings: report.warnings, press: { ...input, completedIds: report.undoIds, previousFailures: report.failures } } : null);
      if (report.warnings.length && !report.done && !report.failures.length) return;
      // The draft warning is still said, on the same line as the count and its Undo.
      const summary = [bulkStatusSummary(report), report.drafted.length ? bulkWarningSentence(report.drafted) : ""].filter(Boolean).join(" ");
      deskToast(summary, {
        tone: report.failures.length ? "err" : "ok",
        // One line that updates, not a stack that disagrees with itself.
        id: BULK_STATUS_TOAST_ID,
        // DHC08: a bulk Kill keeps the same Undo window as a single kill (the
        // single kill's toast is KILL_TOAST_MS for the same reason).
        duration: input.status === "killed" ? KILL_TOAST_MS : undefined,
        undo:
          report.undoIds.length > 0
            ? {
                label: BULK_STATUS_UNDO_LABEL,
                run: async () => {
                  if (input.status === "killed") {
                    if (lastKill.current?.bulk) lastKill.current = null;
                    await undoBulkKill(Promise.resolve({ undoIds: report.undoIds }), (id) =>
                      undoKill.mutateAsync(killUndoPress(id, input.restores?.[id])),
                    );
                    return;
                  }
                  const back = await Promise.allSettled(
                    report.undoIds.map((id) => setStatus.mutateAsync({ id, status: "new", override: input.overrideById?.[id] })),
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
      bulkKillReport.current?.settle({ undoIds: [] });
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
  // DLG-2: Escape does what Keep does, for both bulk confirms. Keep on the
  // delete confirm is disabled while the delete is saving, so Escape waits too.
  useEscapeToCancel(bulkKillReason !== null, () => setBulkKillReason(null));
  useEscapeToCancel(confirmingBulkDelete && !bulkRemove.isPending, () =>
    setConfirmingBulkDelete(false),
  );
  /*
    THU-4: the Undo for a bulk Kill, whether the toast's button or the U key
    presses it. It waits for the batch's own report, so it works the moment the
    toast shows, and puts back exactly the leads that press killed.
  */
  const runBulkKillUndo = async () => {
    const pending = bulkKillReport.current;
    if (!pending) return;
    lastKill.current = null;
    const restoringId = "desk-restoring-bulk";
    deskToast("Restoring…", { id: restoringId, duration: Infinity });
    try {
      await undoBulkKill(pending.promise, (id) => undoKill.mutateAsync(killUndoPress(id, bulkRestores.current[id])));
      deskToast("Undone: the leads are back on the Queue.", { tone: "ok", id: BULK_STATUS_TOAST_ID });
    } catch (error) {
      deskToast(`Could not put those leads back. ${deskErrorReason(error, "put those leads back")}`, { tone: "err", id: BULK_STATUS_TOAST_ID });
    } finally {
      dismissDeskToast(restoringId);
    }
  };
  const bulkRestores = useRef<Record<number, RestoreStatus>>({});
  const bulkSetStatus = (status: "held" | "killed", reason?: string) => {
    const ids = selectedLeads.map((lead) => lead.id);
    if (ids.length === 0) return;
    const restores = Object.fromEntries(selectedLeads.map(l => [l.id, restoreStatus(l.status)]));
    if (status === "killed") {
      /*
        THU-4: the same Undo toast the row Kill shows, at the press and not
        after the round trip; the batch's report replaces it under the same id.
      */
      let settle: (r: { undoIds: number[] }) => void = () => {};
      const promise = new Promise<{ undoIds: number[] }>((resolve) => { settle = resolve; });
      bulkKillReport.current = { promise, settle };
      bulkRestores.current = restores;
      lastKill.current = { id: ids[0], restore: restores[ids[0]], bulk: true };
      // THU-3: the batch is a kill, and the most recent press like any other.
      lastPress.current = { kind: "kill", id: ids[0], restore: restores[ids[0]], bulk: true };
      deskToast(`Killed ${ids.length} lead${ids.length === 1 ? "" : "s"}.`, {
        tone: "ok",
        id: BULK_STATUS_TOAST_ID,
        duration: KILL_TOAST_MS,
        undo: { label: BULK_STATUS_UNDO_LABEL, run: runBulkKillUndo },
      });
    }
    bulkStatus.mutate({
      ids, status, restores,
      ...(status === "killed" && reason !== undefined && reason.trim() ? { killReason: reason.trim() } : {}),
    });
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
          <div className="max-w-sm">
            <ModelPicker
              scope="scan"
              label="Model for this scan"
              value={scanModel}
              onChange={(choice) => {
                scanModelTouched.current = true;
                setScanModel(choice);
                setScanModelEffort(defaultModelEffort(choice));
              }}
              effort={scanModelEffort}
              onEffortChange={setScanModelEffort}
            />
          </div>
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
                f.key === "held" && (f.count ?? 0) > 0
                  ? `${f.count} lead${f.count === 1 ? "" : "s"} waiting on you under Held`
                  : f.key === "printed"
                    ? PRINTED_TAB_NOTE
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
                className={"filter-badge" + (f.key === "held" && (f.count ?? 0) > 0 ? " waiting" : "")}
              >
                {queueTabCountText(f.count)}
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
            placeholder="Search"
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
      {/* THT-11: the Printed count is a duplicate-match count, so the tab says what it counts. */}
      <span className="queue-tab-note">{PRINTED_TAB_NOTE}</span>

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
                  DHB1: this is the picker whose choice the Start press is
                  about to use. The batch dialog below shares the same runtime
                  and effort state, so opening it can still review the exact
                  model this strip selected without a second resolution path.
                */}
                <ModelPicker
                  scope="forced"
                  label="Model for these stories"
                  value={batchRuntime}
                  onChange={pickBatchRuntime}
                  effort={batchEffort}
                  onEffortChange={setBatchEffort}
                  disabled={startBatch.isPending}
                  compact
                />
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
                {/* THT-21: the line under the button says what it does -- it starts AI drafts. */}
                <span className="bulk-start-stack">
                <InkButton
                  disabled={
                    startBatch.isPending || bulkDraftable.length === 0
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
                <span className="bulk-start-note">{BULK_START_NOTE}</span>
                </span>
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
                    bulkSetStatus("held");
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
                    <ul className="queue-delete-reasons">
                      {bulkDeleteReasonLines(selectedLeads).map((lead) => (
                        <li key={lead.id}>
                          <strong>{lead.title}</strong> — {lead.reason}
                        </li>
                      ))}
                    </ul>
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
          Killed tab "best" lists the newest kill first, so a page that holds
          none of the came-back leads is a page the note has nothing to say
          about. */}
      {filter === "killed" && shown.some((l) => (l.resurfaced_count ?? 0) > 0) ? (
        <p className="meta seen-again-note">{SEEN_AGAIN_EXPLAINER}</p>
      ) : null}

      {deleteError ? <Notice kind="err">{deleteError}</Notice> : null}
      {releasedId !== null ? (
        <div className="queue-release-message" role="status">
          <span>Released.</span>
          <InkButton
            tone="quiet"
            pending={setStatus.isPending}
            onClick={() => {
              setStatus.mutate(
                { id: releasedId, status: "held" },
                {
                  onSuccess: (result) => {
                    if (result?.ok) setReleasedId(null);
                  },
                },
              );
            }}
          >
            Undo
          </InkButton>
          <InkButton tone="quiet" onClick={() => setReleasedId(null)}>
            Dismiss
          </InkButton>
        </div>
      ) : null}
      {bulkWarnings ? <div className="queue-bulk" role="status">
        <span>{bulkWarningSentence(bulkWarnings.warnings)}</span>{" "}
        <InkButton disabled={bulkStatus.isPending} onClick={() => {
          const { press, warnings } = bulkWarnings;
          bulkStatus.mutate(bulkDeskRetry(press, warnings));
        }}>{bulkWarnings.press.status === "killed" ? "Kill all anyway" : "Hold all anyway"}</InkButton>
      </div> : null}
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
            {/* BF4, defect 2 / UI1b-9: same box as every row's own -- the
                drawn 24px mark (a 2px outline at rest, an ink fill when picked)
                inside the 44px press area (see `.queue-check` in
                desk-astra.css). This box has no indeterminate state: it is
                `checked={allShownSelected}`, and the bulk bar already prints
                the count when only some rows are picked. */}
            <label className="queue-check">
              <input
                type="checkbox"
                className="queue-pick"
                checked={allShownSelected}
                aria-label={`Select all${bulkSelectLabel(filter) ? ` ${bulkSelectLabel(filter)}` : ""} leads shown (${shown.length})`}
                onChange={(event) => {
                  setConfirmingBulkDelete(false);
                  setBulkDeleteNotice("");
                  setSelectedDeleteLeadIds(queueSelectAllShown(shownIds, event.target.checked));
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
          {/* THU-2 / DHK-2: `queue-toast-room` reserves the foot of the list for
              the fixed bottom-left toast stack, so a kill's toast (chips, Undo)
              never covers the rows it is about. See desk-astra.css. */}
          <div className="lead-list roomy queue-toast-room">
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
                  sectionName={sectionDisplayName(l.topic, sections)}
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
                    `onHold` is passed too, as the plain "Hold (no reason)"
                    (TKA-2), so the two Hold presses read apart. `onKill` is not
                    passed: this menu's kill row is the drawn "Kill with a
                    reason" below.
                  */
                  onBack={() => (l.status === "killed"
                    ? undoKill.mutate(bringBackPress(l.id))
                    : setStatus.mutate({ id: l.id, status: "new", release: l.status === "held" }))}
                  /*
                    FB6, item 5: the row's own Release / Bring back says what it
                    is doing while it does it, and carries the failure sentence.
                    The state is the screen's because the mutation is.
                  */
                  backPending={setStatus.isPending && setStatus.variables?.id === l.id}
                  /*
                    TIA-2: a Hold carries where it goes back to, the way the
                    Kill beside it does. The toast's own Undo reads it, so
                    "Release" is not the only way off a hold that took.
                  */
                  onHold={() => setStatus.mutate(holdLead(l))}
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
                  /*
                    Owner, 2026-10-03, the fast kill: the row's own inline Kill.
                    One press, no dialog, with the Undo and the optional reason
                    chips on the toast it raises (`fast-kill.ts`). The menu's
                    "Kill with a reason" above stays for the editor who wants to
                    write the sentence before killing.
                  */
                  onKillNow={() => setStatus.mutate(killLead(l))}
                  /*
                    Only THIS row's kill is pending. A hold on the same lead (or a
                    kill on another) must not put "Killing…" on this button.
                  */
                  killPending={
                    setStatus.isPending &&
                    setStatus.variables?.id === l.id &&
                    setStatus.variables?.status === "killed"
                  }
                  onKillAsDuplicate={
                    /* Unit AK item 4: the reason names the piece the desk matched,
                   so the kill record on the story page means something to
                   whoever reads it next. */
                    dupMatch
                      ? async () => {
                          return await killAsDuplicate.mutateAsync({
                            id: l.id,
                            restore: restoreStatus(l.status),
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
                  bulkDeleteReason={bulkDeleteReasons[l.id] ?? null}
                  deleteSelected={selectedDeleteLeads.includes(l.id)}
                  onDeleteSelect={(selected) => {
                    setCursor(index);
                    setConfirmingBulkDelete(false);
                    setBulkDeleteNotice("");
                    setSelectedDeleteLeadIds((ids) => queueRowTick(ids, l.id, selected));
                  }}
                  onDraft={(modelChoice, modelEffort, modelChoiceExplicit) => {
                    setDraftNotices((notices) => {
                      const next = { ...notices };
                      delete next[l.id];
                      return next;
                    });
                    queueDraft.mutate({ leadId: l.id, modelChoice, modelEffort, modelChoiceExplicit });
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
                  {sectionDisplayName(t, sections)}
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
        subtitle="Choose leads and one writing runtime. A usual batch has one to five leads; a larger batch asks for your approval. Each lead keeps its own stored research scope."
        primaryLabel={
          batchQueuedNow
            ? "Batch started"
            : startBatch.isPending
              ? "Starting…"
              : `Start ${selectedBatchLeads.length} ${selectedBatchLeads.length === 1 ? "story" : "stories"}`
        }
        primaryDisabled={
          newsroomId === null ||
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
            { leadIds, runtime: batchRuntime, modelEffort: batchEffort, modelChoiceExplicit: batchRuntimeTouched.current },
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
              Add suggested focus ({Math.min(focusAddable.length, Math.max(0, 5 - selectedBatchLeads.length))})
            </InkButton>
          </div>
          <ModelPicker
            scope="forced"
            label="Model for these stories"
            value={batchRuntime}
            onChange={pickBatchRuntime}
            effort={batchEffort}
            onEffortChange={setBatchEffort}
            disabled={startBatch.isPending}
            compact
          />
          <p className="meta">{selectedBatchLeads.length} selected; usual batch: 1 to 5</p>
          {/*
            FB24 (Oct 11 walk): the bar said "Start 1 story" and this dialog said
            0 with no reason. Say why the count differs from the bar's.
          */}
          {batchPoolPending ? (
            <p className="meta" role="status">Loading the leads you selected…</p>
          ) : batchLeadIds.length > selectedBatchLeads.length ? (
            <p className="meta" role="status">
              {batchLeadIds.length - selectedBatchLeads.length} of the {batchLeadIds.length} leads you
              selected {batchLeadIds.length - selectedBatchLeads.length === 1 ? "is" : "are"} not on the desk any more, so
              {batchLeadIds.length - selectedBatchLeads.length === 1 ? " it is" : " they are"} not in this batch.
            </p>
          ) : null}
          {/*
            DHD1-2: the strip behind has the same "Model for these stories"
            choice. Both read one state, so this line says so on screen.
          */}
          <p className="meta">Same choice as the strip behind: changing either one changes both, and Start runs the model shown here.</p>
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
                      queueDraft.mutate({ leadId: item.leadId, modelChoice: batchRuntime, modelEffort: batchEffort, modelChoiceExplicit: batchRuntimeTouched.current, fromBatch: true });
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
            // TIA-2: the dialog holds the lead this screen just held, so the U
            // key knows the hold it is taking back is this screen's own press.
            heldFrom.current.add(holdFor.id);
            /*
              THU-3, THE WALK'S SECOND FINDING. The row menu's "Hold with a
              reason" writes through the dialog's own call, which does not touch
              `lastPress` -- so the menu's Hold was the one hold on this screen
              the U key could not see, and the walk's U after a menu Hold did
              nothing at all. `holdLeadById` stamps the same press the row's own
              Hold and the keyboard's H do, carrying the status the row held
              before the dialog was opened, so all three leave one way back.
            */
            holdLeadById(holdFor.id);
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
          leadStatus={killFor.status}
          onRestored={() => qc.invalidateQueries({ queryKey: ["leads"] })}
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
