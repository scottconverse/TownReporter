#!/usr/bin/env node
/**
 * Nitro/Rolldown emits a cyclic `_ssr/ssr.mjs` barrel:
 *   - `export { ssr_exports as s }` where `ssr_exports` is never bound
 *     → SyntaxError, every route `{ error: true, status: 500, unhandled: true }`
 *   - sibling chunks `import { c as __exportAll } from "./ssr.mjs"` while
 *     ssr.mjs imports those chunks → `__exportAll is not a function`
 *
 * Rewrite `s` to the real server entry and pull `__exportAll` from `_runtime.mjs`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Where the server bundle lands depends on the Nitro preset, and the barrel bug
 * is identical in both. `node-server` (self-hosted, the default) writes
 * `.output/server/`; `vercel` writes `.vercel/output/functions/__server.func/`.
 * Hardcoding the Vercel path made this script silently no-op on a self-hosted
 * build — it printed "skip" and every route then 500'd with
 * `Export 'ssr_exports' is not defined in module`.
 */
const SERVER_DIRS = [
  join(root, ".output/server"),
  join(root, ".vercel/output/functions/__server.func"),
];

const serverDir = SERVER_DIRS.find((dir) => existsSync(join(dir, "_ssr/ssr.mjs")));

if (!serverDir) {
  console.log("[patch-ssr] no ssr.mjs — skip");
  process.exit(0);
}

const ssrDir = join(serverDir, "_ssr");
const barrel = join(ssrDir, "ssr.mjs");
console.log(`[patch-ssr] server bundle: ${serverDir}`);

let changed = 0;
let barrelSrc = readFileSync(barrel, "utf8");
if (barrelSrc.includes("ssr_exports as s")) {
  if (!/\bserver_default\b/.test(barrelSrc)) {
    console.error("[patch-ssr] ssr.mjs has ssr_exports but no server_default");
    process.exit(1);
  }
  barrelSrc = barrelSrc.replaceAll("ssr_exports as s", "server_default as s");
  writeFileSync(barrel, barrelSrc);
  changed += 1;
  console.log("[patch-ssr] ssr.mjs: ssr_exports -> server_default");
}

const importRe =
  /import\s*\{\s*c\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s*from\s*["']\.\/ssr\.mjs["'];?/g;

if (existsSync(ssrDir)) {
  for (const name of readdirSync(ssrDir)) {
    if (!name.endsWith(".mjs") || name === "ssr.mjs") continue;
    const path = join(ssrDir, name);
    const src = readFileSync(path, "utf8");
    importRe.lastIndex = 0;
    if (!importRe.test(src)) continue;
    importRe.lastIndex = 0;
    const next = src.replace(importRe, 'import { r as $1 } from "../_runtime.mjs";');
    if (next !== src) {
      writeFileSync(path, next);
      changed += 1;
      console.log(`[patch-ssr] ${name}: __exportAll from _runtime.mjs`);
    }
  }
}

console.log(changed ? `[patch-ssr] patched ${changed} file(s)` : "[patch-ssr] already healthy");
