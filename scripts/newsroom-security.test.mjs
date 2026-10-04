import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Strip comments so a stray mention in prose cannot satisfy a source-shape check below. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/*
  This used to be a source-text match: `assert.match(src, /assertHttpUrl/)`.
  That is satisfied by the import line alone, so the actual defect an audit
  introduced here -- swapping `assertHttpUrl(raw.trim())` for a bare
  `new URL(raw.trim())` inside sanitizePublicUrls -- left every assertion
  green, because "assertHttpUrl" still appeared in the file (in the now-dead
  import) and nothing checked what the function actually *returns*.

  Running the real function is not just feasible here, it is strictly
  stronger: schema.ts has no Node built-ins, so Node's default TS type
  stripping (this repo targets Node 22+, which supports it) loads it
  directly, no build step, no mock. Feed it URLs a bare `new URL()` parses
  happily but the SSRF/internal-host gate must reject, and check what comes
  out the other side.
*/
test("sanitizePublicUrls is the journalism URL gate, not an origin allowlist", async () => {
  const mod = await import(pathToFileURL(join(ROOT, "src/lib/news/schema.ts")).href);
  const blocked = [
    "http://127.0.0.1/admin", // loopback
    "http://169.254.169.254/latest/meta-data/", // cloud metadata endpoint
    "http://[::1]/", // IPv6 loopback
    "http://internal-service.internal/", // reserved TLD-ish suffix
    "http://my-desk.local/", // mDNS suffix
    "ftp://example.com/file", // non-http(s) scheme
    "not a url at all",
  ];
  const allowed = "https://example.com/a-real-story";
  const out = mod.sanitizePublicUrls([...blocked, allowed, allowed]); // + a dupe
  // Every blocked entry must be gone and the one legitimate URL survives,
  // deduplicated -- that's the whole contract of the function, proven by
  // running it rather than by hoping a call site was left unmodified.
  assert.deepEqual(out, [allowed]);
});

test("public sections return only reader navigation fields, never editorial guidance or sources", () => {
  const source = stripComments(readFileSync(join(ROOT, "src/lib/news/sections.ts"), "utf8"));
  const block = source.slice(source.indexOf("export const publicSections"), source.indexOf("export const editorSections"));
  assert.match(block, /getSections\(DEFAULT_NEWSROOM_ID\)/);
  const projection = block.match(/return (config\.sections\.map\([\s\S]*?\));/);
  assert.ok(projection, "public sections must explicitly project reader fields");
  const project = new Function("config", `return ${projection[1]};`);
  assert.deepEqual(project({ sections: [{ key: "schools", name: "Schools", visible: true, replacementKey: null,
    brief: "PRIVATE_BRIEF", instructions: "PRIVATE_INSTRUCTIONS", sourceIds: [42] }] }),
    [{ key: "schools", name: "Schools", visible: true, replacementKey: null }]);
});
