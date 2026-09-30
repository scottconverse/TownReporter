/*
  The release archive ships the product, not the scaffold.

  scripts/package-windows.mjs builds the Windows ZIP with `git archive`, so
  whatever `.gitattributes` does not mark `export-ignore` is exactly what a
  publisher downloads. This repository was scaffolded inside the Grok App
  Builder sandbox; the sandbox's own material -- its agent contract, the .grok/
  skill trees, its startup.sh and the preview host bridge -- has since been
  deleted outright, and scripts/no-grok-scaffold.test.mjs fails the build if
  any of it comes back. What is still on disk but is not the product is the
  dated and session handoffs and the dated audit reports under artifacts/: kept
  as history, and excluded here so a publisher never receives them.

  HANDOFF-NEXT-AGENT.md is the exception among the handoffs: it is the current
  takeover document and seven live documents link it (SELF-HOSTING.md,
  docs/dark-desk.md, two design notes, three release guides), so it ships and
  this test requires it to.

  Two halves, because they fail for different reasons:

    (a) the entries `git archive` actually produces. This is what the ZIP
        contains, and it is the assertion that matters. It is run with
        `--worktree-attributes`: without it, `git archive HEAD` reads the
        attributes recorded in HEAD's tree, so a pending edit to
        .gitattributes -- the one about to be committed and shipped -- is
        invisible and this test would pass on a checkout that is dropping the
        exclusions. On a clean checkout the flag changes nothing.
    (b) the working-tree `export-ignore` attribute for every tracked scaffold
        path, which names the specific path an edit broke instead of only
        reporting that some entry reappeared.

  Measured 2026-09-30 before the exclusions: 1788 tar entries, 187 of them
  scaffold paths (the .grok/ trees and startup.sh were most of that 187 and
  have since been deleted).
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (args, options = {}) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", ...options });

/** History that must never reach a release archive. */
const SCAFFOLD_DIRS = ["artifacts"];
/** Dated and session handoffs. HANDOFF-NEXT-AGENT.md is current and ships. */
const SCAFFOLD_HANDOFF = /^HANDOFF-(?:2026-.*|SESSION-.*|BUILD-LIST)\.md$/;

function isScaffoldPath(name) {
  return (
    SCAFFOLD_DIRS.some((dir) => name === dir || name.startsWith(`${dir}/`)) ||
    SCAFFOLD_HANDOFF.test(name)
  );
}

/** Product files a Windows publisher has to receive. */
const REQUIRED_IN_ARCHIVE = [
  "LICENSE",
  "README.md",
  "package.json",
  "THIRD_PARTY_NOTICES.md",
  "TODO.md",
  // The current takeover handoff: seven live documents link it, so it ships
  // even though the dated handoffs beside it do not.
  "HANDOFF-NEXT-AGENT.md",
];

/**
 * Entry names from `git archive --format=tar`, read out of the tar itself.
 *
 * Deliberately not `tar -t`: this has to run on a Windows box whose only
 * guaranteed tar is the one Node ships with (none). A ustar header is 512
 * bytes with the name at 0, the octal size at 124 and the optional long-name
 * prefix at 345; every member is padded to a 512-byte boundary.
 */
function tarEntryNames(buffer) {
  const names = [];
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (from, to) => header.toString("utf8", from, to).replace(/\0[\s\S]*$/, "");
    const name = field(0, 100);
    const prefix = field(345, 500);
    const size = Number.parseInt(field(124, 136).trim(), 8) || 0;
    // git writes a pax_global_header member first; it is not a repository path.
    if (name !== "pax_global_header") names.push(prefix ? `${prefix}/${name}` : name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

function archiveEntryNames() {
  return tarEntryNames(
    git(["archive", "--worktree-attributes", "--format=tar", "HEAD"], {
      encoding: "buffer",
      maxBuffer: 1 << 29,
    }),
  );
}

/** `export-ignore` for each path, resolved from the WORKING TREE attributes. */
function exportIgnoreFor(paths) {
  const out = git(["check-attr", "--stdin", "export-ignore"], {
    input: paths.join("\n") + "\n",
  });
  const values = new Map();
  for (const line of out.split("\n")) {
    if (!line) continue;
    const at = line.lastIndexOf(": export-ignore: ");
    if (at === -1) continue;
    values.set(line.slice(0, at), line.slice(at + ": export-ignore: ".length).trim());
  }
  return values;
}

const trackedFiles = () =>
  git(["ls-tree", "-r", "--name-only", "HEAD"]).split("\n").filter(Boolean);

test("the release archive contains no scaffold paths", () => {
  const entries = archiveEntryNames();
  const scaffold = entries.filter(isScaffoldPath);
  assert.deepEqual(
    scaffold,
    [],
    `the release archive still ships scaffold:\n${scaffold.slice(0, 20).join("\n")}`,
  );
  // A tar listing that came back empty or truncated would pass the check above
  // for the wrong reason.
  assert.ok(
    entries.length > 1000,
    `the archive is the real source tree (${entries.length} entries)`,
  );
});

test("the release archive keeps the product files a publisher needs", () => {
  const entries = new Set(archiveEntryNames());
  for (const required of REQUIRED_IN_ARCHIVE) {
    assert.ok(entries.has(required), `${required} must ship in the release archive`);
  }
  assert.ok(entries.has("installer/Install.ps1"), "the Windows installer must ship");
  assert.ok(entries.has("docs/windows-install.md"), "the installation guide must ship");
  assert.ok(entries.has("LICENSE"), "the licence must ship");
});

test("every tracked scaffold path is marked export-ignore in the working tree", () => {
  const candidates = trackedFiles().filter(isScaffoldPath);
  assert.ok(candidates.length >= 10, `scaffold paths to exclude (${candidates.length})`);
  assert.ok(
    candidates.some((name) => name.startsWith("artifacts/")),
    "the archived audit reports are still tracked and must be excluded",
  );
  for (const handoff of [
    "HANDOFF-2026-09-02-ARCHIVE.md",
    "HANDOFF-SESSION-2026-09-02.md",
    "HANDOFF-SESSION-2026-09-04.md",
    "HANDOFF-BUILD-LIST.md",
  ]) {
    assert.ok(candidates.includes(handoff), `the dated handoff ${handoff} must be excluded`);
  }

  const attributes = exportIgnoreFor(candidates);
  const missing = candidates.filter((name) => attributes.get(name) !== "set");
  assert.deepEqual(
    missing,
    [],
    `tracked scaffold with no export-ignore attribute:\n${missing.join("\n")}`,
  );
});

test("the export-ignore exclusions do not reach the documentation or the product", () => {
  const kept = [
    "LICENSE",
    "README.md",
    "TODO.md",
    "THIRD_PARTY_NOTICES.md",
    "package.json",
    "installer/Install.ps1",
    "docs/windows-install.md",
    "licenses/fonts/Literata-OFL.txt",
    // Both are deliberately kept, so a bare `HANDOFF-*.md` pattern would have
    // been wrong: docs/archive/ is dated product history, and the current
    // handoff is what seven live documents point a reader at.
    "HANDOFF-NEXT-AGENT.md",
    "docs/archive/HANDOFF-0.4.3.md",
  ];
  const present = kept.filter((name) => trackedFiles().includes(name));
  assert.equal(
    present.length,
    kept.length,
    `these paths must still be tracked: ${kept.join(", ")}`,
  );

  const attributes = exportIgnoreFor(kept);
  const excluded = kept.filter((name) => attributes.get(name) === "set");
  assert.deepEqual(
    excluded,
    [],
    `product paths wrongly excluded from the archive:\n${excluded.join("\n")}`,
  );
});
