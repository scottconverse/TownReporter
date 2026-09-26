import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createControlServer, ACTIONS, CONFIRM_WORD, renderPage } from "../ops/control/control-server.mjs";

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
 * Nothing in this file spawns anything. `runner` is injected, so a bug in the
 * action table cannot take the live paper down from a test run -- which is the
 * only way these tests are safe to run on the machine that serves the paper.
 * (Two of them do press stop-all, with the fake runner, on purpose: that is the
 * action whose guard is worth proving.)
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
