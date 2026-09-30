import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const windows = process.platform === "win32";
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
