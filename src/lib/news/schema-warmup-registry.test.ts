/*
  Registry-completeness check for the boot-time schema warm-up (Unit CE,
  release 0.6.80).

  This is a runtime check, not a text search: it loads every candidate module
  through Vite's `ssrLoadModule` (the same mechanism `article-headline-edit.test.ts`
  and friends use to import "@/..."-aliased modules like desk.ts under plain
  `node --test`) and reads its REAL exports (`Object.keys` of the loaded module
  namespace), then compares that against `SCHEMA_WARMUP_REGISTRY`
  (src/lib/schema-warmup.ts). A grep over source text would pass even if an
  `ensure*Schema` function were renamed, wrapped, or re-exported in a way a
  text pattern no longer matches; loading the module and looking at what it
  actually exports cannot be fooled that way.

  Candidate discovery still reads file text (there is no way to know which
  files to load without looking at them somehow), but it is used ONLY to build
  the list of files to load -- matching `ensureSchemaOnce(` OR
  `_schema_ensure_state` as a plain substring (the second one so
  legal-removal-schema.ts is still found: it deliberately does NOT call the
  shared `ensureSchemaOnce`, see its own file docstring, but still writes into
  the same marker table under its own name). Both are deliberately generous so
  they can only produce false positives (a file that mentions the string in a
  comment, loaded and found to define nothing worth registering -- harmless)
  and never a false negative that would hide a real gap. Every assertion below
  is about the loaded module's actual exports, not the substring search.
*/
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

const libDirUrl = new URL("../", import.meta.url);
const newsDirUrl = new URL("./", import.meta.url);

/**
 * Exported names that look like `ensure*Schema` (or an equivalently-shaped
 * `ensure*` DDL entry point this repo has) but are intentionally NOT part of
 * the boot warm-up, with the reason -- the same "small explicit allowlist,
 * every entry needs a reason" shape as `schema-parity.test.ts`.
 */
const ALLOWLIST: Record<string, { reason: string }> = {
  "db.ts#ensureSchemaOnce": {
    reason: "the mechanism itself, not a module's DDL batch -- nothing to warm",
  },
  "db.ts#ensureDbReady": {
    reason:
      "PGlite migration bootstrap (applies migrations/*.sql), not an ensureSchemaOnce DDL batch; " +
      "already run at dev/prod boot by pgliteBootstrapPlugin / db.ts's own eager-start block",
  },
};

/** Files directly under `dir` (non-recursive) that look like they define a schema-ensure entry point. */
async function candidateFiles(dir: URL, prefix: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const hits: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".d.ts")) continue;
    const text = await readFile(new URL(entry.name, dir), "utf8");
    if (text.includes("ensureSchemaOnce(") || text.includes("_schema_ensure_state")) {
      hits.push(prefix + entry.name);
    }
  }
  return hits;
}

/** Exported function names shaped like an `ensure*Schema`/`ensure*Documents` DDL entry point. */
function ensureExportNames(mod: Record<string, unknown>): string[] {
  return Object.keys(mod).filter((key) => /^ensure[A-Z]/.test(key) && typeof mod[key] === "function");
}

describe("every ensure*Schema export is registered in SCHEMA_WARMUP_REGISTRY", () => {
  let vite: ViteDevServer;
  let SCHEMA_WARMUP_REGISTRY: typeof import("../schema-warmup.ts").SCHEMA_WARMUP_REGISTRY;

  before(async () => {
    vite = await createServer({
      configFile: false,
      server: { middlewareMode: true },
      resolve: { alias: { "@": join(process.cwd(), "src") } },
    });
    ({ SCHEMA_WARMUP_REGISTRY } = await vite.ssrLoadModule("/src/lib/schema-warmup.ts"));
  });

  after(async () => vite.close());

  it("no module defines an ensure-schema export missing from the registry", async () => {
    const files = [
      ...(await candidateFiles(libDirUrl, "")),
      ...(await candidateFiles(newsDirUrl, "news/")),
    ];
    assert.ok(
      files.length > 10,
      `expected many candidate files, found ${files.length}: ${files.join(", ")}`,
    );

    // Identity, not (module, exportName): a module can re-export another
    // module's already-registered function under its own name (desk.ts
    // re-exports follow-ups.ts's ensureFollowUpsSchema for its callers), and
    // that must not read as a second, unregistered function.
    const registeredFns = new Set(SCHEMA_WARMUP_REGISTRY.map((e) => e.fn));
    const foundFns = new Set<unknown>();
    const missing: string[] = [];

    for (const file of files) {
      const mod = (await vite.ssrLoadModule(`/src/lib/${file}`)) as Record<string, unknown>;
      for (const exportName of ensureExportNames(mod)) {
        const key = `${file}#${exportName}`;
        const value = mod[exportName];
        foundFns.add(value);
        if (ALLOWLIST[key]) continue;
        if (!registeredFns.has(value)) missing.push(key);
      }
    }

    assert.deepEqual(
      missing,
      [],
      `these ensure*Schema exports are not in SCHEMA_WARMUP_REGISTRY (src/lib/schema-warmup.ts) -- ` +
        `add an entry, or add an ALLOWLIST reason here if it genuinely should not run at boot:\n` +
        missing.join("\n"),
    );

    // And the reverse: every registry entry's `fn` must be a real function
    // this scan actually found somewhere -- a stale reference (the export was
    // renamed or removed) would otherwise silently warm nothing at boot.
    const staleEntries = SCHEMA_WARMUP_REGISTRY.filter((e) => !foundFns.has(e.fn)).map(
      (e) => `${e.module}#${e.exportName}`,
    );
    assert.deepEqual(
      staleEntries,
      [],
      `these SCHEMA_WARMUP_REGISTRY entries do not match any real ensure*Schema export found by this scan ` +
        `(stale module/exportName, or the export was renamed):\n` +
        staleEntries.join("\n"),
    );
  });
});
