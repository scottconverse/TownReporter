import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/**
 * Unit U24, item B2: a source row's "Retry" re-checks that one source.
 *
 * THE FINDING. Pressing Retry on a row under "Could not check" fired
 * `POST …/runScan` -- a whole manual scan: a `scan_runs` row, a queued job, a
 * model writing pass, leads filed, and a flat refusal when another scan was
 * already open. On the stand-in editorial day it produced a failed scan whose
 * report blamed the provider, the "Could not check" count unchanged, and not
 * one word on the row that was pressed.
 *
 * WHAT THIS FILE PROVES, against the real `performCheckOneSource` and a real
 * (PGlite) database:
 *
 *   1. It reads the page through the SCAN'S OWN fetch path, so the row's
 *      reason and the scan's `failed_sources` entry are the same sentence.
 *   2. It writes the two columns the row is drawn from, both ways: a source
 *      that reads now comes back clean, one that does not keeps its error --
 *      and it says what happened ON THE ROW.
 *   3. IT STARTS NOTHING. No `scan_runs` row, no `desk_jobs` row: the press
 *      that used to cost a scan now costs one page fetch.
 *
 * MUTATION: pointing the row's press back at `runScan` (the code this
 * replaced) fails the third test with a scan run the editor never asked for.
 */

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performCheckOneSource: typeof import("./desk.ts").performCheckOneSource;
let setFetchImplForTests: typeof import("./fetch-url.ts").setFetchImplForTests;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performCheckOneSource } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
  ({ setFetchImplForTests } = await vite.ssrLoadModule("/src/lib/news/fetch-url.ts"));
});

after(async () => {
  setFetchImplForTests?.(null);
  await vite.close();
});

/*
  A public IP literal, so the SSRF guard takes its no-DNS path and the
  replaced transport below is what actually answers. Nothing here reaches the
  network: `setFetchImplForTests` is the seam `fetch-url.ts` documents for
  exactly this.
*/
const SOURCE_URL = "http://93.184.216.34/council-records";

/** A page with enough prose to pass `ingestUrl`'s "almost no readable text" floor. */
const READABLE = `<!doctype html><html><head><title>Council records</title></head><body>
<article><h1>Council records</h1>
<p>${"The adopted budget message sets the 2027 operating budget at $547.5 million and lists the two November ballot questions. ".repeat(4)}</p>
</article></body></html>`;

function respondWith(body: string, status = 200) {
  setFetchImplForTests(async () =>
    new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } }),
  );
}

let sequence = 98800;

async function fixture() {
  const sql = await getSql();
  const newsroomId = sequence++;
  const userId = `u24-sources-${newsroomId}`;
  await sql.query("delete from newsroom_members where newsroom_id=$1", [newsroomId]);
  await sql.query(
    "insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)",
    [userId, newsroomId],
  );
  const [source] = await sql.query<{ id: number }>(
    "insert into sources(user_id,newsroom_id,url,title,kind,tier,status,last_error) values($1,$2,$3,'Council records','official','A','accepted','The site refused the request.') returning id",
    [userId, newsroomId, SOURCE_URL],
  );
  return { sql, newsroomId, userId, sourceId: source.id };
}

async function sourceRow(sql: Awaited<ReturnType<typeof fixture>>["sql"], id: number) {
  const [row] = await sql.query<{ last_error: string | null; last_fetched_at: string | null }>(
    "select last_error,last_fetched_at from sources where id=$1",
    [id],
  );
  return row!;
}

it("reads the page now and clears the row's error, saying so on the row", async () => {
  const f = await fixture();
  respondWith(READABLE);

  const result = await performCheckOneSource(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.sourceId,
  );
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  assert.equal(result.line, "Read OK now.");
  assert.ok((result.ok ? result.characters : 0) > 40, "the page's own text is what was read");

  const row = await sourceRow(f.sql, f.sourceId);
  assert.equal(row.last_error, null, "the reason that put the row under 'Could not check' is gone");
  assert.ok(row.last_fetched_at, "and the row records when it was read");
});

it("keeps the failure when the page still cannot be read, in the row's own words", async () => {
  const f = await fixture();
  /* A body with no readable prose: the same shape the stand-in editorial day
     hit, and the same error string `ingestUrl` throws inside a scan. */
  respondWith("<!doctype html><html><head><title>x</title></head><body></body></html>");

  const result = await performCheckOneSource(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.sourceId,
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /almost no readable text/);
  assert.match(
    result.ok ? "" : result.line,
    /^Still failing: /,
    "the row says a retry was attempted and what came back",
  );

  const row = await sourceRow(f.sql, f.sourceId);
  assert.match(row.last_error ?? "", /almost no readable text/);
});

it("starts no scan and no job -- the press costs one page fetch, not a run", async () => {
  const f = await fixture();
  respondWith(READABLE);

  const [before] = await f.sql.query<{ runs: number; jobs: number }>(
    `select
      (select count(*)::int from scan_runs where newsroom_id=$1) as runs,
      (select count(*)::int from desk_jobs where newsroom_id=$1) as jobs`,
    [f.newsroomId],
  );
  await performCheckOneSource({ userId: f.userId, newsroomId: f.newsroomId }, f.sourceId);
  const [after] = await f.sql.query<{ runs: number; jobs: number }>(
    `select
      (select count(*)::int from scan_runs where newsroom_id=$1) as runs,
      (select count(*)::int from desk_jobs where newsroom_id=$1) as jobs`,
    [f.newsroomId],
  );
  assert.deepEqual(
    after,
    before,
    "a re-check of one source leaves no scan run and no queued job behind",
  );
  assert.deepEqual(before, { runs: 0, jobs: 0 }, "fixture: this newsroom has neither");
});

it("is what the row's Retry actually presses -- not a scan in disguise", () => {
  /*
    The tests above prove the server function starts nothing. This is the
    tripwire for the OTHER half, and the half the finding was about: the row's
    press. `desk.sources.tsx` used to call `runScan({ customSourceIds: [id] })`
    from this mutation -- the whole scan, model pass and all -- and pointing it
    back there is the mutation this fails on.
  */
  const page = readFileSync(new URL("../../routes/desk.sources.tsx", import.meta.url), "utf8");
  assert.match(page, /checkOneSource\(\{ data: id \}\)/);
  assert.doesNotMatch(
    page,
    /customSourceIds: \[id\]/,
    "the row's press must not be a scan scoped to one source",
  );
  /* The page-level "Run scan now" is still a scan, and still says so. */
  assert.match(page, /runScanNow = useMutation\(\{[\s\S]{0,200}runScan\(\{/);
});

it("refuses a source that is not ACCEPTED, and fetches nothing at all", async () => {
  /*
    UNIT U24b -- THE SERVER'S OWN FENCE. The row's press is drawn for accepted
    sources; the server says the same thing, because a disabled button is a
    suggestion and a scripted call routes past it.

    `paused` is refused too, deliberately: pausing means "do not fetch on a
    schedule", but the row offers Resume and Remove there, not Retry, so
    allowing it would be an unexercised permission rather than a real one.
  */
  const f = await fixture();
  let fetched = 0;
  setFetchImplForTests(async () => {
    fetched += 1;
    return new Response(READABLE, { status: 200, headers: { "content-type": "text/html" } });
  });

  for (const status of ["paused", "rejected"] as const) {
    await f.sql.query("update sources set status=$1 where id=$2", [status, f.sourceId]);
    const result = await performCheckOneSource(
      { userId: f.userId, newsroomId: f.newsroomId },
      f.sourceId,
      0,
    );
    assert.equal(result.ok, false, `${status} must not be re-checked`);
    assert.match(result.ok ? "" : result.line, /paused|not on the watch list/);
  }
  assert.equal(fetched, 0, "a refused press must not touch the site");
  /* And the row is left exactly as it was. */
  const row = await sourceRow(f.sql, f.sourceId);
  assert.equal(row.last_error, "The site refused the request.");
});

it("will not let one press be mashed into a burst at somebody else's server", async () => {
  /*
    UNIT U24b -- THE COOLDOWN. The press fetches a page a publisher pays for,
    and an editor learns nothing new between one press and the next. The pause
    is per EDITOR and per SOURCE, which is both what a spam guard is for and
    what `desk_rate`'s own index can serve.
  */
  const f = await fixture();
  let fetched = 0;
  setFetchImplForTests(async () => {
    fetched += 1;
    return new Response(READABLE, { status: 200, headers: { "content-type": "text/html" } });
  });

  const first = await performCheckOneSource({ userId: f.userId, newsroomId: f.newsroomId }, f.sourceId, 30);
  assert.equal(first.ok, true, first.ok ? "" : first.error);
  const second = await performCheckOneSource({ userId: f.userId, newsroomId: f.newsroomId }, f.sourceId, 30);
  assert.equal(second.ok, false, "a second press inside the window is refused");
  assert.match(second.ok ? "" : second.line, /Try again in \d+s\./);
  assert.equal(fetched, 1, "and it did not reach the site");

  /* The cooldown is this editor's, on this source: neither another source nor
     another editor is refused by it. */
  const [other] = await f.sql.query<{ id: number }>(
    "insert into sources(user_id,newsroom_id,url,title,kind,tier,status) values($1,$2,$3,'Second record','official','A','accepted') returning id",
    [f.userId, f.newsroomId, "http://93.184.216.34/second-record"],
  );
  const secondSource = await performCheckOneSource(
    { userId: f.userId, newsroomId: f.newsroomId },
    other.id,
    30,
  );
  assert.equal(secondSource.ok, true, secondSource.ok ? "" : secondSource.error);
  assert.equal(fetched, 2, "a different source is a different cooldown");
});

it("refuses a source that is not on this desk, rather than fetching a neighbour's", async () => {
  const f = await fixture();
  respondWith(READABLE);
  const other = await fixture();
  const result = await performCheckOneSource(
    { userId: f.userId, newsroomId: f.newsroomId },
    other.sourceId,
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /not on this desk/);
  /* And the neighbour's row is untouched. */
  const row = await sourceRow(other.sql, other.sourceId);
  assert.equal(row.last_error, "The site refused the request.");
});
