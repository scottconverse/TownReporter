/*
  Behavior test for the boot-time schema warm-up itself (Unit CE, release
  0.6.80): does `runSchemaWarmup` actually run every registered module once,
  and does a second run (a second "boot") skip every one of them by marker,
  with no DDL issued the second time?

  PGlite-only, no `DATABASE_URL` -- see schema-ensure-second-call.test.ts for
  why: with one set, `getSql()` would return a Neon handle this test never
  built, silently measuring nothing.
*/
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { createServer, type ViteDevServer } from "vite";

/** The one PGlite instance this process's `getSql()` is pointed at. */
function pgliteInstance(): Promise<PGlite> {
  return (globalThis as typeof globalThis & { __pgliteInstance__: Promise<PGlite> })
    .__pgliteInstance__;
}

describe("runSchemaWarmup", () => {
  let vite: ViteDevServer;
  let getSql: typeof import("./db.ts").getSql;
  let runSchemaWarmup: typeof import("./schema-warmup.ts").runSchemaWarmup;
  let SCHEMA_WARMUP_REGISTRY: typeof import("./schema-warmup.ts").SCHEMA_WARMUP_REGISTRY;

  before(async () => {
    if (process.env.DATABASE_URL) {
      throw new Error(
        "this test measures the PGlite handle; unset DATABASE_URL (with-app-env.mjs does not set it)",
      );
    }
    // schema-warmup.ts pulls in desk.ts, which imports "@/lib/db" -- plain
    // `node --test` cannot resolve that alias, so this module graph is loaded
    // through Vite the same way article-headline-edit.test.ts loads desk.ts.
    vite = await createServer({
      configFile: false,
      server: { middlewareMode: true },
      resolve: { alias: { "@": join(process.cwd(), "src") } },
    });
    ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
    ({ runSchemaWarmup, SCHEMA_WARMUP_REGISTRY } = await vite.ssrLoadModule(
      "/src/lib/schema-warmup.ts",
    ));
  });

  after(async () => vite.close());

  it("runs every registered module at least once on a cold database", async () => {
    const results = await runSchemaWarmup({ timeoutMs: 30_000 });
    assert.equal(
      results.length,
      SCHEMA_WARMUP_REGISTRY.length,
      "one result per registered module, in registry order",
    );
    assert.deepEqual(
      results.map((r) => r.name),
      SCHEMA_WARMUP_REGISTRY.map((e) => e.name),
      "results must be in the same order as the registry (one line per module, in order)",
    );
    const failed = results.filter((r) => r.status === "failed");
    assert.deepEqual(
      failed,
      [],
      `every module must warm cleanly against a cold PGlite database: ${JSON.stringify(failed)}`,
    );
    for (const r of results) {
      assert.ok(Number.isFinite(r.ms) && r.ms >= 0, `${r.name} must report a real elapsed ms`);
    }
  });

  it("a second run skips every module by marker, with no foreign DDL", async () => {
    const MARKER_TABLE = "_schema_ensure_state";
    /**
     * Is this statement DDL against something other than the marker table
     * itself? Same instrument as schema-ensure-second-call.test.ts.
     */
    function foreignDdl(text: string): boolean {
      if (!/\b(alter|create)\b/i.test(text)) return false;
      return !text.includes(MARKER_TABLE);
    }

    await getSql(); // make sure the instance + first migration pass exist
    const pg = await pgliteInstance();
    const original = pg.query;
    const seen: string[] = [];
    (pg as unknown as { query: unknown }).query = (text: string, params?: unknown[]) => {
      seen.push(text);
      return original.call(pg, text as never, params as never);
    };
    const restore: () => void = () => {
      (pg as unknown as { query: typeof original }).query = original;
    };
    try {
      const results = await runSchemaWarmup({ timeoutMs: 30_000 });
      const statuses = new Set(results.map((r) => r.status));
      assert.deepEqual(
        [...statuses],
        ["skipped-by-marker"],
        `every module must report skipped-by-marker on a warm database, got: ${JSON.stringify(
          results.map((r) => ({ name: r.name, status: r.status })),
        )}`,
      );
      const foreign = seen.filter(foreignDdl);
      assert.deepEqual(
        foreign,
        [],
        `a second boot's warm-up must not issue any schema DDL: ${JSON.stringify(foreign)}`,
      );
    } finally {
      restore();
    }
  });

  it("logs exactly one line per module, naming it and its status", async () => {
    const lines: string[] = [];
    await runSchemaWarmup({ timeoutMs: 30_000, log: (line) => lines.push(line) });
    assert.equal(lines.length, SCHEMA_WARMUP_REGISTRY.length);
    for (const entry of SCHEMA_WARMUP_REGISTRY) {
      assert.ok(
        lines.some((line) => line.includes(`[schema-warmup] ${entry.name} `)),
        `expected a log line naming "${entry.name}": ${JSON.stringify(lines)}`,
      );
    }
    for (const line of lines) {
      assert.match(
        line,
        /^\[schema-warmup\] \S+ \d+ms (ran|skipped-by-marker|failed.*)$/,
        `log line must read "name Nms status": ${line}`,
      );
    }
  });

  it("never throws when one module's run() rejects -- logs it and continues", async () => {
    const lines: string[] = [];
    const boom = new Error("simulated failure for this module only");
    const patchedFn = SCHEMA_WARMUP_REGISTRY[1]!.run;
    const patched = SCHEMA_WARMUP_REGISTRY as unknown as { [k: number]: { run: () => Promise<void> } };
    const originalRun = patched[1]!.run;
    patched[1]!.run = () => Promise.reject(boom);
    try {
      const results = await runSchemaWarmup({ timeoutMs: 30_000, log: (line) => lines.push(line) });
      assert.equal(results.length, SCHEMA_WARMUP_REGISTRY.length, "one bad module must not stop the rest from running");
      const failedEntry = results[1]!;
      assert.equal(failedEntry.status, "failed");
      assert.match(failedEntry.error ?? "", /simulated failure for this module only/);
      const others = results.filter((_, i) => i !== 1);
      assert.ok(
        others.every((r) => r.status === "ran" || r.status === "skipped-by-marker"),
        `every other module must still complete: ${JSON.stringify(others)}`,
      );
    } finally {
      patched[1]!.run = originalRun;
      void patchedFn;
    }
  });
});
