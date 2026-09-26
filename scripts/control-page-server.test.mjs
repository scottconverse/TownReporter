import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createControlServer,
  collectStatus,
  describeLastScan,
  formatLocalRange,
  formatLocalTime,
  ACTIONS,
  CONFIRM_WORD,
  renderPage,
} from "../ops/control/control-server.mjs";

/**
 * The Control page (ops/control/control-server.mjs) puts action buttons on a
 * loopback HTTP server: pressing one restarts the paper, the tunnel or the
 * Reddit reader, and one of them takes the paper offline.
 *
 * So the interesting properties are all about what it REFUSES. Binding to
 * 127.0.0.1 is necessary and not sufficient -- the operator's own browser is on
 * this machine, and every page it has open can POST to loopback. Three gates
 * stand between that and a restart: the Host header, a per-process token that a
 * cross-origin page cannot read, and the Origin header. None of the three is
 * load-bearing on its own, so each has a test here that fails if it is dropped.
 *
 * Nothing in this file spawns an ACTION. `runner` is injected, so a bug in the
 * action table cannot take the live paper down from a test run -- which is the
 * only way these tests are safe to run on the machine that serves the paper.
 * (Two of them do press stop-all, with the fake runner, on purpose: that is the
 * action whose guard is worth proving.)
 *
 * One test does spawn the real last-scan chain -- node, the app's own env
 * wrapper, and `pg` -- against a throwaway app root whose .env names a port
 * nothing listens on. That is deliberate and it is the only spawn here: the
 * claim under test is that a database URL found in the install's .env reaches
 * the child at all, and a faked probe could not fail if that path broke. No
 * powershell, no port 5433, no running paper is involved.
 *
 * Port 0 throughout: an ephemeral port per server, so a test run cannot collide
 * with a real Control page or with a sibling test binding a fixed port.
 */

const FAKE_STATUS = {
  checkedAt: "2026-09-25T17:24:49.000Z",
  attention: 1,
  headline: "The paper is running but the outside world cannot reach it.",
  advice: "Try option 3, restart the tunnel.",
  root: "C:\\Users\\scott\\Desktop\\Code\\townreporter-web",
  checks: [
    { id: "database", label: "Database", ok: true, optional: false, detail: "answering on 5433", fix: "start-all" },
    { id: "paper", label: "The paper", ok: true, optional: false, detail: "answered 200 on port 3000", fix: "start-all" },
    { id: "public-site", label: "Public site", ok: false, optional: false, detail: "did not answer", fix: "restart-tunnel" },
    {
      id: "reddit-reader",
      label: "Reddit reader (Redlib)",
      ok: false,
      optional: true,
      detail: "down - the paper reads Reddit through RSS alone",
      fix: "restart-reddit",
    },
  ],
  extras: [
    { id: "backup", label: "Last backup", ok: true, optional: true, detail: "townreporter.sql", fix: null },
  ],
};

async function boot(overrides = {}) {
  const server = createControlServer({
    port: 0,
    host: "127.0.0.1",
    writePidFile: false,
    pidFile: null,
    collect: async () => FAKE_STATUS,
    runner: async () => ({ code: 0, output: [] }),
    // The action table's settle times are fifteen to twenty seconds of real
    // waiting for real restarts. Nothing restarts here, so nothing waits.
    settle: async () => {},
    ...overrides,
  });
  const address = await server.listen();
  return { server, port: address.port };
}

/**
 * A raw request, so the Host header can be set to something the guard must
 * refuse. `fetch` refuses to lie about Host, which is exactly the point.
 */
function raw(port, { method = "GET", path = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, setHost: false }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const hostFor = (port) => ({ host: `127.0.0.1:${port}` });

test("a Host header that is not this server is refused, token or no token", async () => {
  const { server, port } = await boot();
  try {
    for (const host of ["evil.example.com", `evil.example.com:${port}`, `127.0.0.1:${port + 1}`, "localhost.evil.com"]) {
      const page = await raw(port, { headers: { host } });
      assert.equal(page.status, 403, `GET / with Host ${host} was not refused`);
      // The refusal must land before anything useful: no page, no token in it.
      assert.ok(!page.text.includes(server.token), `the refusal for Host ${host} leaked the token`);
    }
    // And the honest ones are not.
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
      const page = await raw(port, { headers: { host } });
      assert.equal(page.status, 200, `GET / with Host ${host} was refused`);
      assert.match(page.text, /TownReporter Control/);
    }
  } finally {
    await server.close();
  }
});

test("a POST with no token is refused", async () => {
  const { server, port } = await boot();
  try {
    const res = await raw(port, {
      method: "POST",
      path: "/api/action/restart-paper",
      headers: { ...hostFor(port), origin: `http://127.0.0.1:${port}`, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 403);
    assert.equal(server.state.run, null, "a refused POST must not have started anything");
  } finally {
    await server.close();
  }
});

test("a POST carrying the token but a foreign Origin is refused", async () => {
  const { server, port } = await boot();
  try {
    const res = await raw(port, {
      method: "POST",
      path: "/api/action/restart-paper",
      headers: {
        ...hostFor(port),
        origin: "http://evil.example.com",
        "x-control-token": server.token,
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(res.status, 403, "Origin did not have to match");
    assert.equal(server.state.run, null);
  } finally {
    await server.close();
  }
});

test("a POST with the token and no Origin or Referer at all is refused", async () => {
  /*
    A same-origin `fetch` always sends Origin on a POST, so a request without
    one is not the page's own. This is the case a non-browser client (or an old
    form post) lands in, and it must not be the hole.
  */
  const { server, port } = await boot();
  try {
    const res = await raw(port, {
      method: "POST",
      path: "/api/action/restart-paper",
      headers: { ...hostFor(port), "x-control-token": server.token, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 403);
    assert.equal(server.state.run, null);
  } finally {
    await server.close();
  }
});

test("the token in the URL is not enough -- only the header counts", async () => {
  const { server, port } = await boot();
  try {
    const res = await raw(port, {
      method: "POST",
      path: `/api/action/restart-paper?token=${server.token}`,
      headers: { ...hostFor(port), origin: `http://127.0.0.1:${port}`, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 403, "the token must be read from the header, never from the query string");
  } finally {
    await server.close();
  }
});

test("an action id that does not exist is a 404, and the prototype chain is not an action table", async () => {
  const { server, port } = await boot();
  try {
    for (const id of ["nope", "constructor", "toString", "__proto__", "valueOf"]) {
      const res = await raw(port, {
        method: "POST",
        path: `/api/action/${id}`,
        headers: {
          ...hostFor(port),
          origin: `http://127.0.0.1:${port}`,
          "x-control-token": server.token,
          "content-type": "application/json",
        },
        body: "{}",
      });
      assert.equal(res.status, 404, `/api/action/${id} did not 404`);
    }
    assert.equal(server.state.run, null, "an unknown id must not have started anything");
  } finally {
    await server.close();
  }
});

test("one action at a time: a second one is a 409 until the first finishes", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const ran = [];
  const { server, port } = await boot({
    runner: async (step) => {
      ran.push(step.args.join(" "));
      await gate;
      return { code: 0, output: [] };
    },
  });
  const post = (id) =>
    raw(port, {
      method: "POST",
      path: `/api/action/${id}`,
      headers: {
        ...hostFor(port),
        origin: `http://127.0.0.1:${port}`,
        "x-control-token": server.token,
        "content-type": "application/json",
      },
      body: "{}",
    });
  try {
    const first = await post("restart-tunnel");
    assert.equal(first.status, 200);
    const second = await post("restart-paper");
    assert.equal(second.status, 409);
    assert.match(second.text, /Another action is running/);
    assert.equal(ran.length, 1, "the second action must not have been started");
    release();
    await new Promise((r) => setTimeout(r, 20));
    // Once it is done, the next one is allowed again.
    const third = await post("restart-paper");
    assert.equal(third.status, 200);
  } finally {
    release();
    await server.close();
  }
});

test("stop-all without the confirm word is refused, and nothing runs", async () => {
  const ran = [];
  const { server, port } = await boot({
    runner: async (step) => {
      ran.push(step.args.join(" "));
      return { code: 0, output: [] };
    },
  });
  const post = (body) =>
    raw(port, {
      method: "POST",
      path: "/api/action/stop-all",
      headers: {
        ...hostFor(port),
        origin: `http://127.0.0.1:${port}`,
        "x-control-token": server.token,
        "content-type": "application/json",
      },
      body,
    });
  try {
    for (const body of ["{}", "", '{"confirm":"yes"}', '{"confirm":true}', '{"sure":"offline"}']) {
      const res = await post(body);
      assert.equal(res.status, 400, `stop-all accepted the body ${JSON.stringify(body)}`);
      assert.match(res.text, new RegExp(CONFIRM_WORD));
    }
    assert.equal(ran.length, 0, "stop-all must not run without the confirm word");
    assert.equal(server.state.run, null);

    // The right word is accepted -- with the fake runner, so this proves the
    // gate opens, not that a test can stop the live paper.
    const ok = await post(`{"confirm":"${CONFIRM_WORD}"}`);
    assert.equal(ok.status, 200);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ran.length, 1);
  } finally {
    await server.close();
  }
});

test("the status endpoint hands the page the shape it renders", async () => {
  const { server, port } = await boot();
  try {
    const res = await raw(port, { path: "/api/status", headers: hostFor(port) });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.text);
    assert.equal(typeof data.attention, "number");
    assert.equal(typeof data.headline, "string");
    assert.ok(Array.isArray(data.checks) && data.checks.length > 0);
    for (const check of data.checks) {
      for (const key of ["id", "label", "ok", "optional", "detail"]) {
        assert.ok(key in check, `a check is missing ${key}`);
      }
      // Every fix id the page is handed must be a real action, or the button it
      // renders 404s. This is the contract between status.ps1 and the server.
      if (check.fix) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(ACTIONS, check.fix),
          `status.ps1 named the fix "${check.fix}", which is not an action`,
        );
      }
    }
    // The optional rows are the ones that must never inflate the count.
    const faults = data.checks.filter((c) => !c.ok && !c.optional).length;
    assert.equal(data.attention, faults, "the headline count must be the non-optional faults");
    assert.ok(
      data.checks.some((c) => c.optional && !c.ok),
      "the fixture must contain a down optional row, or the rule above proves nothing",
    );
  } finally {
    await server.close();
  }
});

test("every action is a fixed absolute executable and an argument array, never a command line", async () => {
  /*
    The shape copied from the model: an argv vector handed to spawn with
    shell:false. A command STRING would be re-parsed by a shell, which is how
    an argument that came from a page turns into a second command. Nothing in
    the request can add an argument to any of these -- the table is the whole
    vocabulary -- and this proves the table is the fixed shape it claims.
  */
  for (const [id, spec] of Object.entries(ACTIONS)) {
    assert.ok(Array.isArray(spec.spawns), `${id}: spawns must be a list of argv vectors`);
    for (const step of spec.spawns) {
      assert.match(step.exe, /^[A-Za-z]:\\/, `${id}: ${step.exe} must be an absolute Windows path`);
      assert.match(step.exe, /System32/i, `${id}: ${step.exe} must come from System32, not a PATH lookup`);
      assert.ok(Array.isArray(step.args), `${id}: args must be an array`);
      for (const arg of step.args) assert.equal(typeof arg, "string", `${id}: every argument must be a string`);
    }
  }
  // The two the brief names: stop everything and start everything.
  assert.ok(Object.prototype.hasOwnProperty.call(ACTIONS, "stop-all"));
  assert.ok(Object.prototype.hasOwnProperty.call(ACTIONS, "start-all"));
  assert.equal(ACTIONS["stop-all"].confirm, CONFIRM_WORD);
});

test("the page carries the token and the theme boot, and never a second copy of a secret", async () => {
  const { server, port } = await boot();
  try {
    const res = await raw(port, { headers: hostFor(port) });
    assert.match(res.text, new RegExp(server.token), "the page must carry the token for its own POSTs");
    // Dark is the default: the pre-paint script only switches to light, and the
    // document is dark before that script runs.
    assert.match(res.text, /<html lang="en" data-theme="dark">/);
    assert.match(res.text, /townreporter\.control\.theme/);
    // No external anything: this page has to render on a machine whose paper is
    // down, so nothing it needs may be fetched from anywhere else.
    assert.doesNotMatch(res.text, /https?:\/\/(?!127\.0\.0\.1)/, "the page must not reference an external URL");
    assert.equal(res.headers["x-frame-options"], "DENY");
    assert.match(res.headers["content-security-policy"], /frame-ancestors 'none'/);
    // The token is minted per process, so two servers never share one.
    const other = await boot();
    try {
      assert.notEqual(other.server.token, server.token);
    } finally {
      await other.server.close();
    }
  } finally {
    await server.close();
  }
});

test("the inline page script compiles", () => {
  /*
    A syntax error in the page's script returns HTTP 200 with a blank page: the
    server cannot see it fail. This is the same failure the model guards against
    at boot, and one line of `new Function` turns it into a failing test.
  */
  const page = renderPage("0123456789abcdef0123456789abcdef");
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 2, "expected the theme boot script and the page script");
  for (const source of scripts) {
    assert.doesNotThrow(() => new Function(source), "the page's inline script has a syntax error");
  }
});

test("it exits by itself after the idle window, and a request pushes that window back", async () => {
  /*
    The page polls every 15 seconds, so an open tab keeps it alive and a shut
    one lets it leave. The clock is injected so this is a real assertion about
    the rule rather than a 60-minute test.
  */
  let clock = 1_000_000;
  const { server, port } = await boot({ now: () => clock, idleMs: 60_000 });
  try {
    assert.equal(server.checkIdle(), false, "it must not leave before the window");

    clock += 30_000;
    const res = await raw(port, { path: "/api/status", headers: hostFor(port) });
    assert.equal(res.status, 200);

    clock += 59_000;
    assert.equal(server.checkIdle(), false, "a request must push the window back");

    clock += 2_000;
    assert.equal(server.checkIdle(), true, "after the window with no requests it must leave");
  } finally {
    await server.close();
  }
});

/* ─────────────────── the six fixes the review asked for ─────────────────── */

/** 2026-09-25, 8:00 PM in Denver: the "now" every fixed-clock test uses. */
const NOW = () => Date.parse("2026-09-26T02:00:00.000Z");
const DENVER = "America/Denver";
const cardFor = (data, id) => data.extras.find((row) => row.id === id);

/**
 * Every probe, faked, so nothing here reaches the network, LM Studio or a
 * database. `lastScan` soft-fails by default: an unreadable scan is the state
 * the page has to survive, and the test that is ABOUT reading it replaces this.
 */
function probeSet(overrides = {}) {
  return {
    status: async () => ({ ok: true, status: FAKE_STATUS }),
    version: () => ({ version: "0.6.66", head: "abcdef12", label: "0.6.66 (abcdef12)" }),
    publicVersion: async () => ({ ok: true, version: "0.6.66" }),
    testCopy: async () => ({ ok: true, up: false, version: null }),
    qwen: async () => ({ ok: true, qwen: [], detail: "LM Studio is not running" }),
    lastScan: async () => ({ ok: false, reason: "unreachable", detail: "Could not read the last scan" }),
    backup: () => ({ ok: false, found: false, dir: "nowhere" }),
    ...overrides,
  };
}

test("no card is green when its probe did not answer", async () => {
  /*
    Fix 1: "OK: Could not read the last scan" was the report. A green verdict is
    a claim that the question was answered, so every card below is a Note --
    including the version card, whose public site could not be read.
  */
  const data = await collectStatus({
    appRoot: "C:\\no\\such\\install",
    now: NOW,
    probes: probeSet({ publicVersion: async () => ({ ok: false, version: null, error: "no answer" }) }),
  });
  assert.equal(data.extras.length, 5, "the fixture is expected to be the whole card set");
  for (const row of data.extras) {
    assert.equal(row.state, "note", `${row.id} reads green over a soft failure: "${row.detail}"`);
    assert.equal(row.ok, false, `${row.id} still says ok: true`);
  }
  assert.equal(data.attention, FAKE_STATUS.attention, "the script's own count is the count");
});

test("a database URL from the install's .env reaches the probe, and an unreachable one is a Note", async () => {
  /*
    Fix 4: the live page said "no database URL is configured" while a URL was
    configured in the install the page was describing -- the server ran from a
    worktree with no .env of its own. The row has to tell those two apart.

    This is the one test in this file that spawns: the real chain (node ->
    scripts/with-app-env.mjs -> ops/control/last-scan.cjs -> pg) against a
    throwaway app root whose .env names port 1, where nothing listens. The A/B
    is the point: the same call with no .env in the app root must produce the
    OTHER sentence, or the first result proves nothing about the .env.
  */
  const withEnv = fs.mkdtempSync(path.join(os.tmpdir(), "townreporter-ag2-env-"));
  const withoutEnv = fs.mkdtempSync(path.join(os.tmpdir(), "townreporter-ag2-bare-"));
  const saved = process.env.DATABASE_URL;
  // Every probe faked EXCEPT the last scan: this test is about the real chain,
  // and a faked probe cannot fail when that chain is what broke.
  const probes = probeSet();
  delete probes.lastScan;
  try {
    fs.writeFileSync(
      path.join(withEnv, ".env"),
      "# the fixture install's own environment\nDATABASE_URL=postgres://postgres:postgres@127.0.0.1:1/townreporter\n",
      "utf8",
    );
    // process.env wins over any .env in probeLastScan, so it has to be out of
    // the way for this to be a test of the file.
    delete process.env.DATABASE_URL;

    const configured = await collectStatus({ appRoot: withEnv, now: NOW, probes });
    const row = cardFor(configured, "last-scan");
    assert.equal(row.state, "note", "a scan that could not be read is never OK");
    assert.equal(row.ok, false);
    assert.match(row.detail, /could not reach the database/, `the row said: "${row.detail}"`);
    assert.doesNotMatch(row.detail, /no database URL/i, "the URL was configured; saying otherwise is the lie that was reported");

    const bare = await collectStatus({ appRoot: withoutEnv, now: NOW, probes });
    const other = cardFor(bare, "last-scan");
    assert.match(other.detail, /no database URL is configured for the paper/, `the control row said: "${other.detail}"`);
    assert.notEqual(other.detail, row.detail, "two different faults must not read as one sentence");
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    fs.rmSync(withEnv, { recursive: true, force: true });
    fs.rmSync(withoutEnv, { recursive: true, force: true });
  }
});

test("every time on the page is a 12-hour clock in this machine's own zone", () => {
  /*
    Fix 3: the last-backup card printed "2026-09-25 22:31" for a file written at
    4:31 PM Mountain. UTC and 24-hour, on a page for one person at that machine.
  */
  const options = { timeZone: DENVER, now: NOW };
  assert.equal(formatLocalTime("2026-09-25T22:31:00.000Z", options), "today at 4:31 PM");
  assert.equal(formatLocalTime("2026-09-25T03:05:00.000Z", options), "yesterday at 9:05 PM");
  assert.equal(formatLocalTime("2026-09-23T12:00:00.000Z", options), "Sep 23 at 6:00 AM");
  assert.equal(formatLocalTime("2026-09-26T13:00:00.000Z", options), "tomorrow at 7:00 AM");
  // Another year is named, or "Sep 23" in a January page reads as this January.
  assert.equal(formatLocalTime("2025-12-01T13:00:00.000Z", options), "Dec 1, 2025 at 6:00 AM");
  assert.equal(formatLocalTime(null, options), "");
  assert.equal(formatLocalTime("not a time", options), "");

  for (const iso of ["2026-09-25T22:31:00.000Z", "2026-09-25T03:05:00.000Z", "2026-09-23T12:00:00.000Z"]) {
    const text = formatLocalTime(iso, options);
    const clock = text.match(/(\d{1,2}):(\d{2}) (AM|PM)$/);
    assert.ok(clock, `${text} is not a 12-hour clock`);
    const hour = Number(clock[1]);
    assert.ok(hour >= 1 && hour <= 12, `${text} has an hour a 12-hour clock cannot have`);
  }

  // The day is a civil date in the zone, not a 24-hour subtraction: on the
  // night the clocks go back these two are 15 hours apart and still "yesterday".
  const acrossDst = { timeZone: DENVER, now: () => Date.parse("2026-11-01T20:00:00.000Z") };
  assert.equal(formatLocalTime("2026-11-01T05:00:00.000Z", acrossDst), "yesterday at 11:00 PM");

  assert.equal(
    formatLocalRange("2026-09-25T22:26:00.000Z", "2026-09-25T22:31:00.000Z", options),
    "today at 4:26 PM to 4:31 PM",
    "two times on one day say the day once",
  );
  assert.equal(
    formatLocalRange("2026-09-25T03:05:00.000Z", "2026-09-25T22:31:00.000Z", options),
    "yesterday at 9:05 PM to today at 4:31 PM",
  );
});

test("the last-scan row says which fault it hit, and a run that did not finish is a Note", () => {
  const note = (scan) => describeLastScan(scan, { timeZone: DENVER, now: NOW }).state;
  assert.deepEqual(describeLastScan({ ok: false, reason: "unreachable" }), {
    state: "note",
    detail: "could not reach the database",
    reason: "unreachable",
  });
  const sentences = {
    "no-database-url": "no database URL is configured for the paper",
    "driver-missing": "the paper's database driver is not installed",
    unreachable: "could not reach the database",
    "no-scans": "no scan has run yet",
    "query-failed": "the scan table could not be read",
  };
  for (const [reason, detail] of Object.entries(sentences)) {
    assert.equal(describeLastScan({ ok: false, reason }).detail, detail, reason);
  }
  // A reason this file has never heard of still may not read as OK, and falls
  // back to what the probe itself said rather than inventing a sentence.
  assert.deepEqual(describeLastScan({ ok: false, reason: "something-new", detail: "fell over" }), {
    state: "note",
    detail: "fell over",
    reason: "something-new",
  });
  assert.equal(note({ ok: false }), "note");

  assert.deepEqual(
    describeLastScan(
      {
        ok: true,
        status: "finished",
        startedAt: "2026-09-25T22:26:00.000Z",
        finishedAt: "2026-09-25T22:31:00.000Z",
        leads: 4,
        model: "deepseek",
      },
      { timeZone: DENVER, now: NOW },
    ),
    { state: "ok", detail: "today at 4:26 PM to 4:31 PM - finished, 4 lead(s), model deepseek", reason: null },
  );
  // "OK: failed" is the same lie as "OK: could not read it", one line down.
  const unfinished = { ok: true, startedAt: "2026-09-25T22:26:00.000Z", finishedAt: "2026-09-25T22:31:00.000Z" };
  assert.equal(note({ ...unfinished, status: "failed" }), "note");
  assert.equal(note({ ...unfinished, status: "failed (never finished)" }), "note");
  assert.equal(note({ ok: true, status: "running", startedAt: "2026-09-25T22:26:00.000Z" }), "note");
  assert.equal(note({ ok: true, startedAt: "2026-09-25T22:26:00.000Z" }), "note");
});

test("a version skew is a Note that names both versions", async () => {
  /*
    Fix 6: while the public site still shows the previous release, the card said
    OK. It is not a fault -- it is what every update looks like for a minute --
    and it is not OK either, because the two are not the same build.
  */
  const differing = await collectStatus({
    appRoot: ".",
    now: NOW,
    probes: probeSet({ publicVersion: async () => ({ ok: true, version: "0.6.64" }) }),
  });
  const row = cardFor(differing, "version");
  assert.equal(row.state, "note", "a skew is not a green light");
  assert.equal(row.ok, false);
  assert.equal(
    row.detail,
    "This install is 0.6.66; the public site shows 0.6.64. Normal right after an update, until the site refreshes.",
  );
  assert.equal(row.optional, true, "a version skew may never inflate the attention count");
  assert.equal(differing.attention, FAKE_STATUS.attention);

  const agreeing = await collectStatus({ appRoot: ".", now: NOW, probes: probeSet() });
  assert.equal(cardFor(agreeing, "version").state, "ok");
});

test("the one destructive action is painted differently, and the Fix button is gated on state", async () => {
  /*
    Fix 5: all six buttons looked the same, including the one that takes the
    paper offline. Fix 2: a healthy row offered a "Fix this" button.
  */
  assert.equal(ACTIONS["stop-all"].danger, true, "stop everything must carry the danger flag");
  for (const [id, spec] of Object.entries(ACTIONS)) {
    if (id === "stop-all") continue;
    assert.notEqual(spec.danger, true, `${id} must not be painted as destructive`);
  }
  // The paint is a real rule in both themes, and it is not the accent colour the
  // other five use: AA against its own ink in each theme.
  const page = renderPage("0123456789abcdef0123456789abcdef");
  assert.match(page, /button\.danger \{ background: var\(--bad\); color: var\(--danger-ink\);/);
  assert.match(page, /--danger-ink: #1b0d0a;/);
  assert.match(page, /--danger-ink: #ffffff;/);
  // A Note is amber. It was the dim grey, which is how "Note: up" looked like a
  // green light with a button under it.
  assert.match(page, /\.verdict\.note \{ color: var\(--warn\); \}/);
  assert.match(page, /if \(withFix && card\.fix && stateOf\(card\) !== "ok"\)/);
  assert.match(page, /box\.dataset\.state = stateOf\(card\)/);

  const { server, port } = await boot();
  try {
    const res = await raw(port, { path: "/api/actions", headers: hostFor(port) });
    const actions = JSON.parse(res.text).actions;
    const flagged = actions.filter((a) => a.danger === true).map((a) => a.id);
    assert.deepEqual(flagged, ["stop-all"], "exactly one action may be painted as destructive");
  } finally {
    await server.close();
  }
});

test("a row written before `state` existed still renders by its old fields", () => {
  /*
    The page must survive an /api/status the row model predates -- the walk's
    fixture is exactly that. `ok` without `state` is the whole of what an older
    row says, so the page derives the state the same way the server does.

    The page script cannot be run whole here (its last lines touch the DOM), so
    the one function is lifted out of it by name and called.
  */
  const page = renderPage("0123456789abcdef0123456789abcdef");
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const source = scripts[scripts.length - 1];
  const start = source.indexOf("function stateOf(card)");
  const end = source.indexOf("function renderCards(", start);
  assert.ok(start > 0 && end > start, "the page no longer defines stateOf(card) where this test expects");
  const stateOf = new Function(`${source.slice(start, end)}; return stateOf;`)();
  assert.equal(stateOf({ ok: true, optional: true }), "ok");
  assert.equal(stateOf({ ok: false, optional: true }), "note");
  assert.equal(stateOf({ ok: false, optional: false }), "down");
  for (const word of ["ok", "note", "down"]) assert.equal(stateOf({ ok: false, state: word }), word);
});

test("the status endpoint is read-only: asking for it starts nothing and stops nothing", async () => {
  let spawns = 0;
  const { server, port } = await boot({
    runner: async () => {
      spawns++;
      return { code: 0, output: [] };
    },
  });
  try {
    for (const path of ["/api/status", "/api/status?refresh=1", "/api/actions", "/api/action/output?since=0"]) {
      const res = await raw(port, { path, headers: hostFor(port) });
      assert.equal(res.status, 200, `${path} did not answer`);
    }
    assert.equal(spawns, 0, "reading the page must never run an action");
    assert.equal(server.state.run, null);
  } finally {
    await server.close();
  }
});
