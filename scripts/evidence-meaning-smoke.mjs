/*
  One real check of the meaning model (D286). The ordinary suite never loads
  it (default-deny fetch, fake embedder); this script does, once, into a
  throwaway cache under the worktree's `.smoke-data/`.

  PASS when "city internet" is closer to the NextLight sentence than to the
  fire-closure sentence -- the example the def1 experiment used.

  Run from the worktree:
    node --experimental-strip-types scripts/evidence-meaning-smoke.mjs
*/
import { stat, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
process.env.TOWNREPORTER_DATA_ROOT = join(here, "..", ".smoke-data");

const { embedTexts, dotProduct, modelCacheDir } = await import(
  "../src/lib/news/evidence-embed.server.ts"
);

const query = "city internet";
const relevant = "NextLight broadband service for Longmont homes";
const other = "Button Rock Preserve closed for fire";

const started = Date.now();
const [q, a, b] = await embedTexts([query, relevant, other]);
const firstLoadMs = Date.now() - started;

const scoreRelevant = dotProduct(q, a);
const scoreOther = dotProduct(q, b);

async function folderSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += await folderSize(path);
    else total += (await stat(path)).size;
  }
  return total;
}

const bytes = await folderSize(modelCacheDir());
console.log(`first load: ${firstLoadMs} ms`);
console.log(`model folder: ${modelCacheDir()} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
console.log(`${query} vs NextLight: ${scoreRelevant.toFixed(4)}`);
console.log(`${query} vs fire:      ${scoreOther.toFixed(4)}`);
console.log(scoreRelevant > scoreOther ? "PASS" : "FAIL");
process.exit(scoreRelevant > scoreOther ? 0 : 1);
