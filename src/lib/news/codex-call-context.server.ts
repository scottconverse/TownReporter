/** Per-call Codex state: keep configured tools/sign-in, omit personal prompt files. */
import { copyFile, link, mkdir, mkdtemp, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { codexChildEnv } from "./cli-child-env.server.ts";

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

export async function createCodexCallContext(input: { system: string; systemPromptFile?: string }) {
  const env = codexChildEnv();
  const originalHome = env.CODEX_HOME;
  const root = await mkdtemp(join(tmpdir(), "tr-codex-call-"));
  const linkedDirectories: string[] = [];
  const dispose = async () => {
    // Remove links explicitly before recursive cleanup; never traverse the
    // operator's plugin/skill directories, including Windows junction targets.
    for (const directory of linkedDirectories) {
      try { await unlink(directory); } catch (error) { if (!missing(error)) throw error; }
    }
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  try {
    if (originalHome) {
      const source = resolve(originalHome);
      try { await copyFile(join(source, "config.toml"), join(root, "config.toml")); }
      catch (error) { if (!missing(error)) throw error; }
      // Never read credentials. Removing the scratch hardlink preserves its source.
      try { await link(join(source, "auth.json"), join(root, "auth.json")); }
      catch (error) { if (!missing(error)) throw error; }
      for (const name of ["plugins", "skills"]) {
        const target = join(source, name);
        try {
          if (!(await stat(target)).isDirectory()) continue;
        } catch (error) { if (missing(error)) continue; throw error; }
        const destination = join(root, name);
        await symlink(target, destination, process.platform === "win32" ? "junction" : "dir");
        linkedDirectories.push(destination);
      }
    }
    const instructionFile = input.systemPromptFile || join(root, "desk-instructions.md");
    if (!input.systemPromptFile) {
      await writeFile(instructionFile, input.system || "Follow the newsroom assignment supplied by the user.", "utf8");
    }
    const cwd = join(root, "work");
    await mkdir(cwd);
    return { env: { ...env, CODEX_HOME: root }, cwd, instructionFile, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
