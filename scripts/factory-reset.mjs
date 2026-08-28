// @ts-check
/**
 * One-shot reset of the existing Longmont grok.me paper.
 *
 * Not a public route. Not a SQL file in migrations/ (those re-run for every
 * self-hoster on first migrate). Runs from scripts/migrate.mjs after schema
 * files, only when the live fingerprint slugs are still in `articles`, and
 * records itself in `_migrations` so a later deploy keeps the new paper.
 *
 * Preview PGLite never hits this path (no DATABASE_URL). A clone without those
 * two stories is left alone.
 */

export const FACTORY_RESET_MARKER = "ops_factory_reset_20260828";

/** Stories that exist only on the populated grok.me box as of 28 Aug 2026. */
export const FINGERPRINT_SLUGS = [
  "longmont-church-commits-40-000-toward-san-lazaro-park-resident-purchase",
  "council-books-six-hour-airport-vision-session-sept-26-at-375-airport-roa",
];

/**
 * App + auth tables. `_migrations` (schema bookkeeping) and `newsrooms`
 * (the appliance row) stay.
 */
export const WIPE_TABLES = [
  "artifact_blobs",
  "artifact_chunks",
  "artifact_versions",
  "capture_events",
  "investigation_entities",
  "entity_aliases",
  "entity_matches",
  "source_monitors",
  "search_attempts",
  "search_log",
  "frontier_items",
  "artifacts",
  "claims",
  "hypotheses",
  "anomalies",
  "dead_ends",
  "relationships",
  "entities",
  "recurring_baselines",
  "investigations",
  "dark_promises",
  "dark_signals",
  "dark_runs",
  "desk_jobs",
  "desk_rate",
  "audit_events",
  "snapshots",
  "scan_runs",
  "drafts",
  "corrections",
  "beat_memory",
  "leads",
  "articles",
  "sources",
  "subscribers",
  "newsroom_members",
  "session",
  "account",
  "verification",
  "user",
];

/**
 * @param {{ applied: string[], presentSlugs: string[] }} args
 */
export function shouldFactoryReset({ applied, presentSlugs }) {
  if (applied.includes(FACTORY_RESET_MARKER)) return false;
  const have = new Set(presentSlugs);
  return FINGERPRINT_SLUGS.every((slug) => have.has(slug));
}

/**
 * @param {string} name
 */
export function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

export const WELCOME_HEADLINE = "A civic paper for Longmont, edited by a human";
export const WELCOME_DEK =
  "The public record is only the beginning. TownReporter follows Longmont meetings, money and contracts — then keeps digging.";
export const WELCOME_BODY = `TownReporter is a civic newsroom for Longmont, Colorado. The public site is the paper: reported stories, exact sources, and a record of what an editor chose to print.

The watch list is where reporting starts, not where it stops. TownReporter watches known civic sources, notices when documents change or disappear, follows names, contracts, packets and prior meetings, and keeps copies of what it finds. Dark Desk is the recursive investigative lane. A human editor still decides what publishes.

What we cover
City Council and study sessions. Planning, housing, and land use. NextLight and municipal utilities. St. Vrain Valley Schools when the record is public. Boulder County business that lands in Longmont.

What we will not do
We will not quote neighborhood apps as fact. We will not invent votes, dollar figures, or speakers. We will not hide a correction. We will not pretend a YouTube auto-caption is a verbatim transcript.

Free to reprint in whole or part with credit to TownReporter and a link back. Do not imply endorsement.`;

/**
 * @typedef {{ query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }} PgClient
 */

/**
 * @param {PgClient} client
 * @param {string[]} applied
 * @returns {Promise<boolean>}
 */
export async function maybeFactoryReset(client, applied) {
  if (applied.includes(FACTORY_RESET_MARKER)) {
    console.log("[migrate] factory reset already recorded — skip.");
    return false;
  }

  const tablesRes = await client.query(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'",
  );
  const have = new Set(tablesRes.rows.map((r) => String(r.tablename)));
  if (!have.has("articles")) {
    console.log("[migrate] factory reset: no articles table — skip.");
    return false;
  }

  const slugRes = await client.query("SELECT slug FROM articles WHERE slug = ANY($1::text[])", [
    FINGERPRINT_SLUGS,
  ]);
  const presentSlugs = slugRes.rows.map((r) => String(r.slug));
  if (!shouldFactoryReset({ applied, presentSlugs })) {
    console.log("[migrate] factory reset fingerprint miss — skip.");
    return false;
  }

  const toWipe = WIPE_TABLES.filter((t) => have.has(t));
  await client.query("BEGIN");
  try {
    if (toWipe.length > 0) {
      await client.query(
        `TRUNCATE TABLE ${toWipe.map(quoteIdent).join(", ")} RESTART IDENTITY CASCADE`,
      );
    }
    if (have.has("newsrooms")) {
      await client.query(
        "INSERT INTO newsrooms (id, name) VALUES (1, 'TownReporter Longmont') ON CONFLICT (id) DO NOTHING",
      );
    }
    await client.query(
      `INSERT INTO articles (user_id, slug, headline, dek, body, topic, source_urls, status)
       VALUES ('masthead', 'welcome-to-townreporter', $1, $2, $3, 'about', '[]', 'published')`,
      [WELCOME_HEADLINE, WELCOME_DEK, WELCOME_BODY],
    );
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [FACTORY_RESET_MARKER]);
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection died — keep the original error */
    }
    throw err;
  }
  console.log("[migrate] factory reset applied — paper empty, desk unclaimed.");
  return true;
}
