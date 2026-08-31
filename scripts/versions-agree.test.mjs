import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every surface that states the version states the SAME version.
 *
 * v0.5.2 shipped for eleven minutes with package.json at 0.5.2 while
 * APP_VERSION -- the constant the footer, the Server page, and the source
 * download all report -- still said 0.5.1, and the doc headers agreed with
 * the wrong one. Nothing caught it because nothing compared them. With a
 * release per finished watchlist item, this happens again the first time a
 * bump forgets a surface -- unless the suite refuses.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("package.json, APP_VERSION, CHANGELOG, and doc headers name one version", () => {
  const pkg = JSON.parse(read("package.json")).version;
  const claims = [
    ["src/lib/version.ts", /APP_VERSION = "([^"]+)"/],
    ["CHANGELOG.md", /Current release: \*\*([^*]+)\*\*/],
    ["README.md", /Current release: \[([^\]]+)\]/],
    ["docs/setup.md", /Current release: \[([^\]]+)\]/],
    ["docs/editor.md", /Current release: \[([^\]]+)\]/],
    ["docs/manual.md", /\*\*Version ([0-9.]+) ·/],
  ];
  const offenders = [];
  for (const [file, re] of claims) {
    const m = read(file).match(re);
    if (!m) offenders.push(`${file}: version claim not found (pattern moved?)`);
    else if (m[1] !== pkg) offenders.push(`${file}: says ${m[1]}, package.json says ${pkg}`);
  }
  assert.deepEqual(
    offenders,
    [],
    "these surfaces disagree with package.json about the current version:\n  " +
      offenders.join("\n  "),
  );
});
