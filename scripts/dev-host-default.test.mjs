import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `npm run dev` must not answer on the local network by default.
 *
 * The dev server binds whatever host `vite dev --host` names, independent of
 * the built server's HOST env var covered by binds-loopback-by-default.test.mjs.
 * It used to be `--host 0.0.0.0` unconditionally, so anyone who ran the
 * documented quickstart on, say, cafe Wi-Fi exposed their desk -- unpublished
 * drafts, the Server page, sign-in -- to every other device on that network.
 *
 * `dev` now defaults to loopback; `npm run dev:lan` is the one documented way
 * to open it up again for phone/LAN testing.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readScripts() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  return pkg.scripts ?? {};
}

test("npm run dev defaults to loopback", () => {
  const scripts = readScripts();
  assert.ok(scripts.dev, "package.json has no \"dev\" script");
  assert.match(
    scripts.dev,
    /--host 127\.0\.0\.1\b/,
    `"dev" is "${scripts.dev}"; it must pass --host 127.0.0.1 so the quickstart ` +
      "never answers on the local network by default",
  );
  assert.doesNotMatch(
    scripts.dev,
    /--host 0\.0\.0\.0\b/,
    '"dev" still passes --host 0.0.0.0 -- that belongs on "dev:lan" only',
  );
});

test("npm run dev:lan is the documented way to open dev to the network", () => {
  const scripts = readScripts();
  assert.ok(scripts["dev:lan"], "package.json has no \"dev:lan\" script for LAN/phone testing");
  assert.match(
    scripts["dev:lan"],
    /--host 0\.0\.0\.0\b/,
    `"dev:lan" is "${scripts["dev:lan"]}"; it must pass --host 0.0.0.0`,
  );
  assert.match(
    scripts["dev:lan"],
    /--port 8080\b/,
    `"dev:lan" is "${scripts["dev:lan"]}"; it must keep --port 8080 like "dev"`,
  );
});

test("dev and dev:lan agree on everything except --host", () => {
  const scripts = readScripts();
  const strip = (s) => s.replace(/--host \S+/, "--host <HOST>");
  assert.equal(
    strip(scripts.dev),
    strip(scripts["dev:lan"]),
    '"dev" and "dev:lan" have drifted apart beyond the --host flag',
  );
});
