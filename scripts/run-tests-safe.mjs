import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { safeTestEnvironment } from "./test-environment.mjs";
import { shardArgs, shardNotice } from "./test-shard.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const guard = new URL("./test-environment-guard.mjs", import.meta.url).href;

if (process.argv.length > 2) {
  console.error(
    "npm test runs the complete suite and does not accept filtering arguments. " +
    "For a focused run use: node scripts/with-app-env.mjs node --experimental-strip-types --test <test-file>",
  );
  process.exit(2);
}

/**
 * CI runs this command on several machines at once, each taking one slice of
 * the discovered files (scripts/test-shard.mjs). A developer sets neither
 * variable and gets the complete suite. A half-set pair is refused here rather
 * than quietly running the wrong files.
 */
let slice;
try {
  slice = shardArgs(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const notice = shardNotice(process.env);
if (notice) console.log(notice);

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
  ["--test", ...slice, "scripts/**/*.test.mjs"],
  ["--experimental-strip-types", "--test", "--test-concurrency=1", ...slice, "src/**/*.test.ts"],
]) {
  const code = await run(args);
  if (code !== 0) process.exit(code);
}
