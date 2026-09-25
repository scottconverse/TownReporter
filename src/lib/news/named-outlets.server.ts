/*
  THE OUTLET LIST AS STORED (0.6.63, Unit W).

  Unit P made the list a per-newsroom setting (paper_settings.named_outlets,
  migration 0088) and the gate reads it there. This module is the editor's
  side of the same row, and it is written to mirror the section list
  (sections.server.ts) line for line, because the two have the same blast
  radius and the owner should not have to learn two different editors:

  * readNamedOutlets is getSections: what is stored, what the newsroom's role
    allows, and the shipped list so the panel can say "using the built-in
    list" without knowing the constant itself.

  * saveNamedOutlets is saveSections: validate, then compare-and-swap on a
    revision and refuse a stale one rather than overwrite another tab.

  * the three stored states stay three. NULL is "use the shipped list", an
    empty array is "this paper checks no outlet names", a list is the list.
    The read returns `stored` as exactly the value the gate will read
    (asNamedOutlets, the same parser), so the panel cannot describe a state
    the gate does not act on. A malformed stored value reads as NULL because
    that is what the gate does with it -- showing the owner "built-in list"
    when the gate is checking the built-in list is the truth, however the
    value got there.

  * the owner check is HERE, inside the function, not in the RPC wrapper:
    savePaperConfig does the same, and it is what makes "an editor cannot
    change which outlets the paper checks" testable without a server.

  The preview needs the published stories, so it lives here too and is
  owner-only like apply: the list of stories a change unchecks is as much a
  part of the decision as the change.
*/

import { getSql, withTransaction } from "../db.ts";
import { ForbiddenError, requireEditor } from "./membership.ts";
import { ensurePaperSettingsSchema } from "./paper-settings.ts";
import { asNamedOutlets, type NamedOutlet } from "./outlet-credit.ts";
import { cleanOutletList, outletProblems, shippedOutlets, OUTLET_LIMITS } from "./named-outlet-rules.ts";
import {
  namedOutletPreview,
  type NamedOutletChange,
  type PublishedStory,
} from "./named-outlet-preview.ts";

/**
 * The draft the panel holds, and the draft the RPCs carry: the revision the
 * editor loaded, and the list it wants. `null` means "the shipped list" --
 * the same value the column stores for that answer, so the state cannot be
 * lost in translation between the screen and the row.
 */
export type NamedOutletConfig = {
  revision: number;
  outlets: NamedOutlet[] | null;
};

export type NamedOutletRead = {
  /** May this editor apply a change? Owner only, like the Sections panel. */
  canEdit: boolean;
  /** The current apply token; 0 for a newsroom that has never applied one. */
  revision: number;
  /** What is stored: null = shipped list, [] = checks nothing, else the list. */
  stored: NamedOutlet[] | null;
  /** The shipped list, so the panel can show what "built-in" means. */
  shipped: NamedOutlet[];
};

/**
 * How many published stories the preview reads to answer "which stories does
 * this change uncheck".
 *
 * Not verified at production scale: this is a single newsroom's own published
 * archive and the read is `status='published' order by id desc` on
 * articles_published_idx, but a paper with more than this many published
 * stories would get an impact list that stops at the cap without saying so.
 * The cap is stated here rather than hidden so the next reader can raise it
 * with a keyset read instead of guessing why a story was missing.
 */
export const PUBLISHED_SCAN_CAP = 5000;

const RELOAD_SENTENCE =
  "The outlet list changed while you were editing. Reload the saved list before applying again.";

/**
 * What is stored for this newsroom, read exactly as the gate reads it.
 * `requireEditor` first: the list is desk content, so any editor may look.
 */
export async function readNamedOutlets(userId: string): Promise<NamedOutletRead> {
  const me = await requireEditor(userId);
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  const rows = await sql<{ named_outlets: unknown; named_outlets_revision: number }>`
    select named_outlets, named_outlets_revision
    from paper_settings
    where newsroom_id = ${me.newsroomId}
    limit 1
  `;
  const row = rows[0];
  return {
    canEdit: me.role === "owner",
    revision: row?.named_outlets_revision ?? 0,
    stored: asNamedOutlets(row?.named_outlets) ?? null,
    shipped: shippedOutlets(),
  };
}

/** The list the gate is using right now, for the preview's "before" side. */
async function storedList(newsroomId: number): Promise<NamedOutlet[] | null> {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  const rows = await sql<{ named_outlets: unknown }>`
    select named_outlets from paper_settings where newsroom_id = ${newsroomId} limit 1
  `;
  return asNamedOutlets(rows[0]?.named_outlets) ?? null;
}

/** This newsroom's published stories, newest first, as the preview reads them. */
async function publishedStories(newsroomId: number): Promise<PublishedStory[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    headline: string;
    slug: string;
    body: string;
    source_urls: string | null;
  }>`
    select id, headline, slug, body, source_urls
    from articles
    where newsroom_id = ${newsroomId} and status = 'published'
    order by id desc
    limit ${PUBLISHED_SCAN_CAP}
  `;
  return rows.map((row) => ({
    id: row.id,
    headline: row.headline,
    slug: row.slug,
    body: row.body,
    sourceUrls: parseUrls(row.source_urls),
  }));
}

/** source_urls is a text column holding a JSON array; anything else covers nothing. */
function parseUrls(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * What applying `input` would change, and which published stories it would
 * stop the paper checking. Owner-only, and a read: it never writes.
 *
 * The "before" side is what is stored NOW, not the revision the caller sent.
 * A stale tab must see the difference it is actually about to make.
 */
export async function previewNamedOutlets(
  userId: string,
  input: NamedOutletConfig,
): Promise<{
  revision: number;
  usingShipped: boolean;
  changes: NamedOutletChange[];
  /** How many published stories were read to look for the impact. */
  scanned: number;
}> {
  const me = await requireEditor(userId);
  if (me.role !== "owner") {
    throw new ForbiddenError("Only the owner can change which outlets the paper checks.");
  }
  const stored = await storedList(me.newsroomId);
  const read = await readNamedOutlets(userId);
  const stories = await publishedStories(me.newsroomId);
  const savedList = stored ?? shippedOutlets();
  // Cleaned the same way apply will clean it, so the preview promises the
  // change the owner is about to get rather than the keystrokes they typed.
  const draftList = input.outlets === null ? shippedOutlets() : cleanOutletList(input.outlets);
  return {
    revision: read.revision,
    usingShipped: input.outlets === null,
    changes: namedOutletPreview(savedList, draftList, stories),
    scanned: stories.length,
  };
}

/**
 * Store `input` and move the revision on, refusing a stale one.
 *
 * Validation happens before the transaction and refuses with the first
 * problem's own sentence: the panel shows the same sentences under the row
 * that raised them, so an apply that fails says what the owner has to fix.
 */
export async function saveNamedOutlets(
  userId: string,
  input: NamedOutletConfig,
): Promise<NamedOutletConfig> {
  const me = await requireEditor(userId);
  if (me.role !== "owner") {
    throw new ForbiddenError("Only the owner can change which outlets the paper checks.");
  }
  const revision = input?.revision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
    throw new Error("The outlet list could not be read. Reload the page and try again.");
  }
  if (input.outlets !== null && !Array.isArray(input.outlets)) {
    throw new Error("The outlet list could not be read. Reload the page and try again.");
  }

  await ensurePaperSettingsSchema();
  /*
    Validate what the owner typed, then store the cleaned version of it.
    The order matters: cleanOutletList drops a blank row and folds duplicates
    away, so a draft that says "name this row" would look fine if it were
    cleaned first. The refusal has to be about the draft on the screen.
  */
  const outlets = input.outlets === null ? null : cleanOutletList(input.outlets);
  if (input.outlets !== null) {
    if (input.outlets.length > OUTLET_LIMITS.outlets) {
      throw new Error(`A list can hold up to ${OUTLET_LIMITS.outlets} outlets.`);
    }
    const problems = outletProblems(input.outlets);
    if (problems.length) throw new Error(problems[0].text);
  }

  const next = await withTransaction(async (sql) => {
    /*
      FOR UPDATE, then compare, then write: the section list's compare-and-swap
      (sections.server.ts saveSections). Two owners applying at the same moment
      serialize here, and the second one is refused rather than silently
      winning -- which matters because "the list the owner last saw" is the
      only thing they can reason about.
    */
    const rows = await sql<{ named_outlets_revision: number }>`
      select named_outlets_revision from paper_settings
      where newsroom_id = ${me.newsroomId}
      for update
    `;
    const current = rows[0]?.named_outlets_revision ?? 0;
    if (current !== revision) throw new Error(RELOAD_SENTENCE);

    const value = outlets === null ? null : JSON.stringify(outlets);
    await sql`
      insert into paper_settings (newsroom_id, named_outlets, named_outlets_revision)
      values (${me.newsroomId}, ${value}, ${current + 1})
      on conflict (newsroom_id) do update set
        named_outlets = excluded.named_outlets,
        named_outlets_revision = excluded.named_outlets_revision,
        updated_at = now()
    `;
    return current + 1;
  });

  return { revision: next, outlets };
}
