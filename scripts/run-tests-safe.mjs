import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { safeTestEnvironment } from "./test-environment.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const guard = new URL("./test-environment-guard.mjs", import.meta.url).href;

/**
 * The ordinary suite is destructive by design inside its disposable database:
 * several tests clear whole membership/invite tables. Never let an inherited
 * production or development DATABASE_URL turn that fixture cleanup into a
 * real-database cleanup.
 */
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", guard, ...args], {
      cwd: root,
      env: safeTestEnvironment(),
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`test process ended by ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

for (const args of [
  ["--test", "scripts/**/*.test.mjs"],
  ["--experimental-strip-types", "--test", "--test-concurrency=1", "src/**/*.test.ts"],
]) {
  const code = await run(args);
  if (code !== 0) process.exit(code);
}
