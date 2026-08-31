/*
  CITY-SETUP slice A: a database-backed paper configuration, with today's
  hard-coded constants as the fallback. No UI, no route, no behaviour change
  for the existing Longmont install -- an install that never writes a
  `paper_settings` row keeps reading PAPER / COUNCIL_VOTES_URL / SEED_SOURCES
  / MEETING_KEYWORDS / LONGMONT_YOUTUBE_CHANNELS exactly as before, because
  every column in that table is nullable and every field below falls back to
  the constant when its column is null.
*/

import { AsyncLocalStorage } from "node:async_hooks";
import { getSql } from "../db.ts";
import { PAPER, COUNCIL_VOTES_URL, SEED_SOURCES } from "../paper.ts";
import { MEETING_KEYWORDS, LONGMONT_YOUTUBE_CHANNELS } from "./youtube.ts";
import { requireEditor, ForbiddenError, DEFAULT_NEWSROOM_ID } from "./membership.ts";

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
  Request-scoped cache.

  No existing per-request cache primitive was found under src/lib/news/ (the
  only AsyncLocalStorage use in the codebase is src/lib/auth/isolation.server.ts,
  a same-site request guard with no state store to reuse), so this is a small
  self-contained ALS store local to this module. `runWithPaperConfigCache`
  is optional: nothing outside this module is required to call it, and
  getPaperConfig() falls back to fetching fresh (no caching, always correct)
  when no store is active -- exactly today's per-call behaviour.
*/
const cacheStorage = new AsyncLocalStorage<Map<number, PaperConfig>>();

export function runWithPaperConfigCache<T>(fn: () => Promise<T>): Promise<T> {
  return cacheStorage.run(new Map(), fn);
}

/**
 * The paper's live configuration: the newsroom's `paper_settings` row,
 * field-by-field, falling back to the shipped constants (PAPER,
 * COUNCIL_VOTES_URL, SEED_SOURCES, MEETING_KEYWORDS, LONGMONT_YOUTUBE_CHANNELS)
 * wherever a column is null or the row does not exist.
 */
export async function getPaperConfig(newsroomId: number = DEFAULT_NEWSROOM_ID): Promise<PaperConfig> {
  const cache = cacheStorage.getStore();
  const hit = cache?.get(newsroomId);
  if (hit) return hit;
  const value = await loadPaperConfig(newsroomId);
  cache?.set(newsroomId, value);
  return value;
}

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

  // Invalidate this newsroom's request-scoped cache entry, if any is active.
  cacheStorage.getStore()?.delete(me.newsroomId);
  return getPaperConfig(me.newsroomId);
}
