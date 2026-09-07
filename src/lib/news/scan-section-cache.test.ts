import { before, after, it } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getPglite, getSql } from "../db.ts";
import { setFetchImplForTests } from "./fetch-url.ts";
import { ingestUrl } from "./ingest.ts";
import { sha256 } from "./url-guard.ts";
import type { DeskJob } from "./jobs.ts";
import type { SectionScanSnapshot } from "./section-types.ts";

// This test executes desk.ts itself. Resolve its Vite alias/extensionless imports
// inside this isolated Node test process; no production loader is changed.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/"))
      specifier = new URL("../../" + specifier.slice(2), import.meta.url).href;
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".") && !specifier.startsWith("file:")) throw error;
      const url = new URL(specifier, context.parentURL);
      for (const suffix of [".ts", ".tsx"]) {
        if (existsSync(fileURLToPath(url) + suffix)) return nextResolve(url.href + suffix, context);
      }
      throw error;
    }
  },
});
let scan: typeof import("./desk.ts").performScanWork;
const marker = "SCHOOLS_AFTER_EIGHT_HUNDRED_CHARACTERS";
const body =
  "A local public report. ".repeat(60) + marker + " Important schools detail. ".repeat(30);
let roomCounter = 8810;
before(async () => {
  const pg = await getPglite();
  for (const name of (await readdir(new URL("../../../migrations/", import.meta.url)))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await pg.exec(await readFile(new URL("../../../migrations/" + name, import.meta.url), "utf8"));
  scan = (await import("./desk.ts")).performScanWork;
  setFetchImplForTests(
    async () => new Response(body, { headers: { "content-type": "text/plain" } }),
  );
});
after(() => {
  setFetchImplForTests(null);
  hooks.deregister();
});
async function modelPack(
  section: boolean,
  priorSection: boolean,
  priorGeneral = false,
  changed = false,
) {
  const sql = await getSql();
  const room = roomCounter++;
  const user = `scan-scope-${room}`;
  const url = `https://93.184.216.34/scope-${room}`;
  const text = (await ingestUrl(url)).text;
  assert.ok(text.indexOf(marker) > 800 && text.indexOf(marker) < 2800);
  const [source] = await sql<{
    id: number;
  }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status,last_hash)
    values(${user},${room},${url},'Shared report','page','A','accepted',${changed ? "older-content-hash" : await sha256(text)}) returning id`;
  const snapshot: SectionScanSnapshot = {
    key: "schools",
    name: "Schools",
    brief: "Look for school details",
    instructions: "Read the whole available excerpt",
    sourceIds: [source.id],
    revision: 2,
  };
  await sql`insert into scan_runs(user_id,newsroom_id,section_snapshot,finished_at,sources_fetched,leads_created,started_at)
    values(${user},${room},${priorSection ? JSON.stringify({ ...snapshot, brief: "Older brief", revision: 1 }) : null},now(),1,1,now()-interval '2 minutes')`;
  if (priorGeneral)
    await sql`insert into scan_runs(user_id,newsroom_id,finished_at,sources_fetched,leads_created,started_at)
    values(${user},${room},now(),1,1,now()-interval '1 minute')`;
  const [run] = await sql<{
    id: number;
  }>`insert into scan_runs(user_id,newsroom_id,section_snapshot)
    values(${user},${room},${section ? JSON.stringify(snapshot) : null}) returning id`;
  let pack = "";
  await scan(
    {
      id: room,
      user_id: user,
      newsroom_id: room,
      subject_id: run.id,
      model_choice: "grok",
      model_choice_source: "editor",
    } as DeskJob,
    {
      grokChat: async (_system, userMessage) => {
        pack = userMessage;
        return {
          ok: true,
          text: JSON.stringify({
            leads: [],
            proposed_sources: [],
            editor_summary: "QA scoped read",
          }),
        };
      },
      setJobStage: async () => {},
      setJobModelChoice: async () => {},
    },
  );
  assert.ok(pack.includes("SOURCE: Shared report"), "actual fetched source must reach the model");
  return pack;
}
it("first section scan expands unchanged sources previously read by General", async () => {
  assert.ok((await modelPack(true, false)).includes(marker));
});
it("changed section brief still receives the expanded excerpt", async () => {
  assert.ok((await modelPack(true, true)).includes(marker));
});
it("General cannot trust shared hashes even after a later General run", async () => {
  assert.ok((await modelPack(false, true, true)).includes(marker));
});
it("General-only newsrooms retain the unchanged-source optimization", async () => {
  assert.ok(!(await modelPack(false, false)).includes(marker));
});
it("expanded section excerpts preserve the actual changed-source signal", async () => {
  const pack = await modelPack(true, false, false, true);
  assert.match(pack, /CHANGED: yes; expanded excerpt for this scan scope/);
  assert.ok(pack.includes(marker));
});
