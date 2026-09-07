import { test } from "node:test";
import assert from "node:assert/strict";
import { watchChangeText, watchOutcome } from "./page-watch.ts";
import type { IngestDocument } from "./ingest.ts";
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
test("page watch records first capture, exact unchanged and numeric change distinctly", () => {
  assert.equal(watchOutcome(doc("Vote: 5 to 2"), null), "first-capture");
  assert.equal(watchOutcome(doc("Vote: 5 to 2"), "Vote: 5 to 2"), "unchanged");
  assert.equal(watchOutcome(doc("Vote: 4 to 3"), "Vote: 5 to 2"), "changed");
  assert.match(watchChangeText("Vote: 5 to 2", "Vote: 4 to 3"), /Removed: Vote: 5 to 2/);
  assert.match(watchChangeText("Vote: 5 to 2", "Vote: 4 to 3"), /Added: Vote: 4 to 3/);
});
test("page watch never calls failed, blocked, moved or unreadable captures unchanged", () => {
  assert.equal(
    watchOutcome(doc("", { ok: false, status: 0, outcome: "fetch-failed" }), "old"),
    "failed",
  );
  assert.equal(watchOutcome(doc("", { ok: false, status: 403 }), "old"), "blocked");
  assert.equal(
    watchOutcome(doc("", { ok: false, status: 404, outcome: "not-found" }), "old"),
    "unavailable",
  );
  assert.equal(
    watchOutcome(doc("", { ok: false, needsOcr: true, outcome: "needs-ocr" }), "old"),
    "needs-ocr",
  );
  assert.equal(
    watchOutcome(doc("", { ok: false, extractionMethod: "refused-too-large" }), "old"),
    "refused-too-large",
  );
  assert.equal(watchOutcome(doc(""), "old"), "no-readable-text");
  assert.equal(
    watchOutcome(
      doc("new", { redirectChain: ["https://example.test/a", "https://example.test/b"] }),
      "old",
    ),
    "moved",
  );
});
import {
  createPageWatchFor,
  checkPageWatchFor,
  pageWatchDetailFor,
  setPageWatchStateFor,
  actOnPageWatchFor,
} from "./page-watch.ts";
import { getSql } from "../db.ts";
const identity = { userId: "watch-editor", newsroomId: 1 };
const input = (suffix: string) => ({
  url: `https://example.test/watch-${suffix}`,
  name: `Watch ${suffix}`,
  reason: "Track the public record",
  modelChoice: "auto",
});
test(
  "manual watch retains readable baseline and honest history across failed checks",
  { timeout: 60000 },
  async () => {
    const created = await createPageWatchFor(identity, input("history"));
    assert.ok(created.ok);
    const first = await checkPageWatchFor(identity, created.id, {
      fetch: async () =>
        doc("Contract value is $12 million. This is the official posted procurement record."),
    });
    assert.equal(first.state, "first-capture");
    const fail = await checkPageWatchFor(identity, created.id, {
      fetch: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(fail.state, "failed");
    const same = await checkPageWatchFor(identity, created.id, {
      fetch: async () =>
        doc("Contract value is $12 million. This is the official posted procurement record."),
    });
    assert.equal(same.state, "unchanged");
    const changed = await checkPageWatchFor(identity, created.id, {
      fetch: async () =>
        doc("Contract value is $13 million. This is the official posted procurement record."),
    });
    assert.equal(changed.state, "changed");
    const detail = await pageWatchDetailFor(identity, created.id);
    assert.equal(detail.history.length, 4);
    assert.match(detail.history[0].diff, /12 million/);
    assert.match(detail.history[0].diff, /13 million/);
  },
);
test(
  "manual watch is newsroom scoped and pause/stop preserve its records",
  { timeout: 60000 },
  async () => {
    const created = await createPageWatchFor(identity, input("states"));
    assert.ok(created.ok);
    await checkPageWatchFor(identity, created.id, {
      fetch: async () => doc("A retained capture from the original public document."),
    });
    assert.equal(await pageWatchDetailFor({ ...identity, newsroomId: 2 }, created.id), null);
    assert.equal((await checkPageWatchFor({ ...identity, newsroomId: 2 }, created.id)).ok, false);
    assert.equal((await setPageWatchStateFor(identity, created.id, "paused")).ok, true);
    let calls = 0;
    assert.equal(
      (
        await checkPageWatchFor(identity, created.id, {
          fetch: async () => {
            calls++;
            return doc("unexpected");
          },
        })
      ).ok,
      false,
    );
    assert.equal(calls, 0);
    await setPageWatchStateFor(identity, created.id, "active");
    await setPageWatchStateFor(identity, created.id, "stopped");
    const detail = await pageWatchDetailFor(identity, created.id);
    assert.equal(detail.watch.watch_state, "stopped");
    assert.equal(detail.history.length, 1);
  },
);
test(
  "manual and scheduled checks cannot overlap; selected OCR choice reaches fetch",
  { timeout: 60000 },
  async () => {
    const created = await createPageWatchFor(identity, {
      ...input("lock"),
      modelChoice: "claude-frontier",
    });
    assert.ok(created.ok);
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((r) => {
      release = r;
    });
    const ready = new Promise<void>((r) => {
      entered = r;
    });
    let calls = 0;
    const first = checkPageWatchFor(identity, created.id, {
      fetch: async (_url: any, options: any) => {
        calls++;
        assert.equal(options.provider, "claude-frontier");
        entered();
        await waiting;
        return doc("A sufficiently readable public capture for concurrent check.");
      },
    });
    await ready;
    const second = await checkPageWatchFor(identity, created.id, {
      fetch: async () => {
        calls++;
        return doc("not reached");
      },
    });
    assert.equal(second.busy, true);
    release();
    await first;
    assert.equal(calls, 1);
  },
);
test(
  "watch capture actions validate provenance and create a lead only on explicit idempotent action",
  { timeout: 60000 },
  async () => {
    const created = await createPageWatchFor(identity, input("actions"));
    assert.ok(created.ok);
    const captured = await checkPageWatchFor(identity, created.id, {
      fetch: async () =>
        doc("Public record changed from $12 million to $13 million in the posted contract."),
    });
    const sql = await getSql();
    await sql.query(
      `create table if not exists leads(id serial primary key,user_id text,newsroom_id integer,headline text,why text,topic text,status text,source_urls text,evidence text,newsworthiness integer,investigation_id integer)`,
    );
    const before = await sql`select count(*)::int as n from leads`;
    assert.equal(before[0]!.n, 0);
    const other = await createPageWatchFor(identity, input("wrong"));
    assert.ok(other.ok);
    assert.equal(
      (
        await actOnPageWatchFor(identity, {
          watchId: other.id,
          checkId: captured.checkId,
          action: "lead",
        })
      ).ok,
      false,
    );
    const a = await actOnPageWatchFor(identity, {
      watchId: created.id,
      checkId: captured.checkId,
      action: "lead",
    });
    assert.ok(a.ok);
    const b = await actOnPageWatchFor(identity, {
      watchId: created.id,
      checkId: captured.checkId,
      action: "lead",
    });
    assert.equal(b.leadId, a.leadId);
    const lead = await sql`select why from leads where id=${a.leadId}`;
    assert.match(String(lead[0]!.why), /unverified/i);
  },
);

test(
  "existing unattended sweep checks manual watches through the same history path",
  { timeout: 60000 },
  async () => {
    const created = await createPageWatchFor(identity, input("scheduled"));
    assert.ok(created.ok);
    const { tickAllDueMonitors } = await import("./monitors-cron.ts");
    await tickAllDueMonitors({
      fetch: async () =>
        doc("Scheduled checks retain the same trustworthy captured text and history."),
    });
    const detail = await pageWatchDetailFor(identity, created.id);
    assert.equal(detail.history.length, 1);
    assert.equal(detail.history[0].state, "first-capture");
  },
);

test(
  "expired check cannot overwrite newer history and stop during flight remains stopped",
  { timeout: 60000 },
  async () => {
    const c = await createPageWatchFor(identity, input("fence"));
    assert.ok(c.ok);
    let release!: () => void, entered!: () => void;
    const wait = new Promise<void>((r) => (release = r)),
      ready = new Promise<void>((r) => (entered = r));
    const started = new Date("2026-09-07T10:00:00Z");
    const stale = checkPageWatchFor(identity, c.id, {
      now: started,
      fetch: async () => {
        entered();
        await wait;
        return doc("OLD WORKER must not overwrite the newer public evidence.");
      },
    });
    await ready;
    const fresh = await checkPageWatchFor(identity, c.id, {
      now: new Date(started.getTime() + 31 * 60000),
      fetch: async () => doc("NEW WORKER owns the captured public evidence and baseline."),
    });
    assert.ok(fresh.ok);
    release();
    assert.equal((await stale).ok, false);
    const detail = await pageWatchDetailFor(identity, c.id);
    assert.equal(detail.history.length, 1);
    assert.match(detail.history[0].full_text, /NEW WORKER/);
    let resume!: () => void, signal!: () => void;
    const hold = new Promise<void>((r) => (resume = r)),
      inFlight = new Promise<void>((r) => (signal = r));
    const checking = checkPageWatchFor(identity, c.id, {
      fetch: async () => {
        signal();
        await hold;
        return doc("A later complete public record may be retained after stopping.");
      },
    });
    await inFlight;
    await setPageWatchStateFor(identity, c.id, "stopped");
    resume();
    await checking;
    const stopped = await pageWatchDetailFor(identity, c.id);
    assert.equal(stopped.watch.watch_state, "stopped");
    const sql = await getSql();
    const rows = await sql`select enabled from source_monitors where id=${c.id}`;
    assert.equal(rows[0]!.enabled, false);
  },
);
test(
  "watch actions reject foreign files and mismatched snapshot provenance",
  { timeout: 60000 },
  async () => {
    const c = await createPageWatchFor(identity, input("provenance"));
    assert.ok(c.ok);
    const result = await checkPageWatchFor(identity, c.id, {
      fetch: async () => doc("The stored capture belongs only to this watched public record."),
    });
    assert.ok(result.ok);
    const sql = await getSql();
    const inv = await sql<{
      id: number;
    }>`insert into investigations(user_id,newsroom_id,title) values(${identity.userId},2,'Other room') returning id`;
    assert.equal(
      (
        await actOnPageWatchFor(identity, {
          watchId: c.id,
          checkId: result.checkId,
          action: "attach",
          investigationId: inv[0]!.id,
        })
      ).ok,
      false,
    );
    const mine = await sql<{
      id: number;
    }>`insert into investigations(user_id,newsroom_id,title) values(${identity.userId},1,'My file') returning id`;
    const attached = await actOnPageWatchFor(identity, {
      watchId: c.id,
      checkId: result.checkId,
      action: "attach",
      investigationId: mine[0]!.id,
    });
    assert.ok(attached.ok);
    const again = await actOnPageWatchFor(identity, {
      watchId: c.id,
      checkId: result.checkId,
      action: "attach",
      investigationId: mine[0]!.id,
    });
    assert.equal(again.artifactId, attached.artifactId);
    const other = await createPageWatchFor(identity, input("different"));
    assert.ok(other.ok);
    await sql`update capture_events set monitor_id=${other.id} where id=(select capture_event_id from manual_watch_checks where id=${result.checkId})`;
    assert.equal(
      (
        await actOnPageWatchFor(identity, {
          watchId: c.id,
          checkId: result.checkId,
          action: "lead",
        })
      ).ok,
      false,
    );
    assert.equal((await pageWatchDetailFor(identity, c.id)).history.length, 0);
  },
);

test(
  "adding the same watch returns it without silently renaming or reassigning it",
  { timeout: 60000 },
  async () => {
    const c = await createPageWatchFor(identity, input("duplicate"));
    assert.ok(c.ok);
    await setPageWatchStateFor(identity, c.id, "stopped");
    const duplicate = await createPageWatchFor(identity, {
      ...input("duplicate"),
      name: "Unexpected replacement",
    });
    assert.ok(duplicate.ok);
    assert.equal(duplicate.id, c.id);
    assert.equal(duplicate.alreadyExists, true);
    const detail = await pageWatchDetailFor(identity, c.id);
    assert.equal(detail.watch.title, "Watch duplicate");
    assert.equal(detail.watch.watch_state, "stopped");
  },
);

test(
  "lease takeover exactly before persistence leaves no stale capture or version",
  { timeout: 60000 },
  async () => {
    const c = await createPageWatchFor(identity, input("persist-boundary"));
    assert.ok(c.ok);
    const now = new Date("2026-09-07T01:00:00Z");
    const old = await checkPageWatchFor(identity, c.id, {
      now,
      fetch: async () => doc("STALE_BOUNDARY_CAPTURE must not reach any stored capture table."),
      beforePersist: async () => {
        const fresh = await checkPageWatchFor(identity, c.id, {
          now: new Date(now.getTime() + 31 * 60000),
          fetch: async () =>
            doc("Current worker won at the persistence boundary and owns this record."),
        });
        assert.ok(fresh.ok);
      },
    });
    assert.equal(old.ok, false);
    const sql = await getSql();
    const versions =
      await sql`select count(*)::int as n from artifact_versions where full_text like ${"%STALE_BOUNDARY_CAPTURE%"}`;
    assert.equal(versions[0]!.n, 0);
    assert.equal((await pageWatchDetailFor(identity, c.id)).history.length, 1);
  },
);

test(
  "row lock serializes takeover attempted between fencing read and capture writes",
  { timeout: 60000 },
  async () => {
    const c = await createPageWatchFor(identity, input("locked-boundary"));
    assert.ok(c.ok);
    const now = new Date("2026-09-07T01:00:00Z");
    let newer: ReturnType<typeof checkPageWatchFor> | undefined;
    const old = await checkPageWatchFor(identity, c.id, {
      now,
      fetch: async () =>
        doc("Old worker holds the row lock and must commit before the newer claimant."),
      afterPersistLock: async () => {
        newer = checkPageWatchFor(identity, c.id, {
          now: new Date(now.getTime() + 31 * 60000),
          fetch: async () =>
            doc("Newer worker starts after the old transaction releases the monitor lock."),
        });
        await new Promise((r) => setTimeout(r, 50));
      },
    });
    assert.ok(old.ok);
    assert.ok(newer);
    assert.ok((await newer).ok);
    const detail = await pageWatchDetailFor(identity, c.id);
    assert.equal(detail.history.length, 2);
    assert.match(detail.history[0].full_text, /Newer worker/);
    assert.match(detail.history[1].full_text, /Old worker/);
  },
);

test(
  "real mocked ingest preserves redirect, soft404 and HTTP200 challenge outcomes",
  { timeout: 60000 },
  async () => {
    const { setFetchImplForTests } = await import("./fetch-url.ts");
    const { ingestDocument } = await import("./ingest.ts");
    const old = process.env.TOWNREPORTER_NO_PLAYWRIGHT;
    process.env.TOWNREPORTER_NO_PLAYWRIGHT = "1";
    try {
      setFetchImplForTests(
        async () =>
          new Response(
            "<html><title>Access denied</title><main><h1>Access denied</h1><p>Please verify you are human before continuing. This security challenge is required to continue.</p></main></html>",
            { headers: { "content-type": "text/html" } },
          ),
      );
      const blocked = await ingestDocument("https://93.184.216.34/watch");
      assert.equal(watchOutcome(blocked, null), "blocked");
      setFetchImplForTests(
        async () =>
          new Response("<html><title>404 Not Found</title><main>Page not found</main></html>", {
            headers: { "content-type": "text/html" },
          }),
      );
      assert.equal(
        watchOutcome(await ingestDocument("https://93.184.216.34/watch"), null),
        "unavailable",
      );
      setFetchImplForTests(async (url) =>
        url.pathname === "/old"
          ? new Response("", { status: 302, headers: { location: "/new" } })
          : new Response(
              "<html><title>Record</title><main><h1>Record</h1><p>The contract value is now thirteen million dollars according to the official posted record.</p></main></html>",
              { headers: { "content-type": "text/html" } },
            ),
      );
      const moved = await ingestDocument("https://93.184.216.34/old");
      assert.equal(watchOutcome(moved, "Earlier contract value"), "moved");
      assert.equal(moved.redirectChain.at(-1), "https://93.184.216.34/new");
      assert.match(watchChangeText("Earlier contract value", moved.text), /Added:/);
    } finally {
      setFetchImplForTests(null);
      if (old === undefined) delete process.env.TOWNREPORTER_NO_PLAYWRIGHT;
      else process.env.TOWNREPORTER_NO_PLAYWRIGHT = old;
    }
  },
);
