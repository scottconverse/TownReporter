/** Run the built render fallback outside the source checkout, using its packaged runtime. */
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const url = process.argv[2] || "https://www.longmonthumane.org/";
const root = await mkdtemp(join(tmpdir(), "townreporter-built-render-"));
try {
  await cp(new URL("../.output/server", import.meta.url), join(root, "server"), {
    recursive: true,
  });
  await writeFile(
    join(root, "probe.mjs"),
    `
    import assert from 'node:assert/strict';
    import {createRequire} from 'node:module';
    import {fileURLToPath} from 'node:url';
    import {fetchRenderedPage} from './server/_chunks/render-fetch.mjs';
    const require = createRequire(new URL('./server/package.json', import.meta.url));
    assert.ok(require.resolve('playwright').startsWith(fileURLToPath(new URL('./server/node_modules/', import.meta.url))));
    try {
      const page = await fetchRenderedPage(process.argv[2]);
      assert.ok(page && page.text.length >= 40, 'built render must return readable public text');
      console.log(JSON.stringify({title:page.title,characters:page.text.length,finalUrl:page.finalUrl}));
      process.exit(0);
    } catch (error) { console.error(error); process.exit(1); }
  `,
  );
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, "probe.mjs"), url], {
      cwd: root,
      windowsHide: true,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: "", VERCEL: "", TOWNREPORTER_NO_PLAYWRIGHT: "" },
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  assert.equal(code, 0, "standalone built render failed");
} finally {
  await rm(root, { recursive: true });
}
