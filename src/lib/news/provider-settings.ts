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
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (newsroom_id, provider_id)
    )
  `);
}

type ProviderSettingRow = {
  provider_id: string;
  call_ms: number | null;
  wall_ms: number | null;
  enabled: boolean | null;
};

/**
 * Every override this paper has stored, keyed by provider id.
 *
 * Rows for providers the registry no longer knows about are dropped rather
 * than returned: a retired provider's stored timeout must not resurface as a
 * budget for whatever id happens to be reused later.
 */
export async function readProviderOverrides(
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<ProviderOverrides> {
  await ensureProviderSettingsSchema();
  const sql = await getSql();
  const rows = await sql<ProviderSettingRow>`
    select provider_id, call_ms, wall_ms, enabled
    from provider_settings where newsroom_id = ${newsroomId}
  `;
  const out: ProviderOverrides = {};
  for (const row of rows) {
    if (!providerEntry(row.provider_id)) continue;
    out[row.provider_id] = {
      callMs: row.call_ms,
      wallMs: row.wall_ms,
      enabled: row.enabled,
    };
  }
  return out;
}

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
