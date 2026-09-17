import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The reader-facing asset directory must not carry the server's database.
 *
 * PGLite is the server-side fallback database, behind a dynamic import in
 * db.ts and used only when DATABASE_URL is unset. A gate audit found its
 * WebAssembly published to `.output/public`: a 10 MB .wasm, a 6 MB .data and a
 * 0.4 MB initdb -- 16.4 MB, 93% of the public assets, referenced by no client
 * script and served to every reader anonymously. `vite.config.ts` now resolves
 * `@electric-sql/pglite` to an inert stub on the client build; the server keeps
 * its own copy under `.output/server`, which is the only one ever used.
 *
 * This guards the OUTPUT, not the config, because the config could be correct
 * and a future dependency could pull the same trick a different way. It only
 * runs when a build is present -- a fresh clone that has not built yet skips
 * with a reason rather than failing.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, ".output", "public");

const built = existsSync(PUBLIC);

test(
  "no pglite payload is served to readers",
  { skip: built ? false : "no build present (.output/public); run `npm run build` first" },
  () => {
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const s = statSync(full);
        if (s.isDirectory()) {
          walk(full);
          continue;
        }
        if (/pglite|initdb/i.test(name)) {
          offenders.push(`${full.slice(ROOT.length + 1)} (${(s.size / 1e6).toFixed(1)} MB)`);
        }
      }
    };
    walk(PUBLIC);
    assert.deepEqual(
      offenders,
      [],
      "the server's fallback database is being served to readers again:\n  " + offenders.join("\n  "),
    );
  },
);

test(
  "the public asset directory stays lean",
  { skip: built ? false : "no build present; run `npm run build` first" },
  () => {
    let total = 0;
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const s = statSync(full);
        if (s.isDirectory()) walk(full);
        else total += s.size;
      }
    };
    walk(PUBLIC);
    const mb = total / 1e6;
    // It measured 2 MB after the fix and 18 MB before. Ten is a wide fence that
    // still catches a multi-megabyte binary wandering back in.
    assert.ok(
      mb < 10,
      `.output/public is ${mb.toFixed(1)} MB; something large is being shipped to readers`,
    );
  },
);
