import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { QuorumRelayClient } from "quorumrelay-client";

export const checkout = fileURLToPath(new URL("..", import.meta.url));
export const libraryRoot = resolve(process.env.CIVIC_CONNECTORS_LIBRARY_ROOT || join(checkout, "../../civic-data-connectors"));
export const python = resolve(process.env.CIVIC_CONNECTORS_PYTHON || join(checkout, "../../connector-interface-venv/Scripts/python.exe"));
export async function freePort() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  return port;
}
export async function startConnectorFixture() {
  const root = await mkdtemp(join(tmpdir(), "townreporter-connectors-integration-"));
  await writeFile(join(root, "fixture-owner.txt"), "connector-fixture-only\n");
  const configuration = JSON.parse(await readFile(join(libraryRoot, "examples/service.mock.json"), "utf8"));
  const port = await freePort();
  configuration.service.port = port;
  const tokens = Object.keys(configuration.service.tokens);
  configuration.service.tokens[tokens[0]].credentials = {
    legistar: { namespace: "//webapi.legistar.com/v1/synthetic-city", token: "synthetic-provider-secret", permissions: ["event:create", "event:update"] },
    telvue: { origin: "https://connect.telvue.com", namespace: "fixture-account", tenant: "newsroom-a",
      access_key: "synthetic-access-key", secret_passphrase: "synthetic-passphrase" },
    "municode-meetings": { origin: "https://meetingsgov.devmunicode.com", namespace: "fixture-account", tenant: "newsroom-a",
      token: "synthetic-account-token" },
  };
  await writeFile(join(root, "service.json"), JSON.stringify(configuration));
  const baseUrl = `http://127.0.0.1:${port}`;
  const client = new QuorumRelayClient({ baseUrl, token: tokens[0], timeoutMs: 15000 });
  let service, closed, logs = "";
  async function start() {
    service = spawn(python, [join(checkout, "scripts/civic-connectors-service.fixture.py"), root],
      { cwd: libraryRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    closed = once(service, "close");
    service.stdout.on("data", (data) => (logs = (logs + data).slice(-8192)));
    service.stderr.on("data", (data) => (logs = (logs + data).slice(-8192)));
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && service.exitCode === null) {
      try { await client.info(); return; } catch { await delay(100); }
    }
    throw new Error(`Synthetic connector fixture did not start: ${logs}`);
  }
  async function stop() {
    if (service?.exitCode === null) service.kill();
    await closed;
  }
  await start();
  return { root, baseUrl, tokens, client,
    async restart() { await stop(); await start(); },
    async close({ preserve = false } = {}) {
      await stop();
      assert.equal(await readFile(join(root, "fixture-owner.txt"), "utf8"), "connector-fixture-only\n");
      if (!preserve) await rm(root, { recursive: true, force: true });
    },
  };
}
