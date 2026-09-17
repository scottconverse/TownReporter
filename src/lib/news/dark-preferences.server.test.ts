import { readFile } from "node:fs/promises";
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { getSql, getPglite } from "../db.ts";
import { ensureDarkSchema } from "./dark.ts";
import {
  readDarkSettingsFor,
  saveDarkSettingsFor,
  snapshotDarkSettingsFor,
} from "./dark-preferences.server.ts";
import { validateResearchPreferences } from "./dark-preferences.ts";
test("room preferences preserve county/dials and a saved round snapshot survives later edits", async () => {
  await ensureDarkSchema();
  const sql = await getSql();
  await sql`insert into dark_settings(newsroom_id,dig,nerve,scope,county) values(81,8,9,'county','Boulder')`;
  const p = validateResearchPreferences({
    mode: "range",
    startDate: "2024-01-01",
    endDate: "2024-12-31",
    verificationLimit: 3,
  });
  await saveDarkSettingsFor(81, { preferences: p });
  assert.deepEqual((await readDarkSettingsFor(81)).preferences, p);
  assert.equal((await readDarkSettingsFor(82)).preferences.verificationLimit, 6);
  assert.equal(
    (await sql`select county from dark_settings where newsroom_id=81`)[0]!.county,
    "Boulder",
  );
  assert.equal((await readDarkSettingsFor(81)).dials.dig, 8);
  await saveDarkSettingsFor(81, { dials: { dig: 2, nerve: 1, scope: "city" } });
  assert.deepEqual((await readDarkSettingsFor(81)).preferences, p);
  const [run] = await sql<{
    id: number;
  }>`insert into dark_runs(user_id,newsroom_id) values('prefs',81) returning id`;
  const snapshot = await snapshotDarkSettingsFor(81, run!.id, new Date("2026-09-07T00:00:00Z"));
  await saveDarkSettingsFor(81, {
    preferences: validateResearchPreferences({ lookbackDays: 30, verificationLimit: 12 }),
  });
  assert.equal(snapshot.preferences.verificationLimit, 3);
  assert.equal(
    JSON.parse(
      (await sql`select research_preferences_json from dark_runs where id=${run!.id}`)[0]!
        .research_preferences_json,
    ).preferences.verificationLimit,
    3,
  );
  await assert.rejects(snapshotDarkSettingsFor(82, run!.id));
  await assert.rejects(snapshotDarkSettingsFor(81, run!.id));
});
test("read failure or invalid stored preferences never silently defaults", async () => {
  await ensureDarkSchema();
  const sql = await getSql();
  await sql`insert into dark_settings(newsroom_id,research_preferences) values(83,'bad json')`;
  await assert.rejects(readDarkSettingsFor(83));
  await sql.query(
    "alter table dark_settings rename column research_preferences to qa_missing_preferences",
  );
  try {
    await assert.rejects(readDarkSettingsFor(84));
  } finally {
    await sql.query(
      "alter table dark_settings rename column qa_missing_preferences to research_preferences",
    );
  }
});

test("the real continued-round worker keeps its snapshot when settings change mid-model call", async () => {
  const { performDarkRound } = await import("./dark.ts");
  const { emptyPlan } = await import("./investigate.ts");
  const { setFetchImplForTests } = await import("./fetch-url.ts");
  const { ensureJobsSchema } = await import("./jobs.ts");
  await ensureDarkSchema();
  await ensureJobsSchema();
  const { ensurePaperSettingsSchema } = await import("./paper-settings.ts");
  await ensurePaperSettingsSchema();
  await (
    await getSql()
  ).query("alter table leads add column if not exists resurfaced_count integer not null default 0");
  const sql = await getSql();
  const [inv] = await sql<{
    id: number;
  }>`insert into investigations(user_id,newsroom_id,title) values('prefs-round',85,'Community choir') returning id`;
  await saveDarkSettingsFor(85, {
    dials: { dig: 1, nerve: 5, scope: "city" },
    preferences: validateResearchPreferences({
      mode: "range",
      startDate: "2023-01-01",
      endDate: "2023-12-31",
      verificationLimit: 1,
    }),
  });
  const keys = [
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "TOWNREPORTER_CODEX",
    "TOWNREPORTER_CLAUDE_CODE",
  ];
  const prior = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    LLM_API_KEY: "mock-key",
    LLM_BASE_URL: "https://preferences.invalid/v1",
    LLM_MODEL: "mock-model",
    TOWNREPORTER_CODEX: "0",
    TOWNREPORTER_CLAUDE_CODE: "0",
  });
  const original = globalThis.fetch,
    packs: string[] = [];
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith("https://preferences.invalid/v1/"))
      throw new Error("No external network in this test");
    const body = JSON.parse(String(init?.body));
    const pack = body.messages[1].content;
    packs.push(pack);
    if (packs.length === 1)
      await saveDarkSettingsFor(85, {
        preferences: validateResearchPreferences({ lookbackDays: 30, verificationLimit: 12 }),
      });
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(
                packs.length === 1
                  ? { ...emptyPlan(), pause: true, summary: "Mock planning finished" }
                  : { editor_summary: "No assertion", signals: [] },
              ),
            },
          },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    );
  };
  setFetchImplForTests(async () => new Response("mock missing", { status: 404 }));
  try {
    await performDarkRound({
      id: 999,
      user_id: "prefs-round",
      newsroom_id: 85,
      subject_id: inv!.id,
      model_choice: "configured",
      model_choice_source: "editor",
    } as import("./jobs.ts").DeskJob);
    assert.ok(packs.length >= 2);
    assert.ok(packs[0]!.includes("2023-01-01 through 2023-12-31"));
    assert.ok(packs[1]!.includes("2023-01-01 through 2023-12-31"));
    const [run] =
      await sql`select research_preferences_json,summary,error from dark_runs where newsroom_id=85 order by id desc limit 1`;
    assert.equal(JSON.parse(run!.research_preferences_json).preferences.verificationLimit, 1);
    assert.match(run!.summary, /2023-01-01 through 2023-12-31/);
    assert.equal(run!.error, null);
  } finally {
    globalThis.fetch = original;
    setFetchImplForTests(null);
    for (const k of keys) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  }
});

before(async () => {
  const sql = await getSql();
  await (
    await getPglite()
  ).exec(await readFile(new URL("../../../migrations/0002_newsroom.sql", import.meta.url), "utf8"));
  for (const table of ["sources", "articles", "leads", "drafts", "scan_runs", "beat_memory"])
    await sql.query(
      "alter table " + table + " add column if not exists newsroom_id integer not null default 1",
    );
});
