import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { outputDigest, sourceDigest, verifyBuild } from "./install-build-manifest.mjs";

test("start identity rejects stale source and a replaced server entry", () => {
  const root = mkdtempSync(join(tmpdir(), "tr-build-"));
  try {
    for (const dir of ["src", "scripts", "installer", ".output/server"])
      mkdirSync(join(root, dir), { recursive: true });
    for (const file of ["package.json", "package-lock.json", "vite.config.ts"])
      writeFileSync(join(root, file), "{}");
    const entry = join(root, ".output/server/index.mjs");
    writeFileSync(entry, "server");
    const manifest = {
      sourceHash: sourceDigest(root),
      serverHash: outputDigest(root),
      version: "test",
    };
    writeFileSync(join(root, ".output/install-build.json"), JSON.stringify(manifest));
    assert.equal(verifyBuild(root).version, "test");
    writeFileSync(join(root, "src/new.ts"), "changed");
    assert.throws(() => verifyBuild(root), /Source changed/);
    rmSync(join(root, "src/new.ts"));
    for (const dir of ["migrations", "public"]) {
      mkdirSync(join(root, dir));
      writeFileSync(join(root, dir, "changed"), "changed");
      assert.throws(() => verifyBuild(root), /Source changed/);
      rmSync(join(root, dir), { recursive: true });
    }
    writeFileSync(join(root, ".output/server/chunk.mjs"), "changed imported chunk");
    assert.throws(() => verifyBuild(root), /Built server changed/);
    rmSync(join(root, ".output/server/chunk.mjs"));
    writeFileSync(entry, "another server");
    assert.throws(() => verifyBuild(root), /Built server changed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
