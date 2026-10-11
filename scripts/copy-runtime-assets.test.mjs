import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("a standalone Node build carries the matching render runtime without an ancestor node_modules", (t) => {
  const root = mkdtempSync(join(tmpdir(), "townreporter-render-packaging-"));
  t.after(() => rmSync(root, { recursive: true }));
  mkdirSync(join(root, "scripts"));
  cpSync(
    new URL("./copy-runtime-assets.mjs", import.meta.url),
    join(root, "scripts/copy-runtime-assets.mjs"),
  );
  const server = join(root, ".output/server");
  mkdirSync(server, { recursive: true });
  writeFileSync(
    join(server, "package.json"),
    JSON.stringify({ type: "module", dependencies: { existing: "1" } }),
  );
  const pglite = join(root, "node_modules/@electric-sql/pglite/dist");
  mkdirSync(pglite, { recursive: true });
  for (const name of ["pglite.data", "pglite.wasm", "initdb.wasm"])
    writeFileSync(join(pglite, name), "fixture");
  for (const name of ["playwright", "playwright-core"]) {
    const pkg = join(root, "node_modules", name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name, version: "1.62.1", main: "index.cjs" }),
    );
    writeFileSync(
      join(pkg, "index.cjs"),
      name === "playwright"
        ? "module.exports = require('playwright-core');"
        : "module.exports = {revision: 1234};",
    );
  }
  const copy = spawnSync(process.execPath, [join(root, "scripts/copy-runtime-assets.mjs")], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(copy.status, 0, copy.stderr);
  // Remove the source dependencies: only the deployed server can resolve now.
  rmSync(join(root, "node_modules"), { recursive: true });
  const runtime = spawnSync(
    process.execPath,
    ["-e", "console.log(require('playwright').revision)"],
    { cwd: server, encoding: "utf8", windowsHide: true },
  );
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.equal(runtime.stdout.trim(), "1234");
  const manifest = JSON.parse(readFileSync(join(server, "package.json"), "utf8"));
  assert.deepEqual(manifest.dependencies, {
    existing: "1",
    playwright: "1.62.1",
    "playwright-core": "1.62.1",
  });
  assert.ok(existsSync(join(server, "_libs/pglite.wasm")));
});
