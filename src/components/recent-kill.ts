/**
 * The killed lead's own row, held in place for the same eight seconds as the
 * kill strip.
 *
 * Owner, 2026-10-28: five leads were killed and the strip was never noticed.
 * The strip can arrive after the save, and the Open list drops the row at the
 * press. This module is the small piece of state between those two facts: the
 * press records the row before React Query moves it, and the screen draws that
 * snapshot in the row's old place until the strip's own deadline.
 *
 * The deadline is deliberately `KILL_TOAST_MS`, not another number that could
 * drift from it. `mergeRecentlyKilled` is pure so a test can prove the open row
 * survives the optimistic move and then leaves on time.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { KILL_TOAST_MS, type RestoreStatus } from "./fast-kill.ts";

export type RecentlyKilled<T extends { id: number }> = {
  row: T;
  /** Where the row stood when the press happened, so it returns to that place. */
  index: number;
  restore: RestoreStatus;
  killedAt: number;
};

export type RecentlyKilledMap<T extends { id: number }> = ReadonlyMap<number, RecentlyKilled<T>>;

/** Add or replace one kill, with the moment that starts its eight-second life. */
export function addRecentlyKilled<T extends { id: number }>(
  current: RecentlyKilledMap<T>,
  row: T,
  index: number,
  restore: RestoreStatus,
  now = Date.now(),
): RecentlyKilledMap<T> {
  const next = new Map(current);
  next.set(row.id, { row, index, restore, killedAt: now });
  return next;
}

/** Remove one row, used by Undo and by an optimistic rollback after a failed save. */
export function removeRecentlyKilled<T extends { id: number }>(
  current: RecentlyKilledMap<T>,
  id: number,
): RecentlyKilledMap<T> {
  if (!current.has(id)) return current;
  const next = new Map(current);
  next.delete(id);
  return next;
}

/** Is this kill still inside the row-message window? */
export function recentlyKilledActive(
  entry: Pick<RecentlyKilled<{ id: number }>, "killedAt"> | undefined,
  now = Date.now(),
): boolean {
  return entry !== undefined && now - entry.killedAt < KILL_TOAST_MS;
}

/** The recent kills that belong on one of the status tabs they were pressed from. */
export function recentlyKilledForTab<T extends { id: number }>(
  current: RecentlyKilledMap<T>,
  tab: "open" | "held",
): RecentlyKilledMap<T> {
  return new Map(
    [...current].filter(([, entry]) => (entry.restore === "held") === (tab === "held")),
  );
}

/**
 * Put active killed rows back into the Open page after the optimistic update
 * removed them.
 *
 * Existing rows keep their current order. A missing row is inserted at the
 * index it occupied at the press, after earlier missing rows have been put
 * back, so a bulk kill leaves the table in the same order it had before.
 */
export function mergeRecentlyKilled<T extends { id: number }>(
  rows: readonly T[],
  recent: RecentlyKilledMap<T>,
  now = Date.now(),
): T[] {
  const result = [...rows];
  const present = new Set(result.map((row) => row.id));
  const missing = [...recent.values()]
    .filter((entry) => recentlyKilledActive(entry, now) && !present.has(entry.row.id))
    .sort((a, b) => a.index - b.index || a.killedAt - b.killedAt || a.row.id - b.row.id);

  for (const entry of missing) {
    const at = Math.max(0, Math.min(entry.index, result.length));
    result.splice(at, 0, entry.row);
    present.add(entry.row.id);
  }
  return result;
}

/**
 * React state and timers for the row messages.
 *
 * `markKilled` is called from the mutation's optimistic half, before its first
 * await, so the row changes in the same paint as the press. Each row gets its
 * own timer; a second kill of the same id replaces the timer and the deadline.
 */
export function useRecentlyKilledRows<T extends { id: number }>() {
  const [recent, setRecent] = useState<RecentlyKilledMap<T>>(() => new Map());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const clearTimer = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const clearKilled = useCallback((id: number) => {
    clearTimer(id);
    setRecent((current) => removeRecentlyKilled(current, id));
  }, [clearTimer]);

  const markKilled = useCallback((row: T, index: number, restore: RestoreStatus) => {
    clearTimer(row.id);
    setRecent((current) => addRecentlyKilled(current, row, index, restore));
    const timer = setTimeout(() => {
      timers.current.delete(row.id);
      setRecent((current) => removeRecentlyKilled(current, row.id));
    }, KILL_TOAST_MS);
    timers.current.set(row.id, timer);
  }, [clearTimer]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
  }, []);

  return { recent, markKilled, clearKilled };
}
