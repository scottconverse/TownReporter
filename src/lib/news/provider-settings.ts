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
import { requireEditor, ForbiddenError, DEFAULT_NEWSROOM_ID } from "./membership.ts";
import {
  PROVIDER_REGISTRY,
  clampBudgetMs,
  effectiveBudget,
  providerEntry,
  validateProviderSeconds,
  type ProviderOverrides,
} from "./provider-registry.ts";
import { refreshLocalCatalog, type LocalCatalog } from "./local-models.ts";

/**
 * Idempotent runtime ensure for the PGLite preview and unit-test paths,
 * mirroring migrations/0029_provider_settings.sql exactly. Same reason
 * `ensurePaperSettingsSchema` exists: Node's test runner never runs
 * `migrations/*.sql` (see src/lib/db.ts createPgliteSql -- `import.meta.glob`
 * is a Vite-only transform), so the schema has to be stated twice.
 */
export async function ensureProviderSettingsSchema() {
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

/** Is a stored `{baseUrl,id}` still on that server's current model list? */
function stillListed(
  pick: { baseUrl: string; id: string } | null | undefined,
  catalog: LocalCatalog,
): boolean {
  if (!pick) return false;
  const server = catalog.servers.find((s) => s.baseUrl === pick.baseUrl);
  return Boolean(server?.models.some((m) => m.id === pick.id));
}

/**
 * Every override this paper has stored, keyed by provider id.
 *
 * Rows for providers the registry no longer knows about are dropped rather
 * than returned: a retired provider's stored timeout must not resurface as a
 * budget for whatever id happens to be reused later.
 *
 * The `local-model` id's `localModel` field is resolved against the LIVE
 * catalog before this returns: the editor's stored pick when it is still on
 * the server's list, else the currently discovered default. Every caller
 * that threads `overrides["local-model"]?.localModel` straight into
 * `grokChat`'s `opts.localModel` (report.ts, dark.ts, investigate.ts)
 * therefore gets "the stored pick, or the discovered default" for free,
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
  const stored = out[LOCAL_MODEL_PROVIDER_ID]?.localModel;
  try {
    const catalog = await refreshLocalCatalog();
    const resolved = stillListed(stored, catalog) ? stored : catalog.defaultModel;
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
): Promise<{ baseUrl: string; id: string } | null> {
  await ensureProviderSettingsSchema();
  const sql = await getSql();
  const rows = await sql<Pick<ProviderSettingRow, "local_model_base_url" | "local_model_id">>`
    select local_model_base_url, local_model_id from provider_settings
    where newsroom_id = ${newsroomId} and provider_id = ${LOCAL_MODEL_PROVIDER_ID}
  `;
  const row = rows[0];
  return row?.local_model_base_url && row.local_model_id
    ? { baseUrl: row.local_model_base_url, id: row.local_model_id }
    : null;
}

export async function resolveLocalModelChoice(
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<LocalModelChoice> {
  const [stored, catalog] = await Promise.all([
    rawStoredLocalModel(newsroomId),
    refreshLocalCatalog(),
  ]);
  if (!stored) return { override: catalog.defaultModel, notice: null, catalog };
  if (stillListed(stored, catalog)) return { override: stored, notice: null, catalog };
  if (catalog.defaultModel) {
    return {
      override: catalog.defaultModel,
      notice: `${stored.id} is no longer on the server; using ${catalog.defaultModel.id}.`,
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
): Promise<SaveLocalModelResult> {
  const me = await requireEditor(userId);
  await ensureProviderSettingsSchema();
  const sql = await getSql();
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
  .handler(async ({ context }): Promise<LocalModelChoice> => {
    const me = await requireEditor(context.userId);
    return resolveLocalModelChoice(me.newsroomId);
  });

export const saveLocalModelFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const v = (raw ?? {}) as { baseUrl?: unknown; id?: unknown };
    if (typeof v.baseUrl === "string" && typeof v.id === "string" && v.baseUrl && v.id) {
      return { baseUrl: v.baseUrl, id: v.id };
    }
    return null;
  })
  .handler(async ({ context, data }): Promise<SaveLocalModelResult> => {
    try {
      return await saveLocalModel(context.userId, data);
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

export type SaveProviderTimeInput = {
  providerId: string;
  /**
   * Seconds, as typed. `null` means "put it back to the shipped default" --
   * that is what the Reset button sends, and it deletes the stored number
   * rather than writing today's default into the row, so a later change to
   * the default reaches a paper that never made a decision.
   */
  callSeconds: number | null;
  /**
   * QA-2 (2026-09-02): true when `raw.callSeconds` was present but is not a
   * finite number (NaN, +/-Infinity, a string, an object...). Before this
   * field existed, `cleanProviderTimeInput` collapsed every such value to
   * `null` -- the exact same shape the Reset button sends -- so a malformed
   * request silently wiped a stored override back to the shipped default
   * instead of being refused. `saveProviderTime` checks this BEFORE treating
   * `callSeconds === null` as a reset, so "field omitted / explicitly null"
   * and "field present but garbage" are no longer the same code path.
   */
  invalid: boolean;
};

export function cleanProviderTimeInput(raw: unknown): SaveProviderTimeInput {
  const v = (raw ?? {}) as Partial<SaveProviderTimeInput>;
  const seconds = v.callSeconds;
  const isFiniteNumber = typeof seconds === "number" && Number.isFinite(seconds);
  return {
    providerId: String(v.providerId ?? ""),
    callSeconds: isFiniteNumber ? Math.round(seconds) : null,
    // `undefined` and `null` are the Reset button's own shape, not garbage --
    // only a PRESENT-but-not-finite value (NaN, Infinity, a string, ...) is
    // invalid input.
    invalid: seconds !== undefined && seconds !== null && !isFiniteNumber,
  };
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
