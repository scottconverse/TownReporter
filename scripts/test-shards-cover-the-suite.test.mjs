import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseShard, shardArgs, shardNotice } from "./test-shard.mjs";

/**
 * A sharded gate has one new way to fail, and it is the quiet one: the files in
 * a slice nobody runs still pass, because nothing ran them. The suite goes
 * green in less time and proves less, which is worse than the slow gate it
 * replaced.
 *
 * Three properties hold it together.
 *
 * 1. Sharding is opt-in. With neither variable set -- a developer's `npm test`,
 *    and every job that does not ask for a slice -- there is no shard at all.
 * 2. `node --test-shard` really does deal every file to exactly one shard. That
 *    is node's behaviour, not ours, so it is checked by running the real test
 *    runner over a temporary directory of fixture files and collecting which
 *    files each shard actually executed -- not by reimplementing node's
 *    arithmetic here and comparing it with itself.
 * 3. CI asks for as many slices as it has machines. `matrix.shard` and
 *    `TOWNREPORTER_TEST_SHARD_TOTAL` disagreeing by one is the whole failure:
 *    with six machines and a total of seven, a seventh of the suite runs
 *    nowhere and nothing says so.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("no shard variables means the complete suite", () => {
  assert.equal(parseShard({}), null);
  assert.deepEqual(shardArgs({}), []);
  assert.equal(shardNotice({}), null);
  // An empty value is how a workflow passes "not set" for an absent matrix
  // value; it must mean the whole suite too, never shard "" of "".
  assert.equal(parseShard({ TOWNREPORTER_TEST_SHARD: "", TOWNREPORTER_TEST_SHARD_TOTAL: "" }), null);
});

test("a shard becomes argv for node, not a filter of our own", () => {
  assert.deepEqual(
    shardArgs({ TOWNREPORTER_TEST_SHARD: "2", TOWNREPORTER_TEST_SHARD_TOTAL: "6" }),
    ["--test-shard=2/6"],
  );
  assert.deepEqual(parseShard({ TOWNREPORTER_TEST_SHARD: " 3 ", TOWNREPORTER_TEST_SHARD_TOTAL: " 3 " }), {
    index: 3,
    total: 3,
  });
  assert.match(
    shardNotice({ TOWNREPORTER_TEST_SHARD: "2", TOWNREPORTER_TEST_SHARD_TOTAL: "6" }),
    /shard 2 of 6/,
  );
});

test("a shard that would run the wrong files, or none, is refused", () => {
  const refused = [
    { TOWNREPORTER_TEST_SHARD: "2" },
    { TOWNREPORTER_TEST_SHARD_TOTAL: "6" },
    { TOWNREPORTER_TEST_SHARD: "0", TOWNREPORTER_TEST_SHARD_TOTAL: "6" },
    { TOWNREPORTER_TEST_SHARD: "7", TOWNREPORTER_TEST_SHARD_TOTAL: "6" },
    { TOWNREPORTER_TEST_SHARD: "1", TOWNREPORTER_TEST_SHARD_TOTAL: "0" },
    { TOWNREPORTER_TEST_SHARD: "one", TOWNREPORTER_TEST_SHARD_TOTAL: "6" },
    { TOWNREPORTER_TEST_SHARD: "1.5", TOWNREPORTER_TEST_SHARD_TOTAL: "6" },
    { TOWNREPORTER_TEST_SHARD: "-1", TOWNREPORTER_TEST_SHARD_TOTAL: "6" },
  ];
  for (const env of refused) {
    assert.throws(() => parseShard(env), Error, `accepted ${JSON.stringify(env)}`);
  }
});

test("the launcher refuses a half-set shard instead of running a different suite", () => {
  const result = spawnSync(process.execPath, [join(ROOT, "scripts/run-tests-safe.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
    env: { ...process.env, TOWNREPORTER_TEST_SHARD: "2", TOWNREPORTER_TEST_SHARD_TOTAL: "" },
  });
  assert.equal(result.status, 2, `expected a refusal, got ${result.status}: ${result.stdout}`);
  assert.match(result.stderr, /TOWNREPORTER_TEST_SHARD_TOTAL/);
});

/**
 * The property the whole arrangement rests on: every file lands in exactly one
 * shard. Fixture files in a temporary directory, the real `node --test`, and
 * the shard flag the launcher passes -- eleven files over four shards, so an
 * off-by-one in node's own dealing would show up as a file that ran twice or
 * not at all.
 */
test("node deals every discovered file to exactly one shard", () => {
  const dir = mkdtempSync(join(tmpdir(), "townreporter-shard-"));
  try {
    const names = Array.from({ length: 11 }, (_, i) => `fixture-${String(i + 1).padStart(2, "0")}`);
    for (const name of names) {
      writeFileSync(
        join(dir, `${name}.test.mjs`),
        `import test from "node:test";\ntest(${JSON.stringify(name)}, () => {});\n`,
      );
    }

    // A nested runner inherits NODE_TEST_CONTEXT and reports to its parent in
    // v8 serialization instead of TAP; this run has to be readable here.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;

    const total = 4;
    const perShard = [];
    for (let index = 1; index <= total; index++) {
      const result = spawnSync(
        process.execPath,
        ["--test", "--test-reporter=tap", `--test-shard=${index}/${total}`, "*.test.mjs"],
        { cwd: dir, env, encoding: "utf8", timeout: 60000, windowsHide: true },
      );
      assert.equal(result.status, 0, `shard ${index} failed: ${result.stdout}${result.stderr}`);
      perShard.push([...result.stdout.matchAll(/^ok \d+ - (fixture-\d+)$/gm)].map((m) => m[1]));
    }

    const ran = perShard.flat();
    assert.deepEqual([...ran].sort(), [...names].sort(), "the shards together are not the whole set");
    assert.equal(new Set(ran).size, ran.length, "a file ran in more than one shard");
    for (const [index, files] of perShard.entries()) {
      assert.ok(files.length > 0, `shard ${index + 1} of ${total} ran nothing`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

