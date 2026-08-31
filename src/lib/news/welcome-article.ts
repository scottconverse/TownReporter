/*
  CITY-SETUP final slice: rewrite the seeded welcome ARTICLE for the
  configured city at first-run setup time.

  migrations/0002_newsroom.sql seeds one article, slug
  `welcome-to-townreporter`, written about Longmont -- that migration file
  is never touched by this feature, so an existing install that already ran
  it keeps that exact row, byte-identical, unless its owner explicitly runs
  setup (see completeFirstRunSetup in paper-settings.ts, which is the only
  caller of writeWelcomeArticle below). This module only UPDATEs that row
  (or inserts it if, somehow, it is missing) with copy generated from the
  paper's now-configured name/city/state/tagline -- never a new migration.
*/
import { getSql } from "../db.ts";
import type { PaperConfig } from "./paper-settings.ts";

export const WELCOME_SLUG = "welcome-to-townreporter";

function welcomeBody(cfg: PaperConfig): string {
  const { name, city, state, tagline } = cfg;
  return `${name} is a small civic newspaper for ${city}, ${state}. It is not a newsletter mill and it is not an autonomous news robot.

The public site is the paper: headlines, recaps, corrections, and a permanent record of what we chose to print. Behind it sits a desk. An editor-in-chief signs in, points Grok at official sources, reviews every draft, and hits publish. Nothing on this masthead goes live because a model felt confident.

What we cover
The public record for ${city} -- council and public-body meetings, budgets, planning and land use, and the local institutions readers depend on. Public meetings, packets, and notices -- the documents most people never open.

What we will not do
We will not quote social apps as fact. We will not invent votes, dollar figures, or speakers. We will not hide a correction. We will not pretend a video auto-caption is a verbatim transcript; captions are a map of topics, and quotes get checked.

How a story gets here
The editor keeps a source list. On Scan, Grok fetches those pages, compares them to the last snapshot, and files leads. On Draft, it writes a recap with attributed claims and named sources. The editor edits, holds, kills, or publishes. Beat memory records what already ran so the next scan does not reprint yesterday as news.

This first item is the paper introducing itself. The next items will be reported from the live public record, by an editor who can still say no.${tagline ? `\n\n${tagline}` : ""}`;
}

/**
 * Rewrite (or, if it is somehow absent, insert) the newsroom's welcome
 * article to read for the configured city. Idempotent: safe to call again
 * if the owner reruns setup from the Server page.
 */
export async function writeWelcomeArticle(newsroomId: number, cfg: PaperConfig): Promise<void> {
  const sql = await getSql();
  const headline = `A civic paper for ${cfg.city}, ${cfg.state}, edited by a human`;
  const dek = `${cfg.name} watches official records, drafts under wire-service rules, and publishes only what an editor signs.`;
  const body = welcomeBody(cfg);

  const updated = await sql`
    update articles
    set headline = ${headline}, dek = ${dek}, body = ${body}
    where slug = ${WELCOME_SLUG} and newsroom_id = ${newsroomId}
    returning id
  `;
  if (updated.length > 0) return;

  // No seeded row for this newsroom (a fresh newsroom that never ran
  // migrations/0002's seed insert, or a slug someone already changed) --
  // insert one rather than silently doing nothing.
  await sql`
    insert into articles
      (user_id, newsroom_id, slug, headline, dek, body, topic, source_urls, status)
    values
      ('masthead', ${newsroomId}, ${WELCOME_SLUG}, ${headline}, ${dek}, ${body}, 'about', '[]', 'published')
    on conflict (slug) do update set
      headline = excluded.headline, dek = excluded.dek, body = excluded.body
  `;
}
