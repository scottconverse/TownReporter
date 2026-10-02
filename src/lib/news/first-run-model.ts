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

/**
 * The scopes a first-run default is stored for: the four the owner can write
 * from by hand. `forced` (a batch, an OCR pass, a transcript) is deliberately
 * out -- those runs must name ONE runtime before they start, and the brief's
 * decision names these four.
 */
export const FIRST_RUN_MODEL_SCOPES = ["story", "scan", "opinion", "dark"] as const;
export type FirstRunModelScope = (typeof FIRST_RUN_MODEL_SCOPES)[number];

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

/** The list's own heading and empty-state sentence, in one place. */
export const LOCAL_MODEL_LIST_TITLE = "Models on this computer";
export const LOCAL_MODEL_LIST_EMPTY =
  "No local server found on this machine. Start LM Studio's server or Ollama, then click Refresh. See docs/local-models.md.";

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
