/**
 * "Come back later", through the real scan (unit SH-B items 2 and 3).
 *
 * WHY THIS RUNS THE REAL `performScanWork`. The rules are pinned in
 * `fetch-politeness.test.ts` and the wiring in `source-politeness-wiring.test.ts`,
 * and neither of those can prove the thing the owner actually asked for: that a
 * site which said "come back at 3:40" is *left alone until then and read
 * after*. That is a claim about a row, two scans and a clock, so it is asserted
 * here against the real scan loop and the real schema -- the harness
 * `scan-section-cache.test.ts` established, with one newsroom per test so the
 * fixtures cannot collide.
 *
 * Every newsroom here watches TWO sources: the one under test, and a healthy
 * one. That is not decoration. A scan in which every source fails refuses to
 * run its writing pass and, on the scheduled path, commits only the failed-run
 * receipt -- so a single-source fixture would lose exactly the writes this test
 * is about, and would be testing the abort rather than the politeness. A real
 * watch list of thirty sources is the case that matters, and it is the case
 * where a partial failure still commits.
 *
 * The clock is moved by writing `retry_after` into the past rather than by
 * waiting, so "the next scan picks it up" is one assertion instead of a
 * ninety-minute test.
 *
 * Both commit paths are exercised on purpose: a scan writes a source row inline
 * when the editor pressed the button, and through `pendingSourceTouches` inside
 * the run transaction when a scheduler started the pass.
 */
import { before, it } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getSql, withTransaction } from "../db.ts";
import { ensureJobsSchema, type DeskJob } from "./jobs.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

// This file needs the migrated schema, including 0116's columns and its
// per-host table. scripts/run-tests-safe.mjs applies migrations/*.sql before
// the file loads; a direct `node --test` run has not, so the fixture asks for
// them itself through the one shared applier, which does nothing when the
// ledger is already full.
await applyMigrationsToTestPglite();

// This test executes desk.ts itself. Resolve its Vite alias/extensionless
// imports inside this isolated Node test process; no production loader changes.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/"))
      specifier = new URL("../../" + specifier.slice(2), import.meta.url).href;
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".") && !specifier.startsWith("file:")) throw error;
      const url = new URL(specifier, context.parentURL);
      for (const suffix of [".ts", ".tsx"]) {
        if (existsSync(fileURLToPath(url) + suffix)) return nextResolve(url.href + suffix, context);
      }
      throw error;
    }
  },
});

let scan: typeof import("./desk.ts").performScanWork;
let ingest: typeof import("./ingest.ts");
let roomCounter = 9910;

before(async () => {
  scan = (await import("./desk.ts")).performScanWork;
  ingest = await import("./ingest.ts");
});

/** A newsroom watching one source on `host` (the one under test) and one
 *  healthy source elsewhere, so a pass over it can actually complete. */
async function newsroom(host: string) {
  const sql = await getSql();
  const room = roomCounter++;
  const user = `politeness-${room}`;
  const watchedUrl = `https://${host}/watch-${room}`;
  const [watched] = await sql<{ id: number }>`
    insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
    values(${user},${room},${watchedUrl},'City page','official','A','accepted') returning id
  `;
  await sql`
    insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
    values(${user},${room},${`https://healthy-${room}.test/news`},'Healthy page','news','B','accepted')
  `;
  return { room, user, watchedId: watched.id, watchedUrl };
}

/** A fresh running scan job in an existing newsroom. */
async function scanJob(room: number, user: string): Promise<DeskJob> {
  const sql = await getSql();
  const [run] = await sql<{ id: number }>`
    insert into scan_runs(user_id,newsroom_id) values(${user},${room}) returning id
  `;
  await ensureJobsSchema();
  const claimToken = `politeness-claim-${room}-${run.id}`;
  const [jobRow] = await sql<{ id: number }>`
    insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,claim_token)
    values(${room},${user},'scan',${run.id},'grok','editor','default','running','Working',${claimToken})
    returning id
  `;
  return {
    id: jobRow.id,
    user_id: user,
    newsroom_id: room,
    subject_id: run.id,
    model_choice: "grok",
    model_choice_source: "editor",
    claim_token: claimToken,
  } as DeskJob;
}

/**
 * A scan whose fetch refuses `refuseUrl` and reads everything else. `onRefusal`
 * counts the attempts on the source under test, which is how "not hammered" is
 * asserted rather than assumed.
 */
function deps(options: {
  refuseUrl: string;
  refusal: Error;
  scheduled?: boolean;
  onRefusal?: () => void;
}) {
  const out: Record<string, unknown> = {
    ingestUrl: async (url: string) => {
      if (url.startsWith(options.refuseUrl)) {
        options.onRefusal?.();
        throw options.refusal;
      }
      return {
        text: `Public meeting notes for the week. ${"Readable copy about the city budget. ".repeat(12)}`,
        titleHint: "Healthy page",
        extras: [],
      };
    },
    grokChat: async () => ({
      ok: true as const,
      text: JSON.stringify({ leads: [], proposed_sources: [], editor_summary: "done" }),
    }),
    setJobStage: async () => {},
    setJobModelChoice: async () => {},
  };
  if (options.scheduled)
    out.scheduledCommit = (write: (sql: unknown) => Promise<unknown>) =>
      withTransaction(write as never);
  return out;
}

async function readSource(sourceId: number) {
  const sql = await getSql();
  const [row] = await sql<{
    last_error: string | null;
    retry_after: Date | null;
    retry_after_note: string | null;
    blocked_at: Date | null;
    blocked_attempts: number;
    status: string;
  }>`
    select last_error,retry_after,retry_after_note,blocked_at,blocked_attempts,status
    from sources where id=${sourceId}
  `;
  return row!;
}

it("a 429 is recorded as a wait, the source is skipped until then, and read after", async () => {
  const { room, user, watchedId, watchedUrl } = await newsroom("example.test");
  let refusals = 0;
  const onRefusal = () => (refusals += 1);
  const refusal = () => new ingest.IngestFetchError(429, 600_000);

  // 1. The site asks us to come back in ten minutes.
  await scan(
    await scanJob(room, user),
    deps({ refuseUrl: watchedUrl, refusal: refusal(), onRefusal }) as never,
  );

  const parked = await readSource(watchedId);
  assert.equal(refusals, 1, "a 429 is asked exactly once -- never twice 400 ms apart");
  assert.ok(parked.retry_after, "the wait is recorded");
  assert.match(parked.retry_after_note!, /^Asked us to come back at .+ — will retry then$/);
  assert.equal(parked.last_error, null, "a site that asked us to wait has not failed us");
  assert.equal(parked.status, "accepted", "the source is still on watch");
  const retryAt = parked.retry_after!.getTime();
  const waited = retryAt - Date.now();
  assert.ok(
    waited > 9 * 60_000 && waited <= 10 * 60_000 + 5_000,
    `parked for the ten minutes the site asked for, not ${waited}ms`,
  );

  // 2. The next pass arrives before the time: the row is left alone entirely.
  const second = await scanJob(room, user);
  await scan(
    second,
    deps({ refuseUrl: watchedUrl, refusal: refusal(), onRefusal }) as never,
  );
  assert.equal(refusals, 1, "a parked source is not fetched again before its time");
  const stillParked = await readSource(watchedId);
  assert.equal(stillParked.retry_after!.getTime(), retryAt, "and its wait is not rewritten");
  assert.equal(stillParked.retry_after_note, parked.retry_after_note);
  // And it is not written down as a fetch that never happened: selected, but
  // deliberately not attempted.
  const receiptSql = await getSql();
  const [receipt] = await receiptSql<{ sources_selected: number; sources_attempted: number }>`
    select sources_selected, sources_attempted from scan_runs where id=${second.subject_id}
  `;
  assert.equal(receipt!.sources_selected, 2, "the parked source was still in scope");
  assert.equal(receipt!.sources_attempted, 1, "a parked source is not counted as attempted");

  // 3. The time arrives (moved by hand, not by waiting) and the pass reads it.
  const sql = await getSql();
  await sql`update sources set retry_after = now() - interval '1 minute' where id=${watchedId}`;
  await scan(
    await scanJob(room, user),
    deps({ refuseUrl: "https://never-refused.invalid/", refusal: refusal(), onRefusal }) as never,
  );
  assert.equal(refusals, 1, "the pass after the time reads it without refusing");
  const read = await readSource(watchedId);
  assert.equal(read.retry_after, null, "and a read that worked clears the wait");
  assert.equal(read.retry_after_note, null);
  assert.equal(read.last_error, null);
});

it("a block grows the backoff, is not a stop, and lands the same way on the scheduled path", async () => {
  const { room, user, watchedId, watchedUrl } = await newsroom("blocked.test");
  const host = new URL(watchedUrl).hostname;

  // The editor's press, then a scheduled pass: two refusals in a row.
  await scan(
    await scanJob(room, user),
    deps({ refuseUrl: watchedUrl, refusal: new ingest.IngestFetchError(403, null) }) as never,
  );
  const first = await readSource(watchedId);
  assert.equal(first.status, "accepted", "a blocked source stays on watch -- blocked is not a stop");
  assert.equal(first.blocked_attempts, 1);
  assert.ok(first.blocked_at, "when the block started is recorded");
  assert.match(first.retry_after_note!, /^Blocked us at .+ — trying again on the next pass$/);
  assert.equal(first.last_error, first.retry_after_note, "the editor is told, not hidden");

  // Let the first block's wait pass, then be blocked again through the
  // SCHEDULED path: the second step of the backoff, six hours -- not the flat
  // 400 ms the desk used to wait -- and the same columns as the manual path.
  const sql = await getSql();
  await sql`update sources set retry_after = now() - interval '1 minute' where id=${watchedId}`;
  await scan(
    await scanJob(room, user),
    deps({ refuseUrl: watchedUrl, refusal: new ingest.IngestFetchError(403, null), scheduled: true }) as never,
  );
  const second = await readSource(watchedId);
  assert.equal(second.blocked_attempts, 2);
  assert.equal(
    second.blocked_at!.getTime(),
    first.blocked_at!.getTime(),
    "the sentence keeps the ORIGINAL block time",
  );
  assert.ok(
    second.retry_after!.getTime() - Date.now() > 5 * 60 * 60_000,
    "the second block waits hours",
  );
  assert.match(second.retry_after_note!, /trying again after /);

  // The per-host allowance: four refusals in a day and the host is left until
  // tomorrow rather than asked all day.
  // The scan's own refusals have already been counted here; this is the
  // allowance being spent, not reset.
  await sql`
    insert into source_host_tries(newsroom_id,host,day,tries)
    values(${room},${host},current_date,4)
    on conflict (newsroom_id,host,day) do update set tries = 4
  `;
  await sql`update sources set retry_after = now() - interval '1 minute' where id=${watchedId}`;
  let refusals = 0;
  await scan(
    await scanJob(room, user),
    deps({ refuseUrl: watchedUrl, refusal: new ingest.IngestFetchError(403, null), onRefusal: () => (refusals += 1) }) as never,
  );
  assert.equal(refusals, 0, "a host at its allowance for today is not asked again today");
  const capped = await readSource(watchedId);
  assert.match(capped.retry_after_note!, /^Tried \d+ times today — will try again tomorrow$/);
  assert.equal(capped.status, "accepted", "capped is not dropped -- it is left until tomorrow");
});

it("a host that refused us yesterday is asked again today", async () => {
  // The other half of the cap: it has to expire, or "will try again tomorrow"
  // is a sentence the desk does not keep.
  const { room, user, watchedId, watchedUrl } = await newsroom("yesterday.test");
  const sql = await getSql();
  await sql`
    insert into source_host_tries(newsroom_id,host,day,tries)
    values(${room},${new URL(watchedUrl).hostname},current_date - 1,9)
  `;
  let refusals = 0;
  await scan(
    await scanJob(room, user),
    deps({ refuseUrl: watchedUrl, refusal: new ingest.IngestFetchError(403, null), onRefusal: () => (refusals += 1) }) as never,
  );
  assert.equal(refusals, 1, "yesterday's refusals do not silence today");
  assert.equal((await readSource(watchedId)).blocked_attempts, 1);
});
