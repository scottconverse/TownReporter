/** Per-call Codex state: keep configured tools/sign-in, omit personal prompt files. */
import { randomUUID } from "node:crypto";
import { copyFile, link, mkdir, mkdtemp, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { codexChildEnv } from "./cli-child-env.server.ts";

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

type AuthIdentity = { ino: number; dev: number; size: number; mtimeMs: number };

async function authIdentity(path: string): Promise<AuthIdentity | undefined> {
  try {
    const { ino, dev, size, mtimeMs } = await stat(path);
    return { ino, dev, size, mtimeMs };
  } catch (error) { if (!missing(error)) throw error; }
}

function sameFile(a: AuthIdentity, b: AuthIdentity): boolean {
  return a.ino === b.ino && a.dev === b.dev;
}

function sameIdentity(a: AuthIdentity, b: AuthIdentity): boolean {
  return sameFile(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

export async function createCodexCallContext(input: { system: string; systemPromptFile?: string }) {
  const env = codexChildEnv();
  const originalHome = env.CODEX_HOME;
  const root = await mkdtemp(join(tmpdir(), "tr-codex-call-"));
  const linkedDirectories: string[] = [];
  const realAuth = originalHome ? join(resolve(originalHome), "auth.json") : undefined;
  const tempAuth = join(root, "auth.json");
  let startingAuth: AuthIdentity | undefined;
  let linkedAuth: AuthIdentity | undefined;
  let disposed = false;
  const persistRenewal = async () => {
    if (!realAuth || !startingAuth || !linkedAuth) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      const temporary = await authIdentity(tempAuth);
      const current = await authIdentity(realAuth);
      // A missing operator file means signout: never recreate it. In-place
      // updates already reached the operator through the original hardlink.
      if (!temporary || !current) return;
      if (sameFile(temporary, linkedAuth) && sameFile(current, linkedAuth)) return;
      if (sameFile(temporary, current) || temporary.mtimeMs <= startingAuth.mtimeMs) return;
      if (!sameIdentity(current, startingAuth) && temporary.mtimeMs <= current.mtimeMs) return;

      const staging = join(resolve(originalHome!), `.auth-renewal-${randomUUID()}.json`);
      try {
        // Credential bytes only pass through copyFile and atomic sibling rename.
        await copyFile(tempAuth, staging);
        const latest = await authIdentity(realAuth);
        if (!latest) return;
        if (!sameIdentity(current, latest)) continue;
        await rename(staging, realAuth);
        return;
      } finally {
        // This is our unique staging file, never the operator's auth path.
        await rm(staging, { force: true });
      }
    }
    throw new Error("Codex auth changed during renewal persistence; temporary home retained");
  };
  const dispose = async () => {
    if (disposed) return;
    // On copy/rename/recheck failure retain the scratch home and its renewal.
    await persistRenewal();
    // Remove links explicitly before recursive cleanup; never traverse the
    // operator's plugin/skill directories, including Windows junction targets.
    for (const directory of linkedDirectories) {
      try { await unlink(directory); } catch (error) { if (!missing(error)) throw error; }
    }
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    disposed = true;
  };
  try {
    if (originalHome) {
      const source = resolve(originalHome);
      try { await copyFile(join(source, "config.toml"), join(root, "config.toml")); }
      catch (error) { if (!missing(error)) throw error; }
      // Record identities without reading credentials; the CLI may renew by rename.
      startingAuth = await authIdentity(realAuth!);
      try {
        await link(realAuth!, tempAuth);
        linkedAuth = await authIdentity(tempAuth);
      } catch (error) { if (!missing(error)) throw error; }
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
