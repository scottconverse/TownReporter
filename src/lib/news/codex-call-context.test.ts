import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCodexCallContext } from "./codex-call-context.server.ts";
import { codexChat } from "./ai-codex.server.ts";
import { codexChildEnv } from "./cli-child-env.server.ts";

async function fixture(run: (home: string, root: string, config: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "tr-codex-context-test-"));
  const home = join(root, "operator");
  await mkdir(home);
  const config = '[mcp_servers.fixture]\r\ncommand = "fixture-mcp"\r\n[features]\r\nhooks = true\r\n';
  await writeFile(join(home, "config.toml"), config);
  await writeFile(join(home, "auth.json"), "synthetic-sign-in-never-read");
  for (const name of ["plugins", "skills", "memories", "hooks", "sessions"]) {
    await mkdir(join(home, name));
    await writeFile(join(home, name, "sentinel.txt"), name);
  }
  await writeFile(join(home, "AGENTS.md"), "PERSONAL_INSTRUCTIONS");
  const before = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try { await run(home, root, config); }
  finally {
    if (before === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = before;
    await rm(root, { recursive: true, force: true });
  }
}

describe("Codex newsroom context", () => {
  it("preserves config and sign-in with all plugin/skill tools while omitting personal prompt inputs", async () => {
    await fixture(async (home, _root, config) => {
      const originalEnv = codexChildEnv();
      const originalAuth = await stat(join(home, "auth.json"));
      const first = await createCodexCallContext({ system: "Desk instructions" });
      const second = await createCodexCallContext({ system: "" });
      try {
        assert.notEqual(first.env.CODEX_HOME, second.env.CODEX_HOME);
        assert.equal(process.env.CODEX_HOME, home);
        assert.deepEqual({ ...first.env, CODEX_HOME: home }, originalEnv);
        assert.deepEqual({ ...second.env, CODEX_HOME: home }, originalEnv);
        assert.equal(await readFile(join(first.env.CODEX_HOME, "config.toml"), "utf8"), config);
        const linkedAuth = await stat(join(first.env.CODEX_HOME, "auth.json"));
        assert.equal(linkedAuth.ino, originalAuth.ino);
        assert.equal(linkedAuth.dev, originalAuth.dev);
        assert.ok(linkedAuth.nlink >= 2);
        for (const name of ["plugins", "skills"]) {
          assert.equal(await readFile(join(first.env.CODEX_HOME, name, "sentinel.txt"), "utf8"), name);
        }
        for (const name of ["AGENTS.md", "memories", "hooks", "sessions"]) {
          await assert.rejects(access(join(first.env.CODEX_HOME, name)), { code: "ENOENT" });
        }
        assert.deepEqual(await readdir(first.cwd), []);
        assert.equal(await readFile(first.instructionFile, "utf8"), "Desk instructions");
        assert.ok((await readFile(second.instructionFile, "utf8")).length > 0);
      } finally { await first.dispose(); await second.dispose(); }
      await assert.rejects(access(first.env.CODEX_HOME), { code: "ENOENT" });
      assert.equal(await readFile(join(home, "config.toml"), "utf8"), config);
      assert.equal((await stat(join(home, "auth.json"))).ino, originalAuth.ino);
      assert.equal((await stat(join(home, "auth.json"))).nlink, originalAuth.nlink);
      for (const name of ["plugins", "skills", "memories", "hooks", "sessions"]) await access(join(home, name, "sentinel.txt"));
      assert.equal(await readFile(join(home, "AGENTS.md"), "utf8"), "PERSONAL_INSTRUCTIONS");
    });
  });

  it("chat and image calls override inherited instruction and compact files and clean their call context", async () => {
    await fixture(async (home, root, config) => {
      await writeFile(join(home, "config.toml"), 'model_instructions_file = "personal.md"\nexperimental_compact_prompt_file = "personal-compact.md"\n' + config);
      const fake = join(root, "inspect.mjs");
      await writeFile(fake, `
        import { readFileSync } from 'node:fs';
        const args = process.argv.slice(2);
        const setting = name => JSON.parse(args.find(arg => arg.startsWith(name + '=')).slice(name.length + 1));
        const file = setting('model_instructions_file');
        console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({
          args, home: process.env.CODEX_HOME, cwd: process.cwd(), file,
          compact: setting('experimental_compact_prompt_file'), instructions: readFileSync(file, 'utf8')
        }) } }));
      `);
      const previous = process.env.CODEX_CLI_PATH;
      process.env.CODEX_CLI_PATH = fake;
      try {
        for (const imagePaths of [undefined, [join(root, "page.jpg")]]) {
          const result = await codexChat({ system: "Desk instructions", user: "Task", model: "gpt-6.1-sol", timeoutMs: 5_000, imagePaths });
          assert.equal(result.ok, true);
          if (!result.ok) continue;
          const received = JSON.parse(result.text);
          assert.equal(received.instructions, "Desk instructions");
          assert.equal(received.compact, received.file);
          assert.equal(resolve(received.cwd), join(received.home, "work"));
          assert.notEqual(received.home, home);
          for (const setting of ['developer_instructions=""', 'personality="none"', 'project_doc_max_bytes=0', 'features.hooks=false', 'features.memories=false', 'memories.use_memories=false', 'memories.generate_memories=false', 'notify=[]']) assert.ok(received.args.includes(setting), setting);
          for (const flag of ["--search", "--dangerously-bypass-approvals-and-sandbox"]) assert.ok(received.args.includes(flag));
          for (const flag of ["--bare", "--safe-mode", "--strict-mcp-config", "--disable", "--ignore-user-config"]) assert.equal(received.args.includes(flag), false);
          assert.equal(received.args.includes("--image"), Boolean(imagePaths));
          await assert.rejects(access(received.home), { code: "ENOENT" });
        }
      } finally {
        if (previous === undefined) delete process.env.CODEX_CLI_PATH;
        else process.env.CODEX_CLI_PATH = previous;
      }
    });
  });

  it("removes temporary contexts after failed and timed-out children without deleting tool links' targets", async () => {
    await fixture(async (home, root) => {
      const fake = join(root, "lifecycle.mjs");
      const dump = join(root, "child-home.txt");
      await writeFile(fake, `
        import { writeFileSync } from 'node:fs';
        writeFileSync(process.env.FAKE_CONTEXT_DUMP, process.env.CODEX_HOME);
        if (process.env.FAKE_CONTEXT_HANG === '1') setInterval(() => {}, 1000);
        else process.exitCode = 1;
      `);
      const changes = { CODEX_CLI_PATH: fake, FAKE_CONTEXT_DUMP: dump, FAKE_CONTEXT_HANG: "0" };
      const saved = Object.fromEntries(Object.keys(changes).map(name => [name, process.env[name]]));
      Object.assign(process.env, changes);
      try {
        for (const hang of [false, true]) {
          process.env.FAKE_CONTEXT_HANG = hang ? "1" : "0";
          const result = await codexChat({ system: "Desk instructions", user: "Task", model: "gpt-6.1-sol", timeoutMs: hang ? 500 : 5_000 });
          assert.equal(result.ok, false);
          assert.equal(result.meta?.timedOut, hang);
          const childHome = await readFile(dump, "utf8");
          await assert.rejects(access(childHome), { code: "ENOENT" });
          for (const name of ["plugins", "skills"]) await access(join(home, name, "sentinel.txt"));
          await access(join(home, "auth.json"));
        }
      } finally {
        for (const [name, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
      }
    });
  });
});
