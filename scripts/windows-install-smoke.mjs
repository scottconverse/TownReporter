#!/usr/bin/env node
/** Packaged native-Windows install acceptance; manual editorial workflow, no AI calls. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";
import { verifyBuild } from "./install-build-manifest.mjs";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = resolve(process.env.INSTALL_EVIDENCE_DIR || "");
const started = Date.parse(process.env.INSTALL_ACCEPTANCE_STARTED_AT || "");
const receipt = { ok: false, providerMode: "disabled; manual workflow only", checks: [] };
const errors = [];
let sequence = 0;

function inside(parent, child) {
  const path = relative(parent.toLowerCase(), child.toLowerCase());
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function powershell(args, expectedFailure = false) {
  let result;
  try {
    result = {
      ...(await execute(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args],
        { cwd: root, timeout: 300_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      )),
      code: 0,
    };
  } catch (error) {
    if (error.killed || !Number.isInteger(error.code)) throw error;
    result = { code: error.code, stdout: error.stdout || "", stderr: error.stderr || "" };
  }
  await writeFile(
    join(evidence, `command-${++sequence}.log`),
    `${result.stdout}\n${result.stderr}\nexit=${result.code}\n`,
  );
  if (expectedFailure)
    assert.notEqual(result.code, 0, "A stale source build was incorrectly accepted");
  else assert.equal(result.code, 0, `PowerShell failed: ${result.stderr || result.stdout}`);
  return result;
}

async function sockets(config) {
  const result = await powershell([
    "-Command",
    `$rows = @(Get-NetTCPConnection -State Listen -LocalPort ${config.Port},${config.PgPort} -ErrorAction SilentlyContinue | ForEach-Object { $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess); [pscustomobject]@{ Address=$_.LocalAddress; Port=$_.LocalPort; Executable=$owner.ExecutablePath } }); ConvertTo-Json -InputObject $rows -Compress`,
  ]);
  return JSON.parse(result.stdout);
}

async function assertListening(config) {
  const listeners = await sockets(config);
  for (const [port, binary] of [
    [config.Port, config.NodeExe],
    [config.PgPort, join(config.PgBin, "postgres.exe")],
  ]) {
    const selected = listeners.filter((row) => row.Port === port);
    assert.ok(selected.length > 0, `No listener on configured port ${port}`);
    for (const listener of selected) {
      assert.equal(listener.Address, "127.0.0.1", `Port ${port} was exposed beyond IPv4 loopback`);
      assert.equal(
        listener.Executable.toLowerCase(),
        binary.toLowerCase(),
        `Port ${port} belongs to a different runtime`,
      );
    }
  }
}

async function main() {
  assert.equal(process.platform, "win32", "Native installer acceptance requires Windows");
  assert.ok(
    process.env.INSTALL_EVIDENCE_DIR && !inside(root, evidence) && root !== evidence,
    "Evidence must live outside the packaged source",
  );
  assert.ok(Number.isFinite(started), "Provide the timestamp from before the ZIP download");
  await mkdir(evidence, { recursive: true });
  // Windows PowerShell 5.1's UTF8 output includes a BOM.
  const pointer = JSON.parse(
    (await readFile(join(root, ".townreporter-install.json"), "utf8")).replace(/^\uFEFF/, ""),
  );
  const config = JSON.parse(
    (await readFile(join(pointer.DataRoot, "config.json"), "utf8")).replace(/^\uFEFF/, ""),
  );
  assert.equal(resolve(config.AppRoot).toLowerCase(), root.toLowerCase());
  assert.equal(
    resolve(process.execPath).toLowerCase(),
    resolve(config.NodeExe).toLowerCase(),
    "Smoke must run with the privately installed Node binary",
  );
  assert.ok(inside(config.DataRoot, config.NodeExe), "Node was reused from the workstation");
  assert.ok(inside(config.DataRoot, config.PgBin), "Postgres was reused from the workstation");
  assert.ok(Number.isInteger(config.Port) && config.Port >= 1024 && config.Port <= 65535);
  assert.ok(Number.isInteger(config.PgPort) && config.PgPort >= 1024 && config.PgPort <= 65535);
  assert.notEqual(config.Port, config.PgPort);
  const archiveHash = createHash("sha256")
    .update(await readFile(process.env.INSTALL_SOURCE_ARCHIVE))
    .digest("hex");
  assert.equal(
    archiveHash,
    process.env.INSTALL_SOURCE_SHA256?.toLowerCase(),
    "Downloaded archive SHA mismatch",
  );
  receipt.archiveSha256 = archiveHash;
  assert.match(process.env.INSTALL_SOURCE_COMMIT || "", /^[a-f0-9]{40}$/);
  receipt.sourceCommit = process.env.INSTALL_SOURCE_COMMIT;
  receipt.version = verifyBuild(root).version;
  const manifest = await readFile(join(root, ".output/install-build.json"), "utf8");
  await writeFile(join(evidence, "install-build.json"), manifest);
  receipt.checks.push("Private Node/Postgres paths and downloaded source archive SHA verified");

  const lifecycle = (name, expectedFailure = false) =>
    powershell(
      [
        "-File",
        join(root, "installer", `${name}.ps1`),
        ...(name === "Start" ? ["-NoBrowser"] : []),
      ],
      expectedFailure,
    );
  let browser;
  try {
    await lifecycle("Stop");
    assert.deepEqual(await sockets(config), [], "Installer stop left app or DB listening");
    await writeFile(
      join(config.DataRoot, "providers.json"),
      JSON.stringify({
        TOWNREPORTER_CLAUDE_CODE: "0",
        TOWNREPORTER_CODEX: "0",
        TOWNREPORTER_LOCAL: "0",
      }),
    );
    await lifecycle("Start");
    await assertListening(config);
    const base = `http://127.0.0.1:${config.Port}`;
    const identityResponse = await fetch(`${base}/.well-known/townreporter-instance.json`, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(identityResponse.status, 200);
    const identity = await identityResponse.json();
    assert.equal(identity.instanceId, config.InstanceId);
    assert.equal(identity.version, receipt.version);
    assert.equal(identity.sourceHash, JSON.parse(manifest).sourceHash);
    receipt.checks.push("Served instance/version/source hash matches the packaged build manifest");
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(config.DataRoot, "browsers");
    const { chromium } = await import("playwright");
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    const clientErrors = [];
    page.on("pageerror", (error) => clientErrors.push(error.message));
    page.setDefaultTimeout(45_000);
    const stamp = Date.now();
    const email = `installer-${stamp}@townreporter.test`;
    const password = randomBytes(24).toString("hex");
    const headline = `Testerville library reading hours ${stamp}`;
    const body =
      "INSTALLER TEST FIXTURE. The Testerville library reading group meets on Tuesday. This manually written fixture verifies local publishing, not a real-world fact or AI research.";
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
    await page.getByLabel("Name").fill("Installer Test Editor");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create editor account" }).click();
    await page.getByRole("link", { name: "Queue", exact: true }).waitFor();
    await completeFirstRunSetup(page, base);
    await page.getByRole("link", { name: "Queue", exact: true }).click();
    await page.getByText("File a lead yourself").click();
    await page.getByLabel("Headline").fill(headline);
    await page
      .getByLabel("Why now")
      .fill("A manual installer acceptance fixture, not a reported event.");
    await page.getByRole("button", { name: "File lead" }).click();
    await page.getByLabel("Body").waitFor();
    await page.getByLabel("Headline").fill(headline);
    await page.getByLabel("Dek").fill("Local fixture for persistence verification.");
    await page.getByLabel("Body").fill(body);
    await page.getByRole("button", { name: "Publish to the paper" }).click();
    await page.getByRole("button", { name: "Yes, print it" }).click();
    await page.getByText("On the paper").waitFor();
    await page.getByRole("link", { name: "Read it on the paper" }).click();
    await page.waitForURL(/\/articles\//);
    const articleUrl = page.url();
    await page.getByRole("heading", { level: 1, name: headline, exact: true }).waitFor();
    await page.getByText(body, { exact: true }).waitFor();
    await page.screenshot({ path: join(evidence, "article-before-restart.png"), fullPage: true });
    receipt.checks.push("First owner, paper setup and manual article publication in browser");

    await lifecycle("Stop");
    await lifecycle("Stop");
    assert.deepEqual(await sockets(config), [], "Stop left a configured listener behind");
    const sourcePath = join(root, "src/lib/paper.ts");
    const original = await readFile(sourcePath);
    try {
      await writeFile(
        sourcePath,
        Buffer.concat([
          original,
          Buffer.from("\n// Installer acceptance: deliberately stale source.\n"),
        ]),
      );
      const rejected = await lifecycle("Start", true);
      assert.match(
        `${rejected.stdout}\n${rejected.stderr}`,
        /source changed|rebuild|build.*match/i,
      );
      assert.deepEqual(await sockets(config), [], "Stale build refusal still started a process");
    } finally {
      await writeFile(sourcePath, original);
    }
    receipt.checks.push(
      "Stale source was deliberately injected; Start failed closed with no listeners",
    );
    verifyBuild(root);
    await lifecycle("Start");
    await lifecycle("Start");
    await assertListening(config);
    await page.goto(`${base}/desk`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1, name: "The desk", exact: true }).waitFor();
    assert.ok(!page.url().includes("/login"), "Persistent session was lost on restart");
    await page.goto(articleUrl, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1, name: headline, exact: true }).waitFor();
    await page.getByText(body, { exact: true }).waitFor();
    await page.screenshot({ path: join(evidence, "article-after-restart.png"), fullPage: true });
    const fresh = await browser.newPage();
    fresh.on("pageerror", (error) => clientErrors.push(error.message));
    fresh.setDefaultTimeout(45_000);
    await fresh.goto(`${base}/login`, { waitUntil: "networkidle" });
    await fresh.getByLabel("Email").fill(email);
    await fresh.getByLabel("Password", { exact: true }).fill(password);
    await fresh.getByRole("button", { name: "Sign in with email", exact: true }).click();
    await fresh.getByRole("heading", { level: 1, name: "The desk", exact: true }).waitFor();
    assert.deepEqual(clientErrors, [], "Browser raised an uncaught application error");
    receipt.checks.push(
      "Idempotent stop/start, existing session, fresh owner sign-in and article persisted",
    );
  } catch (error) {
    errors.push(error.stack || String(error));
  } finally {
    if (browser)
      await browser.close().catch((error) => errors.push(`Browser cleanup: ${error.message}`));
    await lifecycle("Stop").catch((error) => errors.push(`Installer cleanup: ${error.message}`));
    receipt.elapsedSeconds = (Date.now() - started) / 1000;
    if (!(receipt.elapsedSeconds > 0 && receipt.elapsedSeconds < 3600))
      errors.push(`Under-hour requirement failed: ${receipt.elapsedSeconds} seconds`);
    receipt.ok = errors.length === 0;
    receipt.errors = errors;
    await writeFile(join(evidence, "receipt.json"), JSON.stringify(receipt, null, 2));
  }
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(JSON.stringify(receipt));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
