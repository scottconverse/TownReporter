import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCliCandidates, findClaudeCli, resetClaudeCliCache } from "./ai-claude-code.server.ts";
import { findCodexCli } from "./ai-codex.server.ts";
import { npmRoamingDir } from "./cli-child-env.server.ts";

const KEYS = ["APPDATA", "USERPROFILE", "HOME", "CLAUDE_CLI_PATH", "CODEX_CLI_PATH"] as const;

async function withEnv<T>(vars: Partial<Record<(typeof KEYS)[number], string>>, run: () => Promise<T> | T): Promise<T> {
  const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  resetClaudeCliCache();
  try {
    return await run();
  } finally {
    for (const k of KEYS) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
    resetClaudeCliCache();
  }
}

describe("CLI lookups when the paper starts at boot (no APPDATA)", () => {
  it("derives the roaming folder from USERPROFILE, and prefers a real APPDATA", async () => {
    await withEnv({ USERPROFILE: join(tmpdir(), "someone") }, () => {
      assert.equal(npmRoamingDir(), join(tmpdir(), "someone", "AppData", "Roaming"));
    });
    await withEnv({ APPDATA: " /roam/dir ", USERPROFILE: join(tmpdir(), "someone") }, () => {
      assert.equal(npmRoamingDir(), "/roam/dir");
    });
    await withEnv({}, () => assert.equal(npmRoamingDir(), undefined));
  });

  it("lists the Claude npm binary under USERPROFILE AppData Roaming", async () => {
    const profile = join(tmpdir(), "someone");
    await withEnv({ USERPROFILE: profile }, () => {
      const expected = [join(profile, "AppData", "Roaming"), "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"].join(String.fromCharCode(92));
      assert.ok(claudeCliCandidates().includes(expected));
    });
  });

  it("does not remember a miss: finds the Claude program once it appears", async () => {
    const dir = await mkdtemp(join(tmpdir(), "claude-miss-"));
    const bin = join(dir, "claude.exe");
    try {
      await withEnv({ CLAUDE_CLI_PATH: bin }, async () => {
        assert.equal(await findClaudeCli(), null);
        await writeFile(bin, "");
        assert.equal(await findClaudeCli(), bin);
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("finds the Claude program installed under USERPROFILE with no APPDATA", { skip: process.platform !== "win32" }, async () => {
    const profile = await mkdtemp(join(tmpdir(), "claude-boot-"));
    const bin = join(profile, "AppData", "Roaming", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    try {
      await withEnv({ USERPROFILE: profile }, async () => {
        assert.notEqual(await findClaudeCli(), bin);
        await mkdir(join(bin, ".."), { recursive: true });
        await writeFile(bin, "");
        assert.equal(await findClaudeCli(), bin);
      });
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  });

  it("finds the Codex program under USERPROFILE with no APPDATA, and looks again each call", async () => {
    const profile = await mkdtemp(join(tmpdir(), "codex-boot-"));
    const npmDir = join(profile, "AppData", "Roaming", "npm");
    const shim = join(npmDir, process.platform === "win32" ? "codex.cmd" : "codex");
    try {
      await withEnv({ USERPROFILE: profile }, async () => {
        assert.deepEqual(await findCodexCli(), { ok: true, bin: "codex" });
        await mkdir(npmDir, { recursive: true });
        await writeFile(shim, "");
        assert.deepEqual(await findCodexCli(), { ok: true, bin: shim });
      });
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  });
});
