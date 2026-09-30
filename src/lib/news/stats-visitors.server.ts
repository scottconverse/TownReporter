/*
  "How many readers today", without ever keeping one.

  THE PROBLEM. The Stats page can count page loads and reading time from plain
  sums, because those are properties of a page. "How many people" is not: it is
  a property of a person, and telling two readers apart needs something that
  persists between their two requests. Every usual answer to that -- a cookie,
  a localStorage id, a session, a stored hash -- is an identifier, and the
  owner's decision of 2026-09-30 forbids storing or logging one.

  THE ANSWER. A handle is computed per request, used to answer one yes/no
  question, and thrown away. What is stored is the integer the answers
  produced. In full:

    handle = HMAC-SHA256(salt, ip | uaClass | day)

      salt     32 bytes from the CSPRNG, made when the window is first touched
               and rotated at local-day rollover. It lives in process memory
               only. It is never written to a table, a file, a log line, an
               HTTP response or a backup, and it dies with the process -- so on
               restart the handles from before are not merely unlinkable, they
               are uncomputable by anyone including this server.
      ip       the client address, read from the allowlisted headers
               (src/lib/news/stats-privacy.ts) and used HERE AND NOWHERE ELSE.
               It is not stored and not logged.
      uaClass  one of five words, never the user-agent string itself.
      day      the local calendar day, so the input changes at midnight as
               well as the salt.

    The handle goes into a Set held in memory. Present -> this reader has
    already been counted today and nothing moves. Absent -> the day's counter
    goes up by one and the handle is remembered. The Set is bounded, and it is
    cleared at day rollover and on restart.

  WHY THIS CANNOT IDENTIFY ANYONE, OR LINK TWO DAYS. The digest is never
  stored and never logged, so there is nothing at rest to attack. The salt is
  secret, so a database alone cannot re-derive a handle from an address. The
  salt rotates daily AND dies on restart, so yesterday's handle and today's
  handle for the same reader are unrelated values that cannot be joined even if
  both were somehow observed -- which is the specific property that makes this
  "no cross-day identifier" rather than a persistent one wearing a new name.

  WHAT IT IS NOT. It is not a headcount, and the page says so beside the
  number. The Set is one process wide and empties on restart, so this
  UNDER-COUNTS. Carrier-grade NAT puts many households behind one address and
  rotating IPv6 privacy addresses give one household many, so it is imprecise
  in the other direction too. And a reader who sends no address at all is not
  counted -- never counted some other way.

  ON `globalThis`, like src/lib/news/reading-live.ts and src/lib/pglite.ts: a
  Vite dev-server HMR pass re-evaluates a module, and module scope would hand
  the new copy an empty Set (and a new salt) while the old copy's were still
  live. One object, created once, found again by every evaluation.
*/

import { createHmac, randomBytes } from "node:crypto";

import type { VisitorUaClass } from "./stats-privacy.ts";

/** 32 bytes: far past the point where the salt is the weak part of the HMAC. */
const SALT_BYTES = 32;

/**
 * A ceiling on remembered handles. A small paper's whole day is a few thousand;
 * this is far above any real traffic and stops a hostile client from growing
 * the process's memory without bound. The oldest handles are dropped first,
 * which can only ever cause an extra count -- never a missing one -- and only
 * under traffic this size never sees.
 */
const MAX_HANDLES = 200_000;

const WINDOW_KEY = "__trStatsVisitorWindow__";

type VisitorWindow = {
  /** Local `YYYY-MM-DD`. A change here is the day rollover. */
  day: string;
  /** Never leaves this process. See the docstring. */
  salt: string;
  handles: Set<string>;
};

function holder(): Record<string, VisitorWindow | undefined> {
  return globalThis as unknown as Record<string, VisitorWindow | undefined>;
}

/**
 * The local calendar day. Storage uses the database's `current_date` (the same
 * calendar `page_views.day` is written on, src/lib/news/views.ts); this only
 * decides when the in-memory window rotates, so a server whose clock and
 * database disagree at a boundary rotates a few minutes early or late and
 * counts on the right day either way.
 */
function localDay(now: number): string {
  const at = new Date(now);
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const date = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${date}`;
}

/** The window for `now`, rotating it if the day has turned. */
function windowFor(now: number): VisitorWindow {
  const day = localDay(now);
  const store = holder();
  const existing = store[WINDOW_KEY];
  if (existing && existing.day === day) return existing;
  const created: VisitorWindow = { day, salt: randomBytes(SALT_BYTES).toString("hex"), handles: new Set() };
  store[WINDOW_KEY] = created;
  return created;
}

/**
 * The handle itself: pure, so a test can hold the salt still and watch the day
 * change underneath it. Exported for that test and for nothing else -- no
 * production caller builds a handle except {@link noteVisitor}.
 */
export function visitorHandleFor(input: {
  salt: string;
  ip: string;
  uaClass: VisitorUaClass;
  day: string;
}): string {
  return createHmac("sha256", input.salt)
    .update(`${input.ip}|${input.uaClass}|${input.day}`)
    .digest("hex");
}

/** Drop the oldest handles until the Set fits its ceiling again. */
function evict(window: VisitorWindow): void {
  while (window.handles.size > MAX_HANDLES) {
    const oldest = window.handles.values().next().value;
    if (oldest === undefined) return;
    window.handles.delete(oldest);
  }
}

/**
 * Count one reader towards today, if this is the first time today they have
 * been seen. Returns true when the count moved.
 *
 * The address is used to build the handle and is then dropped on the floor by
 * this function's own return: nothing here stores it, logs it, or hands it to a
 * caller. A null address returns false and counts nobody.
 */
export function noteVisitor(input: {
  ip: string | null;
  uaClass: VisitorUaClass;
  now?: number;
}): boolean {
  if (!input.ip) return false;
  const now = input.now ?? Date.now();
  const window = windowFor(now);
  const handle = visitorHandleFor({
    salt: window.salt,
    ip: input.ip,
    uaClass: input.uaClass,
    day: window.day,
  });
  if (window.handles.has(handle)) return false;
  window.handles.add(handle);
  evict(window);
  return true;
}

/**
 * Tests only: forget the window. Dropping it is what a process restart does,
 * so a test can call this to simulate one -- the next call mints a new salt and
 * an empty Set.
 */
export function resetVisitorWindow(): void {
  delete holder()[WINDOW_KEY];
}

/**
 * Tests only: what the window holds, so a test can prove the salt and the
 * handles are reachable from process memory and nowhere else -- and that the
 * salt is a different value after a reset.
 */
export function visitorWindowState(now: number = Date.now()): {
  day: string;
  salt: string;
  size: number;
} {
  const window = windowFor(now);
  return { day: window.day, salt: window.salt, size: window.handles.size };
}
