/*
  Unit F3 / Option A: what a brand-new install's writing model is, decided
  ONCE, at the moment the owner finishes first-run setup.

  The owner's requirement (2026-10-02): "The desk should default to whatever
  local model is loaded, and if none is loaded, offer a choice from the models
  available in LM Studio and Ollama." Option A is FIRST-RUN ONLY -- the live
  paper is already `onboarded = true` with choices of its own, and nothing in
  this unit may touch it.

  Three outcomes, and they are the whole module:

    1. A local server answers AND a model is IN MEMORY  -> store Local model >
       "Use whatever is loaded" for every writing scope, so the paper writes
       on what is loaded right now.
    2. A server answers but NOTHING is in memory        -> store nothing, and
       the owner's first desk page draws the "Choose your writing model" card.
    3. No server answers                                -> store nothing, show
       nothing. Automatic stands, and the picker's existing sentence already
       says how to start one.

  WHY "LOADED" IS NOT "LISTED". LM Studio's `/v1/models` lists every model it
  has on disk, and paging a 35B in from disk can take minutes; a default
  pinned to one of those would make the owner's first draft hang on a load
  nobody asked for. `pickLoadedLocalModelAcrossServers` (local-models.ts) is
  the desk's ONE definition of "in memory" -- `loaded === true` only, never an
  embedding model, and a server that reports no load state counts as nothing
  loaded. This module reuses it rather than writing a second rule, so the
  first-run default and the Automatic rung can never disagree about which
  model is in memory.

  CLOUD MODELS ARE NEVER THE DEFAULT. An Ollama cloud model (`:cloud`, or the
  hosted catalog's `-cloud` suffix) runs on Ollama's hosted service and spends
  the owner's allowance, so it is not "the model on this computer" in any
  sense the owner meant. The catalog already flags one (`cloud` on the model
  entry); this module drops cloud entries BEFORE asking what is loaded, which
  is the guard the brief asks for -- in the chooser, not only in the catalog.

  Everything here is PURE: no database, no fetch, no `process.env`. The live
  catalog arrives as an argument (the `.server.ts` half reads it) and the
  store is a separate module, so every rule below is testable through a fake
  catalog without a model server anywhere near the test process.
*/

import { pickLoadedLocalModelAcrossServers, type LocalCatalog, type LocalModelEntry, type LocalServer } from "./local-models.ts";
import { providersFor, type ProviderSurface } from "./provider-registry.ts";
import type { StoryModelChoice } from "./model-choice.ts";
import { modelJob, type ModelAssignmentRow } from "./model-assignments.ts";

/**
 * The values `paper_settings.model_prompt_state` may hold. `null` (no row
 * value) means the offer never ran -- the live paper, and every install whose
 * setup finished with no local server answering.
 *
 * It lives here, in the pure half, because the picker rule below turns on it
 * and the pure half must not import the database half. `first-run-model-
 * settings.ts` re-exports it, so there is still exactly one name for the
 * marker and one place its literals are written.
 */
export type ModelPromptState = "stored" | "offered" | "answered" | null;

/**
 * The scopes a first-run default is stored for: the four the owner can write
 * from by hand. `forced` (a batch, an OCR pass, a transcript) is deliberately
 * out -- those runs must name ONE runtime before they start, and the brief's
 * decision names these four.
 */
export const FIRST_RUN_MODEL_SCOPES = ["story", "scan", "opinion", "dark"] as const;
export type FirstRunModelScope = (typeof FIRST_RUN_MODEL_SCOPES)[number];

/** Is this scope (or a job's surface) one the first-run default covers? */
export function isFirstRunModelScope(value: unknown): value is FirstRunModelScope {
  return typeof value === "string" && (FIRST_RUN_MODEL_SCOPES as readonly string[]).includes(value);
}

/**
 * The provider id "Local model" has in the registry, derived rather than typed
 * out (owner rule: no hard-coded providers). It is the one entry on a surface
 * whose `kind` is `local` -- Automatic's own local rungs are internal and are
 * in no `providersFor` list, so they cannot be reached from here.
 */
export function localModelProviderId(surface: ProviderSurface = "story"): string | null {
  return providersFor(surface).find((entry) => entry.kind === "local")?.id ?? null;
}

/** The surfaces a first-run default covers, as `ProviderSurface` values. */
const FIRST_RUN_SURFACES: readonly ProviderSurface[] = ["story", "scan", "opinion", "dark"];

/**
 * Every provider "surface" a first-run default is written to, deduplicated.
 * One id, but derived per surface so this cannot drift from the registry.
 */
export function firstRunModelProviderIds(): string[] {
  const ids = FIRST_RUN_SURFACES.map((surface) => localModelProviderId(surface)).filter(
    (id): id is string => Boolean(id),
  );
  return [...new Set(ids)];
}

/** Drop every model that runs on a hosted service: never loaded, never default. */
export function withoutCloudModels(servers: readonly LocalServer[]): LocalServer[] {
  return servers.map((server) => ({
    ...server,
    models: server.models.filter((model) => !model.cloud),
  }));
}

/**
 * What the first-run hook should do, decided from a catalog alone.
 *
 * `stored` carries the model the pick resolves to right now, so the caller can
 * say which one in a receipt. `offer-choice` means the card. `keep-automatic`
 * means nothing at all -- no store, no card, Automatic as it stands.
 */
export type FirstRunModelPlan =
  | { kind: "stored"; baseUrl: string; id: string }
  | { kind: "offer-choice" }
  | { kind: "keep-automatic" };

export function planFirstRunModelDefault(servers: readonly LocalServer[]): FirstRunModelPlan {
  const usable = withoutCloudModels(servers);
  const loaded = pickLoadedLocalModelAcrossServers(usable);
  if (loaded) return { kind: "stored", baseUrl: loaded.baseUrl, id: loaded.id };
  /*
    Reachable, nothing in memory. This is the card's case: the owner has
    something to choose from but nothing running, and picking for them would
    mean either pinning a model that has to be paged in from disk or spending
    their Ollama allowance on a cloud model.
  */
  return usable.some((server) => server.reachable) ? { kind: "offer-choice" } : { kind: "keep-automatic" };
}

/*
  ---------------------------------------------------------------------------
  The card: what it says, and the read-only list underneath it
  ---------------------------------------------------------------------------
*/

export const FIRST_RUN_MODEL_CARD_TITLE = "Choose your writing model";

/**
 * The card's own sentence. The alternative is spelled out rather than implied:
 * "Automatic ladder" is a real answer the owner can keep, and the card is the
 * only place a brand-new install explains that.
 */
export const FIRST_RUN_MODEL_CARD_NOTE =
  "Nothing is loaded in LM Studio or Ollama right now, so TownReporter has not picked a model for you. Choose one of the models below, or keep the Automatic ladder.";

/** What "Keep Automatic" is called, on the button and in the receipt. */
export const FIRST_RUN_MODEL_KEEP_AUTOMATIC = "Keep the Automatic ladder";

/**
 * One row of the read-only "Models on this computer" list.
 *
 * A cloud model is marked as such in the one place an editor reads: it runs on
 * Ollama's hosted service and spends the paper's allowance, which is the fact
 * that decides whether it is a model "on this computer" at all. The load state
 * is only printed when the server reports one -- `loaded === null` is "unknown",
 * and saying "not loaded" about a server that never said would be a claim the
 * desk cannot support.
 */
export function localModelListLabel(model: Pick<LocalModelEntry, "id" | "loaded" | "cloud">): string {
  const parts = [model.id];
  if (model.cloud) parts.push("cloud — spends credits");
  if (model.loaded === true) parts.push("loaded");
  if (model.loaded === false) parts.push("not loaded");
  return parts.join(" · ");
}

/*
  ---------------------------------------------------------------------------
  UI1b-6: which rows on the card are a PICK, and which are only a LINE
  ---------------------------------------------------------------------------

  The card used to draw a "Use <model>" button for every model it listed, cloud
  ones included -- and the server (`answerFirstRunModelOffer`) refuses a cloud
  pick on purpose, because a model running on Ollama's hosted service is not
  "on this computer" and spends the owner's allowance. So every cloud row's
  button could only ever produce the refusal sentence: a control that exists to
  fail is worse than no control.

  Option A (agreed with the auditor): a cloud row is a plain labelled line that
  says why it cannot be picked; a local row keeps its real button. The decision
  is ONE pure function so the component, the tests and any later caller cannot
  disagree about which row is which.
*/

/** Is this row a pick the server will accept, or a line that explains itself? */
export function firstRunModelRowKind(model: Pick<LocalModelEntry, "cloud">): "local" | "cloud" {
  return model.cloud ? "cloud" : "local";
}

/**
 * What a cloud row says instead of a button. It names the three facts that
 * decide the row: where it runs, what it costs, and why it is not a choice.
 */
export const FIRST_RUN_CLOUD_ROW_LINE =
  "hosted by Ollama, spends credits, cannot be the desk's default";

/**
 * The words on a card row. A local row says what it is ("gemma4:12b ·
 * loaded"), exactly as the read-only list does; a cloud row carries the
 * explanation above in place of the duplicated "cloud — spends credits" tag,
 * so the line reads once rather than twice.
 */
export function firstRunModelLine(model: Pick<LocalModelEntry, "id" | "loaded" | "cloud">): string {
  if (firstRunModelRowKind(model) === "local") return localModelListLabel(model);
  const parts = [model.id, FIRST_RUN_CLOUD_ROW_LINE];
  if (model.loaded === true) parts.push("loaded");
  if (model.loaded === false) parts.push("not loaded");
  return parts.join(" · ");
}

/** The list's own heading and empty-state sentence, in one place. */
export const LOCAL_MODEL_LIST_TITLE = "Models on this computer";
export const LOCAL_MODEL_LIST_EMPTY =
  "No local server found on this machine. Start LM Studio's server or Ollama, then click Refresh. See docs/local-models.md.";

/*
  ---------------------------------------------------------------------------
  F3b: what a page's picker OPENS on
  ---------------------------------------------------------------------------

  F3 stored the default; the pages still opened on "auto" and SENT it as an
  explicit pick, which `resolveJobModel` prefers over the stored assignment --
  so a fresh install with a loaded local model walked the Automatic ladder on
  every hand-pressed Run. The two functions below are the whole fix's rule:

    - `firstRunPickerDefault` is the answer a page reads (the server function
      `getFirstRunPickerDefault` is its door), and
    - `pickerSeedToApply` is the one condition under which a page adopts it.

  THE MARKER IS THE ONLY KEY. `stored` is written by F3 and by nothing else,
  and it is NULL for every paper that existed before F3 -- including the live
  one, which is onboarded with stored assignments of its own. Reading "the
  stored assignment" here instead would move the live paper's pickers, which
  is why this reads the marker and never the assignments.
*/

/**
 * The choice a page's picker should open on: Local model for a paper F3
 * stored a first-run default for, Automatic for every other paper.
 *
 * The value is the registry's local provider id for that surface (the same
 * `local-model` id the picker's own option carries), so what the page sends as
 * its explicit pick is the option the owner sees selected. What makes the run
 * land on the model in memory is the pick behind it: F3 stored "Use whatever
 * is loaded" for every scope, and the run resolves that sentinel against the
 * live catalog at call time -- so a later, different model is what runs, and
 * no name is frozen here.
 */
export function firstRunPickerDefault(
  state: ModelPromptState,
  surface: ProviderSurface = "story",
): StoryModelChoice {
  if (state !== "stored") return "auto";
  return (localModelProviderId(surface) ?? "auto") as StoryModelChoice;
}

/**
 * The choice a page adopts from the seed, or null when it must keep the one it
 * has.
 *
 * Three ways to answer "keep what you have": the owner has touched this page's
 * picker (their change always wins, and switching to Automatic and back works
 * as before), the seed is nothing new (`auto`, or no answer yet), or the state
 * already holds a real choice -- a story page hydrated from the job's
 * remembered model is a choice, not an untouched default.
 */
export function pickerSeedToApply(input: {
  seed: StoryModelChoice | null;
  touched: boolean;
  current: StoryModelChoice;
}): StoryModelChoice | null {
  if (input.touched) return null;
  if (!input.seed || input.seed === "auto") return null;
  if (input.current !== "auto") return null;
  return input.seed;
}

/** Does this catalog have anything at all worth drawing a list for? */
export function localModelListRows(catalog: LocalCatalog | null): {
  serverKind: string;
  baseUrl: string;
  models: LocalModelEntry[];
}[] {
  return (catalog?.servers ?? [])
    .filter((server) => server.reachable)
    .map((server) => ({ serverKind: server.kind, baseUrl: server.baseUrl, models: server.models }));
}

/*
  ---------------------------------------------------------------------------
  F3c: when the first-run seed STOPS
  ---------------------------------------------------------------------------

  F3b made the pages seed from `stored`, which is right at first run and wrong
  forever after: the seed is an EXPLICIT pick, and an explicit pick outranks
  `model_assignments`. So an owner who later moves Story drafting, the daily
  scan, the opinion or Dark Desk to another provider would still watch every
  hand-pressed Run go to the local model the first run chose -- and nothing in
  the Models page's save path said otherwise.

  The marker therefore lives only as long as nothing else has moved. The rule
  is one transition and it is written once, here:

    `stored` -> `answered`        the owner has since decided for themselves
    NULL      -> NULL             a paper that never ran the hook keeps its
                                  silence (the live paper is exactly this row)
    `offered` -> `offered`        the card is still on screen, unanswered
    `answered` -> `answered`      nothing left to retire

  `answered` is the honest value for a superseded paper: it is what "the card
  was answered" means (the seed is over), and every reader of the marker --
  `firstRunPickerDefault`, `firstRunModelCardState` -- already treats it as
  "Automatic, and no card". Nothing new has to be taught to read it.
*/

/**
 * The marker after the owner changes one of their own settings.
 *
 * ONLY `stored` moves. A save must never be what puts a marker onto a paper
 * that had none: the live paper is `NULL`, and "onboarded with your own
 * assignments" is a finished state, not a superseded first run.
 */
export function supersededModelPromptState(state: ModelPromptState): ModelPromptState {
  return state === "stored" ? "answered" : state;
}

/**
 * The stamp of one saved set, over the jobs the first-run seed can override:
 * a job whose SURFACE is one of the four writing scopes. `ocr` and
 * `transcript` are `forced` -- a run there must name one exact provider, no
 * page seeds a picker for them, and so saving one cannot have overridden the
 * seed.
 */
function firstRunAssignmentStamp(rows: readonly ModelAssignmentRow[]): string {
  return rows
    .filter((row) => isFirstRunModelScope(modelJob(row.jobKey)?.surface))
    .map((row) => `${row.jobKey}:${row.rank}:${row.providerId}:${row.effort ?? ""}`)
    .sort()
    .join("|");
}

/**
 * Did this save change anything the first-run seed covers? `false` for a Save
 * pressed with the values already stored, which must not retire the seed --
 * the owner changed nothing, so nothing has been superseded.
 */
export function firstRunAssignmentsChanged(
  before: readonly ModelAssignmentRow[],
  after: readonly ModelAssignmentRow[],
): boolean {
  return firstRunAssignmentStamp(before) !== firstRunAssignmentStamp(after);
}
