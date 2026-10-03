import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  renameSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const windows = process.platform === "win32";
test("reduced offline app build identity survives relocation and rejects changed runtime files", async () => {
  const { sourceDigest, outputDigest, verifyBuild } = await import("./install-build-manifest.mjs");
  const fixture = mkdtempSync(join(tmpdir(), "tr-setup-manifest-"));
  let root = join(fixture, "staged-app");
  try {
    for (const dir of ["scripts", "installer", "migrations", ".output/server", ".output/public"]) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
    writeFileSync(join(root, "scripts/migrate.mjs"), "// runtime migrator\n");
    writeFileSync(join(root, "installer/Start.ps1"), "# runtime launcher\n");
    writeFileSync(join(root, "migrations/0001.sql"), "SELECT 1;\n");
    writeFileSync(join(root, ".output/server/index.mjs"), "// compiled server\n");
    writeFileSync(join(root, ".output/public/index.html"), "<p>paper</p>");
    writeFileSync(join(root, ".output/install-build.json"), JSON.stringify({ version: "1.2.3", sourceHash: sourceDigest(root), serverHash: outputDigest(root) }));
    assert.equal(verifyBuild(root).version, "1.2.3");
    const relocated = join(fixture, "installed app with spaces");
    renameSync(root, relocated);
    root = relocated;
    assert.equal(verifyBuild(root).version, "1.2.3");
    writeFileSync(join(root, "scripts/migrate.mjs"), "// changed migrator\n");
    assert.throws(() => verifyBuild(root), /Source changed/);
    writeFileSync(join(root, "scripts/migrate.mjs"), "// runtime migrator\n");
    writeFileSync(join(root, ".output/server/index.mjs"), "// changed server\n");
    assert.throws(() => verifyBuild(root), /Built server changed/);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test("setup PE import scanner ships transitive CRT imports and fails on missing DLLs", { skip: !windows }, () => {
  assert.ok(existsSync("scripts/build-windows-setup.ps1"));
  const root = mkdtempSync(join(tmpdir(), "tr-setup-crt-"));
  // Minimal PE32+ import tables: no executable code is run by this fixture.
  const image = (ordinary = [], delayed = []) => {
    const bytes = Buffer.alloc(2048);
    bytes.writeUInt16LE(0x5a4d, 0);
    bytes.writeUInt32LE(128, 60);
    bytes.writeUInt32LE(0x4550, 128);
    bytes.writeUInt16LE(0x8664, 132);
    bytes.writeUInt16LE(1, 134);
    bytes.writeUInt16LE(240, 148);
    bytes.writeUInt16LE(0x20b, 152);
    const section = 392;
    bytes.writeUInt32LE(1536, section + 8);
    bytes.writeUInt32LE(4096, section + 12);
    bytes.writeUInt32LE(1536, section + 16);
    bytes.writeUInt32LE(512, section + 20);
    let nameAt = 1024;
    for (const [index, table, stride, offset, names] of [[1, 512, 20, 12, ordinary], [13, 768, 32, 4, delayed]]) {
      if (names.length) bytes.writeUInt32LE(4096 + table - 512, 152 + 112 + index * 8);
      for (const [i, name] of names.entries()) {
        if (index === 13) bytes.writeUInt32LE(1, table + i * stride);
        bytes.writeUInt32LE(4096 + nameAt - 512, table + i * stride + offset);
        bytes.write(name + "\0", nameAt, "ascii");
        nameAt += name.length + 1;
      }
    }
    return bytes;
  };
  const literal = (value) => `'${value.replaceAll("'", "''")}'`;
  const build = literal(resolve("scripts/build-windows-setup.ps1"));
  const evaluate = (body) => execFileSync("powershell.exe", ["-NoProfile", "-Command", `$ErrorActionPreference='Stop'; $ast=[Management.Automation.Language.Parser]::ParseFile(${build},[ref]$null,[ref]$null); $ast.FindAll({param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -in @('Get-PeImports','Copy-AppLocalCrt')},$true) | ForEach-Object { Invoke-Expression $_.Extent.Text }; ${body}`], { encoding: "utf8", stdio: "pipe" });
  try {
    for (const dir of ["system", "node", "pg"]) mkdirSync(join(root, dir));
    const entry = join(root, "fixture.exe");
    writeFileSync(entry, image(["KERNEL32.dll", "msvcp140.dll", "api-ms-win-crt-runtime-l1-1-0.dll"], ["msvcp140_atomic_wait.dll"]));
    assert.deepEqual(evaluate(`Get-PeImports ${literal(entry)}`).trim().split(/\r?\n/), ["api-ms-win-crt-runtime-l1-1-0.dll", "kernel32.dll", "msvcp140.dll", "msvcp140_atomic_wait.dll"]);
    const copy = `Copy-AppLocalCrt @(${literal(entry)}) @(${literal(join(root, "node"))},${literal(join(root, "pg"))}) ${literal(join(root, "system"))}`;
    assert.throws(() => evaluate(copy), /Missing required app-local CRT DLL/);
    const names = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll", "msvcp140_atomic_wait.dll", "concrt140.dll", "ucrtbase.dll"];
    for (const name of names) writeFileSync(join(root, "system", name), image(name === "msvcp140_atomic_wait.dll" ? ["concrt140.dll"] : []));
    evaluate(copy);
    for (const dir of ["node", "pg"]) assert.deepEqual(readdirSync(join(root, dir)).sort(), names.sort());
    const corrupt = image();
    corrupt.writeUInt32LE(0xffffff00, 60);
    writeFileSync(entry, corrupt);
    assert.throws(() => evaluate(`Get-PeImports ${literal(entry)}`), /Invalid PE header/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("setup build and CI PowerShell parse without running the build or installer", { skip: !windows }, () => {
  const script = resolve("scripts/build-windows-setup.ps1").replaceAll("'", "''");
  execFileSync("powershell.exe", ["-NoProfile", "-Command", `$e=$null; [void][Management.Automation.Language.Parser]::ParseFile('${script}',[ref]$null,[ref]$e); if($e){$e | Out-String | Write-Output; exit 1}`]);
  // Parse each pwsh run block. Expressions are substituted with inert strings.
  const workflow = readFileSync(".github/workflows/windows-install.yml", "utf8");
  const steps = workflow.split(/\n      - /);
  for (const step of steps.filter((value) => /shell: pwsh/.test(value))) {
    const run = step.match(/run: \|\r?\n([\s\S]*?)(?=\n        [a-z-]+:|$)/);
    if (!run) continue;
    const body = run[1].split(/\r?\n/).map((line) => line.replace(/^          /, "")).join("\n").replace(/\$\{\{.*?\}\}/g, "fixture");
    const encoded = Buffer.from(body, "utf16le").toString("base64");
    execFileSync("powershell.exe", ["-NoProfile", "-Command", `$s=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')); $e=$null; [void][Management.Automation.Language.Parser]::ParseInput($s,[ref]$null,[ref]$e); if($e){$e | Out-String | Write-Output; exit 1}`]);
  }
});

test("offline setup ships a prebuilt payload and runs only first-run initialization", () => {
  assert.ok(existsSync("installer/FirstRun.ps1"), "offline FirstRun script is required");
  const firstRun = readFileSync("installer/FirstRun.ps1", "utf8");
  assert.doesNotMatch(firstRun, /Invoke-WebRequest|Get-VerifiedDependency|npm\.cmd|npm ci|install', 'chromium|run', 'build/);
  assert.match(firstRun, /Substring\(0, 8\)/);
  assert.match(firstRun, /initdb\.exe/);
  assert.match(firstRun, /install-build-manifest\.mjs.*verify/);
  assert.match(firstRun, /Start\.ps1/);
  assert.match(firstRun, /SETUP-CODE\.txt/);
  const build = readFileSync("scripts/build-windows-setup.ps1", "utf8");
  assert.match(build, /ci', '--omit=dev/);
  assert.match(build, /PLAYWRIGHT_BROWSERS_PATH/);
  assert.match(build, /'install', 'chromium'/);
  assert.match(build, /migration-plan\.mjs/);
  assert.match(build, /Copy-AppLocalCrt/);
  assert.match(build, /THIRD_PARTY_NOTICES\.txt/);
  assert.match(build, /'licenses'/);
  assert.match(build, /Checksum mismatch/);
  const template = readFileSync("installer/windows-setup/TownReporter.iss", "utf8");
  assert.match(template, /PrivilegesRequired=lowest/);
  assert.match(template, /DefaultDirName=\{localappdata\}\\Programs\\TownReporter/);
  assert.match(template, /TownReporter-\{#AppVersion\}-Setup/);
  assert.match(template, /FirstRun\.ps1/);
  assert.match(template, /ResultCode <> 0/);
  assert.match(template, /Choose an empty installation folder/);
});

test("setup CI blocks networking with a failed outbound probe and exercises long paths", () => {
  const workflow = readFileSync(".github/workflows/windows-install.yml", "utf8");
  assert.match(workflow, /name: Fresh Windows Setup\.exe install/);
  assert.match(workflow, /build-windows-setup\.ps1/);
  assert.match(workflow, /--version=6\.4\.3.*--require-checksums/);
  assert.match(workflow, /New-NetFirewallRule/);
  assert.match(workflow, /-Program \$program/);
  assert.match(workflow, /Restore outbound networking after acceptance/);
  assert.match(workflow, /-ItemType Junction/);
  assert.match(workflow, /Outbound request unexpectedly succeeded/);
  assert.match(workflow, /Remove-NetFirewallRule/);
  assert.match(workflow, /ci-long-path-/);
  assert.match(workflow, /Length -lt 140/);
  assert.match(workflow, /VERYSILENT.*SUPPRESSMSGBOXES/);
  assert.match(workflow, /WINDOWS_SIGNING_PFX/);
});

test("bundled Chromium path is passed to the runtime without changing the ZIP fallback", { skip: !windows }, () => {
  const common = resolve("installer/Common.ps1").replaceAll("'", "''");
  const command = `$ErrorActionPreference='Stop'; $ast=[Management.Automation.Language.Parser]::ParseFile('${common}',[ref]$null,[ref]$null); Invoke-Expression $ast.Find({param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'Set-AppEnvironment'},$true).Extent.Text; $DataRoot='C:\\unused-fixture'; $config=[pscustomobject]@{DatabasePassword='p';PgPort=15432;AuthSecret='s';Port=4388;InstanceId='i';NodeExe='C:\\node.exe';BrowsersPath='C:\\bundled\\chromium'}; Set-AppEnvironment; [Console]::WriteLine($env:PLAYWRIGHT_BROWSERS_PATH); $config.PSObject.Properties.Remove('BrowsersPath'); Set-AppEnvironment; [Console]::WriteLine($env:PLAYWRIGHT_BROWSERS_PATH)`;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" });
  assert.match(output, /C:\\bundled\\chromium/);
  assert.match(output, /C:\\unused-fixture\\browsers/);
});

test("candidate packaging checks out the exact pull-request head", () => {
  const workflow = readFileSync(resolve(".github/workflows/windows-install.yml"), "utf8");
  assert.match(
    workflow,
    /- uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\.4\.0\s+with:\s+ref: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/,
  );
});
test(
  "one source folder cannot be rebound to a different data directory",
  { skip: !windows && "Windows PowerShell required" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "tr-pointer-test-"));
    try {
      mkdirSync(join(root, "installer"));
      copyFileSync(resolve("installer/Install.ps1"), join(root, "installer/Install.ps1"));
      const requested = join(root, "different-data");
      writeFileSync(
        join(root, ".townreporter-install.json"),
        JSON.stringify({ DataRoot: join(root, "original-data") }),
      );
      let message = "unexpected success";
      try {
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            join(root, "installer/Install.ps1"),
            "-DataRoot",
            requested,
          ],
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (error) {
        message = String(error.stderr);
      }
      assert.match(message, /already belongs to another data directory/);
      assert.equal(
        existsSync(requested),
        false,
        "refusal must happen before creating or modifying the other data directory",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test(
  "private credentials, incomplete extraction and lifecycle concurrency hold on Windows",
  { skip: !windows && "Windows PowerShell required" },
  () => {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve("scripts/windows-installer-contract.ps1"),
        "-AppRoot",
        process.cwd(),
      ],
      { encoding: "utf8", stdio: "pipe" },
    );
    assert.match(output, /PASS hidden plain ancestors/);
    assert.match(output, /PASS bind preflight/);
    assert.match(output, /PASS private credentials/);
    assert.match(output, /PASS incomplete runtime/);
    assert.match(output, /PASS concurrent process/);
    assert.match(output, /PASS readiness timeout releases owned probe logs before returning/);
    assert.match(output, /PASS asynchronous readiness termination is joined with a bounded wait/);
  },
);
test(
  "installer PowerShell scripts parse and stay ASCII",
  { skip: !windows && "Windows PowerShell required" },
  () => {
    for (const name of readdirSync("installer").filter((n) => n.endsWith(".ps1"))) {
      const path = resolve("installer", name);
      assert.ok(
        [...readFileSync(path, "utf8")].every((character) => character.charCodeAt(0) < 128),
      );
      const command = `$e=$null; [void][Management.Automation.Language.Parser]::ParseFile('${path.replaceAll("'", "''")}',[ref]$null,[ref]$e); if($e){$e | Out-String | Write-Output; exit 1}`;
      execFileSync("powershell.exe", ["-NoProfile", "-Command", command]);
    }
  },
);
test(
  "a providers.json naming removed Grok keys is warned about, not fatal",
  { skip: !windows && "Windows PowerShell required" },
  () => {
    /*
      TownReporter removed Grok (xAI) as a provider. `Set-AppEnvironment` used
      to THROW on a hand-edited providers.json that still carried XAI_API_KEY,
      which left an upgrading operator with a start that failed and no way
      forward but editing JSON by hand -- for a line the app ignores anyway.
      The warning is what has to stay: admitted, dropped, and said out loud.
      An unknown name is still a typo, and still throws.
    */
    const dataRoot = mkdtempSync(join(tmpdir(), "tr-provider-test-"));
    const runSetAppEnvironment = (settings) => {
      writeFileSync(join(dataRoot, "providers.json"), JSON.stringify(settings));
      const command = [
        "$ErrorActionPreference='Stop'",
        `$common = Join-Path '${process.cwd().replaceAll("'", "''")}' 'installer\\Common.ps1'`,
        "$ast = [Management.Automation.Language.Parser]::ParseInput((Get-Content -LiteralPath $common -Raw), [ref]$null, [ref]$null)",
        "$fn = $ast.Find({param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'Set-AppEnvironment'}, $true).Extent.Text",
        "Invoke-Expression $fn",
        `$DataRoot = '${dataRoot.replaceAll("'", "''")}'`,
        "$config = [pscustomobject]@{ DatabasePassword='p'; PgPort=1; AuthSecret='s'; Port=2; InstanceId='i'; NodeExe=(Join-Path $env:SystemRoot 'System32\\cmd.exe') }",
        "$env:LLM_API_KEY=''; $env:XAI_API_KEY=''; $env:GROK_API_KEY=''",
        "Set-AppEnvironment *>&1 | ForEach-Object { [Console]::Out.WriteLine($_) }",
        "'RESULT llm=' + $env:LLM_API_KEY + ' xai=[' + $env:XAI_API_KEY + '] grok=[' + $env:GROK_API_KEY + ']'",
      ].join("; ");
      try {
        return {
          ok: true,
          output: execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
            encoding: "utf8",
            stdio: "pipe",
          }),
        };
      } catch (error) {
        return { ok: false, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
      }
    };

    try {
      const kept = runSetAppEnvironment({
        LLM_API_KEY: "gateway-key",
        XAI_API_KEY: "xai-leftover",
        GROK_API_KEY: "grok-leftover",
      });
      assert.equal(kept.ok, true, `a stale xAI key must not stop the install:\n${kept.output}`);
      assert.match(kept.output, /Ignoring XAI_API_KEY in providers\.json/);
      assert.match(kept.output, /Ignoring GROK_API_KEY in providers\.json/);
      assert.match(kept.output, /RESULT llm=gateway-key xai=\[\] grok=\[\]/, "a removed key was carried into the app's environment");

      const typo = runSetAppEnvironment({ LLM_APIKEY: "gateway-key" });
      assert.equal(typo.ok, false, "an unknown provider setting is still refused");
      assert.match(typo.output, /Unsupported provider setting: LLM_APIKEY/);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  },
);
test(
  "installer rejects a config belonging to another source tree before touching processes",
  { skip: !windows && "Windows PowerShell required" },
  () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "tr-install-test-"));
    try {
      writeFileSync(
        join(dataRoot, "config.json"),
        JSON.stringify({
          AppRoot: "C:\\another-paper",
          DataRoot: dataRoot,
          InstanceId: "a".repeat(32),
        }),
      );
      const result = (() => {
        try {
          execFileSync(
            "powershell.exe",
            [
              "-NoProfile",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              resolve("installer/Stop.ps1"),
              "-DataRoot",
              dataRoot,
            ],
            { encoding: "utf8", stdio: "pipe" },
          );
          return "unexpected success";
        } catch (error) {
          return String(error.stderr);
        }
      })();
      assert.match(result, /Installation identity mismatch/);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  },
);

test(
  "legacy operations refuse an unconfigured checkout before looking at processes or databases",
  { skip: !windows && "Windows PowerShell required" },
  () => {
    const commands = [
      "restart-app.ps1",
      "watchdog.ps1",
      "stop-townreporter.ps1",
      "start-townreporter.ps1",
    ];
    for (const name of commands) {
      let message = "unexpected success";
      try {
        execFileSync(
          "powershell.exe",
          ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve("ops", name)],
          {
            env: {
              ...process.env,
              TOWNREPORTER_DATA_ROOT: resolve("artifacts", "inert-test-install"),
              WATCHDOG_TEST_MODE: "",
            },
            encoding: "utf8",
            stdio: "pipe",
          },
        );
      } catch (error) {
        message = String(error.stderr);
      }
      assert.match(message, /portable install.*|legacy machine operations are disabled/s, name);
    }
  },
);
