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
import { ensureProviderSettingsSchema, saveLocalModel } from "./provider-settings.ts";
import {
  ensureModelAssignmentsSchema,
  readModelAssignments,
  saveModelAssignments,
} from "./model-assignments-store.ts";
import { resolveJobModel, type ModelAssignmentRow, type ModelJobKey } from "./model-assignments.ts";
import { isUseLoadedLocalModelPick, USE_LOADED_LOCAL_MODEL } from "./model-choice.ts";
import type { LocalCatalog, LocalModelEntry, LocalServer } from "./local-models.ts";
import {
  FIRST_RUN_MODEL_SCOPES,
  LOCAL_MODEL_LIST_EMPTY,
  firstRunModelLine,
  firstRunModelRowKind,
  firstRunPickerDefault,
  isFirstRunModelScope,
  localModelListLabel,
  localModelListRows,
  localModelProviderId,
  planFirstRunModelDefault,
  supersededModelPromptState,
  withoutCloudModels,
  type ModelPromptState,
} from "./first-run-model.ts";
import {
  answerFirstRunModelOffer,
  applyFirstRunModelDefault,
  firstRunModelCardState,
  firstRunPickerChoiceFor,
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
const SUPER = 900_711; // `stored`, then the owner changes a writing assignment
const SAME = 900_712; // `stored`, then the owner saves the SAME assignments
const NULLSAVE = 900_713; // the live shape (NULL), then the owner saves assignments
const OFFERSAVE = 900_714; // `offered`, then the owner saves assignments
const FORCEDONLY = 900_715; // `stored`, then the owner changes OCR only

const OWNER = "f3-owner";
const ALL = [
  LIVE,
  FRESH,
  OFFER,
  CLOUD,
  LISTED,
  BROKEN,
  SLOW,
  PICKED,
  KEPT,
  CHOSEN,
  SUPER,
  SAME,
  NULLSAVE,
  OFFERSAVE,
  FORCEDONLY,
];

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

/*
  UI1b-6 / Option A. The card used to draw a "Use <model>" button for every
  row it listed, cloud rows included -- and the server refuses a cloud pick on
  purpose (test "refuses a cloud model as the default", below, is that door).
  A control whose only possible outcome is the refusal sentence is worse than
  no control, so a cloud row is a LINE. These two cases are the rule itself;
  `src/components/first-run-model-card.test.ts` pins the card's call site.
*/
describe("the card's rows: which is a pick, and which is only a line", () => {
  it("a cloud model is a line, never a pick", () => {
    const cloud = entry({ id: "deepseek-v4.1-flash:cloud", cloud: true, loaded: false });
    assert.equal(firstRunModelRowKind(cloud), "cloud");
    assert.match(firstRunModelLine(cloud), /hosted by Ollama, spends credits, cannot be the desk's default/);
    assert.match(firstRunModelLine(cloud), /deepseek-v4\.1-flash:cloud/);
  });

  it("a model on this computer is a pick", () => {
    const local = entry({ id: "gemma4:12b", loaded: true });
    assert.equal(firstRunModelRowKind(local), "local");
    assert.equal(firstRunModelLine(local), "gemma4:12b · loaded");
    assert.doesNotMatch(firstRunModelLine(local), /spends credits/);
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
    /*
      F3c finding 1: `stored`, NOT `answered`. `answered` is what "Keep the
      Automatic ladder" records, and `firstRunPickerDefault` reads it as
      Automatic -- so a card pick that wrote `answered` would leave every page
      sending an explicit Automatic choice, which outranks the local-model
      assignments this door just saved. The card would report the writing model
      was set while every run walked the ladder instead.
    */
    assert.equal(await readModelPromptState(PICKED), "stored");
    assert.equal((await firstRunModelCardState(PICKED)).show, false, "the card does not come back");
    // ...and the pages really do seed from it, on the owner's own model.
    for (const surface of ["story", "scan", "opinion", "dark"] as const) {
      assert.equal(await firstRunPickerChoiceFor(OWNER, surface), "local-model", surface);
    }
  });

  it("'Keep the Automatic ladder' records the answer and stores nothing", async () => {
    await seatOwner(KEPT);
    const sql = await getSql();
    await sql`update paper_settings set onboarded = true, model_prompt_state = 'offered' where newsroom_id = ${KEPT}`;

    assert.deepEqual(await answerFirstRunModelOffer(OWNER, { keepAutomatic: true }), { ok: true });
    assert.deepEqual(await storedScopes(KEPT), []);
    assert.equal(await readModelPromptState(KEPT), "answered");
    assert.equal((await firstRunModelCardState(KEPT)).show, false);
    // The two answers must NOT share one marker value: keeping Automatic is
    // the one answer that leaves every page opening on Automatic.
    for (const surface of ["story", "scan", "opinion", "dark"] as const) {
      assert.equal(await firstRunPickerChoiceFor(OWNER, surface), "auto", surface);
      assert.equal(firstRunPickerDefault("answered", surface), "auto");
    }
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

/* ------------------------------------------------------------------------- *
 * F3c finding 2: the first-run seed stops when the owner changes assignments
 *
 * `stored` is a picker OVERRIDE: every page sends `local-model` explicitly,
 * which outranks whatever `model_assignments` holds. That is right at first
 * run and wrong forever after -- an owner who moves Story drafting to another
 * provider would still watch every hand-pressed Run go to the local model.
 * The marker therefore lives only as long as nothing else has moved: the
 * owner's own assignment save retires it (`stored` -> `answered`), and the
 * pages go back to opening on Automatic and running what the owner saved.
 * ------------------------------------------------------------------------- */

/** Put one newsroom's row into the shape a case below needs. */
async function setMarker(newsroomId: number, onboarded: boolean, marker: ModelPromptState) {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  await sql`
    update paper_settings set onboarded = ${onboarded}, model_prompt_state = ${marker}
    where newsroom_id = ${newsroomId}
  `;
}

/** Run F3's hook, so the newsroom is a `stored` paper with assignments. */
async function runHook(newsroomId: number) {
  await seatOwner(newsroomId);
  const outcome = await applyFirstRunModelDefault({
    newsroomId,
    ownerUserId: OWNER,
    alreadyOnboarded: false,
    deps: { readCatalog: async () => ONE_LOADED },
  });
  assert.equal(outcome.kind, "stored", "the fixture needs a `stored` paper");
  assert.equal(await readModelPromptState(newsroomId), "stored");
}

/** The saved set with one job's first choice moved to another provider. */
function withJobChanged(
  rows: readonly ModelAssignmentRow[],
  jobKey: ModelJobKey,
  providerId: string,
): ModelAssignmentRow[] {
  return rows.map((row) => ({
    jobKey: row.jobKey,
    rank: row.rank,
    providerId: row.jobKey === jobKey && row.rank === 0 ? providerId : row.providerId,
    effort: row.effort,
  }));
}

const WRITING_SURFACES = ["story", "scan", "opinion", "dark"] as const;

describe("F3c: the rule is `stored` -> `answered`, and nothing else moves", () => {
  it("supersedes `stored` only: NULL stays NULL, `offered` and `answered` stay put", () => {
    assert.equal(supersededModelPromptState("stored"), "answered");
    assert.equal(supersededModelPromptState(null), null, "the live paper never gains a marker");
    assert.equal(supersededModelPromptState("offered"), "offered", "the card is still unanswered");
    assert.equal(supersededModelPromptState("answered"), "answered");
    // The four scopes the rule covers, and the one it does not.
    for (const scope of FIRST_RUN_MODEL_SCOPES) assert.equal(isFirstRunModelScope(scope), true);
    assert.equal(isFirstRunModelScope("forced"), false);
    assert.equal(isFirstRunModelScope(null), false);
  });
});

describe("F3c: the owner's own assignment save retires the first-run seed", () => {
  it("moving a writing job to another provider makes `stored` become `answered`, and the pages stop seeding", async () => {
    await runHook(SUPER);
    const before = await readModelAssignments(SUPER);
    assert.ok(before.length > 0, "the hook assigned the jobs");

    await saveModelAssignments(SUPER, withJobChanged(before, "story-draft", "claude-sonnet"));

    assert.equal(
      await readModelPromptState(SUPER),
      "answered",
      "the owner's newer choice supersedes the first-run pick",
    );
    // Every page opens on Automatic again, so the run uses what the owner just
    // saved instead of the seed's explicit `local-model`.
    for (const surface of WRITING_SURFACES) {
      assert.equal(await firstRunPickerChoiceFor(OWNER, surface), "auto", surface);
      assert.equal(firstRunPickerDefault(await readModelPromptState(SUPER), surface), "auto");
    }
    const after = await readModelAssignments(SUPER);
    assert.equal(
      resolveJobModel({ jobKey: "story-draft", explicit: null, assignments: after }).providerId,
      "claude-sonnet",
      "the assignment the owner saved is what runs",
    );
    // ...and the OTHER jobs the hook assigned are untouched by the supersession.
    assert.equal(
      resolveJobModel({ jobKey: "dark", explicit: null, assignments: after }).providerId,
      localModelProviderId("story"),
    );
  });

  it("a different local-model pick for a writing scope retires it too, and the same pick does not", async () => {
    await runHook(SAME);
    // Save pressed with the values already stored: not a change.
    await saveLocalModel(OWNER, { baseUrl: USE_LOADED_LOCAL_MODEL, id: USE_LOADED_LOCAL_MODEL }, "story");
    assert.equal(await readModelPromptState(SAME), "stored", "the same pick is not a change");

    // The owner picks a DIFFERENT model for the story scope -- the pick the
    // seeded story page would resolve, so it is one of the owner's own
    // decisions the seed would otherwise overrun.
    const saved = await saveLocalModel(OWNER, { baseUrl: LM_STUDIO, id: "halo/qwen3.6-35b-a3b" }, "story");
    assert.deepEqual(saved, { ok: true });
    assert.equal(await readModelPromptState(SAME), "answered");
    for (const surface of WRITING_SURFACES) {
      assert.equal(await firstRunPickerChoiceFor(OWNER, surface), "auto", surface);
    }
    // A scope the seeded pages never open a picker on (`forced`) changes nothing.
    await runHook(FORCEDONLY);
    await saveLocalModel(OWNER, { baseUrl: LM_STUDIO, id: "halo/qwen3.6-35b-a3b" }, "forced");
    assert.equal(await readModelPromptState(FORCEDONLY), "stored");
  });

  it("pressing Save with the same values is not a change, and does not retire it", async () => {
    await runHook(SAME);
    const same = await readModelAssignments(SAME);
    await saveModelAssignments(
      SAME,
      same.map((row) => ({ jobKey: row.jobKey, rank: row.rank, providerId: row.providerId, effort: row.effort })),
    );
    assert.equal(await readModelPromptState(SAME), "stored", "nothing moved, so nothing is superseded");
  });

  it("the live shape (onboarded, NULL marker, its own assignments) is left exactly as it was", async () => {
    await seatOwner(NULLSAVE);
    await setMarker(NULLSAVE, true, null);
    const sql = await getSql();
    await sql`update paper_settings set name = '', city = '', state = '' where newsroom_id = ${NULLSAVE}`;
    await saveModelAssignments(NULLSAVE, [
      { jobKey: "story-draft", rank: 0, providerId: "claude-sonnet", effort: null },
      { jobKey: "scan", rank: 0, providerId: "claude-sonnet", effort: null },
    ]);

    await saveModelAssignments(NULLSAVE, [
      { jobKey: "story-draft", rank: 0, providerId: "claude-sonnet", effort: null },
      { jobKey: "scan", rank: 0, providerId: "claude-haiku", effort: null },
    ]);

    assert.equal(await readModelPromptState(NULLSAVE), null, "a save never gives the live paper a marker");
    for (const surface of WRITING_SURFACES) {
      assert.equal(await firstRunPickerChoiceFor(OWNER, surface), "auto", `${surface}: unchanged`);
    }
    assert.equal((await firstRunModelCardState(NULLSAVE)).show, false);
    const assignments = await readModelAssignments(NULLSAVE);
    assert.equal(resolveJobModel({ jobKey: "scan", explicit: null, assignments }).providerId, "claude-haiku");
  });

  it("an unanswered card stays unanswered: `offered` is not superseded", async () => {
    await seatOwner(OFFERSAVE);
    await setMarker(OFFERSAVE, true, "offered");
    await saveModelAssignments(OFFERSAVE, [
      { jobKey: "story-draft", rank: 0, providerId: "claude-sonnet", effort: null },
    ]);
    assert.equal(await readModelPromptState(OFFERSAVE), "offered");
    assert.equal((await firstRunModelCardState(OFFERSAVE)).show, true, "the owner can still answer it");
  });

  it("a change to a job the seed cannot override (OCR, a forced run) does not retire it", async () => {
    await runHook(FORCEDONLY);
    const before = await readModelAssignments(FORCEDONLY);
    await saveModelAssignments(FORCEDONLY, [
      ...before.map((row) => ({ jobKey: row.jobKey, rank: row.rank, providerId: row.providerId, effort: row.effort })),
      { jobKey: "ocr", rank: 0, providerId: "claude-sonnet", effort: null },
    ]);
    assert.equal(
      await readModelPromptState(FORCEDONLY),
      "stored",
      "the seeded pages never send a forced job's choice, so nothing was overridden",
    );
  });
});

describe("F3c: the hook's and the card's own writes never supersede the marker they set", () => {
  it("the hook's own writes leave the paper `stored` -- the marker is written LAST", async () => {
    await seatOwner(FRESH);
    // The shape that makes the ordering visible: a marker that is already
    // `stored` when the hook runs, so a marker written BEFORE the hook's own
    // assignments would be superseded by them and end up `answered`.
    await setMarker(FRESH, false, "stored");
    const outcome = await applyFirstRunModelDefault({
      newsroomId: FRESH,
      ownerUserId: OWNER,
      alreadyOnboarded: false,
      deps: { readCatalog: async () => ONE_LOADED },
    });
    assert.equal(outcome.kind, "stored");
    assert.equal(await readModelPromptState(FRESH), "stored");
    const assignments = await readModelAssignments(FRESH);
    assert.ok(assignments.length > 0);
    for (const row of assignments) assert.equal(row.providerId, localModelProviderId("story"));
    for (const surface of WRITING_SURFACES) {
      assert.equal(await firstRunPickerChoiceFor(OWNER, surface), "local-model", surface);
    }
  });

  it("the card pick's own writes leave the paper `stored` too", async () => {
    await seatOwner(PICKED);
    await setMarker(PICKED, true, "stored");
    const listed = catalog([
      server({ baseUrl: LM_STUDIO, models: [entry({ id: "halo/qwen3.6-35b-a3b", loaded: false })] }),
    ]);
    assert.deepEqual(
      await answerFirstRunModelOffer(OWNER, {
        choice: { baseUrl: LM_STUDIO, id: "halo/qwen3.6-35b-a3b" },
        catalog: listed,
      }),
      { ok: true },
    );
    assert.equal(await readModelPromptState(PICKED), "stored", "the answer is written after the picks it stores");
    assert.equal((await firstRunModelCardState(PICKED)).show, false, "and the card never comes back");
  });
});
