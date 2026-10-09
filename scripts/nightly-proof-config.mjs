import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const testName = /^townreporter_test_[0-9]{8}_[0-9]{6}$/;

/** Retains the old guard's name, but only the separate Test cluster is allowed. */
export function assertDevDatabase(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Refusing invalid DATABASE_URL");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.port !== "5547" ||
    parsed.username !== "tr_test_admin" ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !testName.test(parsed.pathname.slice(1))
  ) {
    throw new Error(
      "Refusing DATABASE_URL: use tr_test_admin, password-less, on 127.0.0.1:5547/townreporter_test_<stamp>",
    );
  }
  return parsed.href;
}

/** Discovery is one SELECT, with psql -w so a scheduled run never prompts. */
export async function resolveProofTarget(env = process.env, run = runFile) {
  const baseUrl = new URL(env.LIVE_PIPELINE_BASE_URL || "http://127.0.0.1:3400");
  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    !["127.0.0.1", "localhost"].includes(baseUrl.hostname) ||
    baseUrl.port !== "3400" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error("Refusing proof base URL: use the loopback Test server on port 3400");
  }
  let databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    const psql =
      process.platform === "win32"
        ? join(homedir(), "scoop", "apps", "postgresql", "current", "bin", "psql.exe")
        : "psql";
    const { stdout } = await run(
      psql,
      [
        "-X",
        "-w",
        "-h",
        "127.0.0.1",
        "-p",
        "5547",
        "-U",
        "tr_test_admin",
        "-d",
        "postgres",
        "-At",
        "-c",
        "SELECT datname FROM pg_database WHERE datname ~ '^townreporter_test_[0-9]{8}_[0-9]{6}$' AND datallowconn ORDER BY datname DESC LIMIT 1",
      ],
      {
        windowsHide: true,
        timeout: 15_000,
        env: {
          ...Object.fromEntries(Object.entries(env).filter(([key]) => !/^PG/i.test(key))),
          PGPASSWORD: "",
          PGPASSFILE: process.platform === "win32" ? "NUL" : "/dev/null",
          PGOPTIONS: "-c default_transaction_read_only=on",
        },
      },
    );
    const name = stdout.trim();
    if (!testName.test(name)) throw new Error("No stamped Test database found on 127.0.0.1:5547");
    databaseUrl = `postgres://tr_test_admin@127.0.0.1:5547/${name}`;
  }
  return {
    base: baseUrl.href.replace(/\/$/, ""),
    databaseUrl: assertDevDatabase(databaseUrl),
    editorEmail: env.LIVE_PIPELINE_EDITOR_EMAIL || "test-owner@townreporter.test",
    passwordFile:
      env.LIVE_PIPELINE_PASSWORD_FILE ||
      String.raw`C:\Users\scott\Desktop\Code\townreporter-test\test-owner.private`,
  };
}
