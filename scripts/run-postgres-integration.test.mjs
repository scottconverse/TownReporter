import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as runner from "./run-postgres-integration.mjs";
import { postgresTestFiles } from "./postgres-test-discovery.mjs";

const { assertPassingIntegrationSummary, parseTapSummary } = runner;

test("runner accepts a real nonzero TAP pass summary", () => {
  const summary = parseTapSummary("# tests 2\n# pass 2\n# fail 0\n# skipped 0\n# todo 0\n");
  assert.deepEqual(summary, { tests: 2, pass: 2, fail: 0, skipped: 0, todo: 0 });
  assert.equal(assertPassingIntegrationSummary(summary), summary);
});

test("runner rejects empty, all-skipped, failed, and missing TAP summaries", () => {
  for (const output of [
    "# tests 0\n# pass 0\n# fail 0\n# skipped 0\n# todo 0\n",
    "# tests 2\n# pass 0\n# fail 0\n# skipped 2\n# todo 0\n",
    "# tests 2\n# pass 1\n# fail 1\n# skipped 0\n# todo 0\n",
    "TAP version 13\n",
  ]) {
    assert.throws(() => assertPassingIntegrationSummary(parseTapSummary(output)));
  }
});

test("neither lane guard will take an admin URL that dials the live paper", async () => {
  /*
    MAJOR M3. The lane creates, migrates and DROPS databases, and sweeps
    leftovers by name. Port 5433 is the live paper's Postgres on the machine
    that runs it -- so the lane's guard has to refuse that port, and it has to
    read the port the way pg does rather than the way the URL text looks.

    Both guards are checked: the runner's own (which stops the run before it
    spawns anything) and the late preload's (the last line of defence, inside
    the child). They share ops\lib-postgres-url.mjs, which is what makes them
    able to agree.
  */
  const { effectivePort, LIVE_POSTGRES_PORT, targetsLivePostgres } = await import("../ops/lib-postgres-url.mjs");
  const live = [
    `postgres://postgres@127.0.0.1:${LIVE_POSTGRES_PORT}/postgres`,
    "postgres://postgres@127.0.0.1:5433/postgres",
    "postgres://postgres@localhost:5433/postgres",
    "postgres://postgres@[::1]:5433/postgres",
    // The two the first version of the guard could not see: the port in the
    // query string, and no port at all with PGPORT set in the shell.
    "postgres://postgres@127.0.0.1/postgres?port=5433",
    // The production auditor's case (A-PR2 run 2): the authority says 5432 and
    // the query says 5433. pg-connection-string lets the QUERY value win, so pg
    // dials 5433. Both spellings of "two ports in one URL" are refused.
    "postgres://postgres@127.0.0.1:5432/postgres?port=5433",
    "postgres://postgres@127.0.0.1:5433/postgres?port=5432",
    "postgres://postgres@127.0.0.1/postgres?host=x&port=5433",
  ];
  for (const url of live) {
    assert.equal(targetsLivePostgres(url, {}), true, `${url} is not recognised as the live server`);
  }
  assert.equal(targetsLivePostgres("postgres://postgres@127.0.0.1/postgres", { PGPORT: "5433" }), true, "an inherited PGPORT is dialled by pg but not seen");
  assert.equal(effectivePort("postgres://postgres@127.0.0.1/postgres?port=5433", {}), LIVE_POSTGRES_PORT);
  // pg's precedence: the query value beats the authority port.
  assert.equal(effectivePort("postgres://postgres@127.0.0.1:5432/postgres?port=5433", {}), LIVE_POSTGRES_PORT);
  // ...and a throwaway server is still not mistaken for the live one.
  assert.equal(targetsLivePostgres("postgres://postgres@127.0.0.1:55433/postgres", {}), false);
  assert.equal(targetsLivePostgres("postgres://postgres@127.0.0.1:5546/postgres?port=5546", {}), false);

  // A URL the runner would otherwise accept -- loopback, the approved
  // database -- and only the port makes it wrong.
  const runner = await readFile(new URL("./run-postgres-integration.mjs", import.meta.url), "utf8");
  assert.match(runner, /targetsLivePostgres\(requestedAdminUrl\)/, "the runner's own guard no longer checks the port");
  assert.match(runner, /Refusing a PostgreSQL integration admin URL on port \$\{LIVE_POSTGRES_PORT\}/);

  // The preload, run for real in a child: it must refuse before it touches
  // anything, and it must still restore the URL for a legitimate target.
  const { execFileSync } = await import("node:child_process");
  const preload = new URL("./postgres-integration-opt-in.mjs", import.meta.url).href;
  const probe = (url, extraEnv = {}) =>
    execFileSync(process.execPath, ["--import", preload, "-e", "console.log(process.env.TEST_POSTGRES_ADMIN_URL)"], {
      env: {
        ...process.env,
        TOWNREPORTER_RUN_POSTGRES_INTEGRATION: "1",
        TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL: url,
        TEST_POSTGRES_ADMIN_URL: "",
        ...extraEnv,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  for (const url of live) {
    assert.throws(
      () => probe(url),
      (error) => /port 5433/.test(`${error.stdout ?? ""}${error.stderr ?? ""}`),
      `the preload accepted ${url}`,
    );
  }
  // The port in the shell rather than in the URL: pg dials 5433 for this, so
  // the lane must refuse it too.
  assert.throws(
    () => probe("postgres://postgres@127.0.0.1/postgres", { PGPORT: "5433" }),
    (error) => /port 5433/.test(`${error.stdout ?? ""}${error.stderr ?? ""}`),
    "the preload followed PGPORT to the live server",
  );
  // ...and a throwaway server still gets through, so the guard is not simply
  // refusing everything.
  assert.match(probe("postgres://postgres@127.0.0.1:55433/postgres").trim(), /55433\/postgres$/);
});

test("runner uses late isolation preload and executes the entire discovered set by default", async () => {
  const source = await readFile(new URL("./run-postgres-integration.mjs", import.meta.url), "utf8");
  assert.match(source, /postgresTestFiles\(root\)/);
  assert.match(source, /--import.*test-environment-guard/);
  assert.match(source, /--import.*postgres-integration-opt-in/);
  assert.match(source, /selectPostgresTests\(discovered, weights, process\.argv\.slice\(2\)\)/);
  const files = ["src/a.test.ts", "src/b.test.ts"];
  assert.deepEqual(runner.selectPostgresTests(files, {}, [], {}), files);
  assert.deepEqual(runner.selectPostgresTests(files, {}, ["src\\b.test.ts"], {}), ["src/b.test.ts"]);
  assert.match(source, /assertPassingIntegrationSummary/);
});

test("three measured-time parts cover real discovery exactly once and stay within 15%", async () => {
  // Bug: a file silently dropped from CI by a split.
  assert.equal(typeof runner.selectPostgresTests, "function", "the runner needs a part selector");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const discovered = postgresTestFiles(root);
  const weights = JSON.parse(await readFile(new URL("./postgres-integration-weights.json", import.meta.url), "utf8"));
  const times = Object.values(weights).sort((a, b) => a - b);
  const median = (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2;
  const parts = Array.from({ length: 3 }, (_, index) => runner.selectPostgresTests(discovered, weights, [], {
    TOWNREPORTER_POSTGRES_PART: String(index + 1),
    TOWNREPORTER_POSTGRES_PARTS: "3",
  }));
  for (const files of parts) assert.ok(files.length > 0, "a part must not pass without files");
  const assigned = parts.flat();
  assert.equal(new Set(assigned).size, assigned.length, "a file must not run in multiple parts");
  assert.deepEqual([...assigned].sort(), [...discovered].sort(), "no discovered file may disappear from CI");
  const totals = parts.map(files => files.reduce((sum, file) => sum + (weights[file] ?? median), 0));
  assert.ok(Math.max(...totals) <= Math.min(...totals) * 1.15, `unbalanced parts: ${totals.join(", ")}`);
  assert.deepEqual(runner.partitionPostgresTests([...discovered].reverse(), weights, 3).map(part => part.files), parts,
    "discovery order must not change the partition");
});

test("part selection refuses configurations that can omit tests and gives new files the median weight", () => {
  assert.equal(typeof runner.selectPostgresTests, "function", "the runner needs a part selector");
  const files = ["a", "b", "new"];
  const weights = { a: 20, b: 10 };
  const env = { TOWNREPORTER_POSTGRES_PART: "2", TOWNREPORTER_POSTGRES_PARTS: "2" };
  assert.deepEqual(runner.partitionPostgresTests(files, weights, 2), [
    { files: ["a"], seconds: 20 },
    { files: ["new", "b"], seconds: 25 },
  ]);
  assert.deepEqual(runner.selectPostgresTests(files, weights, [], env), ["new", "b"]);
  for (const badEnv of [
    { TOWNREPORTER_POSTGRES_PART: "1" },
    { TOWNREPORTER_POSTGRES_PARTS: "3" },
    { TOWNREPORTER_POSTGRES_PART: "0", TOWNREPORTER_POSTGRES_PARTS: "3" },
    { TOWNREPORTER_POSTGRES_PART: "4", TOWNREPORTER_POSTGRES_PARTS: "3" },
    { TOWNREPORTER_POSTGRES_PART: "1.5", TOWNREPORTER_POSTGRES_PARTS: "3" },
    { TOWNREPORTER_POSTGRES_PART: "1", TOWNREPORTER_POSTGRES_PARTS: "0" },
    { TOWNREPORTER_POSTGRES_PART: "1", TOWNREPORTER_POSTGRES_PARTS: "9007199254740992" },
  ]) assert.throws(() => runner.selectPostgresTests(files, weights, [], badEnv), /must/);
  assert.throws(() => runner.partitionPostgresTests(files, weights, 4), /empty/);
  assert.throws(() => runner.selectPostgresTests(files, weights, ["a"], env), /positional/);
  assert.throws(() => runner.selectPostgresTests(files, weights, ["missing"], {}), /not in PostgreSQL discovery/);
  assert.throws(() => runner.selectPostgresTests(files, weights, ["a", "a"], {}), /Duplicate/);
});
