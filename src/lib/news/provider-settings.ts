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
import { getSql } from "../db.ts";
import { requireEditor, ForbiddenError, DEFAULT_NEWSROOM_ID, ensureNewsroomSchema } from "./membership.ts";
import {
  PROVIDER_REGISTRY,
  clampBudgetMs,
  effectiveBudget,
  providerEntry,
  validateProviderSeconds,
  type ProviderOverrides,
} from "./provider-registry.ts";
import { refreshLocalCatalog, type LocalCatalog } from "./local-models.ts";
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
  await sql.query(`
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
  `);
  // Mirrors migrations/0041_provider_local_model.sql for an install whose
  // table predates it -- same reason the rest of this function exists.
  await sql.query(`alter table provider_settings add column if not exists local_model_base_url text`);
  await sql.query(`alter table provider_settings add column if not exists local_model_id text`);
  await sql.query(`
    create table if not exists newsroom_local_model_choices (
      newsroom_id integer not null references newsrooms(id) on delete cascade,
      scope text not null check (scope in ('story', 'scan', 'opinion', 'dark', 'forced')),
      base_url text not null,
      model_id text not null,
      updated_at timestamptz not null default now(),
      primary key (newsroom_id, scope)
    )
  `);
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
  opinion: "deepseek-v4.1-flash:cloud",
  dark: "deepseek-v4.1-flash:cloud",
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
  if (explicitScoped) {
    // A temporary Ollama outage must never silently send the editor's chosen
    // cloud work to an unrelated LM Studio model on another server.
    out[LOCAL_MODEL_PROVIDER_ID] = { ...(out[LOCAL_MODEL_PROVIDER_ID] ?? {}), localModel: explicitScoped };
    return out;
  }
  try {
    const catalog = await refreshLocalCatalog();
    const resolved = stillListed(stored, catalog) ? stored : preferredLocalModel(scope, catalog);
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
    // run over a local-model lookup nobody may even be using).
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
  const scoped = await sql<{ base_url: string; model_id: string }>`
    select base_url, model_id from newsroom_local_model_choices
    where newsroom_id = ${newsroomId} and scope = ${scope}
  `;
  return scoped[0] ? { baseUrl: scoped[0].base_url, id: scoped[0].model_id } : null;
}

export async function resolveLocalModelChoice(
  newsroomId: number = DEFAULT_NEWSROOM_ID,
  scope?: LocalModelScope,
): Promise<LocalModelChoice> {
  const [stored, catalog] = await Promise.all([
    rawStoredLocalModel(newsroomId, scope),
    refreshLocalCatalog(),
  ]);
  if (!stored) return { override: preferredLocalModel(scope, catalog), notice: null, catalog };
  if (stillListed(stored, catalog)) return { override: stored, notice: null, catalog };
  if (scope && await rawScopedLocalModel(newsroomId, scope)) {
    return { override: stored, notice: `${stored.id} is not reachable or listed right now. This job will keep your choice and report an error if it cannot connect.`, catalog };
  }
  const fallback = preferredLocalModel(scope, catalog);
  if (fallback) {
    return {
      override: fallback,
      notice: `${stored.id} is no longer on the server; using ${fallback.id}.`,
      catalog,
    };
  }
  return { override: null, notice: `${stored.id} is no longer on the server.`, catalog };
}

export type SaveLocalModelResult = { ok: true } | { ok: false; error: string };

/** Any editor may pick a local model -- it is not a timing/security decision. */
export async function saveLocalModel(
  userId: string,
  choice: { baseUrl: string; id: string } | null,
  scope?: LocalModelScope,
): Promise<SaveLocalModelResult> {
  const me = await requireEditor(userId);
  await ensureProviderSettingsSchema();
  const sql = await getSql();
  if (scope) {
    if (choice) {
      await sql.query(`
        insert into newsroom_local_model_choices (newsroom_id, scope, base_url, model_id)
        values ($1, $2, $3, $4)
        on conflict (newsroom_id, scope) do update
          set base_url = excluded.base_url, model_id = excluded.model_id, updated_at = now()
      `, [me.newsroomId, scope, choice.baseUrl, choice.id]);
    } else {
      await sql.query(`delete from newsroom_local_model_choices where newsroom_id = $1 and scope = $2`, [me.newsroomId, scope]);
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
