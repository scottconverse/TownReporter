/*
  One place that knows what a writing model IS.

  Before 0.6.2 the four choices lived in four files that had to agree with
  each other by hand: the picker list in ./model-choice.ts, the label/model/
  off-switch in `explicitProvider` and the timings in `providerBudget` in
  ./ai.ts, the Automatic order in `AUTOMATIC_LADDER`, and the scan's own floor
  in ./scan-model-run.ts. Adding a provider meant editing all of them, and
  Dark Desk -- which never got a picker at all -- proved how easy it is to
  leave one out.

  Two standing operator rules drive the shape of this file:

    1. "Anywhere an AI does something, the editor must be able to pick the
       model."  So every surface (story, scan, opinion, dark) is a flag on
       the entry, not a separate hand-maintained list.
    2. "Next we'll be adding local LLMs (llama.cpp / LM Studio) -- build the
       pickers so that is config, not code."  So a new provider is a new
       `ProviderEntry` in PROVIDER_REGISTRY plus, at most, environment
       variables. Nothing below this module hardcodes a provider id.

  And a third, about time: "timeouts are likely too short for local models --
  give the editor the option to make them longer or shorter in the
  interface." Hence `budget` on every entry, `KIND_BUDGETS` supplying a
  sensible default per kind (including a generous `local` one for the
  llama.cpp/LM Studio entry that does not exist yet), and `effectiveBudget()`
  merging a per-paper override on top.

  This module is deliberately PURE: no database, no `node:` imports, no Vite
  aliases. It is imported by client components, by `node --test` files, and
  by server code alike. The per-paper overrides it merges are LOADED by
  ./provider-settings.ts, which is the half that touches the database.
*/

/**
 * How the desk actually talks to a provider.
 *
 * The first four match `Provider["kind"]` in ./ai.ts one-for-one. `local` has
 * no transport of its own yet -- it exists so the budget defaults for a
 * llama.cpp / LM Studio entry are already written down and reviewed before
 * the entry that uses them lands. A local entry will speak the OpenAI-
 * compatible protocol; what makes it different is that it is slow and free,
 * not that it is a different wire format.
 */
export type ProviderKind = "claude-code" | "codex" | "openai" | "anthropic" | "local";

/** The four places this desk asks a model for something. */
export type ProviderSurface = "story" | "scan" | "opinion" | "dark";

export type ProviderBudget = {
  /** Wall clock for a whole multi-call pipeline, e.g. one draft. */
  wallMs: number;
  /** Ceiling for a single model call. */
  callMs: number;
  /** Time to hold back for the final write so it is never the pass that dies. */
  reserveMs: number;
};

/*
  The ids, spelled out as literals so TypeScript keeps them as a union.

  Two lists, not one, because they answer different questions. A
  PICKER_PROVIDER_ID is something an editor can select by name; an
  INTERNAL_PROVIDER_ID is a provider the desk resolves on its own (today only
  the configured gateway, which Automatic pins when LLM_BASE_URL is set). The
  split is what lets `StoryModelChoice` stay exactly "auto" plus the pickable
  ids, the way it has always been, while the registry still owns the gateway.

  Adding a provider: add its id here, add its entry to PROVIDER_REGISTRY
  below, and set `offeredFor`. Nothing else in the codebase names providers.
  `provider-registry.test.ts` fails if these lists and the registry disagree.
*/
export const PICKER_PROVIDER_IDS = [
  "codex-balanced",
  "codex-frontier",
  "claude-frontier",
  "local-model",
] as const;
export const INTERNAL_PROVIDER_IDS = ["configured"] as const;

export type PickerProviderId = (typeof PICKER_PROVIDER_IDS)[number];
export type ProviderId = PickerProviderId | (typeof INTERNAL_PROVIDER_IDS)[number];

export type ProviderEntry = {
  /** Stable id. Also the value persisted in `desk_jobs.model_choice`. */
  id: ProviderId;
  /** What the picker shows. */
  label: string;
  /** The half-line under the label in the picker. */
  detail: string;
  kind: ProviderKind;
  /** Default model identifier, before `envOverrides.model` is consulted. */
  model: string;
  /** Only meaningful for `openai`/`local`: the endpoint, when it is fixed. */
  baseUrl?: string;
  /**
   * Environment variables that override this entry's fields on a given
   * install. Config, not code -- the whole point of the registry.
   */
  envOverrides: { model?: string; baseUrl?: string; apiKey?: string };
  /** This entry's own timings. Defaults to KIND_BUDGETS[kind] when omitted. */
  budget: ProviderBudget;
  /**
   * The model this provider should PLAN with, when planning and judging are
   * different jobs (Dark Desk hops). Empty/undefined means "no opinion --
   * use the provider's own model". See `plannerModelFor` below.
   */
  plannerModel?: string;
  /** Is this entry usable on this machine right now? Reads the environment. */
  enabled: () => boolean;
  /** The variable an operator sets to `0` to take this entry out entirely. */
  offSwitchEnv?: string;
  /** Which pickers offer it. */
  offeredFor: Record<ProviderSurface, boolean>;
  /**
   * Position in the Automatic ladder, lowest first. Omitted means "never
   * chosen by Automatic" -- Codex Sol is a deliberate, expensive choice and
   * the configured gateway is handled before the ladder runs at all.
   *
   * This is separate from the array order below because the two orders are
   * genuinely different: the PICKER reads Codex, Codex, Claude (cheapest
   * first, the way the menu has always read), while the LADDER tries Claude
   * before Codex (the operator's own signed-in provider first -- see the
   * v0.5.7 incident recorded in `probeProvider`).
   */
  ladderRank?: number;
};

function env(key: string): string | undefined {
  const value = process.env[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/*
  Whether local-models.ts's discovery has found a reachable local
  server on THIS machine, right now. A plain module-level flag, not a
  function that reaches into that module, so this file stays exactly as pure
  as its own doc comment claims -- no `node:` imports, nothing that only
  exists on the server. `local-models.ts` is the only writer (via
  `setLocalDiscoveryReachable`, called after every probe and by its lazy
  60s background refresh); `local-model.enabled()` below is the only reader.
  A browser bundle that evaluates this module simply keeps the `false` it
  starts with, which is fine -- the browser never calls `entry.enabled()`
  itself (see provider-availability.ts's doc comment).
*/
let localDiscoveryReachable = false;

/** Called by local-models.ts after each discovery probe. */
export function setLocalDiscoveryReachable(value: boolean): void {
  localDiscoveryReachable = value;
}

/** Test-only: put the flag back to its start state between test files. */
export function resetLocalDiscoveryReachableForTests(): void {
  localDiscoveryReachable = false;
}

/** `TOWNREPORTER_X=0` means "pretend this machine does not have it". */
function notSwitchedOff(key: string): boolean {
  return env(key) !== "0";
}

/**
 * What each kind needs when its entry does not say otherwise.
 *
 * `claude-code` / `codex` spawn a process and reload a ~25k-token preamble on
 * every call; measured 2.5s at best and 8s for a real prompt, and a draft
 * makes three calls plus document fetches. `anthropic` / `openai` are plain
 * HTTP and answer in seconds.
 *
 * `local` is sized for a model running on the operator's own box: a 30B on a
 * Strix Halo answers a 20k-token prompt in minutes, not seconds, so one call
 * gets the whole wall budget and the reserve is small because there is no
 * per-call process spawn to pay for. These numbers exist BEFORE the entry
 * that uses them, on purpose -- a local entry should not have to invent its
 * own timings under pressure.
 */
export const KIND_BUDGETS: Record<ProviderKind, ProviderBudget> = {
  "claude-code": { wallMs: 420_000, callMs: 150_000, reserveMs: 170_000 },
  codex: { wallMs: 420_000, callMs: 150_000, reserveMs: 170_000 },
  anthropic: { wallMs: 38_000, callMs: 20_000, reserveMs: 12_000 },
  openai: { wallMs: 38_000, callMs: 20_000, reserveMs: 12_000 },
  local: { wallMs: 600_000, callMs: 600_000, reserveMs: 60_000 },
};

/**
 * What Automatic, and the configured gateway, run on.
 *
 * Deliberately the most generous of the lot: Automatic does not know which
 * rung it will land on until it probes, and a gateway may be pointing at
 * anything from GPT-4o-mini to a local 70B. Sizing it for the fast path is
 * how every CLI draft used to die at 38 seconds.
 */
export const PIPELINE_BUDGET: ProviderBudget = {
  wallMs: 660_000,
  callMs: 180_000,
  reserveMs: 180_000,
};

/** The Haiku half of the Dark Desk planner split. See `plannerModelFor`. */
export const CLAUDE_PLANNER_MODEL = "claude-haiku-4-5-20251001";
const CODEX_TERRA_MODEL = "gpt-5.6-terra";
const CODEX_SOL_MODEL = "gpt-5.6-sol";

const EVERY_SURFACE: Record<ProviderSurface, boolean> = {
  story: true,
  scan: true,
  opinion: true,
  dark: true,
};

/**
 * Every provider this desk can be pointed at, in picker order.
 *
 * "Automatic" is NOT here. It is not a provider -- it is the instruction
 * "probe the ladder and pin whichever answers", and the ladder itself is
 * derived from `ladderRank` below. Putting it in the registry would mean
 * every consumer had to special-case an entry with no model, no budget and
 * no transport.
 */
export const PROVIDER_REGISTRY: readonly ProviderEntry[] = [
  {
    id: "codex-balanced",
    label: "Codex Terra",
    detail: "More depth",
    kind: "codex",
    model: CODEX_TERRA_MODEL,
    envOverrides: { model: "TOWNREPORTER_CODEX_TERRA_MODEL" },
    budget: KIND_BUDGETS.codex,
    plannerModel: CODEX_TERRA_MODEL,
    enabled: () => notSwitchedOff("TOWNREPORTER_CODEX"),
    offSwitchEnv: "TOWNREPORTER_CODEX",
    /*
      Opinion offers Claude only. Decided 2026-09-02.

      Codex was offered there too, and its model refuses the job: asked for an
      editorial that takes a position on a local policy question, gpt-5.6-sol
      returned "EDITORIAL_REFUSAL: I can't provide an editorial that advocates
      a position on a local government policy issue" -- twice, with the real
      voice, on a real subject. That is the provider's policy, not a bug, and
      working around it would mean prompting against their rules.
    */
    offeredFor: { story: true, scan: true, opinion: false, dark: true },
    ladderRank: 2,
  },
  {
    id: "codex-frontier",
    label: "Codex Sol",
    detail: "Frontier",
    kind: "codex",
    model: CODEX_SOL_MODEL,
    envOverrides: { model: "TOWNREPORTER_CODEX_SOL_MODEL" },
    budget: KIND_BUDGETS.codex,
    // Planning is the cheap half of the split even when the frontier model
    // does the judging; see `plannerModelFor`.
    plannerModel: CODEX_TERRA_MODEL,
    enabled: () => notSwitchedOff("TOWNREPORTER_CODEX"),
    offSwitchEnv: "TOWNREPORTER_CODEX",
    offeredFor: { story: true, scan: true, opinion: false, dark: true },
    // No ladderRank: Automatic never reaches for the frontier model on its
    // own. Choosing Sol is a decision an editor makes deliberately.
  },
  {
    id: "claude-frontier",
    label: "Claude Opus",
    detail: "Frontier",
    /*
      `claude-code` is the kind that actually runs on the operator's machine:
      this desk is run by someone who does not keep API keys, and the local
      Claude Code login is the default brain. An install that DOES set
      ANTHROPIC_API_KEY gets the `anthropic` transport instead -- ai.ts's
      `explicitProvider` prefers the key when one exists. The budgets are the
      only thing that differ, and `effectiveBudget` resolves that from the
      transport actually chosen, not from this field.
    */
    kind: "claude-code",
    model: "claude-opus-5",
    /*
      No `model` override on purpose. This option is CALLED "Claude Opus" in
      the picker, and an install that sets ANTHROPIC_MODEL to Sonnet must not
      silently make that label a lie. ANTHROPIC_MODEL still steers the
      no-explicit-choice default path in `resolveProvider()`; it does not
      redefine a named menu entry.
    */
    envOverrides: { apiKey: "ANTHROPIC_API_KEY" },
    budget: KIND_BUDGETS["claude-code"],
    plannerModel: CLAUDE_PLANNER_MODEL,
    enabled: () => notSwitchedOff("TOWNREPORTER_CLAUDE_CODE"),
    offSwitchEnv: "TOWNREPORTER_CLAUDE_CODE",
    offeredFor: EVERY_SURFACE,
    ladderRank: 1,
  },
  {
    id: "local-model",
    label: "Local model",
    detail: "llama.cpp, LM Studio, or another OpenAI-compatible server",
    kind: "local",
    /*
      Same env wiring as the `configured` gateway below, on purpose. The
      operator rule (docs/local-models.md) is already "point LLM_BASE_URL at
      llama.cpp / LM Studio"; inventing LOCAL_BASE_URL / LOCAL_MODEL here
      would split one local server's configuration across two variable
      names for no reason. This entry does not add a transport -- `kind:
      "local"` already routes through the same OpenAI-compatible path as
      `openai` in ai.ts's `explicitProvider` -- it adds a NAME an editor can
      pick, on top of config that may already exist on this machine.
    */
    model: "local-model",
    baseUrl: "http://127.0.0.1:1234/v1",
    envOverrides: { model: "LLM_MODEL", baseUrl: "LLM_BASE_URL", apiKey: "LLM_API_KEY" },
    budget: KIND_BUDGETS.local,
    // No plannerModel: a local server serves one model and has never heard of
    // anyone else's identifier. Audit finding TW-001 -- see `plannerModelFor`.
    /*
      LLM_BASE_URL specifically, not "or LLM_API_KEY + LLM_MODEL" -- an entry
      NAMED "Local model" must never be ready without an actual local
      endpoint to point at. Before this, LLM_API_KEY + LLM_MODEL alone made
      this entry report itself ready, and ai.ts's `explicitProvider` used to
      resolve that case by falling back to `https://api.openai.com/v1` --
      together, an editor's "Local model" pick could silently reach OpenAI's
      paid cloud instead of a local server (audit finding "a 'local' pick can
      hit the real paid OpenAI cloud"). `ai.ts`'s `localGateway()` now
      enforces the same requirement at resolution time; this is the readiness
      half so the picker does not even offer it as ready without one.
    */
    /*
      0.6.19: OR discovery. Before this, an entry NAMED "Local model" needed
      LLM_BASE_URL set by hand even when LM Studio or Ollama was already
      running on this box with no config at all -- the out-of-the-box "first
      run comes up alive" rule failed for the exact machine it was written
      for. `localDiscoveryReachable` is set by local-models.ts's
      probes of the two default local ports; LLM_BASE_URL still wins when
      set (an operator who typed it gets exactly that endpoint, discovered
      or not).
    */
    enabled: () =>
      notSwitchedOff("TOWNREPORTER_LOCAL") && (Boolean(env("LLM_BASE_URL")) || localDiscoveryReachable),
    offSwitchEnv: "TOWNREPORTER_LOCAL",
    // "Anywhere an AI acts, the editor can pick the model" -- every surface.
    offeredFor: EVERY_SURFACE,
    // No ladderRank: Automatic must not reach for this on its own. When
    // LLM_BASE_URL is set, the `configured` entry below already makes
    // Automatic pin the same server -- this is the deliberate, named pick.
  },
  {
    id: "configured",
    label: "Configured gateway",
    detail: "LLM_BASE_URL",
    kind: "openai",
    // Both are placeholders until LLM_MODEL / LLM_BASE_URL are set; this
    // entry is not offered in any picker, so nothing renders them.
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    envOverrides: { model: "LLM_MODEL", baseUrl: "LLM_BASE_URL", apiKey: "LLM_API_KEY" },
    /*
      Not KIND_BUDGETS.openai (38/20/12).

      A "configured gateway" is whatever the operator pointed LLM_BASE_URL at
      -- today usually LM Studio or Ollama on the same box, which is slow in
      exactly the way the fast-HTTP numbers assume it is not. It has run on
      the generous pipeline budget since Automatic learned to pin it, and
      shrinking it here would be a silent regression for the one provider a
      local model already arrives through.
    */
    budget: PIPELINE_BUDGET,
    // No plannerModel: a gateway serves one model and has never heard of
    // anyone else's identifier. Audit finding TW-001 -- see `plannerModelFor`.
    enabled: () => Boolean(env("LLM_BASE_URL") || (env("LLM_API_KEY") && env("LLM_MODEL"))),
    /*
      Never in a picker, and not in the ladder either.

      The gateway is not a thing an editor selects by name; it is what
      Automatic pins when the operator has configured one, resolved BEFORE
      the ladder runs (see `probeProvider`). It is in the registry so its
      label, budget and env overrides live with everyone else's.
    */
    offeredFor: { story: false, scan: false, opinion: false, dark: false },
  },
];

const BY_ID = new Map(PROVIDER_REGISTRY.map((entry) => [entry.id, entry]));

export function providerEntry(id: string | undefined | null): ProviderEntry | null {
  return (id && BY_ID.get(id as ProviderId)) || null;
}

/** Every entry a given picker should offer, registry order, Automatic aside. */
export function providersFor(surface: ProviderSurface): readonly ProviderEntry[] {
  return PROVIDER_REGISTRY.filter((entry) => entry.offeredFor[surface]);
}

/**
 * The order Automatic tries providers in.
 *
 * Static, and NOT filtered by `enabled()`: it is read at module load by
 * `AUTOMATIC_LADDER` in ./ai.ts and by the mid-run failover, both of which
 * already handle a rung that turns out to be unavailable (the probe fails and
 * the loop moves on). Filtering here would make the exported constant depend
 * on when the module happened to be imported relative to a test's env setup.
 * Use `enabledAutomaticLadder()` when a live answer is wanted.
 */
export function automaticLadder(): readonly ProviderId[] {
  return PROVIDER_REGISTRY.filter((entry) => entry.ladderRank !== undefined)
    .slice()
    .sort((a, b) => a.ladderRank! - b.ladderRank!)
    .map((entry) => entry.id);
}

/** The ladder as it stands on THIS machine right now. */
export function enabledAutomaticLadder(): readonly ProviderId[] {
  return automaticLadder().filter((id) => providerEntry(id)?.enabled());
}

/** The model id an entry should actually use, after its env override. */
export function providerModel(entry: ProviderEntry): string {
  return (entry.envOverrides.model && env(entry.envOverrides.model)) || entry.model;
}

/**
 * The model that PLANS a Dark Desk hop, for a given chosen provider.
 *
 * Planning and judging are different jobs. The planner writes the next
 * searches and extracts entities; the synthesis decides what the evidence
 * actually shows. Measured on one real pack from a live investigation, Haiku
 * produced the same search volume as Opus (15 vs 14) and more claims (9 vs
 * 6), with the same single overconfident claim -- which the confidence clamp
 * pulls to its ceiling either way -- at a quarter of the cost:
 *
 *   Opus  $0.2836 per hop   Haiku $0.0710 per hop
 *
 * Over a 25-hop round that is $7.09 against $1.77. Synthesis and the brief
 * stay on the chosen model, because that is where the judgment concentrates.
 *
 * THE RULE, stated once: substitute a cheaper model from the SAME provider,
 * never a different provider's identifier. Claude gets Haiku; both Codex
 * entries get Terra; everything else -- a gateway, a future local model --
 * gets an empty string, which means "no opinion, keep the provider's own
 * model". Returning "claude-haiku-..." unconditionally is exactly what
 * audit finding TW-001 was: point LLM_BASE_URL at LM Studio and every hop
 * asked it for a Claude model it had never heard of, the call failed, and
 * the planner fell back to keyword matching without a word.
 */
export function plannerModelFor(id: string | undefined | null): string {
  const entry = providerEntry(id);
  if (!entry?.plannerModel) return "";
  // Honour the same env override the entry's own model honours, so an install
  // that renames Codex Terra does not end up planning on a stale identifier.
  if (entry.plannerModel === CODEX_TERRA_MODEL) {
    return env("TOWNREPORTER_CODEX_TERRA_MODEL") || CODEX_TERRA_MODEL;
  }
  return entry.plannerModel;
}

/** A paper's stored deviation from an entry's shipped defaults. */
export type ProviderOverride = {
  /** Seconds in the UI, milliseconds here. */
  callMs?: number | null;
  wallMs?: number | null;
  enabled?: boolean | null;
  /**
   * The "Local model" entry's own per-newsroom pick -- which local server
   * and which model on it -- as opposed to `enabled`/`callMs`/`wallMs`,
   * which apply to any provider. Only ever set on the `local-model` id's
   * override; see ./provider-settings.ts's `resolveLocalModelChoice`.
   */
  localModel?: { baseUrl: string; id: string } | null;
};

export type ProviderOverrides = Record<string, ProviderOverride>;

/**
 * The narrowest and widest a per-call timeout may be set to.
 *
 * Ten seconds because below that nothing but a trivial gateway reply fits and
 * an editor would only be turning their own desk off. An hour because that is
 * long enough for a 70B running on CPU to finish a 20k-token read, and short
 * enough that a wedged provider still eventually reports rather than holding
 * a lane forever.
 */
export const MIN_BUDGET_MS = 10_000;
export const MAX_BUDGET_MS = 3_600_000;

/** The same two numbers in the unit the interface uses. */
export const MIN_BUDGET_SECONDS = MIN_BUDGET_MS / 1_000;
export const MAX_BUDGET_SECONDS = MAX_BUDGET_MS / 1_000;

/**
 * Why a typed number is not acceptable, in the words the editor will read --
 * or null when it is fine.
 *
 * Refused, not silently clamped: an editor who types 5 and is shown 10 has
 * been told nothing, while an editor who types 5 and reads "between 10
 * seconds and 60 minutes" knows what the field accepts. Pure, and shared by
 * the server function and the panel, so the two can never disagree about
 * what is allowed.
 */
export function validateProviderSeconds(seconds: number): string | null {
  if (!Number.isFinite(seconds)) return "Give it a number of seconds.";
  if (seconds < MIN_BUDGET_SECONDS || seconds > MAX_BUDGET_SECONDS) {
    return `Give it between ${MIN_BUDGET_SECONDS} seconds and ${MAX_BUDGET_SECONDS} seconds (${MAX_BUDGET_SECONDS / 60} minutes).`;
  }
  return null;
}

export function clampBudgetMs(value: number): number {
  return Math.min(MAX_BUDGET_MS, Math.max(MIN_BUDGET_MS, Math.round(value)));
}

/**
 * An entry's shipped budget with the paper's override merged on top.
 *
 * A missing, null, or non-finite override is ignored -- not treated as zero.
 * `wallMs` is additionally never allowed below `callMs`: a pipeline that is
 * given less wall clock than one of its own calls cannot make that call at
 * all, and an editor raising only the per-call number should not thereby
 * break the pipeline around it.
 */
export function effectiveBudget(
  id: string | undefined | null,
  overrides?: ProviderOverrides | ProviderOverride | null,
): ProviderBudget {
  const entry = providerEntry(id);
  const base = entry ? entry.budget : PIPELINE_BUDGET;
  const override = pickOverride(id, overrides);
  if (!override) return { ...base };
  const callMs = usable(override.callMs) ? clampBudgetMs(override.callMs!) : base.callMs;
  const wallMs = usable(override.wallMs) ? clampBudgetMs(override.wallMs!) : base.wallMs;
  return { wallMs: Math.max(wallMs, callMs), callMs, reserveMs: base.reserveMs };
}

function usable(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function pickOverride(
  id: string | undefined | null,
  overrides?: ProviderOverrides | ProviderOverride | null,
): ProviderOverride | null {
  if (!overrides) return null;
  const asSingle = overrides as ProviderOverride;
  if ("callMs" in asSingle || "wallMs" in asSingle || "enabled" in asSingle) return asSingle;
  return (id && (overrides as ProviderOverrides)[id]) || null;
}

/**
 * Is this provider switched on for this paper?
 *
 * Two independent switches, and BOTH have to be on. The environment one is
 * the operator's ("this machine does not have Codex"); the override one is
 * the editor's ("do not offer this on our desk"). Neither can turn on what
 * the other turned off, because they are answering different questions.
 */
export function providerEnabled(
  id: string | undefined | null,
  overrides?: ProviderOverrides | null,
): boolean {
  const entry = providerEntry(id);
  if (!entry) return false;
  if (!entry.enabled()) return false;
  const override = pickOverride(id, overrides);
  return override?.enabled !== false;
}
