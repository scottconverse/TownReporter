import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/**
 * One newspaper's address must not be baked into every copy of the software.
 *
 * `public/robots.txt` ended with `Sitemap: https://townreporter.org/sitemap.xml`.
 * Harmless on the paper it was written for, wrong on every other: a self-hoster
 * in another town shipped a file telling search engines to go index somebody
 * else's newspaper, while their own archive -- the entire reason the sitemap
 * exists -- was advertised nowhere. A gate audit filed it as QA-01.
 *
 * The rule is not "never mention the name". Documentation, the landing page and
 * this project's own release notes all reasonably say where the reference paper
 * lives. The rule is that nothing a running copy SERVES may assert it, because
 * only the server knows its own address.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Files whose contents are served to a visitor or a crawler as-is. */
function servedFiles() {
  /*
    `--others --exclude-standard` as well as tracked files.

    The first version listed tracked files only. Proving it worked, the
    mutation that hard-codes the domain inside the NEW route file sailed
    through -- because that file was not staged yet. A gate that cannot see
    work in progress cannot stop it being committed, which is the one moment
    it is needed. Ignored files stay out: build output is not served source.
  */
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "public", "src/routes", "server"],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  return out
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|txt|xml|json|webmanifest)$/.test(f));
}

test("no served file hard-codes the reference paper's domain", () => {
  const offenders = [];
  for (const file of servedFiles()) {
    let text;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/townreporter\.org/i.test(line)) return;
      // A comment explaining the reference deployment is fine; a value that
      // gets sent to a visitor is not.
      const trimmed = line.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("#")) return;
      offenders.push(`${file}:${i + 1}  ${trimmed.slice(0, 100)}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "these serve one paper's address to every copy of the software; read it from " +
      `the request or PUBLIC_SITE_URL instead:\n  ${offenders.join("\n  ")}`,
  );
});

test("robots.txt is served by a route, not shipped as a fixed file", () => {
  // A static file cannot know where it is running. This is the shape that makes
  // the test above possible to keep passing.
  let staticFile = null;
  try {
    staticFile = readFileSync(join(ROOT, "public/robots.txt"), "utf8");
  } catch {
    /* good: there is no static robots.txt */
  }
  assert.equal(
    staticFile,
    null,
    "public/robots.txt is back; it cannot know the server's own address, which is " +
      "how one paper's sitemap ended up advertised by every install",
  );
});
