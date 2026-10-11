#!/usr/bin/env node
/**
 * Copy binary runtime assets the bundler leaves behind.
 *
 * Rolldown inlines PGLite's JavaScript into `_libs/electric-sql__pglite.mjs`
 * but does not carry its three sibling binaries. At runtime the module reads
 * them from its own directory, so a built server without them dies with
 * `ENOENT: ... _libs/pglite.data` and every database-backed route 500s.
 *
 * Only matters on the no-`DATABASE_URL` fallback path — a deployment with real
 * Postgres never loads PGLite — but that fallback is exactly how someone tries
 * the app before setting a database up, so it has to work.
 *
 * Safe to re-run, and a no-op when there is no build output.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Same two layouts `patch-ssr-exports.mjs` handles: self-hosted, then Vercel. */
const SERVER_DIRS = [
  join(root, ".output/server"),
  join(root, ".vercel/output/functions/__server.func"),
];

/** `[sourceFile, destinationSubdirectory]` — dest is relative to the server dir. */
const ASSETS = [
  ["node_modules/@electric-sql/pglite/dist/pglite.data", "_libs"],
  ["node_modules/@electric-sql/pglite/dist/pglite.wasm", "_libs"],
  ["node_modules/@electric-sql/pglite/dist/initdb.wasm", "_libs"],
];

const serverDir = SERVER_DIRS.find((dir) => existsSync(dir));
if (!serverDir) {
  console.log("[assets] no server build — skip");
  process.exit(0);
}

let copied = 0;
let missing = 0;
for (const [rel, destSub] of ASSETS) {
  const from = join(root, rel);
  if (!existsSync(from)) {
    console.warn(`[assets] missing source: ${rel}`);
    missing += 1;
    continue;
  }
  const destDir = join(serverDir, destSub);
  mkdirSync(destDir, { recursive: true });
  copyFileSync(from, join(destDir, rel.split("/").pop()));
  copied += 1;
}

console.log(`[assets] copied ${copied} file(s) into ${serverDir}`);
// render-fetch uses a variable import to keep Playwright out of serverless
// bundles. Nitro cannot trace that import, so a standalone Node deployment
// needs the two installed packages copied explicitly, with matching versions.
if (serverDir === SERVER_DIRS[0]) {
  const packagePath = join(serverDir, "package.json");
  const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
  for (const name of ["playwright", "playwright-core"]) {
    const source = join(root, "node_modules", name);
    if (!existsSync(join(source, "package.json"))) {
      console.warn(`[assets] missing runtime package: ${name}`);
      missing += 1;
      continue;
    }
    cpSync(source, join(serverDir, "node_modules", name), { recursive: true });
    const { version } = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
    manifest.dependencies ??= {};
    manifest.dependencies[name] = version;
  }
  writeFileSync(packagePath, JSON.stringify(manifest, null, 2) + "\n");
  console.log("[assets] packaged Playwright runtime; Chromium uses PLAYWRIGHT_BROWSERS_PATH or the user's Playwright cache");
}
// A missing source means the PGLite fallback will ENOENT at runtime. Fail the
// build rather than ship a server that 500s on its first database read.
if (missing > 0) process.exit(1);
