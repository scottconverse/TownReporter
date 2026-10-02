/**
 * The wiring SH-B needs and a pure test cannot see (unit SH-B items 1-3).
 *
 * WHY A SOURCE-TEXT PIN. `fetch-politeness.test.ts` proves the rules; it cannot
 * prove that the scan *calls* them. `desk.ts` opens a database at import time
 * and cannot be loaded by `node --experimental-strip-types`, so -- exactly as
 * `scan-coverage.test.ts` does for the accounting columns -- the wiring is
 * pinned by reading the source.
 *
 * THE TWO THINGS WORTH PINNING are both things that have gone wrong here
 * before. A scan writes a source row from one of two places: inline when the
 * editor pressed the button, and through `pendingSourceTouches` inside the run
 * transaction when a scheduler started the pass. `scan-coverage.test.ts` exists
 * because one of those paths was once forgotten, and a row that has a wait on
 * it in one path and not the other is the same class of bug. And a stored
 * `retry_after` that nothing reads is not a wait at all, so the skip has to be
 * there, before the fetch.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

/** Every `.ts`/`.tsx` under a directory, tests excluded: a test that wrote the
 *  column would not be a second production writer. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

const desk = readFileSync(new URL("./desk.ts", import.meta.url), "utf8");
const hostGate = readFileSync(new URL("./host-gate.ts", import.meta.url), "utf8");
const sourcesRoute = readFileSync(new URL("../../routes/desk.sources.tsx", import.meta.url), "utf8");

/** The `WatchRows` component, where a source row is drawn: from its own
 *  declaration to the next top-level `function` after it. */
const watchRowsStart = sourcesRoute.indexOf("function WatchRows(");
const watchRows = sourcesRoute.slice(
  watchRowsStart,
  sourcesRoute.indexOf("\nfunction ", watchRowsStart + 1),
);

describe("SH-B: the scan paces itself per host (item 1)", () => {
  it("binds the scan's fetch to a per-host gate", () => {
    assert.match(desk, /const hostGate = createHostGate\(\)/);
    assert.match(desk, /ingestUrl\(url, \{ schedule: hostGate\.schedule \}\)/);
  });

  it("one gate serves the whole pass, so same-host sources share a pace", () => {
    // A gate built inside the per-source callback would give every source its
    // own empty queue and pace nothing -- the failure this asserts against.
    const scan = desk.slice(desk.indexOf("export const performScanWork"));
    assert.equal(
      (scan.match(/createHostGate\(/g) ?? []).length,
      1,
      "exactly one gate for the pass, not one per source",
    );
  });

  it("the gate serialises a host and gives different hosts their own queues", () => {
    assert.match(hostGate, /this\.states\.get\(key\)/);
    assert.match(hostGate, /if \(wait > 0\) await this\.clock\.sleep\(wait\)/);
  });
});

describe("SH-B: a 'come back later' is recorded and honoured (item 2)", () => {
  it("a parked source is skipped before the fetch, not after it", () => {
    const loop = desk.slice(desk.indexOf("await mapLimit(watchSlice, 6"));
    const skipAt = loop.indexOf("skipThisPass({ retryAfter: src.retry_after");
    const fetchAt = loop.indexOf("return fetchUrl(src.url)");
    assert.ok(skipAt >= 0, "the pass must ask whether the source is parked");
    assert.ok(fetchAt > skipAt, "and it must ask before it fetches");
  });

  it("reads the columns the skip needs", () => {
    assert.match(desk, /retry_after, blocked_at, blocked_attempts\s*\n\s*from sources/);
    assert.match(desk, /retry_after, retry_after_note, blocked_at, blocked_attempts,/);
  });

  it("carries the status and Retry-After out of the fetch", () => {
    const ingest = readFileSync(new URL("./ingest.ts", import.meta.url), "utf8");
    assert.match(ingest, /class IngestFetchError/);
    assert.match(ingest, /retryAfterFromHeaders\(res\.headers, now\)/);
  });
});

describe("SH-B / HIGH-1: every path writes the same row", () => {
  /*
    THE ROW IS WRITTEN FROM THREE PLACES and the audit (A-B8, HIGH-1) found them
    disagreeing: the scheduled commit decided "did we read this page?" from
    `last_error is null`, which is exactly what a "come back later" touch
    carries on purpose. The behaviour is now proven against real PostgreSQL in
    `source-failure-streak.postgres.test.ts` -- three paths, driven end to end,
    asserting on the ROW.

    What is left for a source-text test is the thing a behaviour test cannot
    see: that there is only ONE writer left. A fourth write site that assembled
    its own statement would pass every behaviour test written so far and put the
    drift straight back, so the invariant asserted here is about the codebase
    rather than about a sentence.
  */
  it("every write site goes through the one source-touch statement", () => {
    const sourceTouchWrite = readFileSync(new URL("./source-touch-write.ts", import.meta.url), "utf8");
    assert.match(sourceTouchWrite, /export async function writeSourceTouch/);
    // The press, the inline read, the inline failure, both skips and the
    // scheduled commit: one call each, and no local UPDATE of the streak.
    const calls = desk.match(/writeSourceTouch\(/g) ?? [];
    assert.ok(calls.length >= 6, `expected every path to call it, found ${calls.length}`);
    assert.match(desk, /import \{ writeSourceTouch \} from "\.\/source-touch-write\.ts"/);
  });

  it("nothing else in src increments the streak", () => {
    /*
      The count is the feature. One writer means one rule; a second file that
      wrote `consecutive_failures + 1` would be a second opinion about what
      counts as an attempt, which is the whole defect. `desk.ts` does reset the
      count when an editor pauses or removes a source -- that is a status write,
      not an attempt, and it sets the column to a literal, so only the
      INCREMENT is pinned here.
    */
    const offenders: string[] = [];
    for (const file of sourceFiles(resolve(fileURLToPath(new URL("../../", import.meta.url))))) {
      if (file.endsWith("source-touch-write.ts")) continue;
      if (/consecutive_failures\s*=\s*(sources\.)?consecutive_failures\s*\+/.test(readFileSync(file, "utf8")))
        offenders.push(file);
    }
    assert.deepEqual(offenders, [], "only source-touch-write.ts may increment the streak");
  });
});

describe("SH-B: a block is not a stop (item 3)", () => {
  it("the backoff and the per-host daily cap are both applied", () => {
    assert.match(desk, /touchAfterFailure\(\{/);
    assert.match(desk, /if \(touch\.countsAgainstHostCap\) await noteHostRefusal\(/);
    assert.match(desk, /hostAtDailyCap\(sql, owned\(context\), host\)/);
    assert.match(desk, /BLOCKED_TRIES_PER_HOST_PER_DAY/);
  });

  it("nothing in this feature pauses, rejects or deletes a source", () => {
    /*
      The owner's rule, and the reason this whole unit exists: a public source
      residents can read stays on watch. Neither a refusal nor a cap may change
      a source's status.

      Scoped to the two modules this unit adds, deliberately. `desk.ts` does
      contain a source-status write -- it is the editor's own Pause/Resume/
      Remove press, which is a different unit's feature and must stay. What is
      asserted here is that the *politeness* code has no such write, and that
      the row it produces has nowhere to put one: `SourceTouch` is the whole of
      what a refusal may record.
    */
    const politeness = readFileSync(new URL("./fetch-politeness.ts", import.meta.url), "utf8");
    for (const source of [politeness, hostGate]) {
      assert.doesNotMatch(source, /setSourceStatus|status = 'paused'|status = 'rejected'|delete from sources/);
    }
    const from = politeness.indexOf("export type SourceTouch");
    const touchType = politeness.slice(from, politeness.indexOf("};", from));
    assert.doesNotMatch(touchType, /status/, "a SourceTouch carries no status");
  });
});

describe("SH-B: the Sources row says what is happening, in plain words (item 4)", () => {
  it("draws the stored sentence for a row that is waiting", () => {
    assert.ok(watchRowsStart > 0 && watchRows.length > 0, "WatchRows must be findable");
    assert.match(watchRows, /const waiting = s\.retry_after_note \?\? null;/);
    assert.match(watchRows, /\$\{waiting\} \$\{keepsFailingNote\(/, "a refused row that also keeps failing leads with the wait");
    assert.match(watchRows, /\}\)\}`\s*\n\s*: waiting\s*\n/, "the sentence is what the row shows");
  });

  it("tells a block apart from a wait, and neither is 'Could not check'", () => {
    assert.match(watchRows, /blocked \? "Blocked" : "Waiting"/);
    // The waiting branch is tested BEFORE the failed one, or a blocked row --
    // which carries both a last_error and a wait -- would keep saying the
    // generic "Could not check" and lose the sentence the feature exists for.
    const parked = watchRows.indexOf('{ cls: "wait", label: blocked ? "Blocked" : "Waiting" }');
    assert.ok(parked > 0, "the parked chip must be drawn");
    assert.ok(
      parked < watchRows.indexOf('{ cls: "fail", label: "Could not check" }'),
      "the parked branch must come first",
    );
    // Batch 8 merge (SH-B over SH0-3): a parked row says why it is parked
    // before it says "Keeps failing" -- the desk IS coming back, at a recorded
    // time, and the chip must not read as if it had given up.
    assert.ok(
      parked < watchRows.indexOf('{ cls: "fail", label: "Keeps failing" }'),
      "Waiting / Blocked outranks Keeps failing on the chip",
    );
  });

  it("prints the sentence the fetch stored, and never invents a clock", () => {
    /*
      The note is written by the fetch that earned it and rewritten on every
      attempt, so the ROW's own words are the ones to print. Recomputing it in
      the component would make the server-rendered row and the hydrated one
      disagree whenever a wait elapsed between them.

      The claim is deliberately about WHAT IS PRINTED rather than about the
      component's source: the audit (A-B8, LOW-8) was right that a
      `doesNotMatch(/Date.now()/)` over a source slice proves nothing about
      behaviour and passed on a build where the note was stale. So this asserts
      the sentence reaches the screen, and that it is the STORED one.
    */
    const parked = watchRows.slice(
      watchRows.indexOf("const waiting ="),
      watchRows.indexOf("const note ="),
    );
    assert.match(parked, /s\.retry_after_note/, "the row's own stored sentence is what is read");
    assert.match(
      watchRows,
      /\$\{waiting\} \$\{keepsFailingNote\(/,
      "and a parked row that is also failing still leads with the wait",
    );
  });
});

describe("SH-B: the editor's own press obeys the same rules", () => {
  it("records a refusal it earns, and clears a wait a successful read ends", () => {
    const press = desk.slice(
      desk.indexOf("export async function performCheckOneSource"),
      desk.indexOf("export const checkOneSource"),
    );
    assert.match(press, /classifyRefusal\(\{/, "a press is still the desk knocking on a server");
    assert.match(press, /if \(touch\.countsAgainstHostCap\) await noteHostRefusal\(/);
    /*
      The press writes the same row the scan writes, through the same helper:
      `touchAfterSuccess()` on a read (which is what ends a wait and a block) and
      the refusal's own touch on a failure. Pinned as CALLS rather than as the
      columns of a statement, because the columns now live in exactly one place
      and the sentence that used to be pinned here is what HIGH-1 got wrong.
    */
    assert.match(press, /touch: touchAfterSuccess\(\)/, "a press that read the page ends the wait");
    assert.match(press, /touchAfterError\(msg\)/, "an ordinary press failure is an attempt too");
    assert.match(press, /writeSourceTouch\(sql, \{/);
  });
});

describe("SH-B: the unattended scan honours the wait too (item 2)", () => {
  it("carries the wait in the source snapshot the scheduler hands the scan", () => {
    /*
      The daily scan does not read its sources from the table at run time -- it
      reads the snapshot taken when the reservation was made. So a snapshot
      without these columns would hand a parked source straight to the fetch
      loop and ask a site before the time it asked us to come back, which is
      the one hole the scan's own skip cannot close.
    */
    const daily = readFileSync(new URL("./daily-scan.server.ts", import.meta.url), "utf8");
    assert.match(
      daily,
      /select id,url,title,kind,tier,status,last_hash,last_fetched_at,last_error,retry_after,blocked_at,blocked_attempts from sources/,
    );
  });
});
