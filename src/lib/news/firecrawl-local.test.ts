import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWithFirecrawlLocal } from "./firecrawl-local.server.ts";
import { describeExtractionMethod } from "./extraction-label.ts";
import {
  createPageWatchFor,
  checkPageWatchFor,
  captureWithFirecrawlLocalFor,
} from "./page-watch.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { getSql } from "../db.ts";
import type { IngestDocument } from "./ingest.ts";

await applyMigrationsToTestPglite();

// The base newsroom schema comes from `migrations/*.sql`; these columns mirror
// what page-watch.test.ts ensures before its own fixtures run.
before(async () => {
  const sql = await getSql();
  for (const table of ["sources", "articles", "leads", "drafts", "scan_runs"])
    await sql.query(
      "alter table " + table + " add column if not exists newsroom_id integer not null default 1",
    );
});

const TOKEN = "a1b2c3d4".repeat(8); // 64 hex characters
let tokenPath = "";
before(async () => {
  tokenPath = join(tmpdir(), `firecrawl-token-${randomUUID()}`);
  await writeFile(tokenPath, `${TOKEN}\n`, "utf8");
});

const doc = (text: string, extra: Partial<IngestDocument> = {}): IngestDocument => ({
  ok: true,
  status: 200,
  outcome: "fetched",
  text,
  title: "Record",
  extras: [],
  contentType: "text/html",
  needsOcr: false,
  redirectChain: [],
  extractionMethod: "html",
  pages: [],
  notices: [],
  ...extra,
});

const identity = { userId: "firecrawl-editor", newsroomId: 1 };
const watchInput = (suffix: string) => ({
  url: `https://example.test/firecrawl-${suffix}`,
  name: `Firecrawl ${suffix}`,
  reason: "Track the public record",
  modelChoice: "auto",
});

type FetchCall = { url: string; init: RequestInit };
function stubFetch(
  body: unknown,
  status = 200,
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const scraped = (over: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    markdown: "# Headline\n\nThe page body is long enough to be treated as readable article text.",
    metadata: { statusCode: 200, title: "Headline", url: "https://example.test/article" },
    ...over,
  },
});

test("adapter posts to /v2/scrape with the bearer token and maps the answer", async () => {
  const { fetchImpl, calls } = stubFetch(scraped());
  const result = await readWithFirecrawlLocal("https://example.test/article", {
    fetchImpl,
    token: tokenPath,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /\/v2\/scrape$/);
  assert.equal(calls[0]!.init.method, "POST");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(headers["content-type"], "application/json");
  const body = JSON.parse(String(calls[0]!.init.body));
  assert.deepEqual(body.formats, ["markdown", "links"]);
  assert.equal(body.onlyMainContent, true);
  assert.equal(body.timeout, 38000);
  assert.equal(calls[0]!.init.redirect, "error");

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.title, "Headline");
  assert.match(result.text, /readable article text/);
  assert.equal(result.extractionMethod, "firecrawl-local:0.1.1");
  assert.equal(result.contentType, "text/markdown");
  assert.deepEqual(result.redirectChain, []);
});

test("adapter turns a refused connection into the not-running sentence, without the token", async () => {
  const fetchImpl = (async () => {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:18764");
    throw error;
  }) as unknown as typeof fetch;
  await assert.rejects(
    readWithFirecrawlLocal("https://example.test/article", { fetchImpl, token: tokenPath }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /not running at 127\.0\.0\.1:18764/);
      assert.doesNotMatch(error.message, new RegExp(TOKEN));
      return true;
    },
  );
});

test("adapter refuses cloud answers, failed source statuses, missing tokens and non-local origins", async () => {
  const cloud = stubFetch(scraped({ source: "firecrawl-cloud" }));
  await assert.rejects(
    readWithFirecrawlLocal("https://example.test/article", {
      fetchImpl: cloud.fetchImpl,
      token: tokenPath,
    }),
    /cloud/i,
  );

  const gone = stubFetch({
    success: true,
    data: { markdown: "Gone", metadata: { statusCode: 404, title: "Gone" } },
  });
  await assert.rejects(
    readWithFirecrawlLocal("https://example.test/article", {
      fetchImpl: gone.fetchImpl,
      token: tokenPath,
    }),
    /status 404/,
  );

  await assert.rejects(
    readWithFirecrawlLocal("https://example.test/article", {
      fetchImpl: stubFetch(scraped()).fetchImpl,
      token: join(tmpdir(), `missing-token-${randomUUID()}`),
    }),
    /not set up/,
  );

  const origin = stubFetch(scraped());
  await assert.rejects(
    readWithFirecrawlLocal("https://example.test/article", {
      fetchImpl: origin.fetchImpl,
      token: tokenPath,
      origin: "http://firecrawl.example.com:18764",
    }),
    /127\.0\.0\.1|localhost|::1/,
  );
  assert.equal(origin.calls.length, 0, "a non-local origin is refused before any request");
});

test("engine captures once through Firecrawl Local without moving the watch baseline", async () => {
  const sql = await getSql();
  const created = await createPageWatchFor(identity, watchInput("baseline"));
  assert.ok(created.ok);
  const baseline = await checkPageWatchFor(identity, created.id, {
    fetch: async () =>
      doc("The official record says the contract value is twelve million dollars for the year."),
  });
  assert.ok(baseline.ok);

  const before = (
    await sql<{
      w: number | null;
      l: number | null;
      n: string;
    }>`select watch_last_readable_version_id as w,last_version_id as l,next_check_at::text as n from source_monitors where id=${created.id}`
  )[0]!;

  const result = await captureWithFirecrawlLocalFor(identity, created.id, {
    read: async () =>
      doc("A different reading of the page, captured by Firecrawl Local on this computer today.", {
        extractionMethod: "firecrawl-local:0.1.1",
        contentType: "text/markdown",
      }),
  });
  assert.equal(result.ok, true);
  assert.equal("state" in result ? result.state : undefined, "firecrawl-capture");

  const checks = await sql<{ state: string }>`
    select state from manual_watch_checks where monitor_id=${created.id} and state='firecrawl-capture'`;
  assert.equal(checks.length, 1);

  const events = await sql<{ extraction_method: string; trigger_kind: string }>`
    select extraction_method,trigger_kind from capture_events
    where monitor_id=${created.id} and trigger_kind='manual-firecrawl-local'`;
  assert.equal(events.length, 1);
  assert.equal(events[0]!.extraction_method, "firecrawl-local:0.1.1");

  const after = (
    await sql<{
      w: number | null;
      l: number | null;
      n: string;
      lease: string | null;
    }>`select watch_last_readable_version_id as w,last_version_id as l,next_check_at::text as n,watch_lease as lease from source_monitors where id=${created.id}`
  )[0]!;
  assert.equal(after.w, before.w);
  assert.equal(after.l, before.l);
  assert.equal(after.n, before.n);
  assert.equal(after.lease, null);

  // Default untouched: the ordinary check still records ingest's own method.
  const ordinary = await sql<{ extraction_method: string }>`
    select extraction_method from capture_events
    where monitor_id=${created.id} and trigger_kind='manual-watch'`;
  assert.ok(ordinary.some((row) => row.extraction_method === "html"));
});

test("engine saves nothing when Firecrawl Local fails", async () => {
  const sql = await getSql();
  const created = await createPageWatchFor(identity, watchInput("failure"));
  assert.ok(created.ok);
  const versionsBefore = (
    await sql<{ c: number }>`select count(*)::int as c from artifact_versions where url=${watchInput("failure").url}`
  )[0]!.c;

  const result = await captureWithFirecrawlLocalFor(identity, created.id, {
    read: async () => {
      throw new Error(
        "Firecrawl Local is not running at 127.0.0.1:18764. Start it by hand, then try again. Nothing was saved.",
      );
    },
  });
  assert.equal(result.ok, false);
  assert.match("error" in result ? result.error : "", /not running at 127\.0\.0\.1:18764/);

  const captureEvents = await sql<{ c: number }>`
    select count(*)::int as c from capture_events
    where monitor_id=${created.id} and trigger_kind='manual-firecrawl-local'`;
  assert.equal(captureEvents[0]!.c, 0, "capture_events must have no row");
  const captureChecks = await sql<{ c: number }>`
    select count(*)::int as c from manual_watch_checks
    where monitor_id=${created.id} and state='firecrawl-capture'`;
  assert.equal(captureChecks[0]!.c, 0, "manual_watch_checks must have no row");
  const versionsAfter = (
    await sql<{ c: number }>`select count(*)::int as c from artifact_versions where url=${watchInput("failure").url}`
  )[0]!.c;
  assert.equal(versionsAfter, versionsBefore);
  const lease = (
    await sql<{ lease: string | null }>`select watch_lease as lease from source_monitors where id=${created.id}`
  )[0]!.lease;
  assert.equal(lease, null);
});

test("engine saves nothing when Firecrawl Local returns no readable text", async () => {
  const sql = await getSql();
  const created = await createPageWatchFor(identity, watchInput("empty"));
  assert.ok(created.ok);
  const result = await captureWithFirecrawlLocalFor(identity, created.id, {
    read: async () => doc("", { extractionMethod: "firecrawl-local:0.1.1" }),
  });
  assert.equal(result.ok, false);
  assert.match("error" in result ? result.error : "", /no readable text/i);

  const events = await sql<{ c: number }>`
    select count(*)::int as c from capture_events where monitor_id=${created.id} and trigger_kind='manual-firecrawl-local'`;
  assert.equal(events[0]!.c, 0);
  const checks = await sql<{ c: number }>`
    select count(*)::int as c from manual_watch_checks where monitor_id=${created.id} and state='firecrawl-capture'`;
  assert.equal(checks[0]!.c, 0);
});

test("extraction label names Firecrawl Local", () => {
  assert.equal(
    describeExtractionMethod("firecrawl-local:0.1.1"),
    "Read by Firecrawl Local 0.1.1 on this computer",
  );
});

after(async () => {
  if (tokenPath) await rm(tokenPath, { force: true });
});
