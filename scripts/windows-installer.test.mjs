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
    assert.match(output, /PASS private credentials/);
    assert.match(output, /PASS incomplete runtime/);
    assert.match(output, /PASS concurrent process/);
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
