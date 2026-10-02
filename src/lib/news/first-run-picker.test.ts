/*
  Unit F3b: what a page's picker OPENS on, and what a hand-pressed Run sends.

  F3 (./first-run-model.ts, ./first-run-model-settings.ts) stores Local model >
  "Use whatever is loaded" for the four writing scopes when a fresh install
  finishes setup with a model in memory. It was a KNOWN GAP: the pages opened
  their picker on the literal "auto" and SENT it as an explicit pick, and
  `resolveJobModel` (./model-assignments.ts) prefers an explicit pick over the
  stored assignment -- so a fresh install with a loaded local model still
  walked the Automatic ladder on every hand-pressed Run.

  This file pins the two halves of the fix, at the two seams that decide it:

    1. THE ANSWER THE PAGE READS. `firstRunPickerChoiceFor` is the server
       read behind the `getFirstRunPickerDefault` server function: the pick
       the page's state is seeded from. It is `local-model` ONLY for a paper
       whose F3 marker is `stored`, and `auto` for everything else.

    2. WHAT THE RUN THEN DOES WITH IT. The seeded choice is fed through the
       real resolution chain -- `resolveJobModel` with the newsroom's stored
       assignments, then `resolveLocalModelChoice` against fake local servers
       -- so "the run really goes to the local model" is asserted where the
       server decides it, not in a component.

  THE LIVE-SAFETY RULE. Live is onboarded with stored assignments of its own
  and `model_prompt_state` NULL. Every test in the "live-shaped" describe below
  is the hard guard for that: the answer is `auto` on every surface, and a run
  with `auto` sends exactly what it sends today.

  Every local server here is a stub replacing `globalThis.fetch` (the same
  harness `local-loaded-choice.test.ts` uses). No test touches a real LM
  Studio or Ollama; the seal in src/lib/test-support/model-seal.ts would refuse
  one.
*/

import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureNewsroomSchema } from "./membership.ts";
import { ensurePaperSettingsSchema } from "./paper-settings.ts";
import { ensureProviderSettingsSchema, resolveLocalModelChoice } from "./provider-settings.ts";
import { ensureModelAssignmentsSchema, readModelAssignments, saveModelAssignments } from "./model-assignments-store.ts";
import { resolveJobModel } from "./model-assignments.ts";
import { resetLocalCatalogCacheForTests } from "./local-models.ts";
import type { LocalCatalog, LocalModelEntry, LocalServer } from "./local-models.ts";
import { USE_LOADED_LOCAL_MODEL, type StoryModelChoice } from "./model-choice.ts";
import type { ProviderSurface } from "./provider-registry.ts";
import { firstRunPickerDefault, pickerSeedToApply, planFirstRunModelDefault } from "./first-run-model.ts";
import { applyFirstRunModelDefault, firstRunPickerChoiceFor, readModelPromptState } from "./first-run-model-settings.ts";

/*
  One newsroom per case. Node's runner does not order sibling `it`s inside a
  `describe`, and every one of these writes rows keyed by newsroom_id.
*/
const FRESH = 900_801; // marker `stored`: F3 found a loaded local model at the flip
const LIVE = 900_802; // the production shape: onboarded, marker NULL, own assignments
const OFFERED = 900_803; // marker `offered`: the card is showing
const ANSWERED = 900_804; // marker `answered`: the card was answered
const NOMARK = 900_805; // marker NULL and not onboarded: setup never ran the hook
const ALL = [FRESH, LIVE, OFFERED, ANSWERED, NOMARK];

const OWNER = "f3b-owner";

/** The four surfaces those pages open a picker on, with the job each dispatches. */
const SURFACES: { surface: ProviderSurface; jobKey: string }[] = [
  { surface: "story", jobKey: "story-draft" },
  { surface: "scan", jobKey: "scan" },
  { surface: "opinion", jobKey: "opinion" },
  { surface: "dark", jobKey: "dark" },
];

/* ------------------------------------------------------------------ fakes */

function entry(over: Partial<LocalModelEntry> & { id: string }): LocalModelEntry {
  return {
    label: over.id,
    loaded: null,
    kind: "chat",
    thinking: false,
    vision: false,
    cloud: false,
    contextLength: null,
    ...over,
  };
}

function server(over: Partial<LocalServer> & { baseUrl: string }): LocalServer {
  return { kind: "lmstudio", reachable: true, models: [], ...over };
}

const LM_BASE = "http://127.0.0.1:1234/v1";
const LM_ROOT = "http://127.0.0.1:1234";
const OLLAMA_BASE = "http://127.0.0.1:11434/v1";
const OLLAMA_ROOT = "http://127.0.0.1:11434";

/** LM Studio with exactly one model in memory. */
function fakeLoaded(loadedId: string): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url === `${LM_BASE}/models`) return json({ data: [{ id: loadedId }] });
    if (url === `${LM_ROOT}/api/v0/models`) {
      return json({ data: [{ id: loadedId, state: "loaded", type: "llm" }] });
    }
    if (url === `${OLLAMA_BASE}/models`) return json({ data: [] });
    if (url === `${OLLAMA_ROOT}/api/ps`) return json({ models: [] });
    throw new Error(`unreachable: ${url}`);
  }) as typeof fetch;
}

function withFetch<T>(handler: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

/** The catalog the F3 hook sees: one model in memory, one cloud one refused. */
const ONE_LOADED = {
  servers: [
    server({
      kind: "lmstudio",
      baseUrl: LM_BASE,
      models: [entry({ id: "halo/qwen3.6-35b-a3b", loaded: true })],
    }),
  ],
  defaultModel: null,
  checkedAt: 0,
} satisfies LocalCatalog;

/* ------------------------------------------------------------------ seed */

async function seedNewsrooms() {
  await ensureNewsroomSchema();
  const sql = await getSql();
  await sql.query(
    `insert into newsrooms(id,name) values ${ALL.map((id) => `(${id},'F3b ${id}')`).join(",")} on conflict(id) do nothing`,
  );
}

async function seatOwner(newsroomId: number) {
  await ensureNewsroomSchema();
  const sql = await getSql();
  await sql`delete from newsroom_members where user_id = ${OWNER}`;
  await sql`insert into newsroom_members (user_id, role, newsroom_id) values (${OWNER}, 'owner', ${newsroomId})`;
}

async function clearAll() {
  await ensurePaperSettingsSchema();
  await ensureProviderSettingsSchema();
  await ensureModelAssignmentsSchema();
  const sql = await getSql();
  for (const id of ALL) {
    await sql`delete from newsroom_local_model_choices where newsroom_id = ${id}`;
    await sql`delete from model_assignments where newsroom_id = ${id}`;
    await sql`delete from provider_settings where newsroom_id = ${id}`;
    await sql`delete from paper_settings where newsroom_id = ${id}`;
  }
}

/** Run F3's hook for `FRESH`, exactly as finishing setup does. */
async function freshInstallWithLoadedModel(): Promise<void> {
  await sql_marker(FRESH, false, null);
  await seatOwner(FRESH);
  const outcome = await applyFirstRunModelDefault({
    newsroomId: FRESH,
    ownerUserId: OWNER,
    alreadyOnboarded: false,
    deps: { readCatalog: async () => ONE_LOADED },
  });
  assert.equal(outcome.kind, "stored", "F3 found the loaded model and stored the default");
}

async function sql_marker(newsroomId: number, onboarded: boolean, marker: string /* '' means NULL */ | null) {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  const value = marker === "" ? null : marker;
  await sql`insert into paper_settings (newsroom_id, onboarded, model_prompt_state) values (${newsroomId}, ${onboarded}, ${value})`;
}

/**
 * The live paper, as the auditor read it (2026-10-02): onboarded, blank
 * name/city/state, `model_prompt_state` NULL, and model assignments of its own
 * -- Flash first through the Automatic ladder, plus a stored pick. Seeding a
 * picker from "the stored assignment" in general would move this paper's
 * pickers; the F3 marker is what keeps it still.
 */
async function seedLiveShape() {
  await sql_marker(LIVE, true, "");
  const sql = await getSql();
  await sql`update paper_settings set name = '', city = '', state = '' where newsroom_id = ${LIVE}`;
  await seatOwner(LIVE);
  await saveModelAssignments(LIVE, [
    { jobKey: "story-draft", rank: 0, providerId: "claude-sonnet", effort: null },
    { jobKey: "scan", rank: 0, providerId: "claude-sonnet", effort: null },
  ]);
}

before(async () => {
  process.env.BETTER_AUTH_SECRET = "f3b-first-run-picker-test-secret";
  await seedNewsrooms();
});

beforeEach(async () => {
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
  process.env.TOWNREPORTER_LOCAL_DISCOVERY = "1";
  resetLocalCatalogCacheForTests();
  await clearAll();
});

/* ------------------------------------------------------------------ tests */

describe("F3b (1): a fresh install with a loaded local model opens on Local model", () => {
  it("answers `local-model` for every writing surface, and the run goes to the local model", async () => {
    await freshInstallWithLoadedModel();
    const assignments = await readModelAssignments(FRESH);

    for (const { surface, jobKey } of SURFACES) {
      const choice = await firstRunPickerChoiceFor(OWNER, surface);
      assert.equal(choice, "local-model", `${surface}: the picker opens on Local model, not Automatic`);

      // WHAT THE RUN DOES WITH IT, at the server's own decision point: an
      // explicit pick this build offers wins, and it is the local provider --
      // not the Automatic ladder.
      const resolved = resolveJobModel({ jobKey, explicit: choice, assignments });
      assert.equal(resolved.source, "explicit", `${jobKey}: an explicit pick, exactly as a hand-pressed Run sends`);
      assert.equal(resolved.providerId, "local-model", `${jobKey}: the run goes to the local model`);
      assert.notEqual(resolved.providerId, "auto", `${jobKey}: NOT the Automatic ladder`);
    }
  });

  it("the pick that Local model carries is 'Use whatever is loaded', and it resolves at run time", async () => {
    await freshInstallWithLoadedModel();
    // The sentinel F3 stored is the pick the seeded "local-model" choice
    // carries; the page sends no model name of its own.
    const sql = await getSql();
    const rows = await sql<{ scope: string; base_url: string; model_id: string }>`
      select scope, base_url, model_id from newsroom_local_model_choices where newsroom_id = ${FRESH}
    `;
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.equal(row.base_url, USE_LOADED_LOCAL_MODEL);
      assert.equal(row.model_id, USE_LOADED_LOCAL_MODEL);
    }

    // ...and at run time it is the model IN MEMORY, not a frozen name.
    await withFetch(fakeLoaded("halo/qwen3.6-35b-a3b"), async () => {
      resetLocalCatalogCacheForTests();
      const first = await resolveLocalModelChoice(FRESH, "story");
      assert.equal(first.override?.id, "halo/qwen3.6-35b-a3b");
      assert.equal(first.source, "loaded");
    });
    // The owner loads a DIFFERENT model later. "Use whatever is loaded" means
    // whatever is loaded THEN -- nothing was frozen at first run.
    await withFetch(fakeLoaded("halo-brain-70b"), async () => {
      resetLocalCatalogCacheForTests();
      const second = await resolveLocalModelChoice(FRESH, "story");
      assert.equal(second.override?.id, "halo-brain-70b", "the pick follows the machine, it does not pin a name");
    });
  });

  it("the Dark Desk seed satisfies mustChooseReader (the starters are enabled)", async () => {
    await freshInstallWithLoadedModel();
    const seed = await firstRunPickerChoiceFor(OWNER, "dark");
    const applied = pickerSeedToApply({ seed, touched: false, current: "auto" });
    assert.equal(applied, "local-model");
    // desk.dark.tsx: `mustChooseReader = modelChoice === "auto"`.
    assert.notEqual(applied, "auto", "the picker no longer reads Automatic, so the starters are enabled");
  });
});

describe("F3b (2): the live-shaped paper is untouched -- every page still opens on Automatic", () => {
  it("answers `auto` on every surface, and a run sends exactly what it sends today", async () => {
    await seedLiveShape();
    const assignments = await readModelAssignments(LIVE);
    assert.ok(assignments.length > 0, "live has stored assignments of its own");

    for (const { surface, jobKey } of SURFACES) {
      const seed = await firstRunPickerChoiceFor(OWNER, surface);
      assert.equal(seed, "auto", `${surface}: the picker opens on Automatic`);

      // The page's own rule: a seed of `auto` seeds nothing, so the state that
      // is already there -- `auto` -- stays, and that is what the run sends.
      assert.equal(pickerSeedToApply({ seed, touched: false, current: "auto" }), null);

      const resolved = resolveJobModel({ jobKey, explicit: "auto", assignments });
      assert.equal(resolved.source, "explicit");
      assert.equal(resolved.providerId, "auto", `${jobKey}: what the page sends today, unchanged`);
    }

    // And the stored choices live holds are byte-for-byte what they were.
    assert.deepEqual(
      (await readModelAssignments(LIVE)).map((row) => [row.jobKey, row.providerId]),
      [
        ["scan", "claude-sonnet"],
        ["story-draft", "claude-sonnet"],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  });
});

describe("F3b (3): every marker except `stored` opens on Automatic", () => {
  it("offered, answered and NULL all answer `auto`", async () => {
    await sql_marker(OFFERED, true, "offered");
    await sql_marker(ANSWERED, true, "answered");
    await sql_marker(NOMARK, false, "");
    await seatOwner(NOMARK);
    for (const id of [OFFERED, ANSWERED, NOMARK]) {
      assert.notEqual(await readModelPromptState(id), "stored");
      for (const { surface } of SURFACES) {
        assert.equal(await firstRunPickerChoiceFor(OWNER, surface), "auto", `${id}/${surface}`);
      }
    }
    // The pure rule says the same, with no database in the way.
    for (const marker of ["offered", "answered", null] as const) {
      for (const { surface } of SURFACES) {
        assert.equal(firstRunPickerDefault(marker, surface), "auto", `${marker}/${surface}`);
      }
    }
    assert.equal(firstRunPickerDefault("stored", "story"), "local-model");
  });
});

describe("F3b (4): the owner's own pick always wins", () => {
  it("a touched picker is never overwritten by the seed", async () => {
    await freshInstallWithLoadedModel();
    const seed = await firstRunPickerChoiceFor(OWNER, "story");
    assert.equal(seed, "local-model");
    // The owner switched the picker to Automatic (or to anything else), or had
    // already typed into it before the answer arrived.
    assert.equal(
      pickerSeedToApply({ seed, touched: true, current: "auto" }),
      null,
      "a touch on this page wins over the first-run default",
    );
    assert.equal(pickerSeedToApply({ seed, touched: true, current: "claude-sonnet" }), null);
    // And an untouched picker that already holds a real choice -- a story page
    // hydrated from the job's remembered model -- is left alone too.
    assert.equal(pickerSeedToApply({ seed, touched: false, current: "claude-sonnet" }), null);
    // Nothing to seed is not a seed.
    assert.equal(pickerSeedToApply({ seed: "auto", touched: false, current: "auto" }), null);
    assert.equal(pickerSeedToApply({ seed: null, touched: false, current: "auto" }), null);
    // The ordinary case, once more, last: the untouched page opens on it.
    assert.equal(pickerSeedToApply({ seed, touched: false, current: "auto" }), "local-model");
  });
});

describe("F3b: the F3 plan and the picker answer agree", () => {
  it("a `stored` hook outcome is exactly what turns the pages on", async () => {
    const plan = planFirstRunModelDefault(ONE_LOADED.servers);
    assert.equal(plan.kind, "stored");
    await freshInstallWithLoadedModel();
    assert.equal(await readModelPromptState(FRESH), "stored");
    assert.equal(await firstRunPickerChoiceFor(OWNER, "scan"), "local-model");
    // The answer is always a value the picker can hold -- never undefined, so
    // a page can assign it to its state without a guard beyond `auto`.
    const answer: StoryModelChoice = await firstRunPickerChoiceFor(OWNER, "dark");
    assert.ok(answer === "auto" || answer === "local-model");
  });
});
