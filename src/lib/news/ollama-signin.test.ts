/*
  DEF-2 sign-in behavior, with a fake child process. Nothing here runs the
  real `ollama signin` (rule: it is not run on this machine as part of this
  task), and nothing reads a credential: the module only ever surfaces the URL
  the command prints.
*/

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  cancelOllamaSignIn,
  pollOllamaSignIn,
  resetOllamaSignInForTests,
  startOllamaSignIn,
} from "./ollama-signin.server.ts";
import { OLLAMA_NO_SIGNIN_WORDS } from "./ollama-status.ts";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 5150;
  killed = false;
  kill() {
    this.killed = true;
    return true;
  }
}

function fakeSpawn(child: FakeChild) {
  return (() => child) as unknown as typeof import("node:child_process").spawn;
}

const installed = {
  platform: "linux" as NodeJS.Platform,
  env: { PATH: "/fake/bin" } as NodeJS.ProcessEnv,
  exists: () => true,
};

beforeEach(() => resetOllamaSignInForTests());
afterEach(() => resetOllamaSignInForTests());

describe("ollama signin", () => {
  it("hands back the link the command prints", async () => {
    const child = new FakeChild();
    const started = startOllamaSignIn({
      ...installed,
      spawn: fakeSpawn(child),
      linkWaitMs: 1_000,
    });
    setImmediate(() => {
      child.stdout.emit("data", Buffer.from("To sign in, open: https://ollama.com/connect?key=abc\n"));
    });
    const row = await started;
    assert.equal(row.status, "awaiting_user");
    assert.equal(row.url, "https://ollama.com/connect?key=abc");
    assert.equal(row.pid, 5150);
    assert.equal(row.detail, "");
  });

  it("says Signed in when the command exits cleanly", async () => {
    const child = new FakeChild();
    const started = startOllamaSignIn({
      ...installed,
      spawn: fakeSpawn(child),
      linkWaitMs: 1_000,
    });
    setImmediate(() => child.emit("exit", 0));
    const row = await started;
    assert.equal(row.status, "done");
    assert.equal(pollOllamaSignIn()?.status, "done");
  });

  it("says the Ollama version has no sign-in", async () => {
    const child = new FakeChild();
    const started = startOllamaSignIn({
      ...installed,
      spawn: fakeSpawn(child),
      linkWaitMs: 1_000,
    });
    setImmediate(() => {
      child.stderr.emit("data", Buffer.from("unknown command \"signin\" for \"ollama\"\n"));
      child.emit("exit", 1);
    });
    const row = await started;
    assert.equal(row.status, "no-signin");
    assert.equal(row.detail, OLLAMA_NO_SIGNIN_WORDS);
  });

  it("says Ollama is not installed", async () => {
    const row = await startOllamaSignIn({ ...installed, exists: () => false });
    assert.equal(row.status, "not-installed");
    assert.equal(row.url, null);
  });

  it("stops only the attempt it started", async () => {
    const child = new FakeChild();
    const started = startOllamaSignIn({
      ...installed,
      spawn: fakeSpawn(child),
      linkWaitMs: 1_000,
    });
    setImmediate(() => child.stdout.emit("data", Buffer.from("https://ollama.com/connect?key=abc\n")));
    await started;
    const row = cancelOllamaSignIn();
    assert.equal(row?.status, "cancelled");
    assert.equal(child.killed, true);
  });
});
