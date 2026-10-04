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
 *   - and it moves the ROW between the Queue's server-filtered tabs (B8B item
 *     1). The tab's rows are a list the server already narrowed, so rewriting a
 *     row's status inside the Open page left a held lead drawn under Open until
 *     the refetch landed; a list that knows which tab it is showing is told to
 *     drop a row its new status no longer matches and to take in one it now
 *     does (see `leadsViewFor` and `LeadsPatch`);
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

/**
 * The statuses a row's own press can move a lead between.
 *
 * `drafted` is the fourth, and it arrives by exactly one route: the Undo of a
 * kill putting a drafted lead back where it was (owner, 2026-10-03 -- before
 * this, that Undo restored `new` and orphaned the lead's draft). No other press
 * moves a lead INTO `drafted`; the desk's own drafting pass writes it, and the
 * row's press sites never name it. Widening this union is safe for the patch
 * below: `drafted` falls through `tabFor` and `matchesTab` exactly as `new`
 * does, because a lead with a draft is still an open lead.
 */
export type LeadStatusMove = "held" | "killed" | "new" | "drafted";

/**
 * The three Queue tabs a lead's own status decides.
 *
 * `printed` is a duplicate match against the published list and `all` is every
 * lead the newsroom holds, so neither is a tab a Hold, a Kill or an Undo moves
 * a row in or out of -- see `tabFor` below.
 */
export type StatusTab = "open" | "held" | "killed";

/** The Queue page's tab numbers, in the shape the page holds them. */
type Counts = { open?: number; held?: number; killed?: number; all?: number };

type Leadish = { id?: number; status?: string; headline?: string; why?: string | null; topic?: string | null };

/**
 * What the cached list being patched is SHOWING, read off its own query key.
 *
 * This is the half FB0's Queue unit was missing. The status patch below always
 * moved the row's status inside whatever cache held it, but the Queue's tabs are
 * filtered on the SERVER: the Open tab's page is a list the server already
 * narrowed to open leads, so a row that reads Held inside it is a held row
 * sitting in the Open tab until the refetch lands -- the row the owner watched
 * "go back and forth" (B8B item 1). A list that can say what it is a list OF
 * can be told the row no longer belongs in it.
 */
export type LeadsPatch = {
  /** The status tab this cached list is showing, when it is one. */
  filter?: StatusTab;
  /** The sort it is in, kept so a rollback can put an arriving row back. */
  sort?: string;
  section?: string;
  search?: string;
  /**
   * The row itself, which only a move INTO a cached tab needs: a list that
   * never held the lead cannot invent it, so the caller hands over the copy it
   * read out of the cache that did.
   */
  incoming?: Leadish;
};

/** What `optimistic` remembers, and what `rollback` is handed back. */
export type LeadStatusUndo = {
  id: number;
  moves: {
    key: readonly unknown[];
    /** The status the lead carried before the press. */
    previous: string;
    /** The status the press wrote, which is what a rollback moves away from. */
    next: LeadStatusMove;
    /** The row as it stood before the press, for putting it back in a list. */
    row: Leadish;
    view: LeadsPatch;
  }[];
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
 * One cached answer with one lead's status moved IN, OUT or ACROSS.
 *
 * Two shapes live under the `["leads"]` prefix and both move: Today's
 * `listLeads()` is a bare array and every lead belongs in it, and the Queue's
 * `listQueuePage()` is `{rows, total, counts}` -- a window onto ONE tab.
 *
 * `from` is the status the lead carried a moment ago and `status` is the one it
 * is being moved to; the tab numbers move between `tabFor(from)` and
 * `tabFor(status)`, and `total` follows the rows. It has to be passed rather
 * than read off the row, because at rollback time the row already holds the
 * optimistic status -- or is not in the list at all.
 *
 * What `patch.filter` adds: a list that is showing a status tab and whose filter
 * the row no longer satisfies DROPS the row (a held lead has no business in the
 * Open tab); a list showing the tab the row is arriving in GAINS it, inserted at
 * the front, which is where the row the editor just moved belongs until the
 * invalidation that follows re-sorts it properly. A list with no tab (Today, the
 * batch pool) is left holding the row and only has its status rewritten -- it is
 * not filtered by status, so a move cannot take the row out of it.
 */
export function patchLeadsData(
  data: unknown,
  id: number,
  status: LeadStatusMove,
  from: string | undefined,
  patch: LeadsPatch = {},
): unknown {
  const rows = rowsOf(data);
  if (!rows) return data;

  const index = rows.findIndex((row) => isLead(row, id));
  const held = index >= 0 ? rows[index] : undefined;
  // The row as the move would leave it: the one in this list, or -- for a list
  // it is arriving in -- the copy handed over by the caller.
  const source = held ?? patch.incoming;
  const moved = source ? { ...source, status } : undefined;
  const stays = moved ? matchesTab(moved, patch.filter) && matchesView(moved, patch) : false;

  let nextRows = rows;
  let delta = 0;
  if (held && moved && stays) {
    nextRows = rows.map((row, at) => (at === index ? moved : row));
  } else if (held) {
    // The row is in a list its new status no longer qualifies for.
    nextRows = rows.filter((_, at) => at !== index);
    delta = -1;
  } else if (moved && stays && patch.filter !== undefined) {
    // Arriving in a tab this cache is holding -- but only a tab, never Today's
    // whole list or the batch pool, which have no filter to arrive in.
    nextRows = [moved, ...rows];
    delta = 1;
  }

  if (Array.isArray(data)) return nextRows;

  const page = data as { rows: Leadish[]; counts?: Counts; total?: number };
  const out: { rows: Leadish[]; counts?: Counts; total?: number } = { ...page, rows: nextRows };
  if (delta !== 0 && typeof out.total === "number") out.total = Math.max(0, out.total + delta);
  if (out.counts && from !== undefined && from !== status) {
    const outOf = tabFor(from);
    const into = tabFor(status);
    if (outOf && into && outOf !== into) out.counts = shiftTabCounts(out.counts, outOf, into);
  }
  return out;
}

/**
 * Whether a lead's own status qualifies it for the tab a list is showing.
 *
 * `undefined` (a list with no status tab at all) keeps everything, and so do
 * `printed` and `all` by omission -- they are not statuses, so a status move can
 * neither put a row into them nor take one out. Only the three the Queue's pills
 * are named for can be decided from a status, so only those are decided.
 *
 * `open` is `openLeads` (desk-copy.ts), spelled out rather than imported: this
 * module is loaded by a test harness that cannot resolve the `@/` alias, and a
 * rule this short is cheaper to keep honest than an import that breaks the file.
 */
function matchesTab(row: Leadish, filter: StatusTab | undefined): boolean {
  if (filter === "held") return row.status === "held";
  if (filter === "killed") return row.status === "killed";
  if (filter === "open")
    return row.status !== "killed" && row.status !== "published" && row.status !== "held";
  return true;
}

function matchesView(row: Leadish, view: LeadsPatch): boolean {
  if (view.section && view.section !== "all" && row.topic !== view.section) return false;
  const needle = view.search?.trim().toLowerCase();
  return !needle || `${row.headline ?? ""} ${row.why ?? ""} ${row.topic ?? ""}`.toLowerCase().includes(needle);
}

/**
 * The tab and sort a cached list under `["leads"]` is showing, read off the
 * key the Queue builds (`["leads", filter, section, sort, search, shown]`).
 *
 * Anything that is not one of the three status tabs -- Today's bare `["leads"]`,
 * the Queue's `["leads", "batch-pool"]`, a key from a screen with its own
 * parameters -- answers with no filter, and a list with no filter is never
 * asked to drop a row.
 */
export function leadsViewFor(key: readonly unknown[]): LeadsPatch {
  const filter = key.length > 1 ? key[1] : undefined;
  if (!isStatusTab(filter) && filter !== "all" && filter !== "printed") return {};
  const sort = typeof key[3] === "string" ? key[3] : undefined;
  const section = typeof key[2] === "string" ? key[2] : undefined;
  const search = typeof key[4] === "string" ? key[4] : undefined;
  return { filter: isStatusTab(filter) ? filter : undefined, sort, section, search };
}

function isStatusTab(value: unknown): value is StatusTab {
  return value === "open" || value === "held" || value === "killed";
}

/** The row itself, as some cache holds it, or undefined. */
function rowIn(data: unknown, id: number): Leadish | undefined {
  return rowsOf(data)?.find((row) => row?.id === id);
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
  return rowIn(data, id)?.status;
}

/**
 * Move one lead's status in every `["leads"]` cache, and remember how to put it
 * back. The two halves are handed to `useDeskMutation` as `optimistic` and
 * `rollback`; see this module's header for why the undo is per lead.
 *
 *   const setStatus = useDeskMutation({ ..., ...leadStatusOptimistic(qc) });
 *
 * THE ROW THE LISTS DO NOT ALL HOLD. The lead is read once, out of whichever
 * cache still has it, because a tab the row is ARRIVING in cannot patch itself:
 * the Held tab, cached and showing held leads, has never heard of the open lead
 * being held into it. The copy read here is what gets inserted there, with its
 * status already moved, so both halves of the move land in the same write.
 *
 * A list is only written when the move changes it -- the row moves, or leaves,
 * or arrives -- so a cache with nothing to say is left alone and its rollback
 * has nothing to undo.
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
  const entries = qc.getQueriesData({ queryKey: LEADS_KEY });
  const from = entries.map(([, data]) => statusIn(data, id)).find((s) => s !== undefined);
  if (from === undefined || from === status) return;
  const row = entries.map(([, data]) => rowIn(data, id)).find((r) => r !== undefined);
  for (const [key, data] of entries) {
    const view = leadsViewFor(key);
    if (!touches(data, id, status, view)) continue;
    qc.setQueryData(key, patchLeadsData(data, id, status, from, { ...view, incoming: row }));
  }
}

/**
 * Whether a move would change this cached list at all: the row is in it and
 * moves, or it is not in it and now belongs to the tab it is showing.
 */
function touches(data: unknown, id: number, status: LeadStatusMove, view: LeadsPatch): boolean {
  if (rowIn(data, id)) return true;
  return view.filter !== undefined && matchesTab({ id, status }, view.filter);
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
      const entries = qc.getQueriesData({ queryKey: LEADS_KEY });
      // A lead no cache has ever held has nothing to move or to put back --
      // writing a status into a list would be inventing a row.
      const from = entries.map(([, data]) => statusIn(data, id)).find((s) => s !== undefined);
      if (from === undefined || from === status) return { id, moves: [] };
      const row = entries.map(([, data]) => rowIn(data, id)).find((r) => r !== undefined) ?? { id };

      const moves: LeadStatusUndo["moves"] = [];
      for (const [key, data] of entries) {
        const view = leadsViewFor(key);
        if (!touches(data, id, status, view)) continue;
        moves.push({ key, previous: from, next: status, row, view });
        qc.setQueryData(key, patchLeadsData(data, id, status, from, { ...view, incoming: row }));
      }
      return { id, moves };
    },
    rollback: (context) => {
      const undo = context as LeadStatusUndo | undefined;
      if (!undo || !Array.isArray(undo.moves)) return;
      for (const { key, previous, next, row, view } of undo.moves) {
        const data = qc.getQueryData(key);
        // `next` is the status the list is holding -- or, for a row the move
        // took out of it, the status it was taken out by -- so the tab numbers
        // move back the way they came and the row returns where it was.
        qc.setQueryData(
          key,
          patchLeadsData(data, undo.id, previous as LeadStatusMove, next, { ...view, incoming: row }),
        );
      }
    },
  };
}
