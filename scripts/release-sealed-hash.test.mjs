/*
  Release-sealed hash guard.

  A package must not state its own ZIP hash by value: writing the hash into
  the package changes the ZIP and therefore changes the hash. The published
  .sha256 sidecar is the authority for the artifact hash, and this test checks
  both halves of that rule:

    (a) the package-internal note names the .sha256 sidecar as the hash authority;
    (b) the sidecar value equals the actual ZIP hash;
    (c) the test fails when the note embeds a SHA-256 value for its own ZIP.

  It reads a release note from the repository and, when a package directory is
  supplied, verifies the adjacent ZIP and sidecar. This lets the same guard
  test the package that is actually shipped rather than only its source copy.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(path, "utf8");

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function assertSealedRelease(packageDir, version) {
  const zipName = `TownReporter-${version}-windows-x64.zip`;
  const zipPath = join(packageDir, zipName);
  const shaPath = `${zipPath}.sha256`;
  const notePath = join(packageDir, "docs", "releases", `${version}.md`);
  assert.ok(existsSync(notePath), `package release note missing: ${notePath}`);
  const note = read(notePath);
  assert.ok(
    /\.sha256\b/i.test(note),
    `release note must name the .sha256 sidecar as the hash authority`,
  );
  assert.doesNotMatch(
    note,
    /\b[a-f0-9]{64}\b/i,
    `release note must not state its own ZIP SHA-256 value`,
  );
  assert.ok(existsSync(zipPath), `release ZIP missing: ${zipPath}`);
  assert.ok(existsSync(shaPath), `release sidecar missing: ${shaPath}`);
  const actual = sha256(zipPath);
  const sidecar = read(shaPath).trim().split(/\s+/)[0].toLowerCase();
  assert.equal(sidecar, actual, "published .sha256 sidecar must equal the actual ZIP hash");
  return { zipName, actual, sidecar, notePath };
}

test("the current release note points at the sidecar and never self-embeds its ZIP hash", () => {
  const version = JSON.parse(read(join(root, "package.json"))).version;
  const note = read(join(root, "docs", "releases", `${version}.md`));
  assert.ok(/\.sha256\b/i.test(note), `${version} note must name the .sha256 sidecar`);
  assert.doesNotMatch(note, /\b[a-f0-9]{64}\b/i, `${version} note must not contain a SHA-256 value`);
});

test("published release package sidecar matches the actual ZIP", () => {
  const packageDir = process.env.RELEASE_PACKAGE_DIR;
  if (!packageDir) return;
  const version = process.env.RELEASE_VERSION || JSON.parse(read(join(root, "package.json"))).version;
  assertSealedRelease(resolve(packageDir), version);
});

export { sha256 };