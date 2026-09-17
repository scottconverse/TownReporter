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

/**
 * GitHub's heading anchor: lower-case, drop everything that is not a letter,
 * digit, underscore, hyphen or space, then turn EACH space into a hyphen.
 *
 * Getting this wrong is easy and expensive: a checker that collapsed runs of
 * spaces reported eleven "broken" anchors across the docs, every one of them a
 * false positive caused by an em dash (two spaces -> two hyphens) or a path in
 * the heading ("Server (/desk/ops)" loses its slash). The docs were correct.
 */
function headingSlug(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

test("every documentation anchor link points at a real heading", () => {
  const seeds = ["docs", "README.md", "SELF-HOSTING.md", "TODO.md"]
    .map((name) => join(root, name))
    .filter((path) => existsSync(path));
  const files = seeds.flatMap((seed) => markdownFiles(seed)).filter((path) => !SKIP.test(path));

  const slugs = new Map();
  const slugsFor = (file) => {
    if (!slugs.has(file)) {
      const set = new Set();
      for (const m of readFileSync(file, "utf8").matchAll(/^#{1,6} +(.+)$/gm)) {
        set.add(headingSlug(m[1].trim()));
      }
      slugs.set(file, set);
    }
    return slugs.get(file);
  };

  const broken = [];
  let checked = 0;
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(/\]\(([^)\s]*#[^)\s]+)\)/g)) {
      const raw = match[1];
      if (/^https?:/.test(raw)) continue;
      const [pathPart, fragment] = raw.split("#");
      const target = pathPart ? resolve(dirname(file), pathPart) : file;
      if (!existsSync(target) || !target.endsWith(".md")) continue;
      checked += 1;
      if (!slugsFor(target).has(fragment.toLowerCase())) {
        broken.push(`${file.replace(root + "\\", "")} -> ${raw}`);
      }
    }
  }

  console.log(`docs anchors: ${checked} anchor links, ${broken.length} broken`);
  assert.ok(checked >= 20, `checked the anchor set (${checked})`);
  assert.deepEqual(broken, [], `anchor links with no matching heading:\n${broken.join("\n")}`);
});
