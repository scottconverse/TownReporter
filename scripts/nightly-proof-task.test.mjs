// guards: a nightly run could stage an account in the wrong paper instead of drafting on Test.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test(
  "manual and scheduled proof entry runs the proof without staging an editor",
  { skip: process.platform !== "win32" },
  () => {
    const script = fileURLToPath(new URL("../ops/nightly-proof.ps1", import.meta.url)).replaceAll(
      "'",
      "''",
    );
    const output = execFileSync(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        `function node { Write-Output ('PROOF_CALL:' + ($args -join ' ')); $global:LASTEXITCODE = 0 }; $env:DATABASE_URL = ''; & '${script}' -Now`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    assert.deepEqual(
      output.split(/\r?\n/).filter((line) => line.startsWith("PROOF_CALL:")),
      ["PROOF_CALL:scripts/live-pipeline-proof.mjs"],
    );
  },
);
