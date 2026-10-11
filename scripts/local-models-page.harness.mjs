import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { once } from 'node:events';
import { safeTestEnvironment } from './test-environment.mjs';

const RESERVED_PORTS = new Set([3000,3100,3400,5433,5432,5548,5547]);

function assertArtifactDir(dir){
  const cwd = process.cwd();
  const abs = resolve(cwd, dir);
  const rel = relative(cwd, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`artifactDir must be within cwd: ${dir}`);
  }
  return abs;
}

export async function startLocalModelsFixtureServer(base, artifactDir){
  const url = new URL(base);
  if (url.hostname !== '127.0.0.1') throw new Error('base hostname must be 127.0.0.1');
  const port = Number(url.port);
  if (!port) throw new Error('base must have a nonempty port');
  if (RESERVED_PORTS.has(port)) throw new Error(`reserved port: ${port}`);

  const absArtifact = assertArtifactDir(artifactDir);
  mkdirSync(absArtifact, { recursive: true });
  const logPath = resolve(absArtifact, 'fixture-server.log');
  const logStream = createWriteStream(logPath, { flags: 'a' });

  const dataRoot = `${absArtifact}/disposable-data`;
  process.env.TOWNREPORTER_DATA_ROOT = dataRoot;

  const env = safeTestEnvironment({
    ...process.env,
    DATABASE_URL: '',
    VERCEL: '',
    VERCEL_ENV: '',
    LLM_BASE_URL: 'http://127.0.0.1:1234/v1',
    TOWNREPORTER_LOCAL_DISCOVERY: '0',
    TOWNREPORTER_LOCAL: '1',
    PORT: String(port),
    HOST: '127.0.0.1',
    BETTER_AUTH_URL: base,
    BETTER_AUTH_SECRET: 'fixture-disposable-secret-not-real',
    TOWNREPORTER_DATA_ROOT: dataRoot,
    TOWNREPORTER_CODEX: '0',
    TOWNREPORTER_CLAUDE_CODE: '0',
    TOWNREPORTER_DEEPSEEK: '0',
    TOWNREPORTER_QWEN: '0',
    TOWNREPORTER_GEMINI: '0',
  });

  for (const key of Object.keys(env)) {
    if (/API_KEY|ACCESS_TOKEN|LLM_MODEL/i.test(key)) {
      if (key === 'LLM_BASE_URL' || key === 'BETTER_AUTH_SECRET') continue;
      env[key] = '';
    }
  }

  const preload = new URL('./local-models-page.fixture.mjs', import.meta.url).href;
  const child = spawn(
    process.execPath,
    ['--import', preload, '.output/server/index.mjs'],
    { cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore','pipe','pipe'] }
  );

  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });

  let childError = null;
  child.on('error', (err) => { childError = err; });

  async function stop(){
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill();
        await once(child, 'exit');
      } catch { /* ignore */ }
    }
    await new Promise((res) => logStream.end(res));
  }

  async function reachable(){
    if (childError) throw childError;
    if (child.exitCode !== null) return false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1000);
      const res = await fetch(base, { signal: ctrl.signal });
      clearTimeout(t);
      return res.status > 0;
    } catch { return false; }
  }

  try {
    for (let i = 0; i < 120; i++) {
      if (childError) throw childError;
      if (child.exitCode !== null) throw new Error(`fixture server exited early: ${child.exitCode}`);
      if (await reachable()) return stop;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('fixture server did not become reachable');
  } catch (err) {
    await stop().catch(() => {});
    throw err;
  }
}
