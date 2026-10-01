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
import { readFileSync } from "node:fs";

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

describe("SH-B: both commit paths write the same row (items 2 and 3)", () => {
  it("the manual path writes the wait and the block inline", () => {
    assert.match(
      desk,
      /update sources set last_error = \$\{touch\.last_error\}, last_fetched_at = now\(\),\s*\n\s*retry_after = \$\{touch\.retry_after\}/,
    );
  });

  it("the scheduled path writes them inside the run transaction too", () => {
    assert.match(
      desk,
      /update sources set last_error = \$\{touch\.error\}, last_fetched_at = now\(\),\s*\n\s*retry_after = \$\{touch\.retry_after \?\? null\}/,
    );
  });

  it("a success clears the wait and the block on both paths", () => {
    const clears = desk.match(/retry_after = null, retry_after_note = null, blocked_at = null, blocked_attempts = 0/g);
    assert.ok(clears && clears.length >= 1, "the inline success path must clear politeness");
    assert.match(desk, /pendingSourceTouches\.push\(\{ id: src\.id, error: null \}\)/);
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
    assert.match(watchRows, /waiting != null\s*\n\s*\? waiting/, "the sentence is what the row shows");
  });

  it("tells a block apart from a wait, and neither is 'Could not check'", () => {
    assert.match(watchRows, /blocked \? "Blocked" : "Waiting"/);
    // The waiting branch is tested BEFORE the failed one, or a blocked row --
    // which carries both a last_error and a wait -- would keep saying the
    // generic "Could not check" and lose the sentence the feature exists for.
    assert.ok(
      watchRows.indexOf("waiting != null") < watchRows.indexOf('"Could not check"'),
      "the parked branch must come first",
    );
  });

  it("never recomputes the sentence or compares it to the clock", () => {
    // The note is written by the fetch that earned it and rewritten on every
    // attempt, so a stored one is always current. Recomputing it here would
    // also make the server-rendered row and the hydrated one disagree whenever
    // a wait elapsed between them.
    const waitingBlock = watchRows.slice(
      watchRows.indexOf("const waiting ="),
      watchRows.indexOf("const note ="),
    );
    assert.doesNotMatch(waitingBlock, /Date\.now\(\)|new Date\(/);
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
    assert.match(
      press,
      /retry_after=null, retry_after_note=null, blocked_at=null, blocked_attempts=0/,
      "a press that read the page must not leave the row saying Waiting",
    );
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
