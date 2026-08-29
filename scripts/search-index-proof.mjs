#!/usr/bin/env node
/**
 * Measure what the archive search costs, with and without its indexes.
 *
 * ENG-008 said the public search was an unindexed `ilike '%q%'` over every
 * published body, reachable by anyone with no session and no rate limit. The
 * fix is migration 0018. This is the measurement behind that claim, kept as a
 * script rather than a sentence in a commit message, so anyone can re-run it.
 *
 * It builds a throwaway database, fills it with 20,000 stories, times the real
 * query, applies the migration verbatim, and times it again. The database is
 * dropped at the end. It never touches the paper's own data.
 *
 *   node scripts/with-app-env.mjs node scripts/search-index-proof.mjs
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(here, "..", "migrations", "0018_search_index.sql");
const SCRATCH = "tr_search_proof";
const ROWS = 20_000;

const QUERY = `
  select id from articles
  where status = 'published' and newsroom_id = 1
    and (headline ilike '%kimbark%' or dek ilike '%kimbark%' or body ilike '%kimbark%')
  order by published_at desc limit 30`;

function adminUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — run this through scripts/with-app-env.mjs");
  const u = new URL(url);
  u.pathname = "/postgres";
  return u.toString();
}

function scratchUrl() {
  const u = new URL(process.env.DATABASE_URL);
  u.pathname = `/${SCRATCH}`;
  return u.toString();
}

async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** The two numbers that matter: wall time, and how much of the table was read. */
async function measure(client, label) {
  await client.query("analyze articles");
  const { rows } = await client.query(`explain (analyze, buffers, format json) ${QUERY}`);
  const plan = rows[0]["QUERY PLAN"][0];
  const ms = plan["Execution Time"];
  const buffers = plan.Plan["Shared Hit Blocks"] + (plan.Plan["Shared Read Blocks"] ?? 0);
  const node = JSON.stringify(plan.Plan).includes("trgm") ? "trigram index" : "scan";
  console.log(`  ${label.padEnd(22)} ${ms.toFixed(2).padStart(8)} ms   ${String(buffers).padStart(6)} buffers   ${node}`);
  return { ms, buffers };
}

await withClient(adminUrl(), async (c) => {
  await c.query(`drop database if exists ${SCRATCH}`);
  await c.query(`create database ${SCRATCH}`);
});

try {
  const result = await withClient(scratchUrl(), async (c) => {
    await c.query(`
      create table articles (
        id serial primary key, newsroom_id int default 1, status text,
        headline text, dek text, body text, published_at timestamptz default now()
      )`);
    await c.query(
      `insert into articles (status, headline, dek, body)
       select 'published', 'Council item ' || g, 'A short dek for item ' || g,
              repeat('The Longmont city council reviewed the packet for item ' || g || '. ', 120)
       from generate_series(1, $1) g`,
      [ROWS],
    );
    await c.query(
      `insert into articles (status, headline, dek, body)
       values ('published', 'Kimbark parcel rezoning', 'the planning board',
               'A hearing on the Kimbark parcel is set.')`,
    );
    console.log(`\n${ROWS.toLocaleString()} published stories, one of them matching:\n`);
    const before = await measure(c, "before (no index)");
    await c.query(await readFile(MIGRATION, "utf8"));
    const after = await measure(c, "after (migration 0018)");
    return { before, after };
  });

  const faster = result.before.ms / result.after.ms;
  const lighter = result.before.buffers / result.after.buffers;
  console.log(`\n  ${faster.toFixed(0)}x faster, ${lighter.toFixed(0)}x fewer buffers read.\n`);
  if (faster < 5) {
    console.error("The index did not help. That is a regression, not a passing run.");
    process.exit(1);
  }
} finally {
  await withClient(adminUrl(), (c) => c.query(`drop database if exists ${SCRATCH}`));
}
