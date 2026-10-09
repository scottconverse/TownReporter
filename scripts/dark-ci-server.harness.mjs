import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { once } from "node:events";
import { safeTestEnvironment } from "./test-environment.mjs";

export async function startLocalWalkServer(base, artifactDir) {
  const url = new URL(base);
  if (url.hostname !== "127.0.0.1" || ["3000", "3100", "3400", "5433"].includes(url.port)) throw new Error("Local CI walk requires an allowed temporary loopback port");
  mkdirSync(artifactDir, { recursive: true });
  process.env.TOWNREPORTER_DATA_ROOT = resolve(artifactDir, "disposable-data");
  const env = { ...safeTestEnvironment(), UIWALK_LOCAL_FIXTURE: "1", PORT: url.port, HOST: "127.0.0.1", BETTER_AUTH_URL: base, BETTER_AUTH_SECRET: "local-ci-walk-disposable-auth-only", TOWNREPORTER_DATA_ROOT: resolve(artifactDir, "disposable-data"), TOWNREPORTER_CODEX: "1", TOWNREPORTER_CLAUDE_CODE: "0", TOWNREPORTER_GEMINI: "0", TOWNREPORTER_TEST_ALLOW_REAL_MODELS: "" };
  for (const key of Object.keys(env)) if (/(?:API_KEY|ACCESS_TOKEN|LLM_BASE_URL|LLM_MODEL|DATABASE_URL)/.test(key)) env[key] = "";
  const log = createWriteStream(resolve(artifactDir, "local-server.log"));
  const child = spawn(process.execPath, ["--import", new URL("../src/lib/test-support/model-seal.ts", import.meta.url).href, "--import", new URL("./dark-ci-fixture.preload.mjs", import.meta.url).href, ".output/server/index.mjs"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log); child.stderr.pipe(log);
  const stop = async () => { if (child.exitCode === null) { child.kill(); await once(child, "exit"); } log.end(); };
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error("Local CI server exited; see local-server.log");
      try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) return stop; } catch { /* booting */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Local CI server did not boot; see local-server.log");
  } catch (error) { await stop(); throw error; }
}
