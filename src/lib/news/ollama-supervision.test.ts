/*
  DEF-2 behavior tests. Rule 20: no test reads source text. Every case here
  drives the real functions with a fake clock, fake fetch and fake spawn, so
  nothing touches the Ollama on this machine.
*/

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OLLAMA_DID_NOT_START_NOTE,
  OLLAMA_CHECK_CACHE_MS,
  ensureOllama,
  ollamaDataRoot,
  ollamaStartedNote,
  ollamaStatus,
  ownStatePath,
  resetOllamaSupervisionForTests,
  resolveOllamaExecutable,
  stopOwnedOllama,
} from "./ollama-supervision.server.ts";
import {
  OLLAMA_DEFAULT_ENDPOINT,
  OLLAMA_OWN_ENDPOINT,
  providerEndpoint,
  providerEntry,
  resetSupervisedOllamaBaseUrlForTests,
  resetLocalDiscoveryReachableForTests,
} from "./provider-registry.ts";

const TEST_ENV = "TOWNREPORTER_TEST_ENV_VERIFIED";
const DEFAULT_ROOT = "http://127.0.0.1:11434";
const OWN_ROOT = "http://127.0.0.1:11435";

let root = "";
let previousTestEnv: string | undefined;
let previousDataRoot: string | undefined;

function atSixFiftyTwo(): number {
  return new Date(2026, 10, 4, 6, 52, 0, 0).getTime();
}

/** A fetch that answers on exactly the roots it is given. */
function fetchAnswering(answering: Set<string>) {
  return async (url: string) => ({ ok: answering.has(new URL(url).origin) });
}

/** A spawn that records its call and returns a plausible detached child. */
function spawnRecording() {
  const calls: { command: string; args: string[]; options: Record<string, unknown> }[] = [];
  const spawn = ((command: string, args: string[], options: Record<string, unknown>) => {
    calls.push({ command, args, options });
    return { pid: 4242, unref() {} };
  }) as unknown as typeof import("node:child_process").spawn;
  return { spawn, calls };
}

beforeEach(() => {
  previousTestEnv = process.env[TEST_ENV];
  previousDataRoot = process.env.TOWNREPORTER_DATA_ROOT;
  // The module is inert inside the sealed test environment; these cases use
  // fakes, so they switch that one guard off for the length of the test.
  delete process.env[TEST_ENV];
  root = mkdtempSync(join(tmpdir(), "tr-ollama-"));
  process.env.TOWNREPORTER_DATA_ROOT = root;
  resetOllamaSupervisionForTests();
  resetSupervisedOllamaBaseUrlForTests();
  resetLocalDiscoveryReachableForTests();
});

afterEach(() => {
  resetOllamaSupervisionForTests();
  resetSupervisedOllamaBaseUrlForTests();
  resetLocalDiscoveryReachableForTests();
  if (previousTestEnv === undefined) delete process.env[TEST_ENV];
  else process.env[TEST_ENV] = previousTestEnv;
  if (previousDataRoot === undefined) delete process.env.TOWNREPORTER_DATA_ROOT;
  else process.env.TOWNREPORTER_DATA_ROOT = previousDataRoot;
  rmSync(root, { recursive: true, force: true });
});

describe("finding a running Ollama", () => {
  it("uses 11434 when it answers and changes nothing", async () => {
    const { spawn, calls } = spawnRecording();
    const answer = await ensureOllama({
      fetch: fetchAnswering(new Set([DEFAULT_ROOT])),
      spawn,
      exists: () => true,
      now: atSixFiftyTwo,
    });
    assert.equal(answer.outcome, "running");
    assert.equal(answer.endpoint, OLLAMA_DEFAULT_ENDPOINT);
    assert.equal(answer.supervised, false);
    assert.equal(answer.note, null);
    assert.equal(calls.length, 0, "a running Ollama is never touched");
    assert.equal(providerEndpoint(providerEntry("deepseek-flash")!), OLLAMA_DEFAULT_ENDPOINT);
  });

  it("reports not-installed and starts nothing when the program is absent", async () => {
    const { spawn, calls } = spawnRecording();
    const answer = await ensureOllama({
      fetch: fetchAnswering(new Set()),
      spawn,
      exists: () => false,
      now: atSixFiftyTwo,
    });
    assert.equal(answer.outcome, "not-installed");
    assert.equal(answer.running, false);
    assert.equal(answer.note, null);
    assert.equal(calls.length, 0);
  });
});

describe("starting our own copy", () => {
  it("starts ollama serve on 11435, detached and hidden, and reports the line", async () => {
    const { spawn, calls } = spawnRecording();
    const answer = await ensureOllama({
      fetch: fetchAnswering(new Set([OWN_ROOT])),
      spawn,
      exists: () => true,
      now: atSixFiftyTwo,
      sleep: async () => undefined,
      waitMs: 5_000,
    });
    assert.equal(answer.outcome, "started");
    assert.equal(answer.endpoint, OLLAMA_OWN_ENDPOINT);
    assert.equal(answer.supervised, true);
    assert.equal(answer.note, ollamaStartedNote(atSixFiftyTwo()));
    assert.match(answer.note!, /^Ollama was down\. TownReporter started it at 6:52 AM\.$/);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].args[0], "serve");
    assert.equal(calls[0].options.detached, true);
    assert.equal(calls[0].options.windowsHide, true);
    assert.equal((calls[0].options.env as NodeJS.ProcessEnv).OLLAMA_HOST, "127.0.0.1:11435");

    // While our copy is the one answering, the DeepSeek rung goes to 11435.
    assert.equal(providerEndpoint(providerEntry("deepseek-flash")!), OLLAMA_OWN_ENDPOINT);
    assert.ok(existsSync(ownStatePath(root)), "the PID is saved for shutdown");
  });

  it("goes on with the next model when the copy does not answer in time", async () => {
    const { spawn, calls } = spawnRecording();
    let clock = atSixFiftyTwo();
    const answer = await ensureOllama({
      fetch: fetchAnswering(new Set()),
      spawn,
      exists: () => true,
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
      waitMs: 3_000,
      pollMs: 1_000,
    });
    assert.equal(answer.outcome, "failed");
    assert.equal(answer.running, false);
    assert.equal(answer.note, OLLAMA_DID_NOT_START_NOTE);
    assert.equal(calls.length, 1);
    // It waits the whole ceiling and then stops asking: the job is not blocked
    // beyond it.
    assert.ok(clock - atSixFiftyTwo() >= 3_000);
  });

  it("reuses a copy an earlier check started on 11435 without spawning again", async () => {
    mkdirSync(join(root, "logs"), { recursive: true });
    writeFileSync(
      ownStatePath(root),
      JSON.stringify({ pid: process.pid, port: 11435, startedAt: atSixFiftyTwo() }),
      "utf8",
    );
    const { spawn, calls } = spawnRecording();
    const answer = await ensureOllama({
      fetch: fetchAnswering(new Set([OWN_ROOT])),
      spawn,
      exists: () => true,
      now: atSixFiftyTwo,
    });
    assert.equal(answer.outcome, "running");
    assert.equal(answer.endpoint, OLLAMA_OWN_ENDPOINT);
    assert.equal(answer.supervised, true);
    assert.equal(calls.length, 0);
  });

  it("caches the answer for 30 seconds", async () => {
    let probes = 0;
    const fetch = async (url: string) => {
      probes += 1;
      return { ok: new URL(url).origin === DEFAULT_ROOT };
    };
    let clock = atSixFiftyTwo();
    const deps = { fetch, exists: () => false, now: () => clock };
    await ensureOllama(deps);
    const first = probes;
    await ensureOllama(deps);
    assert.equal(probes, first, "a second check inside 30s does not probe again");
    clock += OLLAMA_CHECK_CACHE_MS;
    await ensureOllama(deps);
    assert.ok(probes > first, "after 30s it probes again");
  });
});

describe("one check at a time", () => {
  /** A fetch that takes a moment, so two calls really overlap. */
  function slowFetch(answering: Set<string>) {
    return async (url: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: answering.has(new URL(url).origin) };
    };
  }

  it("two checks at once start exactly one copy and both get the same answer", async () => {
    const { spawn, calls } = spawnRecording();
    const deps = {
      fetch: slowFetch(new Set([OWN_ROOT])),
      spawn,
      exists: () => true,
      now: atSixFiftyTwo,
      sleep: async () => undefined,
      waitMs: 2_000,
    };
    const [first, second] = await Promise.all([ensureOllama(deps), ensureOllama(deps)]);
    assert.equal(calls.length, 1, "the second caller waited for the first check");
    assert.equal(first.outcome, "started");
    assert.deepEqual(second, first);
  });

  it("'Check again' (force) joins a check already running", async () => {
    const { spawn, calls } = spawnRecording();
    const deps = {
      fetch: slowFetch(new Set([OWN_ROOT])),
      spawn,
      exists: () => true,
      now: atSixFiftyTwo,
      sleep: async () => undefined,
      waitMs: 2_000,
    };
    const running = ensureOllama(deps);
    const forced = await ensureOllama({ ...deps, force: true });
    const first = await running;
    assert.equal(calls.length, 1);
    assert.equal(forced.outcome, "started");
    assert.deepEqual(forced, first);
  });
});

describe("a busy machine whose Ollama answers slowly", () => {
  it("probes 11434 again before spawning and uses it when it answers", async () => {
    let probes = 0;
    const fetch = async (url: string) => {
      if (new URL(url).origin !== DEFAULT_ROOT) return { ok: false };
      probes += 1;
      if (probes === 1) throw new DOMException("The operation was aborted.", "AbortError");
      if (probes === 2) return { ok: false };
      return { ok: true };
    };
    const { spawn, calls } = spawnRecording();
    const answer = await ensureOllama({
      fetch,
      spawn,
      exists: () => true,
      now: atSixFiftyTwo,
    });
    assert.equal(probes, 3, "first quick probe (2 requests), then the patient recheck");
    assert.equal(answer.outcome, "running");
    assert.equal(answer.endpoint, OLLAMA_DEFAULT_ENDPOINT);
    assert.equal(answer.supervised, false);
    assert.equal(calls.length, 0, "no second copy is started");
  });
});

describe("shutdown and discovery", () => {
  it("stops its own copy on Windows with taskkill by PID and its tree", async () => {
    // The fake spawn reports this test process's PID, which is alive, so the
    // alive check passes; runSync is injected, so nothing is really killed.
    const spawn = ((_command: string, _args: string[], _options: Record<string, unknown>) => ({
      pid: process.pid,
      unref() {},
    })) as unknown as typeof import("node:child_process").spawn;
    await ensureOllama({
      fetch: fetchAnswering(new Set([OWN_ROOT])),
      spawn,
      exists: () => true,
      now: atSixFiftyTwo,
      sleep: async () => undefined,
      waitMs: 2_000,
    });
    const killed: { command: string; args: string[] }[] = [];
    const stopped = stopOwnedOllama({
      dataRoot: root,
      platform: "win32",
      runSync: (command, args) => {
        killed.push({ command, args });
      },
    });
    assert.equal(stopped, true);
    assert.equal(killed.length, 1);
    assert.equal(killed[0].command, "taskkill");
    assert.deepEqual(killed[0].args, ["/PID", String(process.pid), "/T", "/F"]);
  });

  it("does nothing when the saved PID is not the one it recorded", async () => {
    const { spawn } = spawnRecording();
    await ensureOllama({
      fetch: fetchAnswering(new Set([OWN_ROOT])),
      spawn,
      exists: () => true,
      now: atSixFiftyTwo,
      sleep: async () => undefined,
      waitMs: 2_000,
    });
    // The state file now names a different PID than the one we started.
    writeFileSync(
      ownStatePath(root),
      JSON.stringify({ pid: process.pid, port: 11435, startedAt: atSixFiftyTwo() }),
      "utf8",
    );
    const killed: { command: string; args: string[] }[] = [];
    const stopped = stopOwnedOllama({
      dataRoot: root,
      platform: "win32",
      runSync: (command, args) => {
        killed.push({ command, args });
      },
    });
    assert.equal(stopped, false);
    assert.equal(killed.length, 0, "a PID we did not record is never killed");
  });

  it("never stops an Ollama this process did not start", () => {
    mkdirSync(join(root, "logs"), { recursive: true });
    writeFileSync(
      ownStatePath(root),
      JSON.stringify({ pid: process.pid, port: 11435, startedAt: atSixFiftyTwo() }),
      "utf8",
    );
    // The PID is alive (it is this test process), but it is not ours to kill.
    assert.equal(stopOwnedOllama({ dataRoot: root }), false);
    assert.ok(existsSync(ownStatePath(root)), "the state file is left alone");
  });

  it("finds the Windows folder when PATH has no ollama", () => {
    const local = "C:\\Users\\ann\\AppData\\Local";
    const found = resolveOllamaExecutable({
      platform: "win32",
      env: { PATH: "C:\\Windows", LOCALAPPDATA: local },
      exists: (path) => path === join(local, "Programs", "Ollama", "ollama.exe"),
    });
    assert.equal(found, join(local, "Programs", "Ollama", "ollama.exe"));
  });

  it("reports a running copy without starting one", async () => {
    const status = await ollamaStatus({
      fetch: fetchAnswering(new Set([DEFAULT_ROOT])),
      exists: () => true,
    });
    assert.equal(status.running, true);
    assert.equal(status.endpoint, OLLAMA_DEFAULT_ENDPOINT);
    assert.equal(status.supervised, false);
  });

  it("reads the app's own data root", () => {
    assert.equal(ollamaDataRoot({ TOWNREPORTER_DATA_ROOT: root } as NodeJS.ProcessEnv), root);
  });
});
