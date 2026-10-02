import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertPassingIntegrationSummary, parseTapSummary } from "./run-postgres-integration.mjs";

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
  ];
  for (const url of live) {
    assert.equal(targetsLivePostgres(url, {}), true, `${url} is not recognised as the live server`);
  }
  assert.equal(targetsLivePostgres("postgres://postgres@127.0.0.1/postgres", { PGPORT: "5433" }), true, "an inherited PGPORT is dialled by pg but not seen");
  assert.equal(effectivePort("postgres://postgres@127.0.0.1/postgres?port=5433", {}), LIVE_POSTGRES_PORT);

  // A URL the runner would otherwise accept -- loopback, the approved
  // database -- and only the port makes it wrong.
  const runner = await readFile(new URL("./run-postgres-integration.mjs", import.meta.url), "utf8");
  assert.match(runner, /effectivePort\(requestedAdminUrl\) === LIVE_POSTGRES_PORT/, "the runner's own guard no longer checks the port");
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
  assert.match(source, /selected = process\.argv\.slice\(2\)\.length \? process\.argv\.slice\(2\) : discovered/);
  assert.match(source, /assertPassingIntegrationSummary/);
});
