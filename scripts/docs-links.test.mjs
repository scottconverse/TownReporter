/*
  Every relative link in the documentation has to resolve.

  The directive asks for documentation aligned with the real product, and a
  link to a file that was renamed or deleted is the cheapest way for a manual
  to send a publisher somewhere that does not exist. Archive and operations
  history are excluded: those are dated records of what happened, not live
  guidance, and rewriting them is explicitly out of scope.

  Measured 2026-09-16: 43 live markdown files, 209 relative links, 0 missing.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = /[\\/](archive|operations)[\\/]/;

function markdownFiles(seed) {
  const out = [];
  const walk = (path) => {
    const stat = statSync(path);
    if (stat.isFile()) {
      if (path.endsWith(".md")) out.push(path);
      return;
    }
    for (const entry of readdirSync(path)) walk(join(path, entry));
  };
  walk(seed);
  return out;
}

test("every relative documentation link resolves", () => {
  const seeds = ["docs", "README.md", "SELF-HOSTING.md", "TODO.md"]
    .map((name) => join(root, name))
    .filter((path) => existsSync(path));
  assert.ok(seeds.length >= 4, "the documentation seeds are present");

  const files = seeds.flatMap((seed) => markdownFiles(seed)).filter((path) => !SKIP.test(path));
  // 43 live markdown files on 2026-09-16 once dated archive/operations history is excluded.
  assert.ok(files.length >= 30, `scanned a real documentation set (${files.length} files)`);

  const missing = [];
  let checked = 0;
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(/\]\(([^)\s]+)\)/g)) {
      const raw = match[1];
      if (/^(https?:|mailto:|#)/.test(raw)) continue;
      const target = raw.split("#")[0];
      if (!target) continue;
      checked += 1;
      if (!existsSync(resolve(dirname(file), target))) {
        missing.push(`${file.replace(root + "\\", "")} -> ${raw}`);
      }
    }
  }

  assert.ok(checked >= 100, `checked the whole link set (${checked})`);
  console.log(`docs links: ${files.length} files, ${checked} relative links, ${missing.length} missing`);
  assert.deepEqual(missing, [], `broken documentation links:\n${missing.join("\n")}`);
});
