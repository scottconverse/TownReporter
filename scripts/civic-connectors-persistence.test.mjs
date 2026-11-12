import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { it } from "node:test";
import { safeTestEnvironment } from "./test-environment.mjs";

const run = promisify(execFile);
const fixture = fileURLToPath(
  new URL("./civic-connectors-persistence.fixture.mjs", import.meta.url),
);
const guard = new URL("./test-environment-guard.mjs", import.meta.url).href;
const seal = new URL("../src/lib/test-support/model-seal.ts", import.meta.url).href;

it(
  "reopens migrated real evidence from a file-backed PGlite in a fresh process",
  { timeout: 90000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "townreporter-connectors-persistence-"));
    try {
      await writeFile(join(root, "fixture-owner.txt"), "connector-fixture-only\n", "utf8");
      const phase = async (name) => {
        const result = await run(
          process.execPath,
          ["--import", guard, "--import", seal, fixture, root, name],
          {
            cwd: fileURLToPath(new URL("..", import.meta.url)),
            env: safeTestEnvironment(),
            timeout: 40000,
            maxBuffer: 1024 * 1024,
            windowsHide: true,
          },
        );
        return JSON.parse(result.stdout.trim());
      };
      const saved = await phase("save");
      const reopened = await phase("reopen");
      assert.notEqual(saved.pid, reopened.pid, "restart must be a genuinely fresh process");
      assert.equal(saved.migrations, reopened.migrations);
      assert.ok(reopened.migrations > 100, "the actual migration corpus must be applied");
      for (const field of ["versions", "chunks", "blobs", "captures"]) {
        assert.deepEqual(reopened[field], saved[field], `${field} must survive restart unchanged`);
        assert.equal(reopened[field].length, 2);
      }
      const expectedBytes = Buffer.from(
        '{"meeting":9,"unknown":{"zero":0,"flag":false,"empty":null}}',
      );
      const expectedHash = createHash("sha256").update(expectedBytes).digest("hex");
      for (let index = 0; index < 2; index++) {
        const version = reopened.versions[index];
        assert.equal(version.newsroom_id, 944221 + index);
        assert.equal(version.url, "https://records.example.test/restart/agenda");
        assert.equal(
          version.full_text,
          "Synthetic council agenda. Item 9 proposes stormwater culvert repairs.",
        );
        assert.equal(version.content_hash, expectedHash);
        assert.equal(reopened.chunks[index].page_number, 9);
        assert.equal(reopened.chunks[index].version_id, version.id);
        assert.equal(reopened.blobs[index].version_id, version.id);
        assert.deepEqual(Buffer.from(reopened.blobs[index].body_b64, "base64"), expectedBytes);
        assert.equal(reopened.captures[index].version_id, version.id);
        assert.equal(reopened.captures[index].trigger_kind, "civic-connector");
      }
      assert.notEqual(reopened.versions[0].id, reopened.versions[1].id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
