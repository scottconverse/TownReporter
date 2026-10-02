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
import { ensureSchemaOnce, getSql } from "../db.ts";
/*
  MEETING_KEYWORDS and LONGMONT_YOUTUBE_CHANNELS come from ../paper.ts, not
  from ./youtube.ts where they were written: this module is loaded by the
  root route, and youtube.ts spawns python through a `.server.ts` module, so
  importing it here put a server-only file in the client build (0.6.63).
*/
import {
  PAPER,
  COUNCIL_VOTES_URL,
  SEED_SOURCES,
  EDITOR_EMAIL,
  MEETING_KEYWORDS,
  LONGMONT_YOUTUBE_CHANNELS,
} from "../paper.ts";
import type { PaperIdentity } from "../paper-identity.ts";
/* Type-only, and the module it comes from imports nothing at all: see
   NewsroomPlace's note. */
import type { NewsroomPlace } from "./lead-match.ts";
/* Pure constants + folds, no database: the outlet list and its parser. */
import { NAMED_OUTLETS, asNamedOutlets, type NamedOutlet } from "./outlet-credit.ts";
/* Pure zod + constants, no database: safe to load from a plain node test. */
import { LIMITS } from "./request-input.ts";
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
  /** Runtime override for EDITOR_EMAIL (src/lib/paper.ts). Null means "use the build-time value." */
  editorEmail: string | null;
  /**
   * The outlets whose reporting a story must show its reader, overriding
   * NAMED_OUTLETS (src/lib/news/outlet-credit.ts). An empty list means this
   * newsroom credits no outlets; only a NULL column falls back.
   */
  namedOutlets: NamedOutlet[];
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
  named_outlets: unknown;
  editor_email: string | null;
};

/**
 * Idempotent runtime ensure for the PGLite preview path, mirroring
 * ensureInviteSchema in membership.ts: the migration is the real
 * deployment's source of truth, this exists because Node's unit-test
 * runner never runs migrations/*.sql (see src/lib/db.ts createPgliteSql --
 * `import.meta.glob` is a Vite-only transform).
 *
 * Run through `ensureSchemaOnce` (Unit BP2, option (ii)): the four
 * `alter table ... add column if not exists` statements below need ACCESS
 * EXCLUSIVE, and this function is the first line of the PUBLIC read
 * (`getPublicPaperConfig` -> `isOnboarded`). While the nightly `pg_dump` held
 * ACCESS SHARE on `paper_settings`, those ALTERs queued behind it and the
 * paper's own pages waited with them. The marker lives in the database, so a
 * warm process issues no ALTER at all -- and a database rebuilt underneath it
 * re-runs the batch, exactly as `dark-schema-rebuild.test.ts` requires.
 * `paper-settings-read-lock.test.ts` holds the lock and proves it.
 */
const PAPER_SETTINGS_SCHEMA: readonly string[] = [
  `
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
  `,
  // CITY-SETUP final slice: mirrors migrations/0022_paper_settings_onboarded.sql
  `alter table paper_settings add column if not exists onboarded boolean not null default false`,
  // CITY-SETUP release-walkthrough Critical fix: mirrors migrations/0024_paper_settings_editor_email.sql
  `alter table paper_settings add column if not exists editor_email text`,
  // Unit P item 5: mirrors migrations/0088_paper_settings_named_outlets.sql
  `alter table paper_settings add column if not exists named_outlets jsonb`,
  // Unit W item 3: mirrors migrations/0089_paper_settings_named_outlets_revision.sql
  `alter table paper_settings add column if not exists named_outlets_revision integer not null default 0`,
];

export async function ensurePaperSettingsSchema() {
  await ensureSchemaOnce(await getSql(), "paper-settings", PAPER_SETTINGS_SCHEMA);
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
    editorEmail: EDITOR_EMAIL,
    namedOutlets: NAMED_OUTLETS.map((o) => ({ ...o, aliases: [...o.aliases], domains: [...o.domains] })),
  };
}

/*
  CITY-SETUP release-walkthrough Blocker fix.

  What an install shows to the PUBLIC before anyone has completed first-run
  setup. Never a real town's identity: a fresh database with no
  `paper_settings` row used to fall through defaultConfig() -- the shipped
  Longmont constants -- straight to the public site, not just the owner's
  desk. A brand-new install's masthead read "TownReporter — Longmont,
  Colorado", its nav linked https://longmontcitycouncil.org/, and the
  migration-seeded welcome article read as Longmont's own paper introducing
  itself -- all before anyone had claimed the desk.

  `onboarded` is the signal for "has an owner actually run setup" --
  migrations/0023_paper_settings_onboard_existing.sql marks any install that
  already had a claimed newsroom onboarded, so this placeholder only ever
  reaches a genuinely unconfigured install; the existing production paper
  (onboarded via that migration) is untouched.
*/
const UNCONFIGURED_PAPER_CONFIG: PaperConfig = {
  name: "TownReporter",
  city: "",
  state: "",
  location: "Not yet set up",
  timezone: "UTC",
  tagline: "This installation has not been configured yet.",
  kicker: "Awaiting setup",
  deck:
    "This paper hasn't been set up yet. An editor needs to sign in and complete first-run setup before real coverage appears here.",
  trust: "Awaiting setup.",
  councilVotesUrl: "",
  youtubeChannels: [],
  meetingKeywords: [],
  seedSources: [],
  editorEmail: null,
  /*
    No outlets, like the other lists above: this shape is what a
    not-yet-configured install shows the PUBLIC, and the named-outlet gate
    never reads it (getPaperConfig is the desk-only read performPublish uses).
  */
  namedOutlets: [],
};

/**
 * The PaperConfig the public site (and only the public site) may render:
 * the real, live-merged config once the owner has completed first-run
 * setup, or the neutral placeholder above until then. Every caller that
 * serves the anonymous internet -- getPaperIdentityFn, the RSS feed, and
 * every function in src/lib/news/public.ts -- goes through this, not
 * getPaperConfig() directly, which stays the desk-only "current config,
 * defaults and all" read used to prefill the setup form.
 */
export async function getPublicPaperConfig(
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<PaperConfig> {
  if (!(await isOnboarded(newsroomId))) return UNCONFIGURED_PAPER_CONFIG;
  return getPaperConfig(newsroomId);
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
    /*
      An empty string here means "this paper has no council-votes site", the
      same way an empty list means none. Only a NULL column -- never set --
      falls back to the shipped Longmont address.
    */
    councilVotesUrl:
      row.council_votes_url === null || row.council_votes_url === undefined
        ? base.councilVotesUrl
        : row.council_votes_url.trim(),
    youtubeChannels: asStringArray(row.youtube_channels) ?? base.youtubeChannels,
    meetingKeywords: asStringArray(row.meeting_keywords) ?? base.meetingKeywords,
    seedSources: asSeedSources(row.seed_sources) ?? base.seedSources,
    /*
      An empty list is an answer, exactly as an empty seed_sources is ("this
      newsroom credits no outlets"), and only a NULL column -- nothing stored
      -- falls back to the shipped list. A malformed value falls back too; see
      asNamedOutlets. A gate that stops firing over a typo in a stored row is
      worse than one that checks the shipped outlets.
    */
    namedOutlets: asNamedOutlets(row.named_outlets) ?? base.namedOutlets,
    /*
      Same rule as councilVotesUrl: an empty string is a real answer ("this
      paper has no editor contact address"), which lets an owner turn off an
      inherited build-time address. Only a NULL column -- never set -- falls
      back to EDITOR_EMAIL.
    */
    editorEmail:
      row.editor_email === null || row.editor_email === undefined
        ? base.editorEmail
        : row.editor_email.trim() || null,
  };
}

async function loadPaperConfig(newsroomId: number): Promise<PaperConfig> {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  const rows = await sql<PaperSettingsRow>`
    select name, city, state, location, timezone, tagline, kicker, deck, trust,
           council_votes_url, youtube_channels, meeting_keywords, seed_sources,
           named_outlets, editor_email
    from paper_settings
    where newsroom_id = ${newsroomId}
    limit 1
  `;
  return mergeRow(rows[0], defaultConfig());
}

/*
  No cache. Deliberately.

  This was an AsyncLocalStorage request cache, which put `node:async_hooks`
  in the client graph and broke every desk page. Its replacement -- a plain
  Map with a short TTL -- then served a stale RSS channel title reading
  "TownReporter, Longmont" from a paper that had just been set up as the
  Riverbend Record: the built server splits this module across chunks, so the
  copy that saved and cleared the entry was not the copy the feed read from.

  The read is one indexed lookup on a single row. Two attempts to make it
  cheaper both produced a paper displaying the wrong city, which is the one
  thing this whole feature exists to prevent. It reads fresh.
*/

/**
 * The paper's live configuration: the newsroom's `paper_settings` row,
 * field-by-field, falling back to the shipped constants (PAPER,
 * COUNCIL_VOTES_URL, SEED_SOURCES, MEETING_KEYWORDS, LONGMONT_YOUTUBE_CHANNELS)
 * wherever a column is null or the row does not exist.
 */
export async function getPaperConfig(newsroomId: number = DEFAULT_NEWSROOM_ID): Promise<PaperConfig> {
  return loadPaperConfig(newsroomId);
}

/**
 * The county this paper covers, from the desk's place fields.
 *
 * `dark_settings.county` is the column the desk's own place read uses
 * (`readDarkPlace`, dark.ts): the owner typed a county in Paper setup and the
 * public geography pill row should say it rather than the generic word
 * "County" (unit BX). It is read here because the public identity is fetched
 * once per page load and the pills are a reader surface.
 *
 * Two things are deliberately not fatal. A database that has not created
 * `dark_settings` yet, and an owner who has never typed a county, both mean the
 * same thing to a reader: no county to name, so the pill keeps "County".
 */
async function readCounty(newsroomId: number): Promise<string | null> {
  const sql = await getSql();
  const rows = await sql<{ county: string | null }>`
    select county from dark_settings where newsroom_id = ${newsroomId} limit 1
  `.catch(() => [] as { county: string | null }[]);
  return rows[0]?.county?.trim() || null;
}

/** The three place fields of a paper's identity, read the one way. City and
 * state are always strings here (the config read has already defaulted them);
 * only the county can be missing, and then it is null rather than absent --
 * `PaperIdentity.county` and the matcher's NewsroomPlace both read it that
 * way. */
async function paperPlaceFor(
  cfg: PaperConfig,
  newsroomId: number,
): Promise<{ city: string; state: string; county: string | null }> {
  /*
    The county is read for an install that has finished first-run setup only.
    An install that has not got that far names no city, no state and no
    county -- the placeholder above -- so there is no place to look a county
    up FOR, and a county alone would scope a paper that never said where it
    is.
  */
  const county = (await isOnboarded(newsroomId)) ? await readCounty(newsroomId) : null;
  return { city: cfg.city, state: cfg.state, county };
}

/**
 * Where this newsroom is: the city and state it is set up for, and the county
 * its owner typed into Paper setup.
 *
 * Unit U26b (2026-09-30): this is the one read for "the paper's own place",
 * and it is deliberately the SAME source the public identity uses (the block
 * below) rather than a second lookup that could drift from it. The lead
 * matcher and the Queue's "Looks already printed" chip take it as a `place`
 * parameter (see NewsroomPlace in ./lead-match.ts) so that a paper set up for
 * another town stops treating Longmont's region as its own furniture -- the
 * class of bug ENG-3 removed from the desk's searches, which the matcher
 * still had because it read the shipped constants directly.
 *
 * A paper that has named no place gets no place words at all. Nothing here
 * guesses a region: `getPublicPaperConfig` answers with the neutral
 * placeholder until the owner has completed setup, and a county nobody typed
 * is null.
 */
export async function getPaperPlace(
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<NewsroomPlace> {
  return paperPlaceFor(await getPublicPaperConfig(newsroomId), newsroomId);
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
    // Public-facing: goes through getPublicPaperConfig(), not
    // getPaperConfig(), so an install that has not completed first-run
    // setup never serves the shipped Longmont identity to the internet.
    const cfg = await getPublicPaperConfig();
    /*
      Same reads as `getPaperPlace` above, and the same rule: the county is
      public-facing too, so it is only read for an install that has finished
      first-run setup: the neutral placeholder above names no county, and
      neither does an install that never got that far.
    */
    const { county } = await paperPlaceFor(cfg, DEFAULT_NEWSROOM_ID);
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
      county,
      editorEmail: cfg.editorEmail,
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
  editorEmail: string | null;
  namedOutlets: NamedOutlet[] | null;
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
  editorEmail: "editor_email",
  namedOutlets: "named_outlets",
};

const JSONB_FIELDS = new Set<keyof PaperConfigPatch>([
  "youtubeChannels",
  "meetingKeywords",
  "seedSources",
  "namedOutlets",
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
export async function isOnboarded(newsroomId: number): Promise<boolean> {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  const rows = await sql<{ onboarded: boolean | null }>`
    select onboarded from paper_settings where newsroom_id = ${newsroomId} limit 1
  `;
  return rows[0]?.onboarded === true;
}

/*
  SG1 / Option A: an install that has not been set up must not spend.

  A fresh install that nobody has set up has NO town. Every read on the desk
  falls back to the shipped Longmont constants there (`defaultConfig()`), so a
  first scan on an un-set-up install searches the wrong town and spends credit.
  Until the owner finishes Paper setup, the desk REFUSES to start a scan, a
  Dark Desk run or a draft.

  ONE CHECK, ONE PLACE. Every gated entry point calls `requirePaperSetUp`
  (or its non-throwing twin `paperSetUpRefusal`); nothing else re-implements
  the rule, so there is one sentence to change and one thing to test.

  IT READS `onboarded` AND NOTHING ELSE. Never "is the city filled in". The
  live database has ONE paper_settings row with `onboarded = true` and name,
  city and state EMPTY, and `mergeRow` folds those blanks into the shipped
  Longmont values -- so a gate that asked about the city would refuse the live
  paper, which is the outage this whole unit must not cause. See
  `paper-live-shape.test.ts` and `paper-setup-gate.test.ts`.
*/

/** The refusal an un-set-up install gets, with the action it refused. One sentence. */
export function PAPER_NOT_SET_UP_SENTENCE(action: string): string {
  return `This paper has not been set up yet. Finish Paper setup first (Server > Paper setup), then ${action}.`;
}

/**
 * The refusal when the desk could not even ASK. FAIL CLOSED: the same rule the
 * Server panel's Paper-setup section follows (ops-panels.tsx) -- "I could not
 * check whether this paper is set up" is not "it is set up", and treating a
 * read error as a pass is exactly how an un-set-up install would spend on
 * Longmont's behalf.
 */
export function PAPER_SETUP_UNCHECKABLE_SENTENCE(action: string): string {
  return `The desk could not check whether this paper has been set up yet, so it will not ${action}. Reload the page and try again.`;
}

/** The refusal a gated action throws. `paperNotSetUp` is a flag, not `instanceof`:
 *  a class extending Error loses its prototype when downlevelled to ES5, which
 *  is what the desk's DOM harness does (see DeskFollowUpError in desk-action.ts). */
export class PaperNotSetUpError extends Error {
  readonly paperNotSetUp = true as const;
  constructor(message: string) {
    super(message);
    this.name = "PaperNotSetUpError";
  }
}

export function isPaperNotSetUpError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { paperNotSetUp?: unknown }).paperNotSetUp === true
  );
}

/**
 * THE check: has this newsroom finished first-run setup? Throws
 * `PaperNotSetUpError` if not, and throws it too if the answer could not be
 * read at all (fail closed).
 *
 * `readOnboarded` is a seam for tests (and only for tests): production passes
 * nothing and the read is `isOnboarded`.
 */
export async function requirePaperSetUp(
  newsroomId: number,
  action: string,
  readOnboarded: (newsroomId: number) => Promise<boolean> = isOnboarded,
): Promise<void> {
  let onboarded: boolean;
  try {
    onboarded = await readOnboarded(newsroomId);
  } catch {
    throw new PaperNotSetUpError(PAPER_SETUP_UNCHECKABLE_SENTENCE(action));
  }
  if (!onboarded) throw new PaperNotSetUpError(PAPER_NOT_SET_UP_SENTENCE(action));
}

/**
 * The same check for the handlers that answer `{ ok: false, error }` rather
 * than throwing: the refusal sentence, or null when the action may start.
 */
export async function paperSetUpRefusal(
  newsroomId: number,
  action: string,
  readOnboarded?: (newsroomId: number) => Promise<boolean>,
): Promise<string | null> {
  try {
    await requirePaperSetUp(newsroomId, action, readOnboarded);
    return null;
  } catch (err) {
    if (isPaperNotSetUpError(err)) return (err as Error).message;
    throw err;
  }
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
  /** Blank is a real answer: this paper has no council-votes site. */
  councilVotesUrl: string;
  /** Blank is a real answer: no address is shown at all. */
  editorEmail: string;
  watchlist: SeedSource[];
  youtubeChannels: string[];
  meetingKeywords: string[];
};

export function cleanSetupInput(raw: unknown): FirstRunSetupInput {
  const v = (raw ?? {}) as Partial<FirstRunSetupInput>;
  /*
    Every field below is unbounded otherwise, and this is the only thing in
    front of `savePaperConfig` on the setup path -- which writes whatever it is
    handed into a text column with no length check of its own
    (paper-settings.ts:359-399). So a setup post could put megabytes into the
    paper's own row, and every later read of that row (the reader-facing
    config, the editor page, the welcome article) would carry it forward.
  */
  const cut = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
  /*
    Two fields are not display text: half a URL and half an address are both
    worse than none, and blank is already a documented real answer for each
    (see the type above). Those two go blank past the ceiling instead of being
    cut to a value that would be printed as if it were real.
  */
  const cutOrBlank = (value: unknown, max: number) => {
    const text = String(value ?? "").trim();
    return text.length > max ? "" : text;
  };
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
        .filter((s) => s.url.length > 0 && s.url.length <= LIMITS.url)
        .slice(0, LIMITS.watchlistEntries)
        .map((s) => ({ ...s, title: s.title.slice(0, LIMITS.seedTitle) }))
    : [];
  const cleanStringList = (value: unknown, entries: number, itemMax: number) =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, entries)
          .map((item) => item.slice(0, itemMax))
      : [];
  return {
    name: cut(v.name, LIMITS.paperName),
    city: cut(v.city, LIMITS.paperCity),
    state: cut(v.state, LIMITS.paperState),
    timezone: cut(v.timezone, LIMITS.timezone),
    tagline: cut(v.tagline, LIMITS.tagline),
    councilVotesUrl: cutOrBlank(v.councilVotesUrl, LIMITS.url),
    editorEmail: cutOrBlank(v.editorEmail, LIMITS.email),
    watchlist,
    youtubeChannels: cleanStringList(
      v.youtubeChannels,
      LIMITS.channelOrKeywordEntries,
      LIMITS.listItem,
    ),
    meetingKeywords: cleanStringList(
      v.meetingKeywords,
      LIMITS.meetingKeywordEntries,
      LIMITS.meetingKeyword,
    ),
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
        /*
          Derived, not asked for.

          The kicker and the deck are the two lines a reader sees first, and
          both name the city. Leaving them unset meant a paper set up as the
          Riverbend Record still opened with "Independent civic reporting ·
          Longmont" above "TownReporter follows Longmont's meetings" -- the
          front page contradicting its own masthead. Asking the owner to
          compose them would be three more fields answering to the same two
          facts they have already given, so they are written from the name
          and the city. The Server page can still edit them afterwards.
        */
        // Always written, even blank: blank means this paper has no council
        // site, and must not inherit Longmont's.
        councilVotesUrl: data.councilVotesUrl ?? "",
        // Stored even when blank: an empty column means "show no address at
        // all", while NULL would fall back to the build-time email -- which
        // on a shared build can belong to another town entirely.
        editorEmail: data.editorEmail ?? "",
        kicker: `Independent civic reporting  ·  ${data.city}`,
        deck: `${data.name} follows ${data.city}'s meetings, money, contracts and public records — then keeps digging when something changes, disappears or doesn't add up. Non-profit. Human-edited. Sources shown.`,
        seedSources: data.watchlist,
        youtubeChannels: data.youtubeChannels,
        meetingKeywords: data.meetingKeywords,
      });

      await ensurePaperSettingsSchema();
      const sql = await getSql();
      await sql`
        update paper_settings set onboarded = true, updated_at = now()
        where newsroom_id = ${me.newsroomId}
      `;

      await writeWelcomeArticle(me.newsroomId, cfg);

      return { ok: true as const };
    } catch (err) {
      if (err instanceof ForbiddenError) return { ok: false as const, error: err.message };
      throw err;
    }
  });
