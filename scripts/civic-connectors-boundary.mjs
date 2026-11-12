import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const checkout = fileURLToPath(new URL("..", import.meta.url));
const libraryRoot = resolve(
  process.env.CIVIC_CONNECTORS_LIBRARY_ROOT || join(checkout, "../../civic-data-connectors"),
);
const python = resolve(
  process.env.CIVIC_CONNECTORS_PYTHON ||
    join(checkout, "../../connector-interface-venv/Scripts/python.exe"),
);
const { QuorumRelayClient, ServiceError } = await import(
  pathToFileURL(join(libraryRoot, "client/dist/index.js")).href
);
const root = await mkdtemp(join(tmpdir(), "townreporter-connectors-boundary-"));
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const configuration = JSON.parse(
  await readFile(join(libraryRoot, "examples/service.mock.json"), "utf8"),
);
configuration.service.port = port;
const tokens = Object.keys(configuration.service.tokens);
await writeFile(join(root, "service.json"), JSON.stringify(configuration), "utf8");
const service = spawn(
  python,
  [
    "-m",
    "civic_data_connectors",
    "serve",
    "--config",
    join(root, "service.json"),
    "--database",
    join(root, "captures.sqlite"),
  ],
  { cwd: libraryRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
service.stdout.on("data", (data) => (logs = (logs + data).slice(-8192)));
service.stderr.on("data", (data) => (logs = (logs + data).slice(-8192)));
const closed = once(service, "close");
const baseUrl = `http://127.0.0.1:${port}`;
const client = new QuorumRelayClient({ baseUrl, token: tokens[0], timeoutMs: 5000 });
try {
  let info;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && service.exitCode === null) {
    try {
      info = await client.info();
      break;
    } catch {
      await delay(100);
    }
  }
  assert.ok(info, `Connector service did not start: ${logs}`);
  assert.equal(info.data.version, "0.1.0.dev8");
  assert.equal(info.schema_version, "2.0.0");
  const providers = await client.execute("providers");
  assert.equal(providers.data.providers.length, 31);
  for (const provider of ["legistar", "swagit"]) {
    const row = providers.data.providers.find((item) => item.provider === provider);
    assert.ok(row, `Provider catalog is missing ${provider}`);
    assert.equal(
      row.capabilities?.operations?.native_search?.implementation_status,
      "implemented",
      `${provider} native-search implementation label must reflect the packaged adapter`,
    );
  }
  const bytes = Buffer.from(
    JSON.stringify([
      {
        EventId: 701,
        EventBodyName: "Council",
        EventDate: "2026-11-11T00:00:00",
        EventTime: "7:00 PM",
        EventRowVersion: "synthetic-r1",
        EventComment: "Synthetic culvert repair appropriation",
        unknown: [null, false, 0, "", { non_ascii: "café" }],
      },
    ]),
  );
  const request = {
    source: {
      provider: "legistar",
      url: "https://synthetic-city.legistar.com/Calendar.aspx",
      input_format: "legistar-events-json",
    },
    content_base64: bytes.toString("base64"),
    bounds: { date_from: "2026-11-11", date_to: "2026-11-11" },
  };
  const discovered = await client.execute("discover", request);
  assert.equal(discovered.status, "partial");
  assert.equal(discovered.data.records.length, 1);
  assert.match(discovered.coverage.scope, /saved capture.*not a complete/i);
  const retrieved = await client.execute("fetch", request);
  assert.equal(retrieved.status, "partial");
  assert.match(retrieved.coverage.scope, /one saved capture.*not a complete upstream catalog/i);
  assert.equal(retrieved.data.capture.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(retrieved.data.records[0].original.unknown, [
    null, false, 0, "", { non_ascii: "café" },
  ]);
  const preview = await client.execute("import_preview", { result: discovered });
  assert.equal(preview.data.persisted, false);
  const imported = await client.execute("import_bundle", { result: discovered, persist: true });
  assert.equal(imported.data.persisted, true);
  assert.equal(imported.status, "partial");
  assert.deepEqual(imported.coverage, discovered.coverage);
  const searched = await client.execute("search", { query: { terms: ["Council"] } });
  assert.equal(searched.data.hits.length, 1);
  const foreign = new QuorumRelayClient({ baseUrl, token: tokens[1] });
  const hidden = await foreign.execute("search", { query: { terms: ["Council"] } });
  assert.deepEqual(hidden.data.hits, []);
  const exported = await client.execute("export", { bundle: imported.data.bundle, format: "zip" });
  assert.ok(["completed", "partial"].includes(exported.status), JSON.stringify(exported));
  assert.equal(Buffer.from(exported.data.content_base64, "base64").subarray(0, 2).toString(), "PK");
  const uploaded = await client.upload(new Blob([Buffer.from(exported.data.content_base64, "base64")]));
  const repeated = await client.execute("import_bundle", {
    format: "zip", file_handle: uploaded.data.file_handle, persist: true,
  });
  assert.ok(repeated.data, JSON.stringify(repeated));
  assert.equal(repeated.data.changes[0].outcome, "unchanged");
  const unauthenticated = new QuorumRelayClient({ baseUrl });
  await assert.rejects(
    () => unauthenticated.info(),
    (error) => error instanceof ServiceError && error.httpStatus === 401,
  );
  await assert.rejects(
    () => client.execute("search", { tenant: "newsroom-b", query: {} }),
    (error) => error instanceof ServiceError && error.httpStatus === 400,
  );
  console.log(JSON.stringify({
    status: "PASS",
    mode: "synthetic saved capture; no live provider calls",
    library: info.data.version,
    schema: info.schema_version,
    providers: providers.data.providers.length,
    sequence: ["discover:partial", "fetch", "import_preview", "import_bundle:partial", "search", "export:zip", "reimport:unchanged"],
    isolation: ["other newsroom cannot search capture", "missing bearer rejected", "request tenant rejected"],
    transport: "real TypeScript client -> loopback HTTP -> Python engine -> SQLite",
  }));
} finally {
  if (service.exitCode === null) service.kill();
  await closed;
  await rm(root, { recursive: true, force: true });
}
