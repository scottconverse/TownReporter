/*
  Unit F3 / Option A: a fresh install's writing model, decided once.

  Every case below passes a FAKE catalog through the `deps.readCatalog` seam.
  No test in this file touches a model server: the seal in
  src/lib/test-support/model-seal.ts refuses a real one in a test process, and
  the seam is what makes that refusal irrelevant here.

  The three mutations the brief names are the reason the assertions are shaped
  the way they are:
    (a) count a listed-but-not-loaded model as loaded -> tests 2 and 5 fail;
    (b) let the hook run for an onboarded install       -> test 1 fails;
    (c) pick a cloud model by default                   -> test 4 fails.
*/

import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureNewsroomSchema } from "./membership.ts";
import { ensurePaperSettingsSchema } from "./paper-settings.ts";
import { ensureProviderSettingsSchema } from "./provider-settings.ts";
import { ensureModelAssignmentsSchema, readModelAssignments } from "./model-assignments-store.ts";
import { resolveJobModel } from "./model-assignments.ts";
import { isUseLoadedLocalModelPick, USE_LOADED_LOCAL_MODEL } from "./model-choice.ts";
import type { LocalCatalog, LocalModelEntry, LocalServer } from "./local-models.ts";
import {
  FIRST_RUN_MODEL_SCOPES,
  LOCAL_MODEL_LIST_EMPTY,
  localModelListLabel,
  localModelListRows,
  localModelProviderId,
  planFirstRunModelDefault,
  withoutCloudModels,
} from "./first-run-model.ts";
import {
  answerFirstRunModelOffer,
  applyFirstRunModelDefault,
  firstRunModelCardState,
  readModelPromptState,
} from "./first-run-model-settings.ts";

/*
  One newsroom per case: node's test runner does not order sibling `it`s inside
  a `describe`, and every one of these writes rows keyed by newsroom_id.
*/
const LIVE = 900_701; // onboarded, blank name/city/state -- the production shape
const FRESH = 900_702; // a brand-new install finishing setup
const OFFER = 900_703; // servers answering, nothing loaded
const CLOUD = 900_704; // only Ollama cloud models listed
const LISTED = 900_705; // many models listed, none loaded
const BROKEN = 900_706; // the probe throws
const SLOW = 900_707; // the probe never answers
const PICKED = 900_708; // the card, answered with a model
const KEPT = 900_709; // the card, answered with "keep Automatic"
const CHOSEN = 900_710; // a paper that already chose: never overwritten

const OWNER = "f3-owner";
const ALL = [LIVE, FRESH, OFFER, CLOUD, LISTED, BROKEN, SLOW, PICKED, KEPT, CHOSEN];

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

function catalog(servers: LocalServer[]): LocalCatalog {
  return { servers, defaultModel: null, checkedAt: 0 };
}

const LM_STUDIO = "http://127.0.0.1:1234/v1";
const OLLAMA = "http://127.0.0.1:11434/v1";

/** The catalog every "a model is loaded" case uses. */
const ONE_LOADED = catalog([
  server({
    kind: "lmstudio",
    baseUrl: LM_STUDIO,
    models: [
      entry({ id: "halo/qwen3.6-35b-a3b", loaded: true }),
      entry({ id: "text-embedding-nomic", loaded: true, kind: "embedding" }),
    ],
  }),
]);

async function seedNewsrooms() {
  await ensureNewsroomSchema();
  const sql = await getSql();
  await sql.query(
    `insert into newsrooms(id,name) values ${ALL.map((id) => `(${id},'F3 ${id}')`).join(",")} on conflict(id) do nothing`,
  );
}

/**
 * Seat the one owner in the newsroom under test. `requireEditor` reads the
 * newsroom from membership, so "the owner" is always an owner OF one paper --
 * exactly as in production, where every one of these writes lands on the paper
 * the owner just set up.
 */
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
  /*
    Every fresh install below is mid-setup: `savePaperConfig` has already
    written its `paper_settings` row (`onboarded` still false) by the time the
    hook runs. The marker is a column on that row, so the row has to exist --
    which is exactly the production ordering.
  */
  for (const id of ALL) {
    await sql`
      insert into paper_settings (newsroom_id, onboarded, model_prompt_state)
      values (${id}, false, null)
    `;
  }
  await seatOwner(FRESH);
}

async function storedScopes(newsroomId: number): Promise<{ scope: string; baseUrl: string; id: string }[]> {
  const sql = await getSql();
  const rows = await sql<{ scope: string; base_url: string; model_id: string }>`
    select scope, base_url, model_id from newsroom_local_model_choices
    where newsroom_id = ${newsroomId} order by scope
  `;
  return rows.map((row) => ({ scope: row.scope, baseUrl: row.base_url, id: row.model_id }));
}

/** The production shape: onboarded, blank name/city/state (F4/SG1). */
async function seedLiveShape() {
  const sql = await getSql();
  await sql`
    update paper_settings set name = '', city = '', state = '', onboarded = true
    where newsroom_id = ${LIVE}
  `;
}

before(async () => {
  process.env.BETTER_AUTH_SECRET = "f3-first-run-model-test-secret";
  await seedNewsrooms();
});

beforeEach(async () => {
  await clearAll();
});

describe("a paper that is already onboarded (the live shape) is never touched", () => {
  it("stores nothing, offers no card, and leaves its own choices alone", async () => {
    await seedLiveShape();
    // Live holds a local-model pick of its own, for its own scope.
    const sql = await getSql();
    await sql`
      insert into newsroom_local_model_choices (newsroom_id, scope, base_url, model_id)
      values (${LIVE}, 'forced', ${OLLAMA}, 'deepseek-v4.1-flash:cloud')
    `;
    const before = await storedScopes(LIVE);

    const outcome = await applyFirstRunModelDefault({
      newsroomId: LIVE,
      ownerUserId: OWNER,
      alreadyOnboarded: true,
      deps: { readCatalog: async () => ONE_LOADED },
    });
    assert.deepEqual(outcome, { kind: "skipped", why: "already-onboarded" });

    // The card's visibility rule, and the ensure-default path, both ran. Live
    // sees neither: its choices are byte-for-byte what they were.
    assert.deepEqual(await storedScopes(LIVE), before);
    assert.equal((await firstRunModelCardState(LIVE)).show, false);
    assert.equal(await readModelPromptState(LIVE), null, "no marker is written for an onboarded paper");
    assert.equal((await readModelAssignments(LIVE)).length, 0, "no assignment is written either");
  });

  it("an install that already chose is not overwritten either", async () => {
    await ensurePaperSettingsSchema();
    await seatOwner(CHOSEN);
    const sql = await getSql();
    await sql`
      insert into newsroom_local_model_choices (newsroom_id, scope, base_url, model_id)
      values (${CHOSEN}, 'story', ${LM_STUDIO}, 'halo/qwen3.6-35b-a3b')
    `;
    const outcome = await applyFirstRunModelDefault({
      newsroomId: CHOSEN,
      ownerUserId: OWNER,
      alreadyOnboarded: false,
      deps: { readCatalog: async () => ONE_LOADED },
    });
    assert.deepEqual(outcome, { kind: "skipped", why: "already-chosen" });
    assert.deepEqual(await storedScopes(CHOSEN), [
      { scope: "story", baseUrl: LM_STUDIO, id: "halo/qwen3.6-35b-a3b" },
    ]);
  });
});

describe("setup with a model loaded in memory", () => {
  it("stores Local model > 'Use whatever is loaded' for every writing scope", async () => {
    const outcome = await applyFirstRunModelDefault({
      newsroomId: FRESH,
      ownerUserId: OWNER,
      alreadyOnboarded: false,
      deps: { readCatalog: async () => ONE_LOADED },
    });
    assert.equal(outcome.kind, "stored");

    const stored = await storedScopes(FRESH);
    assert.deepEqual(
      stored.map((row) => row.scope).sort(),
      [...FIRST_RUN_MODEL_SCOPES].sort(),
      "every writing scope has a pick",
    );
    for (const row of stored) {
      assert.equal(row.baseUrl, USE_LOADED_LOCAL_MODEL, `${row.scope}: the sentinel, not a pinned id`);
      assert.equal(row.id, USE_LOADED_LOCAL_MODEL);
      assert.equal(isUseLoadedLocalModelPick(row), true);
    }

    // ...and the PROVIDER choice too, or every run would still walk Automatic.
    const providerId = localModelProviderId("story");
    assert.ok(providerId, "the registry offers a local provider");
    const assignments = await readModelAssignments(FRESH);
    assert.ok(assignments.length > 0, "the jobs the four scopes dispatch were assigned");
    for (const row of assignments) {
      assert.equal(row.rank, 0);
      assert.equal(row.providerId, providerId);
    }
    for (const jobKey of ["story-draft", "scan", "opinion", "dark"]) {
      assert.equal(
        resolveJobModel({ jobKey, explicit: null, assignments }).providerId,
        providerId,
        `${jobKey} resolves to Local model`,
      );
    }
    assert.equal(await readModelPromptState(FRESH), "stored");
    assert.equal((await firstRunModelCardState(FRESH)).show, false, "a paper with a model sees no card");
  });
});

describe("setup with servers answering but nothing loaded", () => {
  it("stores nothing and shows the card", async () => {
    const listed = catalog([
      server({
        baseUrl: LM_STUDIO,
        models: [entry({ id: "halo/qwen3.6-35b-a3b", loaded: false })],
      }),
    ]);
    const outcome = await applyFirstRunModelDefault({
      newsroomId: OFFER,
      ownerUserId: OWNER,
      alreadyOnboarded: false,
      deps: { readCatalog: async () => listed },
    });
    assert.deepEqual(outcome, { kind: "offer-choice" });
    assert.deepEqual(await storedScopes(OFFER), [], "nothing is stored");
    assert.equal((await readModelAssignments(OFFER)).length, 0);
    assert.equal(await readModelPromptState(OFFER), "offered");
    assert.equal((await firstRunModelCardState(OFFER)).show, true);
  });

  it("the same answer when only Ollama CLOUD models are listed", async () => {
    const onlyCloud = catalog([
      server({
        kind: "ollama",
        baseUrl: OLLAMA,
        models: [entry({ id: "deepseek-v4.1-flash:cloud", loaded: true, cloud: true })],
      }),
    ]);
    const outcome = await applyFirstRunModelDefault({
      newsroomId: CLOUD,
      ownerUserId: OWNER,
      alreadyOnboarded: false,
      deps: { readCatalog: async () => onlyCloud },
    });
    assert.deepEqual(outcome, { kind: "offer-choice" });
    assert.deepEqual(await storedScopes(CLOUD), [], "a cloud model is never the default");
    assert.equal((await firstRunModelCardState(CLOUD)).show, true);
  });

  it("listed is NOT loaded: many models, none in memory, nothing stored", async () => {
    const manyListed = catalog([
      server({
        kind: "lmstudio",
        baseUrl: LM_STUDIO,
        models: [
          entry({ id: "a-model", loaded: false }),
          entry({ id: "b-model", loaded: false }),
          entry({ id: "c-model", loaded: null }),
        ],
      }),
      server({
        kind: "llamacpp",
        baseUrl: "http://127.0.0.1:8080/v1",
        models: [entry({ id: "d-model", loaded: null })],
      }),
    ]);
    const outcome = await applyFirstRunModelDefault({
      newsroomId: LISTED,
      ownerUserId: OWNER,
      alreadyOnboarded: false,
      deps: { readCatalog: async () => manyListed },
    });
    assert.deepEqual(outcome, { kind: "offer-choice" });
    assert.deepEqual(await storedScopes(LISTED), [], "listed is not loaded");
    assert.equal((await readModelAssignments(LISTED)).length, 0);
  });
});

describe("setup is never failed or held up by the probe", () => {
  it("a probe that throws stores nothing and shows nothing", async () => {
    const outcome = await applyFirstRunModelDefault({
      newsroomId: BROKEN,
      ownerUserId: OWNER,
      alreadyOnboarded: false,
      deps: {
        readCatalog: async () => {
          throw new Error("discovery exploded");
        },
      },
    });
    assert.deepEqual(outcome, { kind: "error" });
    assert.deepEqual(await storedScopes(BROKEN), []);
    assert.equal(await readModelPromptState(BROKEN), null);
    assert.equal((await firstRunModelCardState(BROKEN)).show, false);
  });

  it("a probe that never answers is abandoned, and setup is unaffected", async () => {
    const outcome = await applyFirstRunModelDefault({
      newsroomId: SLOW,
      ownerUserId: OWNER,
      alreadyOnboarded: false,
      deps: { readCatalog: () => new Promise(() => {}), probeTimeoutMs: 20 },
    });
    assert.deepEqual(outcome, { kind: "error" });
    assert.deepEqual(await storedScopes(SLOW), []);
    assert.equal(await readModelPromptState(SLOW), null);
  });

  it("no server answering keeps Automatic and stores nothing", async () => {
    const outcome = await applyFirstRunModelDefault({
      newsroomId: OFFER,
      ownerUserId: OWNER,
      alreadyOnboarded: false,
      deps: { readCatalog: async () => catalog([]) },
    });
    assert.deepEqual(outcome, { kind: "keep-automatic" });
    assert.deepEqual(await storedScopes(OFFER), []);
    assert.equal(await readModelPromptState(OFFER), null, "no card: there is nothing to choose from");
  });
});

describe("the read-only 'Models on this computer' list", () => {
  it("marks a cloud model and does not mark a local one", () => {
    const local = entry({ id: "gemma4:12b", loaded: true });
    const cloud = entry({ id: "deepseek-v4.1-flash:cloud", loaded: false, cloud: true });
    assert.equal(localModelListLabel(local), "gemma4:12b · loaded");
    assert.doesNotMatch(localModelListLabel(local), /cloud/i);
    assert.equal(localModelListLabel(cloud), "deepseek-v4.1-flash:cloud · cloud — spends credits · not loaded");
    assert.match(localModelListLabel(cloud), /cloud — spends credits/);
  });

  it("says nothing about load state a server never reported", () => {
    assert.equal(localModelListLabel(entry({ id: "plain-model" })), "plain-model");
  });

  it("re-reads: the same catalog renders identically, and a refresh shows the new one", () => {
    const before = catalog([server({ baseUrl: LM_STUDIO, models: [entry({ id: "a-model", loaded: false })] })]);
    const after = catalog([server({ baseUrl: LM_STUDIO, models: [entry({ id: "a-model", loaded: true })] })]);
    assert.equal(localModelListRows(before)[0].models[0].loaded, false);
    assert.equal(localModelListRows(after)[0].models[0].loaded, true, "Refresh re-reads the catalog");
    assert.equal(localModelListRows(null).length, 0);
    assert.match(LOCAL_MODEL_LIST_EMPTY, /Start LM Studio's server or Ollama/);
  });

  it("drops cloud models from what counts as loaded, never from the list", () => {
    const servers = [server({ kind: "ollama", baseUrl: OLLAMA, models: [entry({ id: "x:cloud", cloud: true, loaded: true })] })];
    assert.equal(withoutCloudModels(servers)[0].models.length, 0, "never counted as loaded");
    assert.deepEqual(planFirstRunModelDefault(servers), { kind: "offer-choice" });
  });
});

describe("the card, answered", () => {
  it("a picked model is stored for every scope and the card goes away", async () => {
    const listed = catalog([
      server({ baseUrl: LM_STUDIO, models: [entry({ id: "halo/qwen3.6-35b-a3b", loaded: false })] }),
    ]);
    await seatOwner(PICKED);
    const sql = await getSql();
    await sql`update paper_settings set onboarded = true, model_prompt_state = 'offered' where newsroom_id = ${PICKED}`;

    const result = await answerFirstRunModelOffer(OWNER, {
      choice: { baseUrl: LM_STUDIO, id: "halo/qwen3.6-35b-a3b" },
      catalog: listed,
    });
    assert.deepEqual(result, { ok: true });
    const stored = await storedScopes(PICKED);
    assert.equal(stored.length, FIRST_RUN_MODEL_SCOPES.length);
    for (const row of stored) {
      assert.equal(row.baseUrl, LM_STUDIO);
      assert.equal(row.id, "halo/qwen3.6-35b-a3b");
    }
    assert.equal(await readModelPromptState(PICKED), "answered");
    assert.equal((await firstRunModelCardState(PICKED)).show, false, "the card does not come back");
  });

  it("'Keep the Automatic ladder' records the answer and stores nothing", async () => {
    await seatOwner(KEPT);
    const sql = await getSql();
    await sql`update paper_settings set onboarded = true, model_prompt_state = 'offered' where newsroom_id = ${KEPT}`;

    assert.deepEqual(await answerFirstRunModelOffer(OWNER, { keepAutomatic: true }), { ok: true });
    assert.deepEqual(await storedScopes(KEPT), []);
    assert.equal(await readModelPromptState(KEPT), "answered");
    assert.equal((await firstRunModelCardState(KEPT)).show, false);
  });

  it("refuses a cloud model as the default", async () => {
    await seatOwner(KEPT);
    const sql = await getSql();
    await sql`update paper_settings set onboarded = true, model_prompt_state = 'offered' where newsroom_id = ${KEPT}`;
    const cloudCatalog = catalog([
      server({ kind: "ollama", baseUrl: OLLAMA, models: [entry({ id: "x:cloud", cloud: true, loaded: true })] }),
    ]);
    const result = await answerFirstRunModelOffer(OWNER, {
      choice: { baseUrl: OLLAMA, id: "x:cloud" },
      catalog: cloudCatalog,
    });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : "", /spends your allowance/);
    assert.deepEqual(await storedScopes(KEPT), []);
  });
});
