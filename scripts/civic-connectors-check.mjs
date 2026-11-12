import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { safeTestEnvironment } from "./test-environment.mjs";

const check = process.argv[2] ?? "integration";
if (!["integration", "browser"].includes(check)) throw new Error("Choose integration or browser.");
const root = fileURLToPath(new URL("..", import.meta.url));
const child = spawn(process.execPath, [
  "--experimental-strip-types",
  "--import", new URL("./test-environment-guard.mjs", import.meta.url).href,
  "--import", new URL("../src/lib/test-support/model-seal.ts", import.meta.url).href,
  fileURLToPath(new URL(`./civic-connectors-${check}.mjs`, import.meta.url)),
], { cwd: root, env: safeTestEnvironment(), stdio: "inherit", windowsHide: true });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
