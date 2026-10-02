/*
  Unit F3 / Option A: the half of the first-run writing-model default that
  touches the database and the machine.

  ./first-run-model.ts is pure and owns every rule (what "loaded" means, that a
  cloud model is never the default, what the card says). This module owns the
  three things that cannot be pure: reading the live local catalog, writing the
  choices, and remembering that the offer happened at all.

  THE ONE CALL SITE is `completeFirstRunSetup` (paper-settings.ts), which
  calls `applyFirstRunModelDefault` AFTER it commits `onboarded = true`. Three
  properties follow from where it sits, and each of them is a bug this unit
  could have shipped without:

  - It runs at the FLIP and nowhere else. A page load never calls it, and an
    install that is already onboarded never reaches it: `completeFirstRunSetup`
    is also the Server page's "fix a wrong answer" door, so the hook is told
    whether the row was already onboarded and refuses to touch it if it was.
    THE LIVE PAPER is exactly that case (onboarded, blank name/city/state).
  - It never overwrites a stored choice. Before anything is written the
    newsroom's existing model choices are read; if there are any, the hook
    stores nothing.
  - It can never fail or hang setup. The probe is time-bounded, everything is
    wrapped in try/catch, and any error means "store nothing, no card, keep
    Automatic" -- the owner is already past the form and their answer is safe.

  The `deps` seam is the test seam (the same shape `UnreviewedClaimDeps` uses):
  a test passes `readCatalog` and no model server is ever contacted. The test
  seal in src/lib/test-support/model-seal.ts refuses a real local model server
  in a test process; nothing here needs one.
*/

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../auth/middleware.ts";
import { getSql } from "../db.ts";
import { ForbiddenError, requireEditor } from "./membership.ts";
import { refreshLocalCatalog, type LocalCatalog } from "./local-models.ts";
import {
  FIRST_RUN_MODEL_SCOPES,
  firstRunModelProviderIds,
  localModelProviderId,
  planFirstRunModelDefault,
} from "./first-run-model.ts";
import { ensureProviderSettingsSchema, saveLocalModel } from "./provider-settings.ts";
import { ensureModelAssignmentsSchema, saveModelAssignments } from "./model-assignments-store.ts";
import { MODEL_JOBS } from "./model-assignments.ts";
import { USE_LOADED_LOCAL_MODEL } from "./model-choice.ts";
import { ensurePaperSettingsSchema } from "./paper-settings.ts";
import type { LocalModelScope } from "./request-input.ts";

export { ensurePaperSettingsSchema };

/**
 * The values `paper_settings.model_prompt_state` may hold. `null` (no row
 * value) means the offer never ran -- the live paper, and every install whose
 * setup finished with no local server answering.
 */
export type ModelPromptState = "stored" | "offered" | "answered" | null;

export type FirstRunModelDeps = {
  /** The live catalog. Production passes nothing and this is `refreshLocalCatalog`. */
  readCatalog?: () => Promise<LocalCatalog>;
  /**
   * How long the probe may take before the hook gives up and stores nothing.
   * A few seconds: `refreshLocalCatalog` bounds each request at 1.5s, and the
   * owner is waiting on a form they have already submitted.
   */
  probeTimeoutMs?: number;
};

export type FirstRunModelOutcome =
  | { kind: "stored"; baseUrl: string; id: string }
  | { kind: "offer-choice" }
  | { kind: "keep-automatic" }
  | { kind: "skipped"; why: "already-onboarded" | "already-chosen" }
  | { kind: "error" };

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/** `Promise.race` against a timer, with the timer cleared either way. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("first-run model probe timed out")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------- *
 * The marker
 * ------------------------------------------------------------------------- */

export async function readModelPromptState(newsroomId: number): Promise<ModelPromptState> {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  const rows = await sql<{ model_prompt_state: string | null }>`
    select model_prompt_state from paper_settings where newsroom_id = ${newsroomId} limit 1
  `;
  const value = rows[0]?.model_prompt_state ?? null;
  return value === "stored" || value === "offered" || value === "answered" ? value : null;
}

async function writeModelPromptState(newsroomId: number, state: Exclude<ModelPromptState, null>) {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  await sql`
    update paper_settings set model_prompt_state = ${state}, updated_at = now()
    where newsroom_id = ${newsroomId}
  `;
}

/* ------------------------------------------------------------------------- *
 * Storing the writing choice, for every scope
 * ------------------------------------------------------------------------- */

/**
 * Has this newsroom already decided anything about its writing model?
 *
 * Read before anything is written, because the hook's contract is that it
 * never overwrites a choice somebody made. All three places a model choice
 * lives are checked: the per-scope local-model picks, the per-job assignments,
 * and the legacy unscoped `provider_settings` local-model row.
 */
export async function hasStoredModelChoice(newsroomId: number): Promise<boolean> {
  await ensureProviderSettingsSchema();
  const sql = await getSql();
  const [scoped, assignments, legacy] = await Promise.all([
    sql<{ scope: string }>`select scope from newsroom_local_model_choices where newsroom_id = ${newsroomId} limit 1`,
    sql<{ job_key: string }>`select job_key from model_assignments where newsroom_id = ${newsroomId} limit 1`,
    sql<{ provider_id: string }>`
      select provider_id from provider_settings
      where newsroom_id = ${newsroomId} and local_model_id is not null limit 1
    `,
  ]);
  return scoped.length > 0 || assignments.length > 0 || legacy.length > 0;
}

/**
 * Store "Local model > Use whatever is loaded" for every writing scope, and
 * the matching provider choice for every job those scopes dispatch.
 *
 * BOTH halves are needed, and that is the whole point of doing this in one
 * place. `saveLocalModel` stores WHICH local model a scope means; the
 * assignment stores THAT the job runs on the local provider at all. Storing
 * only the first leaves every run on Automatic (which walks the cloud ladder
 * first), and storing only the second points the local provider at whatever
 * the catalog happens to default to rather than at what is in memory.
 *
 * `ownerUserId` is the owner who just finished setup: `saveLocalModel` is
 * owner-only on the server, and this is the moment they are provably the owner.
 */
async function storeLoadedLocalChoice(newsroomId: number, ownerUserId: string): Promise<void> {
  await ensureProviderSettingsSchema();
  await ensureModelAssignmentsSchema();
  for (const scope of FIRST_RUN_MODEL_SCOPES) {
    await saveLocalModel(
      ownerUserId,
      { baseUrl: USE_LOADED_LOCAL_MODEL, id: USE_LOADED_LOCAL_MODEL },
      scope as LocalModelScope,
    );
  }
  const providerId = localModelProviderId("story") ?? firstRunModelProviderIds()[0];
  if (!providerId) return;
  const covered = new Set<string>(FIRST_RUN_MODEL_SCOPES);
  await saveModelAssignments(
    newsroomId,
    MODEL_JOBS.filter((job) => covered.has(job.surface)).map((job) => ({
      jobKey: job.key,
      rank: 0,
      providerId,
      effort: null,
    })),
  );
}

/**
 * THE HOOK. Called once per install, at the false-to-true `onboarded` flip,
 * after that flip has been committed.
 *
 * `alreadyOnboarded` is what keeps the live paper out of this file entirely:
 * the Server page can re-open setup on a paper that is already onboarded, and
 * that is a correction, not a first run.
 */
export async function applyFirstRunModelDefault(input: {
  newsroomId: number;
  ownerUserId: string;
  /** True when the row was ALREADY onboarded before this call. */
  alreadyOnboarded: boolean;
  deps?: FirstRunModelDeps;
}): Promise<FirstRunModelOutcome> {
  if (input.alreadyOnboarded) return { kind: "skipped", why: "already-onboarded" };
  try {
    if (await hasStoredModelChoice(input.newsroomId)) {
      return { kind: "skipped", why: "already-chosen" };
    }
    const readCatalog = input.deps?.readCatalog ?? refreshLocalCatalog;
    const catalog = await withTimeout(
      readCatalog(),
      input.deps?.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    );
    const plan = planFirstRunModelDefault(catalog?.servers ?? []);
    if (plan.kind === "stored") {
      await storeLoadedLocalChoice(input.newsroomId, input.ownerUserId);
      await writeModelPromptState(input.newsroomId, "stored");
      return plan;
    }
    if (plan.kind === "offer-choice") {
      await writeModelPromptState(input.newsroomId, "offered");
      return plan;
    }
    return { kind: "keep-automatic" };
  } catch {
    /*
      A probe that threw, timed out, or answered with something unreadable is
      "we could not tell", and the honest response is to change nothing: no
      stored choice, no card, Automatic as it stands. Setup itself is already
      finished and must not fail because of this.
    */
    return { kind: "error" };
  }
}

/* ------------------------------------------------------------------------- *
 * The card, server side
 * ------------------------------------------------------------------------- */

export type FirstRunModelCardState = { show: boolean };

/**
 * Should the owner's first desk page draw the "Choose your writing model"
 * card? Only when the first-run hook wrote `offered` -- which only a setup
 * that finished AFTER this release, with a server answering and nothing in
 * memory, can have done. The live paper reads `null` and sees nothing.
 */
export async function firstRunModelCardState(newsroomId: number): Promise<FirstRunModelCardState> {
  return { show: (await readModelPromptState(newsroomId)) === "offered" };
}

export type AnswerFirstRunModelResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * The owner's answer to the card.
 *
 * "Keep the Automatic ladder" records the answer and stores nothing, so the
 * card does not come back. A picked model is stored for every writing scope --
 * the exact model the owner chose, not the "whatever is loaded" sentinel,
 * because they chose THAT model -- together with the provider choice that
 * makes the desk actually run it.
 *
 * A cloud model is refused here as well as filtered in the chooser: the card
 * lists it (an owner may reasonably pick Ollama's hosted DeepSeek on purpose,
 * through the picker), but it must never become the FIRST-RUN default by
 * accident, and this door is the one the card opens.
 */
export async function answerFirstRunModelOffer(
  userId: string,
  input: { choice?: { baseUrl: string; id: string } | null; keepAutomatic?: boolean; catalog?: LocalCatalog },
): Promise<AnswerFirstRunModelResult> {
  const me = await requireEditor(userId);
  if (me.role !== "owner") {
    throw new ForbiddenError("Only the owner can choose the paper's writing model.");
  }
  if (input.keepAutomatic) {
    await writeModelPromptState(me.newsroomId, "answered");
    return { ok: true };
  }
  const choice = input.choice;
  if (!choice?.baseUrl || !choice.id) {
    return { ok: false, error: "Choose a model, or keep the Automatic ladder." };
  }
  const catalog = input.catalog ?? (await refreshLocalCatalog());
  const server = catalog.servers.find((candidate) => candidate.baseUrl === choice.baseUrl);
  const model = server?.models.find((candidate) => candidate.id === choice.id);
  if (!server?.reachable || !model) {
    return { ok: false, error: "That model is not on this machine right now. Click Refresh and choose again." };
  }
  if (model.cloud) {
    return {
      ok: false,
      error: "That model runs on Ollama's hosted service and spends your allowance, so it cannot be the desk's default. Pick one of the models on this computer, or keep the Automatic ladder.",
    };
  }
  await ensureProviderSettingsSchema();
  await ensureModelAssignmentsSchema();
  for (const scope of FIRST_RUN_MODEL_SCOPES) {
    await saveLocalModel(userId, { baseUrl: choice.baseUrl, id: choice.id }, scope as LocalModelScope);
  }
  const providerId = localModelProviderId("story") ?? firstRunModelProviderIds()[0];
  if (providerId) {
    const covered = new Set<string>(FIRST_RUN_MODEL_SCOPES);
    await saveModelAssignments(
      me.newsroomId,
      MODEL_JOBS.filter((job) => covered.has(job.surface)).map((job) => ({
        jobKey: job.key,
        rank: 0,
        providerId,
        effort: null,
      })),
    );
  }
  await writeModelPromptState(me.newsroomId, "answered");
  return { ok: true };
}

/* ------------------------------------------------------------------------- *
 * Server functions
 * ------------------------------------------------------------------------- */

export const getFirstRunModelCard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<FirstRunModelCardState> => {
    try {
      const me = await requireEditor(context.userId);
      // The card is the OWNER's: only they can answer it, and a control that
      // can only be refused should not be drawn.
      if (me.role !== "owner") return { show: false };
      return await firstRunModelCardState(me.newsroomId);
    } catch (err) {
      if (err instanceof ForbiddenError) return { show: false };
      throw err;
    }
  });

export const answerFirstRunModelCardFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const v = (raw ?? {}) as { choice?: { baseUrl?: unknown; id?: unknown } | null; keepAutomatic?: unknown };
    const keepAutomatic = v.keepAutomatic === true;
    const baseUrl = typeof v.choice?.baseUrl === "string" ? v.choice.baseUrl : "";
    const id = typeof v.choice?.id === "string" ? v.choice.id : "";
    return {
      keepAutomatic,
      choice: !keepAutomatic && baseUrl && id ? { baseUrl, id } : null,
    };
  })
  .handler(async ({ context, data }): Promise<AnswerFirstRunModelResult> => {
    try {
      return await answerFirstRunModelOffer(context.userId, data);
    } catch (err) {
      if (err instanceof ForbiddenError) return { ok: false, error: err.message };
      throw err;
    }
  });

/* The picker's existing "nothing is loaded" sentences are `preflight.ts`'s and
   `model-picker.tsx`'s; this module deliberately owns no refusal wording of its
   own, so the card and a refused run cannot describe the same situation twice. */
