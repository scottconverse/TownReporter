/*
  The seal's own test.

  It is the one test in the suite that must be allowed to talk to a blocked
  address, so it proves the block by *throwing*, not by connecting: every
  "refused" case asserts on the rejection, and none of them can reach a model
  server even if one is running. The one case that does open a socket opens it
  on an ephemeral loopback port this file chose, which is the shape the seal
  exists to permit.
*/

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  REAL_MODEL_OPT_IN_ENV,
  TEST_RUN_ENV,
  assertModelRequestAllowed,
  installModelSeal,
  modelSealRefusal,
} from "./model-seal.ts";

/** Every address a test must not be able to reach, and why each one is listed. */
const REFUSED: { url: string; names: RegExp }[] = [
  { url: "http://127.0.0.1:11434/v1/models", names: /11434/ },
  { url: "http://127.0.0.1:11434/api/show", names: /11434/ },
  { url: "http://localhost:11434/v1/chat/completions", names: /11434/ },
  { url: "http://127.0.0.1:1234/v1/models", names: /1234/ },
  { url: "http://127.0.0.1:8080/v1/models", names: /8080/ },
  { url: "http://127.0.0.1:11434/v1", names: /11434/ },
  { url: "https://api.anthropic.com/v1/models?limit=1", names: /anthropic/ },
  { url: "https://api.openai.com/v1/chat/completions", names: /openai/ },
  // Not a model host on any known list: still refused, because the ordinary
  // suite is offline and "not loopback" is the rule.
  { url: "https://news.example.org/feed.xml", names: /not loopback/ },
];

function withTestEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const keys = [TEST_RUN_ENV, REAL_MODEL_OPT_IN_ENV];
  const previous = keys.map((k) => [k, process.env[k]] as const);
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of previous) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("the model seal", () => {
  let server: Server;
  let origin: string;
  let restore: () => void;

  before(async () => {
    // Port 0: the OS picks a free port, which is what a fake model server in a
    // test looks like -- and what the seal must keep allowing.
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "fake-model" }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    restore = installModelSeal();
  });

  after(async () => {
    restore?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("refuses every blocked address in a test run, naming the URL", () => {
    for (const { url, names } of REFUSED) {
      withTestEnv({ [TEST_RUN_ENV]: "1", [REAL_MODEL_OPT_IN_ENV]: undefined }, () => {
        assert.throws(
          () => assertModelRequestAllowed(url),
          (error: Error) => {
            assert.match(error.message, /Refusing/);
            assert.ok(error.message.includes(url.split("?")[0]!), `names ${url}`);
            assert.match(error.message, names);
            assert.match(error.message, new RegExp(REAL_MODEL_OPT_IN_ENV));
            return true;
          },
          `${url} must be refused`,
        );
      });
    }
  });

  it("refuses the blocked addresses through fetch itself, not only the check", async () => {
    for (const { url } of REFUSED.slice(0, 4)) {
      await withTestEnvAsync({ [TEST_RUN_ENV]: "1", [REAL_MODEL_OPT_IN_ENV]: undefined }, async () => {
        await assert.rejects(() => fetch(url), /Refusing/, `${url} must be refused by fetch`);
      });
    }
  });

  it("allows a fake loopback server on an ephemeral port, and gets its answer", async () => {
    await withTestEnvAsync({ [TEST_RUN_ENV]: "1", [REAL_MODEL_OPT_IN_ENV]: undefined }, async () => {
      assert.equal(modelSealRefusal(`${origin}/v1/models`), null);
      const res = await fetch(`${origin}/v1/models`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { data: [{ id: "fake-model" }] });
    });
  });

  it("is inert outside a test run", () => {
    withTestEnv({ [TEST_RUN_ENV]: undefined, [REAL_MODEL_OPT_IN_ENV]: undefined }, () => {
      assert.equal(modelSealRefusal("http://127.0.0.1:11434/v1/models"), null);
      assert.doesNotThrow(() => assertModelRequestAllowed("https://api.anthropic.com/v1/models"));
    });
  });

  it("lets a developer opt in, and says so once", async () => {
    await withTestEnvAsync({ [TEST_RUN_ENV]: "1", [REAL_MODEL_OPT_IN_ENV]: "1" }, async () => {
      assert.equal(modelSealRefusal("http://127.0.0.1:11434/v1/models"), null);

      const written: string[] = [];
      const realWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;
      try {
        await fetch("http://127.0.0.1:11434/v1/models").catch(() => {});
      } finally {
        process.stderr.write = realWrite;
      }
      assert.ok(
        written.some((line) => line.includes(REAL_MODEL_OPT_IN_ENV)),
        "the opt-in must announce itself on stderr",
      );
    });
  });
});

async function withTestEnvAsync<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const keys = [TEST_RUN_ENV, REAL_MODEL_OPT_IN_ENV];
  const previous = keys.map((k) => [k, process.env[k]] as const);
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of previous) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
