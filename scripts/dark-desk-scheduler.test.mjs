import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const TEMPLATE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * ENG-202: the dev Vite plugin `darkDeskMonitorPlugin` (vite.config.ts,
 * `apply: "serve"`) only runs under `vite dev`. The built node-server needs
 * its own copy of the same drain -- server/plugins/dark-desk-scheduler.ts --
 * or a default self-hosted install never reclaims stale jobs/monitors
 * without CRON_SECRET or an external scheduler.
 *
 * These are source tripwires (this repo's established pattern -- see
 * grok-pwa-plugin.test.mjs's "vite config keeps the nitro serverDir wiring"
 * test): an accidental deletion or de-wiring of the plugin fails loudly here
 * instead of silently in a shipped install with no terminal open.
 */

function readScheduler() {
  return readFileSync(join(TEMPLATE_ROOT, "server/plugins/dark-desk-scheduler.ts"), "utf8");
}

test("prod scheduler plugin lives where Nitro's serverDir convention finds it", () => {
  const src = readScheduler();
  assert.match(src, /export default function/);
});

test("prod scheduler wires the same two functions the dev plugin uses", () => {
  const src = readScheduler();
  assert.match(src, /@\/lib\/news\/monitors-cron/);
  assert.match(src, /tickAllDueMonitors/);
  assert.match(src, /@\/lib\/news\/jobs/);
  assert.match(src, /drainQueuedJobs/);
});

test("prod scheduler matches the dev plugin's cadence exactly", () => {
  const src = readScheduler();
  const viteConfig = readFileSync(join(TEMPLATE_ROOT, "vite.config.ts"), "utf8");
  for (const n of ["45_000", "5 \\* 60 \\* 1000", "8_000", "20_000"]) {
    const re = new RegExp(n);
    assert.match(viteConfig, re, `dev plugin missing expected cadence literal ${n}`);
    assert.match(src, re, `prod plugin missing expected cadence literal ${n}`);
  }
});

/**
 * The scheduler must carry NO environment gate.
 *
 * The first draft returned early unless NODE_ENV was "production" -- and this
 * deployment never sets NODE_ENV (grep across ops/*.ps1 and .env.example
 * found none), so the guard disabled the plugin in the exact environment it
 * was written for. It is also unnecessary: vite.config.ts registers nitro()
 * (and with it server/plugins/*) only on build/preview, so this file never
 * loads under `npm run dev` and cannot double-drain against the Vite plugin.
 * If a NODE_ENV early-return reappears, unattended recovery silently dies.
 */
test("prod scheduler is not gated on NODE_ENV (this deploy never sets it)", () => {
  const src = readScheduler();
  const gated = /NODE_ENV/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""));
  assert.equal(
    gated,
    false,
    "a NODE_ENV check in the scheduler disables unattended recovery on this " +
      "deploy, which never sets NODE_ENV; the built server is the only place " +
      "this file loads, so no dev gate is needed",
  );
});

test("prod scheduler guards against overlapping ticks and never throws out of a tick", () => {
  const src = readScheduler();
  // Two independent ticking flags, one per drain, mirroring the dev plugin.
  assert.match(src, /ticking/);
  assert.match(src, /jobsTicking/);
  assert.match(src, /catch \(err\)/);
});
