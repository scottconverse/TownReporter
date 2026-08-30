import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * No two integration test files may listen on the same port.
 *
 * The Postgres integration files each boot the built server on a fixed port,
 * and CI runs them in parallel. sign-in-throttle's second server
 * (PORT_LOCKOUT) shipped with 3863 -- the same port as search-index -- so
 * whichever bound it first answered BOTH files' requests, wired to its own
 * scratch database. The search test then asked a lockout server about a row
 * that lived somewhere else: page rendered, empty, no error anywhere. Four
 * diagnostic CI cycles to corner, because any file run alone binds its own
 * port and passes.
 *
 * This walks every test file under src/ for `PORT... = <number>` constants
 * and fails if a number appears twice across files.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function* testFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* testFiles(p);
    else if (/\.test\.ts$/.test(e.name)) yield p;
  }
}

test("every integration test file binds its own port", () => {
  const owners = new Map(); // port -> [file:const]
  for (const file of testFiles(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/const (PORT\w*)\s*=\s*(\d{4,5})/g)) {
      const port = m[2];
      const tag = `${file.slice(ROOT.length + 1).replaceAll("\\", "/")}:${m[1]}`;
      if (!owners.has(port)) owners.set(port, []);
      owners.get(port).push(tag);
    }
  }
  const clashes = [...owners.entries()].filter(([, tags]) => tags.length > 1);
  assert.deepEqual(
    clashes,
    [],
    "these test files share a listen port; in parallel CI whichever binds " +
      "first answers BOTH files' requests against the wrong database:\n  " +
      clashes.map(([port, tags]) => `${port}: ${tags.join(" AND ")}`).join("\n  "),
  );
});
