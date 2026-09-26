import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jobs } from "./ci-yaml.mjs";
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
const CI = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");

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

/** `run:` command lines of one job, comments and block scalars flattened. */
function runLines(jobName) {
  const body = jobs(CI)[jobName];
  assert.ok(body, `job "${jobName}" is not in ci.yml`);
  return body
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .flatMap((line) => {
      const match = /^-?\s*run:\s*(.+)$/.exec(line);
      return match && match[1] !== "|" ? [match[1].trim()] : [];
    });
}

/** Lines of one job's YAML with whole-line comments removed. */
function settingLines(jobName) {
  const body = jobs(CI)[jobName];
  assert.ok(body, `job "${jobName}" is not in ci.yml`);
  return body.filter((line) => line.trim() && !line.trim().startsWith("#"));
}

test("CI runs the unit suite as shards, and asks for exactly as many as it runs", () => {
  const lines = settingLines("unit-tests");
  const text = lines.join("\n");

  const matrix = /^\s*shard:\s*\[([^\]]+)\]\s*$/m.exec(text);
  assert.ok(matrix, "the unit-tests job has no `shard: [...]` matrix");
  const indices = matrix[1].split(",").map((value) => Number(value.trim()));
  assert.deepEqual(
    indices,
    indices.map((_, i) => i + 1),
    `the shard matrix must be 1..n with no gaps and no repeats; got ${indices.join(", ")}`,
  );

  assert.match(
    text,
    /^\s*TOWNREPORTER_TEST_SHARD:\s*\$\{\{\s*matrix\.shard\s*\}\}\s*$/m,
    "each machine must be handed its own matrix index, not a fixed one",
  );
  const declaredTotal = /^\s*TOWNREPORTER_TEST_SHARD_TOTAL:\s*["']?(\d+)["']?\s*$/m.exec(text);
  assert.ok(declaredTotal, "the unit-tests job never sets TOWNREPORTER_TEST_SHARD_TOTAL");
  assert.equal(
    Number(declaredTotal[1]),
    indices.length,
    `the job runs ${indices.length} shards but asks node for ${declaredTotal[1]}: ` +
      `the difference is the part of the suite that runs nowhere`,
  );

  assert.ok(
    runLines("unit-tests").includes("npm test"),
    "the shards must run the documented suite command, not a hand-written subset",
  );
  assert.match(
    text,
    /^\s*fail-fast:\s*false\s*$/m,
    "one shard's failure must not cancel the others, or a red run hides the rest of its failures",
  );
});

test("one check stays green only when every shard and the static checks are", () => {
  const gate = settingLines("test").join("\n");
  assert.match(gate, /^\s*needs:.*\bunit-tests\b/m, "the gate job does not wait for the shards");
  assert.match(gate, /^\s*needs:.*\bstatic\b/m, "the gate job does not wait for typecheck and lint");
  assert.match(gate, /if:\s*always\(\)/, "the gate must run even when a shard fails, or it never reports");
  assert.match(gate, /needs\.unit-tests\.result/, "the gate must read the shards' result");
  assert.match(gate, /needs\.static\.result/, "the gate must read the static checks' result");
  assert.match(gate, /exit 1/, "the gate must actually fail when a dependency did not succeed");
  // A branch rule matches the check by the job's `name:` when it has one and by
  // its id when it does not. This job is the one that used to run the suite, so
  // it stays nameless and the required check stays called `test`.
  assert.ok(
    !/^ {4}name:/m.test(gate),
    "the gate job must not be given a name: the check a branch rule requires is called `test`",
  );
});

test("typecheck and lint still run in CI, beside the suite", () => {
  const commands = runLines("static");
  for (const command of ["npm ci", "npm run typecheck", "npm run typecheck:test", "npm run lint"]) {
    assert.ok(commands.includes(command), `the static job must run exactly \`${command}\``);
  }
});
