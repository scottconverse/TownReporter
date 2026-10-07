/*
  The half of the provider registry that touches the database.

  ./provider-registry.ts is pure and client-safe: it knows what a provider IS
  and what it costs in time by default. This module knows what THIS paper has
  decided about those defaults -- "wait five minutes for a call, not two and a
  half", "do not offer Codex Sol on our desk" -- and it is the only place that
  reads or writes the `provider_settings` table.

  Why it exists at all: the operator's third standing rule for 0.6.2 was
  "timeouts are likely too short for local models -- give the editor the
  option to make them longer or shorter in the interface." A local model on
  the same box can take four minutes to answer a 20,000-character pack. The
  shipped 150-second per-call ceiling would call that a failure every time,
  and before this the only fix was editing a constant in a TypeScript file.

  Time is stored in MILLISECONDS in this table and everywhere in code. The
  Server page shows and accepts SECONDS, because an editor thinks in seconds.
  The conversion happens at the edges (`toSeconds` / `fromSeconds` below), not
  scattered through the UI.
*/

import { createServerFn } from "@tanstack/react-start";
/*
  Relative, not the `@/` alias -- the same rule paper-settings.ts follows and
  for the same reason: Vite resolves that alias and plain Node does not, and
  `node --test` loads this module.
*/
import { authMiddleware } from "../auth/middleware.ts";
import { ensureSchemaOnce, getSql } from "../db.ts";
import {
  requireEditor,
  ForbiddenError,
  ONLY_OWNER_CHANGES_MODEL_CONNECTIONS,
  DEFAULT_NEWSROOM_ID,
  ensureNewsroomSchema,
} from "./membership.ts";
import {
  PROVIDER_REGISTRY,
  clampBudgetMs,
  effectiveBudget,
  providerEndpoint,
  providerEndpointWatched,
  providerEntry,
  providerSwitchedOff,
  validateProviderSeconds,
  type ProviderOverrides,
} from "./provider-registry.ts";
import {
  pickLoadedLocalModelAcrossServers,
  refreshLocalCatalog,
  type LocalCatalog,
} from "./local-models.ts";
import { isFirstRunModelScope } from "./first-run-model.ts";
import { supersedeFirstRunModelDefault } from "./first-run-marker.ts";
import { isUseLoadedLocalModelPick, type LocalModelSource } from "./model-choice.ts";
import { cleanProviderTimeInput, type SaveProviderTimeInput } from "./provider-settings-input.ts";
export { cleanProviderTimeInput, type SaveProviderTimeInput } from "./provider-settings-input.ts";
import {
  cleanLocalModelInput,
  cleanModelScope,
  type LocalModelScope,
} from "./request-input.ts";

/**
 * Idempotent runtime ensure for the PGLite preview and unit-test paths,
 * mirroring the provider tables from migrations 0029, 0041, and 0083. Same reason
 * `ensurePaperSettingsSchema` exists: Node's test runner never runs
 * `migrations/*.sql` (see src/lib/db.ts createPgliteSql -- `import.meta.glob`
 * is a Vite-only transform), so the schema has to be stated twice.
 */
export async function ensureProviderSettingsSchema() {
  await ensureNewsroomSchema();
  const sql = await getSql();
  await ensureSchemaOnce(sql, "provider-settings", [
    `
    create table if not exists provider_settings (
      id serial primary key,
      newsroom_id integer not null default 1,
      provider_id text not null,
      call_ms integer,
      wall_ms integer,
      enabled boolean,
      local_model_base_url text,
      local_model_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (newsroom_id, provider_id)
    )
  `,
    // Mirrors migrations/0041_provider_local_model.sql for an install whose
    // table predates it -- same reason the rest of this function exists.
    `alter table provider_settings add column if not exists local_model_base_url text`,
    `alter table provider_settings add column if not exists local_model_id text`,
    `
    create table if not exists newsroom_local_model_choices (
      newsroom_id integer not null references newsrooms(id) on delete cascade,
      scope text not null check (scope in ('story', 'scan', 'opinion', 'dark', 'forced')),
      base_url text not null,
      model_id text not null,
      updated_at timestamptz not null default now(),
      primary key (newsroom_id, scope)
    )
  `,
  ]);
}

type ProviderSettingRow = {
  provider_id: string;
  call_ms: number | null;
  wall_ms: number | null;
  enabled: boolean | null;
  local_model_base_url: string | null;
  local_model_id: string | null;
};

const LOCAL_MODEL_PROVIDER_ID = "local-model";
/*
  The scope allow-list and its cleaner moved to request-input.ts, where they
  can be tested without opening a database. Re-exported here so every existing
  importer of `LocalModelScope` (and of the type on `resolveLocalModelChoice`,
  `saveLocalModel` and the rest) is unchanged.
*/
export type { LocalModelScope } from "./request-input.ts";

/** First-run model candidates; a newsroom's saved pick always takes precedence. */
const PREFERRED_CLOUD_MODEL_BY_SCOPE: Readonly<Record<LocalModelScope, string>> = {
  story: "deepseek-v4.1-flash:cloud",
  scan: "deepseek-v4.1-flash:cloud",
  "follow-up": "deepseek-v4.1-flash:cloud",
  opinion: "deepseek-v4.1-flash:cloud",
  dark: "deepseek-v4.1-flash:cloud",
  ocr: "deepseek-v4.1-flash:cloud",
  forced: "deepseek-v4.1-flash:cloud",
};

/** Is a stored `{baseUrl,id}` still on that server's current model list? */
function stillListed(
  pick: { baseUrl: string; id: string } | null | undefined,
  catalog: LocalCatalog,
): boolean {
  if (!pick) return false;
  const server = catalog.servers.find((s) => s.baseUrl === pick.baseUrl);
  return Boolean(server?.models.some((m) => m.id === pick.id));
}

function preferredLocalModel(
  scope: LocalModelScope | undefined,
  catalog: LocalCatalog,
): { baseUrl: string; id: string } | null {
  if (!scope) return catalog.defaultModel;
  const preferredId = PREFERRED_CLOUD_MODEL_BY_SCOPE[scope];
  const server = catalog.servers.find(
    (candidate) => candidate.kind === "ollama" && candidate.reachable &&
      candidate.models.some((model) => model.id === preferredId),
  );
  return server ? { baseUrl: server.baseUrl, id: preferredId } : catalog.defaultModel;
}

/**
 * Every override this paper has stored, keyed by provider id.
 *
 * Rows for providers the registry no longer knows about are dropped rather
 * than returned: a retired provider's stored timeout must not resurface as a
 * budget for whatever id happens to be reused later.
 *
 * An explicit scoped `local-model` pick is preserved even if its server is
 * temporarily unavailable; legacy unscoped picks still resolve against the
 * live catalog and fall back to its discovered default. Every caller
 * that threads `overrides["local-model"]?.localModel` straight into
 * `grokChat`'s `opts.localModel` (report.ts, dark.ts, investigate.ts)
 * therefore gets the correct per-job pick for free,
 * without needing to know `local-models.ts` exists. Discovery is a cheap,
 * cached (20s), localhost-only call; a failure there is swallowed and
 * simply leaves the stored pick (or nothing) in place, exactly as it stood
 * before this resolution step existed.
 *
 * A newsroom with NO stored `local-model` row and NO discovered local
 * server gets no synthetic entry at all -- "no rows at all" (the shipped-
 * defaults contract every other provider id already has, and what
 * `provider-settings.e2e.test.ts`'s "starts with the shipped defaults and
 * no rows at all" proves against a real Postgres) stays exactly `{}`, the
 * same as before this field existed.
 */
export async function readProviderOverrides(
  newsroomId: number = DEFAULT_NEWSROOM_ID,
  scope?: LocalModelScope,
): Promise<ProviderOverrides> {
  await ensureProviderSettingsSchema();
  const sql = await getSql();
  const rows = await sql<ProviderSettingRow>`
    select provider_id, call_ms, wall_ms, enabled, local_model_base_url, local_model_id
    from provider_settings where newsroom_id = ${newsroomId}
  `;
  const out: ProviderOverrides = {};
  for (const row of rows) {
    if (!providerEntry(row.provider_id)) continue;
    out[row.provider_id] = {
      callMs: row.call_ms,
      wallMs: row.wall_ms,
      enabled: row.enabled,
      localModel:
        row.local_model_base_url && row.local_model_id
          ? { baseUrl: row.local_model_base_url, id: row.local_model_id }
          : null,
    };
  }
  const explicitScoped = scope ? await rawScopedLocalModel(newsroomId, scope) : null;
  const stored = explicitScoped ?? out[LOCAL_MODEL_PROVIDER_ID]?.localModel;
  /*
    The live catalog, fetched at most once per call and never allowed to fail
    the read: this is a budgets lookup every draft/scan/dig makes, and discovery
    never throws anyway (local-models.ts).
  */
  let catalog: LocalCatalog | null = null;
  const liveCatalog = async (): Promise<LocalCatalog | null> => {
    if (catalog === null) {
      try {
        catalog = await refreshLocalCatalog();
      } catch {
        catalog = null;
      }
    }
    return catalog;
  };
  if (isUseLoadedLocalModelPick(stored)) {
    /*
      "Use whatever is loaded" must be resolved here, for every caller, or
      `grokChat` would be handed the literal sentinel as a base URL. This is
      the one pick that is resolved at call time rather than at save time, so
      it is the one pick a run can act on differently from the one before it.

      Nothing loaded is the honest answer, and `probeProvider` refuses with the
      item-2 sentence before any call.
    */
    const loaded = pickLoadedLocalModelAcrossServers((await liveCatalog())?.servers ?? []);
    out[LOCAL_MODEL_PROVIDER_ID] = { ...(out[LOCAL_MODEL_PROVIDER_ID] ?? {}), localModel: loaded };
    return out;
  }
  if (explicitScoped && storedAddressIsAllowed(explicitScoped.baseUrl, await liveCatalog())) {
    // A temporary Ollama outage must never silently send the editor's chosen
    // cloud work to an unrelated LM Studio model on another server. U7b: and an
    // address the desk may not send work to is not kept at all -- it falls
    // through to the catalog fallback below, exactly like a vanished model.
    out[LOCAL_MODEL_PROVIDER_ID] = { ...(out[LOCAL_MODEL_PROVIDER_ID] ?? {}), localModel: explicitScoped };
    return out;
  }
  try {
    /* A failed lookup is an empty catalog, not a thrown one: "nothing was
       discovered" is a real answer here (`storedAddressIsAllowed` treats it as
       "not in the list", and `preferredLocalModel` resolves to nothing). */
    const live: LocalCatalog =
      (await liveCatalog()) ?? { servers: [], defaultModel: null, checkedAt: 0 };
    /*
      U7b: the same address rule `saveLocalModel` enforces, applied to what is
      already stored -- a row can predate the rule, or have been written by
      hand. A stored pick the desk may not use is dropped to `null` here, which
      is the fallback a vanished model already gets: the preferred local model,
      else nothing.
    */
    const usable = stored && storedAddressIsAllowed(stored.baseUrl, live) ? stored : null;
    const resolved = stillListed(usable, live)
      ? usable
      : // Unit BB item 3, for a newsroom that has never picked anything:
        // prefer whatever is in memory over any named model, so the first
        // run after the owner loads something runs on it. A stored pick that
        // has vanished keeps the old fallback -- an editor chose it, and
        // silently moving them to a different local model is the failure
        // mode this comment above is about.
        usable
        ? preferredLocalModel(scope, live)
        : (pickLoadedLocalModelAcrossServers(live.servers) ?? preferredLocalModel(scope, live));
    // "No rows at all" must mean exactly that -- an empty object, the same
    // shipped-defaults contract every other provider id already has. A
    // newsroom with no stored row and no discovered local server (the
    // ordinary case on a CI Postgres runner, which has neither LM Studio
    // nor Ollama listening) must not gain a synthetic `local-model` entry
    // just because discovery ran. Only merge in a resolved value when there
    // is something to say (a live catalog default) or a row already exists
    // to update (whose `localModel` may need to move from a vanished stored
    // pick to null, or to the current default).
    if (resolved || out[LOCAL_MODEL_PROVIDER_ID]) {
      out[LOCAL_MODEL_PROVIDER_ID] = { ...(out[LOCAL_MODEL_PROVIDER_ID] ?? {}), localModel: resolved };
    }
  } catch {
    // Discovery failed (should not happen -- it never throws -- but this is
    // a budgets read used by every draft/scan/dig, and it must never fail a
    // run over a local-model lookup nobody may even be using). Fail closed:
    // the row read above was never checked against the address rule, so it
    // must not survive into the run.
    if (out[LOCAL_MODEL_PROVIDER_ID]) {
      out[LOCAL_MODEL_PROVIDER_ID] = { ...out[LOCAL_MODEL_PROVIDER_ID], localModel: null };
    }
  }
  return out;
}

/**
 * What "Local model" should actually call for this newsroom, right now, PLUS
 * the one-line notice the picker shows when a stored pick had to be
 * abandoned ("<id> is no longer on the server; using <default>").
 * `readProviderOverrides` above does the same resolution for every model
 * call; this is the picker-facing sibling that also explains itself.
 */
export type LocalModelChoice = {
  override: { baseUrl: string; id: string } | null;
  /**
   * Unit BB: where `override` came from, so the picker can say so in words
   * and `probeProvider` can tell "Use whatever is loaded" (which refuses with
   * the item-2 sentence when nothing is loaded) from an editor's named pick
   * that happens to have resolved to nothing.
   */
  source: LocalModelSource;
  notice: string | null;
  catalog: LocalCatalog;
};


/** The raw stored pick, with no catalog fallback applied -- for the notice only. */
async function rawStoredLocalModel(
  newsroomId: number,
  scope?: LocalModelScope,
): Promise<{ baseUrl: string; id: string } | null> {
  await ensureProviderSettingsSchema();
  const sql = await getSql();
  if (scope) {
    const scoped = await rawScopedLocalModel(newsroomId, scope);
    if (scoped) return scoped;
  }
  const rows = await sql<Pick<ProviderSettingRow, "local_model_base_url" | "local_model_id">>`
    select local_model_base_url, local_model_id from provider_settings
    where newsroom_id = ${newsroomId} and provider_id = ${LOCAL_MODEL_PROVIDER_ID}
  `;
  const row = rows[0];
  return row?.local_model_base_url && row.local_model_id
    ? { baseUrl: row.local_model_base_url, id: row.local_model_id }
    : null;
}

async function rawScopedLocalModel(newsroomId: number, scope: LocalModelScope) {
  const sql = await getSql();
  const table = scope === "follow-up" || scope === "ocr"
    ? "newsroom_local_model_choices_additional"
    : "newsroom_local_model_choices";
  const scoped = await sql.query<{ base_url: string; model_id: string }>(
    `select base_url, model_id from ${table} where newsroom_id = $1 and scope = $2`,
    [newsroomId, scope],
  );
  return scoped[0] ? { baseUrl: scoped[0].base_url, id: scoped[0].model_id } : null;
}

/*
  ---------------------------------------------------------------------------
  The address rule for a STORED local-model pick
  ---------------------------------------------------------------------------

  `ai.ts`'s local gateway sends the full prompt AND the operator's
  `LLM_API_KEY` / `OPENAI_API_KEY` to whatever `baseUrl` one of these two tables
  holds, through a plain `fetch` with no SSRF guard. So a stored address is not
  an editorial preference like a timeout -- it is an address the desk will hand
  the operator's credentials to.

  One rule, applied at both ends. `saveLocalModel` refuses a new address that is
  not loopback and not in the live catalog; every READER below applies the same
  rule to what is already stored, because a row can predate the save check or
  have been written straight into the table.
*/

/**
 * The hosts a stored local-model address is allowed to name: this computer,
 * and nothing else.
 */
function isLoopbackHost(hostname: string): boolean {
  const bare =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return bare === "localhost" || bare === "127.0.0.1" || bare === "::1";
}

/**
 * May the desk send work to this address?
 *
 * Yes for loopback -- a model server on the box running TownReporter, which is
 * what "Local model" means and what `LLM_BASE_URL` points at -- and yes for an
 * address this computer's own discovery just found (`refreshLocalCatalog`, the
 * same catalog `resolveLocalModelChoice` resolves picks against), because a
 * discovered address is one the desk already talks to. No for anything else: an
 * arbitrary URL arrives from a browser, and a run to it would be the one that
 * hands a stranger the operator's key.
 *
 * Trailing slashes are ignored on the comparison only: discovery stores
 * `http://127.0.0.1:11434/v1` and a picker may send the same address with a
 * slash on the end, which is the same server and must not be denied for it.
 *
 * A stored address the desk will not use is treated exactly like a pick whose
 * model vanished: the run falls back to the catalog's preferred local model, or
 * to none, and the picker says why. `null` catalog means "nothing was
 * discovered" (or discovery failed), which is the same answer as "not in it".
 */
function storedAddressIsAllowed(baseUrl: string, catalog: LocalCatalog | null): boolean {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (isLoopbackAddress(trimmed)) return true;
  // Anything that is not a URL at all matches no server here, so it is refused
  // by the same line that refuses an address nobody discovered.
  return Boolean(catalog?.servers.some((server) => server.baseUrl === trimmed));
}

/** Is this address this computer? Answers without touching the network. */
function isLoopbackAddress(baseUrl: string): boolean {
  try {
    return isLoopbackHost(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * `storedAddressIsAllowed` for a save, which has to fetch the catalog first.
 *
 * Loopback is answered before the lookup, exactly as it was in U7: a save to
 * this computer must not depend on discovery, and must not start it either --
 * `refreshLocalCatalog` is a shared, cached, network-touching call and a
 * loopback address never needs its answer.
 */
async function localModelAddressIsAllowed(baseUrl: string): Promise<boolean> {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (isLoopbackAddress(trimmed)) return true;
  let catalog: LocalCatalog | null = null;
  try {
    catalog = await refreshLocalCatalog();
  } catch {
    // Discovery never throws (local-models.ts), but an address must not be
    // admitted because the check that would have refused it failed.
    catalog = null;
  }
  return storedAddressIsAllowed(trimmed, catalog);
}

/** The host of a stored address, for the sentence that explains a refusal. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/**
 * What the picker says about a stored address the desk will not use. The
 * sentence names the address, because "somewhere else" is not something an
 * owner can act on, and names who can fix it.
 */
function storedAddressRefusedNotice(choice: { baseUrl: string; id: string }): string {
  return (
    `${choice.id} at ${hostOf(choice.baseUrl)} is not on this computer or in the discovered list, ` +
    `so the desk will not send work there. The owner can choose again.`
  );
}

export async function resolveLocalModelChoice(
  newsroomId: number = DEFAULT_NEWSROOM_ID,
  scope?: LocalModelScope,
): Promise<LocalModelChoice> {
  const [stored, catalog] = await Promise.all([
    rawStoredLocalModel(newsroomId, scope),
    refreshLocalCatalog(),
  ]);

  /*
    Unit BB item 2: the stored sentinel resolves NOW, not when it was saved --
    that is the entire point of the choice. `pickLoadedLocalModelAcrossServers`
    is the same function the Automatic rung uses, with the same server order,
    so "Use whatever is loaded" and the ladder can never disagree about which
    model is in memory. Nothing loaded resolves to no model; it does NOT fall
    back to the preferred cloud model, because the editor asked for this
    machine and the run must stop instead of quietly spending elsewhere.
  */
  if (isUseLoadedLocalModelPick(stored)) {
    return { override: pickLoadedLocalModelAcrossServers(catalog.servers), source: "loaded", notice: null, catalog };
  }

  if (!stored) {
    /*
      Item 3: with nothing stored, a model already in memory IS the default.
      Only when none is loaded does the older default stand -- the preferred
      cloud model for this scope, else the catalog's own default -- and
      `source: "default"` is what tells the picker's help line to say which
      model that is and why.
    */
    const loaded = pickLoadedLocalModelAcrossServers(catalog.servers);
    if (loaded) return { override: loaded, source: "loaded", notice: null, catalog };
    return { override: preferredLocalModel(scope, catalog), source: "default", notice: null, catalog };
  }

  if (stillListed(stored, catalog)) return { override: stored, source: "stored", notice: null, catalog };

  /*
    U7b: a stored pick is only usable if the desk may send work to its address.
    An address that is neither on this computer nor in the discovered catalog is
    refused HERE, before the keep-your-choice branch below -- that branch exists
    so a temporary Ollama outage does not move a decision, not so an editor's
    old row can point the next run at a stranger's server. The fallback is the
    same one a vanished model gets, and the notice says which address and who
    can fix it.
  */
  if (!storedAddressIsAllowed(stored.baseUrl, catalog)) {
    const replaced = preferredLocalModel(scope, catalog);
    const notice = storedAddressRefusedNotice(stored);
    return replaced
      ? { override: replaced, source: "default", notice: `${notice} Using ${replaced.id} instead.`, catalog }
      : { override: null, source: "default", notice, catalog };
  }

  if (scope && await rawScopedLocalModel(newsroomId, scope)) {
    return { override: stored, source: "stored", notice: `${stored.id} is not reachable or listed right now. This job will keep your choice and report an error if it cannot connect.`, catalog };
  }
  const fallback = preferredLocalModel(scope, catalog);
  if (fallback) {
    return {
      override: fallback,
      source: "default",
      notice: `${stored.id} is no longer on the server; using ${fallback.id}.`,
      catalog,
    };
  }
  return { override: null, source: "default", notice: `${stored.id} is no longer on the server.`, catalog };
}

export type SaveLocalModelResult = { ok: true } | { ok: false; error: string };

/**
 * Store (or clear) the newsroom's local-model pick.
 *
 * Owner-only, enforced here on the server and not merely hidden in the page:
 * this column decides where every local-model prompt and the operator's key go.
 * The address is checked too -- loopback, or an address discovery found -- so
 * an address typed into a browser can never become the place the desk sends the
 * operator's credentials. Read-only callers (`getLocalModelChoice`) stay open to
 * every editor, because knowing which model is chosen is not a way to change it.
 */
export async function saveLocalModel(
  userId: string,
  choice: { baseUrl: string; id: string } | null,
  scope?: LocalModelScope,
): Promise<SaveLocalModelResult> {
  const me = await requireEditor(userId);
  if (me.role !== "owner") {
    throw new ForbiddenError(ONLY_OWNER_CHANGES_MODEL_CONNECTIONS);
  }
  /*
    "Use whatever is loaded" is not an address at all -- it is the sentinel the
    run resolves against the live catalog (`resolveLocalModelChoice`), so there
    is nothing here to point anywhere and nothing to check.
  */
  if (choice && !isUseLoadedLocalModelPick(choice)) {
    if (!(await localModelAddressIsAllowed(choice.baseUrl))) {
      return {
        ok: false,
        error:
          "A local model must be on this computer, or one the desk found on it. " +
          "Use an address like http://127.0.0.1:11434/v1, or choose a model from the list.",
      };
    }
  }
  await ensureProviderSettingsSchema();
  const sql = await getSql();
  if (scope) {
    /*
      Read before the write, because F3c finding 2 turns on whether this save
      actually MOVED the pick: a first-run paper's `stored` marker makes every
      page send an explicit `local-model`, so a different per-scope pick is one
      of the owner's own decisions that the seed would otherwise overrun. A
      save that stores what was already there is not a change, and retires
      nothing.

      The legacy UNSCOPED row below needs no such rule: a seeded page resolves
      its scope's row FIRST (`rawScopedLocalModel`, then the unscoped row), and
      a first-run paper always has a row for all four scopes, so nothing an
      unscoped save writes can move a seeded page.
    */
    const before = await rawScopedLocalModel(me.newsroomId, scope);
    const table = scope === "follow-up" || scope === "ocr"
      ? "newsroom_local_model_choices_additional"
      : "newsroom_local_model_choices";
    if (choice) {
      await sql.query(`
        insert into ${table} (newsroom_id, scope, base_url, model_id)
        values ($1, $2, $3, $4)
        on conflict (newsroom_id, scope) do update
          set base_url = excluded.base_url, model_id = excluded.model_id, updated_at = now()
      `, [me.newsroomId, scope, choice.baseUrl, choice.id]);
    } else {
      await sql.query(`delete from ${table} where newsroom_id = $1 and scope = $2`, [me.newsroomId, scope]);
    }
    const moved =
      choice === null
        ? before !== null
        : before?.baseUrl !== choice.baseUrl || before?.id !== choice.id;
    if (moved && isFirstRunModelScope(scope)) {
      await supersedeFirstRunModelDefault(me.newsroomId);
    }
    return { ok: true };
  }
  await sql.query(
    `
      insert into provider_settings (newsroom_id, provider_id, local_model_base_url, local_model_id)
      values ($1, $2, $3, $4)
      on conflict (newsroom_id, provider_id) do update
        set local_model_base_url = excluded.local_model_base_url,
            local_model_id = excluded.local_model_id,
            updated_at = now()
    `,
    [me.newsroomId, LOCAL_MODEL_PROVIDER_ID, choice?.baseUrl ?? null, choice?.id ?? null],
  );
  return { ok: true };
}

export const getLocalModelChoice = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => cleanModelScope((raw as { scope?: unknown } | null)?.scope))
  .handler(async ({ context, data }): Promise<LocalModelChoice> => {
    const me = await requireEditor(context.userId);
    return resolveLocalModelChoice(me.newsroomId, data);
  });

export const saveLocalModelFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => cleanLocalModelInput(raw))
  .handler(async ({ context, data }): Promise<SaveLocalModelResult> => {
    try {
      if (data.invalidScope) return { ok: false, error: "Choose a valid model-use scope." };
      if (data.invalidInput) {
        return { ok: false, error: "That model address or model id is too long to store." };
      }
      return await saveLocalModel(context.userId, data.choice, data.scope);
    } catch (err) {
      if (err instanceof ForbiddenError) return { ok: false, error: err.message };
      throw err;
    }
  });

/*
  There is deliberately no `paperProviderBudget(newsroomId, choice)` helper
  here. Every pipeline that spends real time -- a Story draft, a Scan read, a
  Dark Desk round -- reads the paper's overrides ONCE at the top of the run
  with `readProviderOverrides` and then passes them to `providerBudget()` for
  each attempt. A per-call helper would hide a database read inside a timing
  calculation that runs several times per pipeline, and would make a mid-run
  failover's budget depend on a second query rather than on the numbers the
  run started with.
*/

const SECOND = 1_000;

function toSeconds(ms: number): number {
  return Math.round(ms / SECOND);
}

/** What the Server page renders: one row per provider the picker can offer. */
export type ProviderTimeSetting = {
  providerId: string;
  label: string;
  detail: string;
  /**
   * How the desk reaches it. The Server page uses this to file each time
   * field under the sign-in row it belongs to: both Codex entries are the
   * one Codex login, and Claude Opus is the one Claude login.
   */
  kind: string;
  /** The per-call ceiling in force, in seconds. */
  callSeconds: number;
  /** What it would be with no override, in seconds. */
  defaultCallSeconds: number;
  /** True when this paper has stored a number of its own. */
  overridden: boolean;
  /** Is this provider offered on this desk at all? */
  enabled: boolean;
  /** False when the machine itself has the provider switched off. */
  availableOnThisMachine: boolean;
  /**
   * The address this provider's calls go to, or null for a provider that has
   * none (the two command-line tools reach their service through a login, not
   * a URL). `providerEndpoint` is the one reader of that fact, so the address
   * the Server page prints is the address `rungGateway` calls.
   */
  endpoint: string | null;
  /**
   * Is that address one the desk's own local-model discovery looks at?
   *
   * False when an installation setting named the address, and false when
   * discovery is switched off -- both cases where nobody looked, and where
   * "nothing answered there" would be a claim about a probe that never ran.
   * See `providerEndpointWatched`.
   */
  endpointWatched: boolean;
  /**
   * True when an installation setting has THIS provider switched off
   * (`TOWNREPORTER_X=0`), the state `provider-login.server.ts` reports as
   * `disabledByOperator` for the two logins.
   *
   * Not derivable from `availableOnThisMachine` above, which for a local rung
   * also means "nothing was found answering": those are two different
   * sentences -- "you turned this off" and "nothing is listening" -- and the
   * Server page prints each one only where it is true.
   */
  switchedOffByOperator: boolean;
};

export async function providerTimeSettings(
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<ProviderTimeSetting[]> {
  const overrides = await readProviderOverrides(newsroomId);
  return PROVIDER_REGISTRY.map((entry) => {
    const override = overrides[entry.id];
    const merged = effectiveBudget(entry.id, overrides);
    return {
      providerId: entry.id,
      label: entry.label,
      detail: entry.detail,
      kind: entry.kind,
      callSeconds: toSeconds(merged.callMs),
      defaultCallSeconds: toSeconds(entry.budget.callMs),
      overridden: typeof override?.callMs === "number" && override.callMs > 0,
      enabled: override?.enabled !== false,
      availableOnThisMachine: entry.enabled(),
      endpoint: providerEndpoint(entry),
      endpointWatched: providerEndpointWatched(entry),
      switchedOffByOperator: providerSwitchedOff(entry),
    };
  });
}

export type SaveProviderTimeResult =
  | { ok: true; settings: ProviderTimeSetting[] }
  | { ok: false; error: string };

/**
 * Store (or clear) one provider's per-call ceiling for this paper.
 *
 * Owner-only, enforced here on the server and not merely hidden in the page:
 * this changes how long every editor's draft is allowed to run, which is the
 * same class of decision as changing the paper's settings or inviting an
 * editor -- both of which `savePaperConfig` / `createInvite` refuse to a
 * plain editor.
 */
export async function saveProviderTime(
  userId: string,
  input: SaveProviderTimeInput,
): Promise<SaveProviderTimeResult> {
  const me = await requireEditor(userId);
  if (me.role !== "owner") {
    throw new ForbiddenError("Only the owner can change how long a writing model may take.");
  }
  const entry = providerEntry(input.providerId);
  if (!entry) return { ok: false, error: "There is no such writing model." };

  // QA-2: a present-but-not-finite callSeconds (NaN, Infinity, a non-numeric
  // value) must be refused with the same shape as an out-of-range number --
  // never silently treated as the Reset button's `null`.
  if (input.invalid) return { ok: false, error: "Give it a number of seconds." };

  await ensureProviderSettingsSchema();
  const sql = await getSql();

  if (input.callSeconds === null) {
    await sql`
      update provider_settings set call_ms = null, updated_at = now()
      where newsroom_id = ${me.newsroomId} and provider_id = ${entry.id}
    `;
    return { ok: true, settings: await providerTimeSettings(me.newsroomId) };
  }

  /*
    Refused, not silently clamped -- see `validateProviderSeconds`. The clamp
    below is still applied as a belt-and-braces guard for anything that
    reaches the column another way.
  */
  const problem = validateProviderSeconds(input.callSeconds);
  if (problem) return { ok: false, error: problem };
  const callMs = clampBudgetMs(input.callSeconds * SECOND);

  await sql.query(
    `
      insert into provider_settings (newsroom_id, provider_id, call_ms)
      values ($1, $2, $3)
      on conflict (newsroom_id, provider_id) do update
        set call_ms = excluded.call_ms, updated_at = now()
    `,
    [me.newsroomId, entry.id, callMs],
  );
  return { ok: true, settings: await providerTimeSettings(me.newsroomId) };
}

/** Owner-only read of the panel's rows. */
export const getProviderTimeSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ProviderTimeSetting[]> => {
    const me = await requireEditor(context.userId);
    if (me.role !== "owner") {
      throw new ForbiddenError("Only the owner can see the writing-model time budgets.");
    }
    return providerTimeSettings(me.newsroomId);
  });

/** Owner-only write. Validation lives in `saveProviderTime`, above. */
export const saveProviderTimeFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => cleanProviderTimeInput(raw))
  .handler(async ({ context, data }): Promise<SaveProviderTimeResult> => {
    try {
      return await saveProviderTime(context.userId, data);
    } catch (err) {
      if (err instanceof ForbiddenError) return { ok: false, error: err.message };
      throw err;
    }
  });
