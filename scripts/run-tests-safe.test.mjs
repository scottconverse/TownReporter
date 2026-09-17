import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Exercise the real runner entry point, but replace child spawning before its
// imports load. A regression must never launch the entire destructive suite.
const preload = `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
childProcess.spawn = (command, args, options) => {
  console.log('SPAWN:' + JSON.stringify({ args, isolated: options.env.DATABASE_URL === '' }));
  const child = new EventEmitter();
  queueMicrotask(() => child.emit('exit', 0, null));
  return child;
};
syncBuiltinESMExports();
`;
function invoke(args) {
  return spawnSync(process.execPath, [
    "--import", `data:text/javascript,${encodeURIComponent(preload)}`,
    fileURLToPath(new URL("./run-tests-safe.mjs", import.meta.url)), ...args,
  ], { encoding: "utf8", timeout: 5000, windowsHide: true });
}

test("ordinary test command still runs both isolated suite groups", () => {
  const result = invoke([]);
  assert.equal(result.status, 0, result.stderr);
  const calls = result.stdout.split("\n").filter(line => line.startsWith("SPAWN:"))
    .map(line => JSON.parse(line.slice(6)));
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.isolated));
  assert.ok(calls[0].args.includes("scripts/**/*.test.mjs"));
  assert.ok(calls[1].args.includes("src/**/*.test.ts"));
});

for (const args of [["--run", "src/lib/news/search-web.test.ts"], ["src/lib/news/search-web.test.ts"]]) {
  test(`unsupported filtering refuses before spawning: ${args.join(" ")}`, () => {
    const result = invoke(args);
    assert.equal(result.status, 2, "must not silently launch the full suite");
    assert.equal(result.stdout.includes("SPAWN:"), false);
    assert.match(result.stderr, /with-app-env\.mjs node .*--test/);
  });
}
