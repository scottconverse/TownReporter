import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function everyServerFnHasMiddleware(src, middleware) {
  const names = [...src.matchAll(/export const (\w+) = createServerFn/g)].map((m) => m[1]);
  const missing = [];
  for (const name of names) {
    const idx = src.indexOf(`export const ${name} = createServerFn`);
    const next = src.indexOf("export const ", idx + 20);
    const block = next === -1 ? src.slice(idx) : src.slice(idx, next);
    if (!block.includes(`.middleware([${middleware}])`)) missing.push(name);
  }
  return missing;
}

test("sanitizePublicUrls is the journalism URL gate, not an origin allowlist", () => {
  const src = readFileSync(join(ROOT, "src/lib/news/schema.ts"), "utf8");
  assert.match(src, /export function sanitizePublicUrls/);
  assert.match(src, /assertHttpUrl/);
  assert.doesNotMatch(src, /allowed\.has\(u\.origin\)/);
  assert.match(src, /ScanResultSchema/);
  assert.match(src, /DraftResultSchema/);
});

test("every desk and dark mutation is gated by deskMiddleware", () => {
  const desk = readFileSync(join(ROOT, "src/lib/news/desk.ts"), "utf8");
  const dark = readFileSync(join(ROOT, "src/lib/news/dark.ts"), "utf8");
  assert.deepEqual(everyServerFnHasMiddleware(desk, "deskMiddleware"), []);
  assert.deepEqual(everyServerFnHasMiddleware(dark, "deskMiddleware"), []);
  assert.match(desk, /export const publishLead[\s\S]*?\.middleware\(\[deskMiddleware\]\)/);
  assert.match(desk, /sanitizePublicUrls/);
  assert.doesNotMatch(desk, /originAllowlist\(/);
  assert.match(desk, /assertRate\(context\.userId, "scan"\)/);
  assert.match(desk, /assertRate\(context\.userId, "draft"\)/);
  assert.match(desk, /withTransaction/);
  assert.match(dark, /assertRate\(context\.userId, "dark"\)/);
  assert.match(dark, /audit\(\s*(?:context\.)?userId,\s*"dark"/);
});

test("membership rejects a second identity (unauthorized publish path)", () => {
  const membership = readFileSync(join(ROOT, "src/lib/news/membership.ts"), "utf8");
  const auth = readFileSync(join(ROOT, "src/lib/news/desk-auth.ts"), "utf8");
  assert.match(membership, /class ForbiddenError/);
  assert.match(membership, /readonly status = 403/);
  assert.match(membership, /throw new ForbiddenError/);
  assert.match(membership, /role === "owner" \|\| mine\[0\]\?\.role === "editor"/);
  assert.match(auth, /requireUserId/);
  assert.match(auth, /requireEditor/);
  assert.match(auth, /assertSameSiteRequest/);
});

test("public paper SQL is a single LIMIT and has no desk middleware", () => {
  const pub = readFileSync(join(ROOT, "src/lib/news/public.ts"), "utf8");
  assert.doesNotMatch(pub, /limit 30\s*\n\s*limit /);
  assert.doesNotMatch(pub, /deskMiddleware/);
  assert.doesNotMatch(pub, /confirm_token/);
  assert.doesNotMatch(pub, /subscribeNewsletter/);
});

test("SSRF: fetch follows redirects manually and re-asserts each hop", () => {
  const src = readFileSync(join(ROOT, "src/lib/news/fetch-url.ts"), "utf8");
  assert.match(src, /redirect: "manual"/);
  assert.match(src, /fetchPublicHttpTracked/);
  assert.match(src, /assertPublicHttpUrl/);
  assert.match(src, /lookup\(host, \{ all: true \}\)/);
  assert.match(src, /isBlockedAddress/);
  assert.match(src, /isIP\(host\) && isBlockedAddress\(host\)/);
});

test("scan does not stamp last_hash until the writing pass succeeds", () => {
  const desk = readFileSync(join(ROOT, "src/lib/news/desk.ts"), "utf8");
  assert.match(desk, /pendingHashes/);
  assert.match(desk, /shouldCommitFetchHashes/);
  assert.match(desk, /previousScanNeedsReread/);
  assert.match(desk, /parseScanResult/);
  assert.doesNotMatch(desk, /set last_hash = \$\{hash\}, last_fetched_at = now\(\)/);
});

test("scan never auto-promotes model URLs to official or Tier A", () => {
  const desk = readFileSync(join(ROOT, "src/lib/news/desk.ts"), "utf8");
  assert.match(desk, /'discovered', 'unclassified', 'proposed'/);
  assert.doesNotMatch(desk, /'official', 'B', 'proposed'/);
  assert.match(desk, /ingestUrl/);
  assert.doesNotMatch(desk, /tier: 'A', 'accepted'/);
});

test("scan includes Tier C and never prunes snapshot history", () => {
  const desk = readFileSync(join(ROOT, "src/lib/news/desk.ts"), "utf8");
  assert.doesNotMatch(desk, /tier <> 'C'/);
  assert.doesNotMatch(desk, /delete from snapshots/);
  assert.doesNotMatch(desk, /offset 8/);
});

test("Dark Desk digs, does not auto-publish, does not cap confidence", () => {
  const dark = readFileSync(join(ROOT, "src/lib/news/dark.ts"), "utf8");
  const desk = readFileSync(join(ROOT, "src/lib/news/desk.ts"), "utf8");
  const prompt = readFileSync(join(ROOT, "src/lib/news/dark-prompt.ts"), "utf8");
  assert.match(dark, /researchLoop/);
  assert.match(dark, /continueInvestigation/);
  assert.match(dark, /Math\.min\(1,/);
  assert.doesNotMatch(dark, /Math\.min\(0\.5,/);
  assert.doesNotMatch(dark, /insert into articles/);
  assert.doesNotMatch(dark, /update leads set status = 'published'/);
  assert.match(desk, /Held and killed leads cannot print|Un-hold this lead before publishing/);
  assert.doesNotMatch(desk, /Dark desk items cannot print/);
  assert.doesNotMatch(prompt, /CAPPED AT 0\.5/);
  assert.match(prompt, /Search broadly/);
});

test("ingest follows documents across origins", () => {
  const src = readFileSync(join(ROOT, "src/lib/news/ingest.ts"), "utf8");
  assert.doesNotMatch(src, /abs\.origin !== base\.origin/);
});

test("scan URL history writes newsroom_id", () => {
  const desk = readFileSync(join(ROOT, "src/lib/news/desk.ts"), "utf8");
  assert.match(desk, /insert into snapshots \(user_id, newsroom_id, source_id/);
});
