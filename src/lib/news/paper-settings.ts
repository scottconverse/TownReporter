/*
  CITY-SETUP slice A: a database-backed paper configuration, with today's
  hard-coded constants as the fallback. No UI, no route, no behaviour change
  for the existing Longmont install -- an install that never writes a
  `paper_settings` row keeps reading PAPER / COUNCIL_VOTES_URL / SEED_SOURCES
  / MEETING_KEYWORDS / LONGMONT_YOUTUBE_CHANNELS exactly as before, because
  every column in that table is nullable and every field below falls back to
  the constant when its column is null.
*/

import { createServerFn } from "@tanstack/react-start";
/*
  Relative, not the `@/` alias. Vite resolves that alias and plain Node does
  not, and this module IS loaded by node --test (paper-settings.test.ts, and
  anything that reaches it through desk.ts), so an alias here fails CI with
  "Cannot find package '@/lib'". claim.ts can use the alias because no
  node --test file loads it.
*/
import { authMiddleware } from "../auth/middleware.ts";
import { getSql } from "../db.ts";
import { PAPER, COUNCIL_VOTES_URL, SEED_SOURCES } from "../paper.ts";
import type { PaperIdentity } from "../paper-context.tsx";
import { MEETING_KEYWORDS, LONGMONT_YOUTUBE_CHANNELS } from "./youtube.ts";
import { requireEditor, ForbiddenError, DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { writeWelcomeArticle } from "./welcome-article.ts";

export type SeedSource = (typeof SEED_SOURCES)[number];

export type PaperConfig = {
  name: string;
  city: string;
  state: string;
  location: string;
  timezone: string;
  tagline: string;
  kicker: string;
  deck: string;
  trust: string;
  councilVotesUrl: string;
  youtubeChannels: string[];
  meetingKeywords: string[];
  seedSources: SeedSource[];
};

type PaperSettingsRow = {
  name: string | null;
  city: string | null;
  state: string | null;
  location: string | null;
  timezone: string | null;
  tagline: string | null;
  kicker: string | null;
  deck: string | null;
  trust: string | null;
  council_votes_url: string | null;
  youtube_channels: unknown;
  meeting_keywords: unknown;
  seed_sources: unknown;
};

/**
 * Idempotent runtime ensure for the PGLite preview path, mirroring
 * ensureInviteSchema in membership.ts: the migration is the real
 * deployment's source of truth, this exists because Node's unit-test
 * runner never runs migrations/*.sql (see src/lib/db.ts createPgliteSql --
 * `import.meta.glob` is a Vite-only transform).
 */
export async function ensurePaperSettingsSchema() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists paper_settings (
      id serial primary key,
      newsroom_id integer not null default 1,
      name text,
      city text,
      state text,
      location text,
      timezone text,
      tagline text,
      kicker text,
      deck text,
      trust text,
      council_votes_url text,
      youtube_channels jsonb,
      meeting_keywords jsonb,
      seed_sources jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (newsroom_id)
    )
  `);
  // CITY-SETUP final slice: mirrors migrations/0022_paper_settings_onboarded.sql
  await sql.query(`alter table paper_settings add column if not exists onboarded boolean not null default false`);
}

function defaultConfig(): PaperConfig {
  return {
    name: PAPER.name,
    city: PAPER.city,
    state: PAPER.state,
    location: PAPER.location,
    timezone: PAPER.timezone,
    tagline: PAPER.tagline,
    kicker: PAPER.kicker,
    deck: PAPER.deck,
    trust: PAPER.trust,
    councilVotesUrl: COUNCIL_VOTES_URL,
    youtubeChannels: [...LONGMONT_YOUTUBE_CHANNELS],
    meetingKeywords: [...MEETING_KEYWORDS],
    seedSources: SEED_SOURCES.map((s) => ({ ...s })),
  };
}

/** Parse a jsonb column that may already be an array (PGLite) or a JSON string (Neon `text`-decoded jsonb still arrives parsed). */
function asStringArray(raw: unknown): string[] | null {
  if (raw == null) return null;
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  if (!Array.isArray(value)) return null;
  /*
    An empty array is an answer, not a gap. A city with no meeting video
    channel must be able to say so; returning null here would have handed
    them Longmont's channels forever, which is the exact failure this whole
    feature exists to end. Only a missing or malformed value falls back.
  */
  return value.filter((v): v is string => typeof v === "string");
}

function asSeedSources(raw: unknown): SeedSource[] | null {
  if (raw == null) return null;
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  if (!Array.isArray(value)) return null;
  const rows = value.filter(
    (v): v is SeedSource =>
      Boolean(v) &&
      typeof v === "object" &&
      typeof (v as SeedSource).url === "string" &&
      typeof (v as SeedSource).title === "string",
  );
  // Empty means "seed nothing", for the same reason as asStringArray above.
  return rows;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mergeRow(row: PaperSettingsRow | undefined, base: PaperConfig): PaperConfig {
  if (!row) return base;
  return {
    name: row.name?.trim() || base.name,
    city: row.city?.trim() || base.city,
    state: row.state?.trim() || base.state,
    location: row.location?.trim() || base.location,
    timezone: row.timezone?.trim() || base.timezone,
    tagline: row.tagline?.trim() || base.tagline,
    kicker: row.kicker?.trim() || base.kicker,
    deck: row.deck?.trim() || base.deck,
    trust: row.trust?.trim() || base.trust,
    councilVotesUrl: row.council_votes_url?.trim() || base.councilVotesUrl,
    youtubeChannels: asStringArray(row.youtube_channels) ?? base.youtubeChannels,
    meetingKeywords: asStringArray(row.meeting_keywords) ?? base.meetingKeywords,
    seedSources: asSeedSources(row.seed_sources) ?? base.seedSources,
  };
}

async function loadPaperConfig(newsroomId: number): Promise<PaperConfig> {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  const rows = await sql<PaperSettingsRow>`
    select name, city, state, location, timezone, tagline, kicker, deck, trust,
           council_votes_url, youtube_channels, meeting_keywords, seed_sources
    from paper_settings
    where newsroom_id = ${newsroomId}
    limit 1
  `;
  return mergeRow(rows[0], defaultConfig());
}

/*
  A small process-level cache.

  This was an AsyncLocalStorage request cache, and it broke the desk: this
  module is reached from code that also ends up in the client graph, so Vite
  externalised `node:async_hooks` for the browser and every desk page died on
  "Module node:async_hooks has been externalized for browser compatibility".
  CI caught it; a local `npm test` did not, because the browser tests skip
  without a Postgres URL.

  A plain Map has no server-only import and cannot repeat that. The TTL is
  short because the only writer is the owner changing the paper's own
  settings, and savePaperConfig clears the entry outright -- the window only
  matters for a second process that did not perform the write.
*/
const CACHE_TTL_MS = 30_000;
const cache = new Map<number, { at: number; value: PaperConfig }>();

/** Drop every cached entry. Exported for tests. */
export function clearPaperConfigCache() {
  cache.clear();
}

/**
 * The paper's live configuration: the newsroom's `paper_settings` row,
 * field-by-field, falling back to the shipped constants (PAPER,
 * COUNCIL_VOTES_URL, SEED_SOURCES, MEETING_KEYWORDS, LONGMONT_YOUTUBE_CHANNELS)
 * wherever a column is null or the row does not exist.
 */
export async function getPaperConfig(newsroomId: number = DEFAULT_NEWSROOM_ID): Promise<PaperConfig> {
  const hit = cache.get(newsroomId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await loadPaperConfig(newsroomId);
  cache.set(newsroomId, { at: Date.now(), value });
  return value;
}

/**
 * The paper's identity fields only, shaped for the client (`PaperIdentity`
 * in src/lib/paper-context.tsx) and fetched ONCE per page load: the root
 * route's `beforeLoad` is the only caller (see src/routes/__root.tsx), and
 * its result is threaded down through route context / React context rather
 * than re-fetched per component.
 */
export const getPaperIdentityFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<PaperIdentity> => {
    const cfg = await getPaperConfig();
    return {
      name: cfg.name,
      city: cfg.city,
      state: cfg.state,
      location: cfg.location,
      timezone: cfg.timezone,
      tagline: cfg.tagline,
      kicker: cfg.kicker,
      deck: cfg.deck,
      trust: cfg.trust,
      councilVotesUrl: cfg.councilVotesUrl,
    };
  },
);

export type PaperConfigPatch = Partial<{
  name: string | null;
  city: string | null;
  state: string | null;
  location: string | null;
  timezone: string | null;
  tagline: string | null;
  kicker: string | null;
  deck: string | null;
  trust: string | null;
  councilVotesUrl: string | null;
  youtubeChannels: string[] | null;
  meetingKeywords: string[] | null;
  seedSources: SeedSource[] | null;
}>;

const COLUMN_BY_FIELD: Record<keyof PaperConfigPatch, string> = {
  name: "name",
  city: "city",
  state: "state",
  location: "location",
  timezone: "timezone",
  tagline: "tagline",
  kicker: "kicker",
  deck: "deck",
  trust: "trust",
  councilVotesUrl: "council_votes_url",
  youtubeChannels: "youtube_channels",
  meetingKeywords: "meeting_keywords",
  seedSources: "seed_sources",
};

const JSONB_FIELDS = new Set<keyof PaperConfigPatch>([
  "youtubeChannels",
  "meetingKeywords",
  "seedSources",
]);

/**
 * Save a partial paper-config override. Owner-only: reuses `requireEditor`
 * from membership.ts (the exact owner/editor check every other desk RPC
 * goes through) and additionally requires the "owner" role, matching how
 * createInvite in membership.ts restricts its own owner-only action.
 */
export async function savePaperConfig(
  userId: string,
  patch: PaperConfigPatch,
): Promise<PaperConfig> {
  const me = await requireEditor(userId);
  if (me.role !== "owner") {
    throw new ForbiddenError("Only the owner can change the paper's settings.");
  }
  await ensurePaperSettingsSchema();
  const sql = await getSql();

  // Only fields this module knows a column for. An unknown key used to reach
  // the SQL as `undefined = $2`, which fails as a syntax error at the database
  // rather than being refused here.
  const fields = (Object.keys(patch) as (keyof PaperConfigPatch)[]).filter(
    (f) => Object.prototype.hasOwnProperty.call(COLUMN_BY_FIELD, f),
  );
  if (fields.length === 0) return getPaperConfig(me.newsroomId);

  const setClauses: string[] = [];
  const params: unknown[] = [me.newsroomId];
  for (const field of fields) {
    const column = COLUMN_BY_FIELD[field];
    const raw = patch[field];
    const value = raw == null ? null : JSONB_FIELDS.has(field) ? JSON.stringify(raw) : raw;
    params.push(value);
    setClauses.push(`${column} = $${params.length}`);
  }

  await sql.query(
    `
      insert into paper_settings (newsroom_id, ${fields.map((f) => COLUMN_BY_FIELD[f]).join(", ")})
      values ($1, ${fields.map((_f, i) => `$${i + 2}`).join(", ")})
      on conflict (newsroom_id) do update set
        ${setClauses.join(", ")},
        updated_at = now()
    `,
    params,
  );

  // The owner just changed it; never serve the old copy from cache.
  cache.delete(me.newsroomId);
  return getPaperConfig(me.newsroomId);
}

/*
  CITY-SETUP final slice: first-run setup.

  `onboarded` is a bare flag on the same paper_settings row, not folded into
  PaperConfig/PaperConfigPatch above -- it is administrative state ("has the
  owner completed the setup form"), not an identity field a page renders, so
  it never needs to reach getPaperIdentityFn or the client PaperIdentity
  shape.
*/

/**
 * The current editor's newsroom's live PaperConfig -- used to prefill the
 * setup form (both on the first-run gate and the Server page's "Paper
 * setup" section) so re-running setup starts from what's already there,
 * not blank fields.
 */
export const getPaperConfigForEditor = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const me = await requireEditor(context.userId);
    return getPaperConfig(me.newsroomId);
  });

/** Is there a paper_settings row for this newsroom with onboarded = true? */
async function isOnboarded(newsroomId: number): Promise<boolean> {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  const rows = await sql<{ onboarded: boolean | null }>`
    select onboarded from paper_settings where newsroom_id = ${newsroomId} limit 1
  `;
  return rows[0]?.onboarded === true;
}

/**
 * Owner-only: does this newsroom still need the first-run setup screen?
 * A signed-in editor (not owner) always gets `needsSetup: false` -- only the
 * owner can run setup, so there is nothing for anyone else to be routed to.
 */
export const firstRunSetupState = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const me = await requireEditor(context.userId);
      if (me.role !== "owner") return { needsSetup: false as const };
      return { needsSetup: !(await isOnboarded(me.newsroomId)) };
    } catch (err) {
      if (err instanceof ForbiddenError) return { needsSetup: false as const };
      throw err;
    }
  });

export type FirstRunSetupInput = {
  name: string;
  city: string;
  state: string;
  timezone: string;
  tagline: string;
  watchlist: SeedSource[];
};

function cleanSetupInput(raw: unknown): FirstRunSetupInput {
  const v = (raw ?? {}) as Partial<FirstRunSetupInput>;
  const watchlist = Array.isArray(v.watchlist)
    ? v.watchlist
        .filter(
          (s): s is SeedSource =>
            Boolean(s) && typeof s === "object" && typeof (s as SeedSource).url === "string",
        )
        .map((s) => ({
          url: s.url.trim(),
          title: (s.title ?? "").trim() || s.url.trim(),
          kind: s.kind ?? "official",
          tier: s.tier ?? "A",
        }))
        .filter((s) => s.url.length > 0)
    : [];
  return {
    name: String(v.name ?? "").trim(),
    city: String(v.city ?? "").trim(),
    state: String(v.state ?? "").trim(),
    timezone: String(v.timezone ?? "").trim(),
    tagline: String(v.tagline ?? "").trim(),
    watchlist,
  };
}

/**
 * The whole first-run setup form, in one owner-only RPC: writes the paper's
 * identity (name / city / state / timezone / tagline / watch list) through
 * the same savePaperConfig() every later settings edit goes through, marks
 * this newsroom onboarded, and rewrites the seeded welcome ARTICLE so it
 * reads for the configured city instead of migrations/0002_newsroom.sql's
 * hard-coded Longmont copy. Reachable twice: once as the gate after
 * claiming a fresh desk (src/routes/desk.setup.tsx via the desk.index
 * redirect), and again any time afterward from the Server page, so a wrong
 * answer during setup is fixable without touching a file.
 */
export const completeFirstRunSetup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => cleanSetupInput(raw))
  .handler(async ({ context, data }) => {
    try {
      if (!data.name || !data.city || !data.state || !data.timezone) {
        return {
          ok: false as const,
          error: "Paper name, city, state and timezone are required.",
        };
      }
      const me = await requireEditor(context.userId);
      if (me.role !== "owner") {
        throw new ForbiddenError("Only the owner can set up the paper.");
      }
      const cfg = await savePaperConfig(context.userId, {
        name: data.name,
        city: data.city,
        state: data.state,
        location: `${data.city}, ${data.state}`,
        timezone: data.timezone,
        tagline: data.tagline || null,
        seedSources: data.watchlist,
      });

      await ensurePaperSettingsSchema();
      const sql = await getSql();
      await sql`
        update paper_settings set onboarded = true, updated_at = now()
        where newsroom_id = ${me.newsroomId}
      `;
      cache.delete(me.newsroomId);

      await writeWelcomeArticle(me.newsroomId, cfg);

      return { ok: true as const };
    } catch (err) {
      if (err instanceof ForbiddenError) return { ok: false as const, error: err.message };
      throw err;
    }
  });
