import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The built server must carry its own unattended clock (ENG-202).
 *
 * The dev Vite plugin (`darkDeskMonitorPlugin`, apply:"serve") drains jobs
 * and ticks monitors on an interval -- and only in dev. A default self-hosted
 * install (no CRON_SECRET, no external scheduler) had no unattended recovery
 * at all: a job orphaned by a crash waited for the next human click.
 *
 * The clock's construction is load-bearing and this test pins each part:
 * two earlier homes for it broke two different ways (a dynamic "@/" alias
 * import from a Nitro plugin built a dangling chunk on Linux and silently
 * emptied the archive search; a start-from-db.ts pulled the news graph into
 * the client build and tripped import-protection). What survived: a fully
 * STATIC, RELATIVE import chain, entered only from
 * server/plugins/unattended-clock.ts.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
// The negative assertions target CODE; the files' own comments narrate the
// broken patterns by name and must not trip them.
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

test("the clock is static, relative, and driven by the right two functions", () => {
  const src = read("src/lib/news/unattended-scheduler.ts");
  assert.match(src, /^import \{ tickAllDueMonitors \} from "\.\/monitors-cron\.ts";/m);
  assert.match(src, /^import \{ drainQueuedJobs \} from "\.\/jobs\.ts";/m);
  // No dynamic imports and no "@/" alias -- each produced a broken build.
  assert.doesNotMatch(code("src/lib/news/unattended-scheduler.ts"), /import\(/);
  assert.doesNotMatch(code("src/lib/news/unattended-scheduler.ts"), /"@\//);
});

test("the plugin entry exists, imports relatively, and carries no NODE_ENV gate", () => {
  const plugin = read("server/plugins/unattended-clock.ts");
  assert.match(plugin, /from "\.\.\/\.\.\/src\/lib\/news\/unattended-scheduler\.ts"/);
  assert.match(plugin, /startUnattendedScheduler\(\)/);
  // NODE_ENV is never set on this deployment; a gate on it silently disables
  // recovery in the exact environment the plugin exists for.
  assert.doesNotMatch(code("server/plugins/unattended-clock.ts"), /NODE_ENV/);
});

test("nothing client-reachable imports the scheduler", () => {
  // db.ts (client-reachable) once started the clock and dragged the news
  // graph into the client build. The plugin must stay the only entry.
  read("src/lib/db.ts");
  assert.doesNotMatch(code("src/lib/db.ts"), /unattended-scheduler/);
});

test("the clock keeps the dev plugin's exact cadence", () => {
  const src = read("src/lib/news/unattended-scheduler.ts");
  const vite = read("vite.config.ts");
  for (const n of ["45_000", "8_000", "20_000", "5 \\* 60 \\* 1000"]) {
    const re = new RegExp(n);
    assert.match(vite, re, `dev plugin missing expected cadence literal ${n}`);
    assert.match(src, re, `prod clock missing expected cadence literal ${n}`);
  }
});

test("the clock guards overlap, swallows tick errors, and never pins the process", () => {
  const src = read("src/lib/news/unattended-scheduler.ts");
  assert.match(src, /ticking/);
  assert.match(src, /jobsTicking/);
  assert.match(src, /catch \(err\)/);
  assert.match(src, /unref/);
  assert.match(src, /globalThis/);
});

test("development and built clocks both reserve routine editions", () => {
  assert.match(read("vite.config.ts"), /tickRoutineNoticeEditions/);
  assert.match(read("src/lib/news/unattended-scheduler.ts"), /tickRoutineNoticeEditions/);
});

test("stats disk reporting has an independent bounded clock in development and built servers", () => {
  const built = read("src/lib/news/unattended-scheduler.ts");
  const vite = read("vite.config.ts");
  assert.match(built, /^import \{ tickStatsReports \} from "\.\/stats-reports\.server\.ts";/m);
  assert.match(built, /statsTicking/);
  assert.match(vite, /tickStatsReports/);
  assert.match(vite, /statsTicking/);
  for (const src of [built, vite]) {
    assert.match(src, /60_000/);
    assert.match(src, /60 \* 60 \* 1000/);
  }
});
