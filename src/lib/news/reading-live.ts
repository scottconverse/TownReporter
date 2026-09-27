/*
  "Reading right now", in memory and nowhere else.

  The Stats page's top panel (docs/design/handoff-2026-09-26/design/Desk
  Stats.dc.html, "Reading right now") shows how many people are on the paper
  this minute, which pages they are on, how long they have been there, a
  thirty-bar sparkline and how that compares with half an hour ago.

  THE ONE RULE. None of that is written down. There is no table for it, no log
  line, no file. It lives in the Maps below, in this process's memory, for as
  long as the beats keep arriving and not one minute longer; restart the server
  and it is empty.

  WHY THERE IS NO TOKEN. The handoff sketched a per-tab random token so the
  server could tell two readers apart (KICKOFF.md, "Stats v2 reading
  beacon"). This unit's brief rules that out -- "never written with any
  per-reader key" -- and the browser test asserts that no request carries an
  id. So the window counts BEATS, not tabs: a visible page sends one every
  fifteen seconds, so four beats a minute is one reader. Two readers on the
  same story in the same minute are eight beats and estimate as two; one reader
  who has just arrived is one beat and estimates as one.

  That estimate is why the page prints "updates every 15 seconds" next to the
  number and why the "How it's counted" box says readers are estimated from
  anonymous heartbeats. It is honest about being an estimate; it is not
  pretending to be a headcount.
*/

import type { ReadDevice, ReadRefClass } from "./reading.ts";

/** How long a single beat keeps a reader in the window. */
const PRESENCE_MS = 60_000;
/** The sparkline and the "30 minutes ago" comparison both span this. */
export const LIVE_WINDOW_MINUTES = 30;
const WINDOW_MS = LIVE_WINDOW_MINUTES * 60_000;
/** One beat every 15 seconds -> four beats a minute per reader. */
const BEATS_PER_READER_PER_MINUTE = 4;
const MINUTE_MS = 60_000;
/**
 * A ceiling on remembered beats. Four beats a minute for thirty minutes is 120
 * beats per reader on a page; this is far above any real small paper and keeps
 * a hostile client from growing the process's memory without bound. The oldest
 * beats are dropped first.
 */
const MAX_BEATS = 20_000;
/** Ceiling on remembered arrivals, same reasoning. */
const MAX_ARRIVALS = 5_000;

type Beat = { at: number; seconds: number; device: ReadDevice };
type Arrival = { at: number; refClass: ReadRefClass };

/*
  The window is held on `globalThis` rather than in module scope for the same
  reason src/lib/pglite.ts holds the database there: Vite's dev server and HMR
  re-evaluate a module on edit, and module scope would hand the new copy an
  empty window while the old copy's beats were still live. One object, created
  once, found again by every evaluation.
*/
type LiveWindow = {
  beatsByPath: Map<string, Beat[]>;
  arrivals: Arrival[];
  beatCount: number;
};

const LIVE_KEY = "__trReadingLiveWindow__";

function liveWindow(): LiveWindow {
  const holder = globalThis as unknown as Record<string, LiveWindow | undefined>;
  const existing = holder[LIVE_KEY];
  if (existing) return existing;
  const created: LiveWindow = { beatsByPath: new Map(), arrivals: [], beatCount: 0 };
  holder[LIVE_KEY] = created;
  return created;
}

function readersFromBeats(count: number): number {
  if (count <= 0) return 0;
  return Math.max(1, Math.round(count / BEATS_PER_READER_PER_MINUTE));
}

function prune(now: number): void {
  const live = liveWindow();
  const oldest = now - WINDOW_MS;
  for (const [path, list] of live.beatsByPath) {
    let keep = 0;
    while (keep < list.length && list[keep]!.at < oldest) keep += 1;
    if (keep > 0) {
      list.splice(0, keep);
      live.beatCount -= keep;
    }
    if (list.length === 0) live.beatsByPath.delete(path);
  }
  if (live.beatCount > MAX_BEATS) {
    // Drop whole buckets of the oldest beats until the total fits. Approximate
    // by design: this only ever runs when the window is far past any real
    // traffic, and the numbers it feeds are estimates already.
    for (const [path, list] of live.beatsByPath) {
      if (live.beatCount <= MAX_BEATS) break;
      const drop = Math.min(list.length, live.beatCount - MAX_BEATS);
      list.splice(0, drop);
      live.beatCount -= drop;
      if (list.length === 0) live.beatsByPath.delete(path);
    }
  }
  const cutoff = now - WINDOW_MS;
  const firstKeep = live.arrivals.findIndex((a) => a.at >= cutoff);
  if (firstKeep > 0) live.arrivals = live.arrivals.slice(firstKeep);
  if (live.arrivals.length > MAX_ARRIVALS) {
    live.arrivals = live.arrivals.slice(live.arrivals.length - MAX_ARRIVALS);
  }
}

/**
 * One heartbeat: this page is still being read, and this is the active time so
 * far. Called from the beacon handler; never written to a database.
 */
export function noteLiveBeat(
  input: { path: string; seconds: number; device: ReadDevice },
  now: number = Date.now(),
): void {
  const live = liveWindow();
  const list = live.beatsByPath.get(input.path) ?? [];
  list.push({ at: now, seconds: input.seconds, device: input.device });
  live.beatCount += 1;
  live.beatsByPath.set(input.path, list);
  prune(now);
}

/** One arrival: a page load, by class. Powers "Arriving from, right now". */
export function noteLiveArrival(refClass: ReadRefClass, now: number = Date.now()): void {
  const live = liveWindow();
  live.arrivals.push({ at: now, refClass });
  prune(now);
}

export type LivePage = { path: string; readers: number; avgSeconds: number };
export type LiveArrivalRow = { refClass: ReadRefClass; count: number };
export type LiveDeviceRow = { device: ReadDevice; readers: number; pct: number };

export type LiveSnapshot = {
  /** Estimated readers on the paper this minute. */
  readers: number;
  /**
   * Readers now, less the estimate for the oldest minute in the window. Not a
   * stored count of anything -- a difference of two estimates.
   */
  changeFrom30MinAgo: number;
  /** Readers per minute, oldest first, exactly LIVE_WINDOW_MINUTES entries. */
  perMinute: number[];
  pages: LivePage[];
  arrivals: LiveArrivalRow[];
  devices: LiveDeviceRow[];
  windowMinutes: number;
  beatSeconds: number;
};

/**
 * The window as of `now`. Pure read -- prunes what has aged out and computes,
 * writes nothing anywhere.
 */
export function liveSnapshot(now: number = Date.now()): LiveSnapshot {
  prune(now);
  const live = liveWindow();
  const presenceCutoff = now - PRESENCE_MS;
  const pages: LivePage[] = [];
  let readers = 0;
  const deviceBeats: Record<string, number> = {};

  for (const [path, list] of live.beatsByPath) {
    const recent = list.filter((beat) => beat.at >= presenceCutoff);
    if (recent.length === 0) continue;
    const pathReaders = readersFromBeats(recent.length);
    readers += pathReaders;
    const totalSeconds = recent.reduce((sum, beat) => sum + beat.seconds, 0);
    pages.push({
      path,
      readers: pathReaders,
      avgSeconds: Math.round(totalSeconds / recent.length),
    });
    for (const beat of recent) deviceBeats[beat.device] = (deviceBeats[beat.device] ?? 0) + 1;
  }
  pages.sort((a, b) => b.readers - a.readers || a.path.localeCompare(b.path));

  const devices: LiveDeviceRow[] = [];
  const deviceTotal = Object.values(deviceBeats).reduce((sum, n) => sum + n, 0);
  if (deviceTotal > 0) {
    const rows = (["phone", "tablet", "computer"] as const)
      .map((device) => ({ device, share: (deviceBeats[device] ?? 0) / deviceTotal }))
      .filter((row) => row.share > 0);
    // Distribute the estimated reader count by each device's share of the
    // beats, largest first, so the percentages and the rows agree with the
    // number printed above them.
    let assigned = 0;
    rows.sort((a, b) => b.share - a.share);
    rows.forEach((row, index) => {
      const count =
        index === rows.length - 1 ? Math.max(0, readers - assigned) : Math.round(readers * row.share);
      assigned += count;
      devices.push({
        device: row.device,
        readers: count,
        pct: readers > 0 ? Math.round((count / readers) * 100) : 0,
      });
    });
  }

  const perMinute: number[] = [];
  for (let index = LIVE_WINDOW_MINUTES - 1; index >= 0; index -= 1) {
    const from = now - (index + 1) * MINUTE_MS;
    const to = now - index * MINUTE_MS;
    let count = 0;
    for (const list of live.beatsByPath.values()) {
      for (const beat of list) if (beat.at >= from && beat.at < to) count += 1;
    }
    perMinute.push(readersFromBeats(count));
  }
  if (perMinute.length > 0) perMinute[perMinute.length - 1] = readers;

  const arrivalsByClass = new Map<ReadRefClass, number>();
  const arrivalCutoff = now - WINDOW_MS;
  for (const arrival of live.arrivals) {
    if (arrival.at < arrivalCutoff) continue;
    arrivalsByClass.set(arrival.refClass, (arrivalsByClass.get(arrival.refClass) ?? 0) + 1);
  }
  const arrivalRows = [...arrivalsByClass.entries()]
    .map(([refClass, count]) => ({ refClass, count }))
    .sort((a, b) => b.count - a.count);

  return {
    readers,
    changeFrom30MinAgo: readers - (perMinute[0] ?? 0),
    perMinute,
    pages,
    arrivals: arrivalRows,
    devices,
    windowMinutes: LIVE_WINDOW_MINUTES,
    beatSeconds: 15,
  };
}

/** Tests only: forget the window. */
export function resetLiveWindow(): void {
  const live = liveWindow();
  live.beatsByPath.clear();
  live.arrivals = [];
  live.beatCount = 0;
}
