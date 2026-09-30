/*
  The Grok App Builder scaffold is gone, and stays gone.

  This repository was exported out of the Grok App Builder sandbox, and that
  export landed the sandbox's own material in the product tree: an agent
  contract that opens "You are Grok Build... App Builder Workspace", 88 files
  of skill trees, a `startup.sh` that only ever ran inside the sandbox, a
  preview host bridge that let `grok.com` drive this app's navigation, and a
  dev-only `/__app-env` endpoint plus the `with-app-env` read of
  `.grok/app-env.json` that existed to feed it. None of it is TownReporter.

  The owner will not use Grok or xAI again, so the dead scaffold was deleted
  rather than archived. Deleting it is not self-enforcing: every one of these
  paths was reachable from `npm run dev`, a checkout, or a doc pointer, and a
  copy-paste out of an old branch -- or out of `.git` history, where the
  scaffold still lives -- would quietly restore it. So this file is the guard:
  it fails if the paths come back, if source starts referencing the deleted
  modules again, or if the environment wrapper starts reading `.grok` again.

  Scope is deliberate. `docs/`, `CHANGELOG.md`, the dated `HANDOFF-*.md`
  records and `artifacts/` still name all of this, and they are supposed to:
  they are records of what happened, and rewriting history to hide the export
  would be worse than carrying the word. This guard is about the product tree.
*/
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Everything the scaffold removal deleted. Paths, relative to the repository
 * root.
 *
 * `.grok/`, the two agent-contract files, `startup.sh`, `app-env-plugin.mjs`
 * and the preview host bridge (both of its files, plus its origin allow-list)
 * are the set the owner named. The other three go with them:
 * `brand-check.mjs` exists to warn about the sandbox's `og.grok.me` placeholder
 * card -- it names `.grok/skills/og/SKILL.md` in every warning -- and
 * `preview-thumbnail.mjs` is the capture tool for the sandbox's own
 * `SandboxInternal.CapturePreviewThumbnail` service. All of it was reachable
 * only from sandbox tooling.
 */
const DELETED_PATHS = [
  ".grok",
  "AGENTS.md",
  "AGENTS.project.md",
  "startup.sh",
  "scripts/app-env-plugin.mjs",
  "scripts/brand-check.mjs",
  "scripts/brand-check.test.mjs",
  "src/lib/preview-host-bridge.ts",
  "src/lib/preview-embedder-origin.ts",
  "src/components/preview-host-bridge.tsx",
  "scripts/archive/preview-thumbnail.mjs",
];

/**
 * Module names that must not be referenced from the product tree again. If one
 * is imported, the import has no file behind it; if it is named in prose, the
 * prose is describing a bridge or an endpoint that no longer exists.
 */
const DELETED_MODULE_NAMES = [
  "preview-host-bridge",
  "preview-embedder-origin",
  "app-env-plugin",
];

/** Where a deleted module must not be referenced from (the product tree). */
const SOURCE_PATHS = ["src", "scripts", "server", "vite.config.ts", "package.json"];

/**
 * Paths under SOURCE_PATHS whose job is to say these names out loud. Only this
 * file: the list above is the only place in the product tree allowed to write
 * them down.
 */
const NAME_SAYERS = ["scripts/no-grok-scaffold.test.mjs"];

/**
 * Files matching `pattern`, via `git grep` (exit 1 = no match).
 *
 * `--untracked` so a file that has been written but not staged is caught too;
 * ignored paths are still skipped, and the scan is scoped to SOURCE_PATHS, so
 * it never reaches `node_modules`. In CI everything is tracked and the flag
 * changes nothing.
 */
function trackedFilesMatching(pattern) {
  try {
    return execFileSync(
      "git",
      ["grep", "-l", "--untracked", "-i", "-e", pattern, "--", ...SOURCE_PATHS],
      { cwd: ROOT, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .map((name) => name.replaceAll("\\", "/"));
  } catch (err) {
    if (err.status === 1) return [];
    throw err;
  }
}

test("the deleted Grok scaffold has not come back", () => {
  const restored = DELETED_PATHS.filter((rel) => existsSync(join(ROOT, rel)));
  assert.deepEqual(
    restored,
    [],
    "these scaffold paths were deleted on purpose (the owner will not use Grok or xAI " +
      `again) and must not be restored:\n  ${restored.join("\n  ")}`,
  );
});

test("nothing in the product tree references the deleted scaffold modules", () => {
  for (const name of DELETED_MODULE_NAMES) {
    const offenders = trackedFilesMatching(name).filter((file) => !NAME_SAYERS.includes(file));
    assert.deepEqual(
      offenders,
      [],
      `"${name}" was deleted, but these files still name it:\n  ${offenders.join("\n  ")}`,
    );
  }
});

test("the environment wrapper does not read a .grok file", () => {
  const wrapper = readFileSync(join(ROOT, "scripts/with-app-env.mjs"), "utf8");
  assert.doesNotMatch(
    wrapper,
    /\.grok/,
    "scripts/with-app-env.mjs merges the workspace .env and nothing else -- the " +
      ".grok/app-env.json read it used to carry was deleted with the sandbox scaffold",
  );
});
