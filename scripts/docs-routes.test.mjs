/*
  A URL in the documentation has to be a URL the app serves.

  docs/manual.md listed `/desk/page-watches` in its route table. No such route
  exists: the manual page-watch panel is mounted inside `/desk/dark`
  (src/routes/desk.dark.tsx), and `git grep page-watches` finds only a query
  key. A publisher following the manual would have hit a 404.

  Dated archive, operations history and proofs are excluded - those record what
  happened, may quote a URL precisely because it was broken, and are not
  rewritten. Measured 2026-09-16: 28 route files, 27 documented paths, 0
  unresolved.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/*
  Dated records are excluded, not just the archive: proofs under docs/proofs
  quote broken things on purpose to document them (the report from this very
  change names /desk/page-watches because that URL was the defect).
*/
const SKIP = /[\\/](archive|operations|proofs)[\\/]/;
/** Served by the server rather than a file route, or a path *prefix* only. */
const NOT_A_FILE_ROUTE = /^\/(feed|sitemap\.xml|robots\.txt)$/;

function markdownFiles(seed) {
  const out = [];
  const walk = (path) => {
    const stat = statSync(path);
    if (stat.isFile()) { if (path.endsWith(".md")) out.push(path); return; }
    for (const entry of readdirSync(path)) walk(join(path, entry));
  };
  walk(seed);
  return out;
}

/** src/routes/desk.queue.tsx serves /desk/queue; [.] escapes a literal dot. */
function routePath(file) {
  const name = file.replace(/\.tsx?$/, "");
  const escaped = name.replace(/\[\.\]/g, "\u0000");
  const path = "/" + escaped.replace(/^index$/, "").replace(/\.index$/, "").replace(/\./g, "/");
  return (path.replace(/\u0000/g, ".").replace(/\/$/, "") || "/").replace(/\/(\$|:)\w+/g, "/:id");
}

test("every URL the documentation names is a route the app serves", () => {
  const routeDir = join(root, "src", "routes");
  const routes = new Set(
    readdirSync(routeDir)
      .filter((f) => /\.tsx?$/.test(f) && !f.startsWith("__"))
      .map(routePath),
  );
  assert.ok(routes.size >= 20, `found the route set (${routes.size})`);

  const docs = ["docs", "README.md", "SELF-HOSTING.md", "TODO.md"]
    .map((name) => join(root, name))
    .filter((path) => existsSync(path))
    .flatMap((seed) => markdownFiles(seed))
    .filter((path) => !SKIP.test(path));

  const named = new Map();
  for (const file of docs) {
    for (const m of readFileSync(file, "utf8").matchAll(
      /(?<![\w:/.-])\/(desk|login|corrections|about|how-we-report|feed|articles|evidence|sitemap\.xml|robots\.txt)([\w/.:$-]*)/g,
    )) {
      const path = "/" + (m[1] + m[2]).replace(/[.,)`'"]+$/, "");
      if (!named.has(path)) named.set(path, file.replace(root + "\\", ""));
    }
  }
  assert.ok(named.size >= 15, `found the documented paths (${named.size})`);

  const unresolved = [];
  for (const [path, where] of named) {
    if (path.endsWith("/")) continue;                 // a section prefix, not a URL
    if (NOT_A_FILE_ROUTE.test(path)) continue;        // served by the server, or a feed
    const normalized = path.replace(/\/(\$|:)\w+/g, "/:id");
    if (!routes.has(normalized)) unresolved.push(`${path}  (${where})`);
  }

  console.log(`doc routes: ${routes.size} routes, ${named.size} documented paths, ${unresolved.length} unresolved`);
  assert.deepEqual(unresolved, [], `documented URLs with no route:\n${unresolved.join("\n")}`);
});
