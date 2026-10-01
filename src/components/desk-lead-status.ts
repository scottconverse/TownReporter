/**
 * The optimistic half of a Hold, a Kill and an Undo — one rule, both screens.
 *
 * README "Interactions & behavior", State: "the selected lead index and
 * per-lead pending status (optimistic Held/Killed with Undo until the server
 * confirms)". The desk drew neither half: the row sat exactly as it was until
 * the round trip landed, and Today's list and the Queue's table each held their
 * own idea of what a lead's status was, so the same press had to be wired twice
 * if it was to be wired at all. FB0-Report Table B calls the result "not
 * optimistic (README:484)" on both screens.
 *
 * This module is that rule, in one place:
 *
 *   - it patches EVERY `["leads"]`-prefixed cache the screen is holding, so
 *     Today's `listLeads()` array and the Queue's windowed page move together
 *     and neither can be the one that did not hear about the press;
 *   - it moves the Queue's own tab COUNTS in the same write, because a row that
 *     leaves "Open" while the Open pill still counts it is the same lie one
 *     line up (FB6, owner report 7a);
 *   - and it remembers the one thing needed to put it back, so a failure
 *     restores the row rather than leaving a held lead held while the toast
 *     says the hold did not happen.
 *
 * WHY THE WAY BACK IS A STATUS AND NOT A SNAPSHOT. The obvious optimistic
 * shape -- save every matching cache entry, write them all back on failure --
 * is wrong the moment two presses overlap, which is exactly what the bulk strip
 * does: twelve `setStatus` calls run at once, the first one's snapshot is taken
 * before any of them landed, and a failure on lead 1 would write that snapshot
 * back over the eleven that had already moved. So the undo is per lead: the
 * status that lead had, per cache entry, and putting it back moves nothing else.
 *
 * The two callbacks are handed straight to `useDeskMutation`'s `optimistic` /
 * `rollback` (desk-action.ts) -- this is not a second pattern, it is the one
 * pattern's optimistic call sites supplied once for both screens.
 */
import type { QueryClient } from "@tanstack/react-query";

/** The three statuses a row's own press can move a lead between. */
export type LeadStatusMove = "held" | "killed" | "new";

/** The Queue page's tab numbers, in the shape the page holds them. */
type Counts = { open?: number; held?: number; killed?: number; all?: number };

type Leadish = { id?: number; status?: string };

/** What `optimistic` remembers, and what `rollback` is handed back. */
export type LeadStatusUndo = {
  id: number;
  moves: { key: readonly unknown[]; previous: string }[];
};

/** The one query key prefix every reader of the leads list shares. */
export const LEADS_KEY = ["leads"] as const;

/**
 * The tab a lead's status puts it in, or null when it belongs to no tab that a
 * Hold, a Kill or an Undo moves.
 *
 * `all` is every lead the newsroom holds and `printed` is a duplicate match
 * rather than a status, so neither of those moves -- and neither does anything
 * unknown, which is why this answers with `keyof Counts` or null rather than
 * guessing.
 *
 * `open` is the lead's own rule (`openLeads`, desk-copy.ts): not killed, not
 * published, not held. A held lead sitting in the Open count is the defect the
 * owner reported (FB6, 7a), so a Hold has to leave it.
 */
function tabFor(status: string): keyof Counts | null {
  if (status === "held") return "held";
  if (status === "killed") return "killed";
  if (status === "published") return null;
  return "open";
}

/** Two tabs with one lead moved between them, never counting below zero. */
export function shiftTabCounts(counts: Counts, from: keyof Counts, to: keyof Counts): Counts {
  const next: Counts = { ...counts };
  if (typeof next[from] === "number") next[from] = Math.max(0, (next[from] ?? 0) - 1);
  if (typeof next[to] === "number") next[to] = (next[to] ?? 0) + 1;
  return next;
}

/**
 * One cached answer with one lead's status moved.
 *
 * Two shapes live under the `["leads"]` prefix and both move: Today's
 * `listLeads()` is a bare array, and the Queue's `listQueuePage()` is
 * `{rows, total, counts}`. Anything else is returned untouched rather than
 * guessed at.
 *
 * `previous` is the status the lead carried a moment ago, and between it and
 * the new one the counts move: OUT of `tabFor(previous)` and INTO
 * `tabFor(status)`. It has to be passed rather than read off the row, because
 * at rollback time the row already holds the optimistic status.
 */
export function patchLeadsData(
  data: unknown,
  id: number,
  status: LeadStatusMove,
  previous: string | undefined,
): unknown {
  const rows = rowsOf(data);
  if (!rows) return data;
  const moved = rows.map((row) => (isLead(row, id) ? { ...row, status } : row));
  if (Array.isArray(data)) return moved;

  const page = data as { rows: Leadish[]; counts?: Counts; total?: number };
  if (!page.counts || previous === undefined || previous === status) return { ...page, rows: moved };
  const from = tabFor(previous);
  const to = tabFor(status);
  if (!from || !to || from === to) return { ...page, rows: moved };
  return { ...page, rows: moved, counts: shiftTabCounts(page.counts, from, to) };
}

/** The array of leads inside either shape, or null when `data` is neither. */
function rowsOf(data: unknown): Leadish[] | null {
  if (Array.isArray(data)) return data as Leadish[];
  if (data && typeof data === "object" && Array.isArray((data as { rows?: unknown }).rows)) {
    return (data as { rows: Leadish[] }).rows;
  }
  return null;
}

function isLead(row: unknown, id: number): row is Leadish {
  return Boolean(row) && typeof row === "object" && (row as Leadish).id === id;
}

/** The status a lead carries in `data` right now, if it can be seen at all. */
export function statusIn(data: unknown, id: number): string | undefined {
  return rowsOf(data)?.find((row) => row?.id === id)?.status;
}

/**
 * Move one lead's status in every `["leads"]` cache, and remember how to put it
 * back. The two halves are handed to `useDeskMutation` as `optimistic` and
 * `rollback`; see this module's header for why the undo is per lead.
 *
 *   const setStatus = useDeskMutation({ ..., ...leadStatusOptimistic(qc) });
 */
/**
 * Move one lead's status in every `["leads"]` cache right now, with no undo.
 *
 * For a press whose confirmation came from a DIALOG rather than from the
 * mutation this module wraps. Hold and Kill on both screens open a dialog that
 * asks why first (the drawn behaviour, and FB0 Table B calls that half OK), so
 * the write lands inside the dialog and the screen hears about it through
 * `onDone`. Waiting for the screen's own refetch before the row moves is the
 * "line going back and forth" the owner opened this unit about -- the row is
 * one press behind the dialog the whole time. The dialog's answer already means
 * the write took, so the row can move on the spot.
 *
 * There is no rollback here, and there is nothing to roll back: the server has
 * answered by the time this is called, and the invalidation that follows it is
 * the check.
 */
export function moveLeadStatusNow(qc: QueryClient, id: number, status: LeadStatusMove): void {
  /*
    N6 of the batch-7 re-audit. A `["leads"]` fetch that started before this
    write lands after it carrying the row's OLD status, and writes it back over
    the top -- the row flips and flips back until something corrects it again.
    The invalidation that follows this call does not save it: React Query does
    not start a second fetch for a key that already has one in flight.

    `cancelQueries` is called first and its promise is deliberately dropped:
    the cancellation itself -- the state revert and the retryer's abort -- is
    synchronous, and the promise only reports that the sweep is over. Awaiting
    it here would put the row's move a microtask behind the dialog that
    confirmed it, which is the flicker this module exists to remove.
  */
  void qc.cancelQueries({ queryKey: LEADS_KEY });
  for (const [key, data] of qc.getQueriesData({ queryKey: LEADS_KEY })) {
    const previous = statusIn(data, id);
    if (previous === undefined || previous === status) continue;
    qc.setQueryData(key, patchLeadsData(data, id, status, previous));
  }
}

export function leadStatusOptimistic(qc: QueryClient): {
  optimistic: (input: { id: number; status: LeadStatusMove }) => Promise<LeadStatusUndo>;
  rollback: (context: unknown, input?: { id: number; status: LeadStatusMove }) => void;
} {
  return {
    /*
      N6 of the batch-7 re-audit, and the React Query optimistic-update pattern
      it names: CANCEL THE IN-FLIGHT READS FIRST. A `["leads"]` fetch that
      started before the press resolves after it carrying the row's old status
      and writes it straight back over the optimistic one -- the row flips Held
      and flips back, which is the "line going back and forth" the owner
      reported, one round trip later. The post-press invalidation does not
      repair it either: React Query will not start a second fetch for a key
      that already has one in flight, so the stale answer IS the answer.

      This is `async` on purpose, and `onMutate` awaits it (`desk-action.ts`),
      so the cancellation is finished before the patch below and the caller's
      undo handle is the value, not a promise of it.
    */
    optimistic: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: LEADS_KEY });
      const moves: LeadStatusUndo["moves"] = [];
      for (const [key, data] of qc.getQueriesData({ queryKey: LEADS_KEY })) {
        const previous = statusIn(data, id);
        // A cache that has never held this lead has nothing to move or to put
        // back -- writing a status into it would be inventing a row.
        if (previous === undefined || previous === status) continue;
        moves.push({ key, previous });
        qc.setQueryData(key, patchLeadsData(data, id, status, previous));
      }
      return { id, moves };
    },
    rollback: (context) => {
      const undo = context as LeadStatusUndo | undefined;
      if (!undo || !Array.isArray(undo.moves)) return;
      for (const { key, previous } of undo.moves) {
        const data = qc.getQueryData(key);
        // Read the status it holds NOW (the optimistic one) so the tab counts
        // move back the way they came.
        qc.setQueryData(
          key,
          patchLeadsData(data, undo.id, previous as LeadStatusMove, statusIn(data, undo.id)),
        );
      }
    },
  };
}
