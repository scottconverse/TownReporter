/**
 * Importing finished stories: the server half.
 *
 * `import-stories.ts` reads a paste into cards; this file turns the ticked
 * cards into rows. Three things it will not do:
 *
 * 1. It never invents text. Every body paragraph and dek is re-checked against
 *    the paste with `containsVerbatim` BEFORE it is stored -- the same check
 *    the deterministic reader applies to a model's reply. A card that fails
 *    that test is refused by name and nothing is written for it, because a
 *    silently "tidied" sentence is the one failure a newsroom cannot see.
 *
 * 2. It never calls a model unless the deterministic reader found no stories.
 *    `readImportStructure` exists for the "none" case only; the caller reaches
 *    it from the review screen, and it asks ONE question (which paragraphs
 *    belong to which story), never for prose.
 *
 * 3. It never publishes. Leads land `new` (or `held` for a Hold), drafts are
 *    saved, and the ordinary Publish button is the only way out.
 *
 * The captures of the cited pages run afterwards and best-effort, through the
 * desk's existing supplied-source capture (`ingestDocument` +
 * `story_documents`) so the story editor sees what the sources actually said.
 * A page that will not load is counted, not stored, and never blocks the
 * import: the source link is already on the story, which is what a reader
 * checks.
 */

import { createHash } from "node:crypto";
import { getSql, type Sql } from "../db.ts";
import { grokChat, probeProvider, parseJsonBlock } from "./ai.ts";
import { runPinnedCallWithFailover } from "./desk-model-run.ts";
import { storyModelChoice, type StoryModelChoice } from "./model-choice.ts";
import { modelEffort, type ModelEffort } from "./provider-registry.ts";
import { audit } from "./ops.ts";
import { provenanceFromUrls } from "./findings.ts";
import { sanitizePublicUrls } from "./schema.ts";
import { ingestDocument } from "./ingest.ts";
import { ensureStoryDocuments, storeStoryDocument } from "./story-documents.server.ts";
import {
  STRUCTURE_SYSTEM,
  containsVerbatim,
  CLEAN_SPLIT_FLAG,
  disclosureLine,
  fallbackSingleStory,
  splitParagraphs,
  structureUserPrompt,
  verifyModelSplit,
  type DisclosureKey,
  type ImportedStory,
} from "./import-stories.ts";

/** `leads.origin` for a story read out of a report the editor pasted. */
export const IMPORT_ORIGIN = "import";

/** How many cited pages one import fetches in the background. */
const CAPTURE_LIMIT = 12;
const CAPTURE_TIMEOUT_MS = 12_000;

/** One cited page to fetch, on the lead whose story cites it. */
export type CaptureTarget = { url: string; headline: string; leadId: number };

/* ------------------------------------------------------------------ *
 * The one model call: structure only, checked word for word.
 * ------------------------------------------------------------------ */

export type StructureResult = {
  stories: ImportedStory[];
  /** "model" = the model's split was accepted; "fallback" = one flagged story. */
  method: "model" | "fallback";
  /** Why a story or a whole split was refused, worded for the desk. */
  reason: string;
  rejected: number;
  /** A technical failure of the call itself, when there was one. */
  error: string;
  /** Set when Automatic moved the call to another ready provider. */
  switchedTo: string;
};

/**
 * Ask a model for the structure of a paste that has none.
 *
 * The newsroom's own picker decides the model, and Automatic keeps the same
 * fail-over every other AI call in this desk gets (`runPinnedCallWithFailover`
 * over `planAutomaticFailover`) -- a lapsed login or a timeout moves the
 * unfinished call one rung, a content refusal stops it.
 *
 * `chat` and `probe` are injectable so a test can drive this without a real
 * provider; everything else about the path is the real one.
 */
export async function readImportStructure(
  input: {
    text: string;
    newsroomId: number;
    modelChoice?: unknown;
    modelEffort?: unknown;
  },
  deps: { chat?: typeof grokChat; probe?: typeof probeProvider } = {},
): Promise<StructureResult> {
  const empty: StructureResult = {
    stories: [],
    method: "fallback",
    reason: "",
    rejected: 0,
    error: "",
    switchedTo: "",
  };
  const text = String(input.text ?? "");
  if (!text.trim()) {
    return { ...empty, error: "There is no text to read." };
  }
  const chat = deps.chat ?? grokChat;
  const probe = deps.probe ?? probeProvider;
  const choice = storyModelChoice(input.modelChoice);
  const effort = choice === "auto" ? null : modelEffort(choice, input.modelEffort);
  let switchedTo = "";

  const attempt = await runPinnedCallWithFailover<
    { modelChoice: StoryModelChoice; modelEffort: ModelEffort | null },
    Awaited<ReturnType<typeof grokChat>>
  >({
    snapshot: { modelChoice: choice, modelEffort: effort },
    source: choice === "auto" ? "auto" : "editor",
    probe: (next) => probe(next, input.newsroomId, undefined, "story"),
    /*
      Structure, not prose: the reply is the report's own paragraphs with the
      boundaries marked, so the ceiling is the size of the paste rather than a
      writer's answer. A report too big for this budget still loses nothing --
      the split is refused and the editor gets the whole paste as one card.
    */
    run: (snapshot) =>
      chat(STRUCTURE_SYSTEM, structureUserPrompt(text), 8000, {
        choice: snapshot.modelChoice,
        newsroomId: input.newsroomId,
        timeoutMs: 180_000,
        noTools: true,
        reasoningEffort: snapshot.modelEffort,
      }),
    resolve: async (next) => ({ modelChoice: next, modelEffort: modelEffort(next, effort) }),
    onSwitch: async ({ nextChoice }) => {
      switchedTo = nextChoice;
    },
  });

  const result = attempt.result;
  if (!result.ok) {
    const error = String("error" in result ? result.error : "") || "The model call failed.";
    return {
      ...empty,
      error,
      switchedTo,
      stories: [fallbackSingleStory(text, { reason: CLEAN_SPLIT_FLAG })],
    };
  }

  const parsed = parseJsonBlock<unknown>(String(result.text ?? ""));
  const verified = verifyModelSplit(text, parsed);
  if (verified.stories.length === 0) {
    return {
      ...empty,
      rejected: verified.rejected,
      reason: verified.reason || CLEAN_SPLIT_FLAG,
      switchedTo,
      stories: [fallbackSingleStory(text, { reason: verified.reason || undefined })],
    };
  }
  return {
    stories: verified.stories,
    method: "model",
    reason: verified.reason,
    rejected: verified.rejected,
    error: "",
    switchedTo,
  };
}

/* ------------------------------------------------------------------ *
 * Importing the ticked cards.
 * ------------------------------------------------------------------ */

export type ImportSelection = {
  headline: string;
  section: string;
  dek: string;
  body: string;
  links: { text: string; url: string }[];
  score: string;
  triage: string;
  reporterNextStep: string;
  hold: boolean;
  disclosureKey: DisclosureKey;
  disclosureOther: string;
};

export type ImportPayload = {
  text: string;
  tool: string;
  stories: ImportSelection[];
};

export type ImportResult = {
  ok: boolean;
  error: string;
  imported: { leadId: number; headline: string; hold: boolean }[];
  /** Cards refused because the text they carried is not what the editor pasted. */
  refused: { headline: string; reason: string }[];
};

/** What the paste is, for the lead's provenance. Null when the paste is empty. */
export function importInputSha256(text: string): string {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

/**
 * Check every card against the paste as written, before anything is stored.
 *
 * A body paragraph that is not in the paste means the card is carrying text
 * the editor never pasted -- the one thing this feature must never do. The
 * whole card is refused rather than trimmed: a story missing a paragraph is a
 * story an editor would publish without knowing what was cut.
 */
export function verifySelections(
  text: string,
  selections: ImportSelection[],
): { accepted: ImportSelection[]; refused: { headline: string; reason: string }[] } {
  const accepted: ImportSelection[] = [];
  const refused: { headline: string; reason: string }[] = [];
  for (const selection of selections) {
    const headline = String(selection.headline ?? "").trim();
    const paragraphs = splitParagraphs(selection.body);
    if (!headline) {
      refused.push({ headline: "A story with no headline", reason: "Give it a headline first." });
      continue;
    }
    if (paragraphs.length === 0) {
      refused.push({ headline, reason: "This story has no text." });
      continue;
    }
    const outside = paragraphs.filter((p) => !containsVerbatim(text, p));
    const dekOutside =
      selection.dek.trim() && !containsVerbatim(text, selection.dek.trim())
        ? selection.dek.trim()
        : "";
    if (outside.length > 0 || dekOutside) {
      const sample = (outside[0] ?? dekOutside).slice(0, 120);
      refused.push({
        headline,
        reason: `Part of this story is not word-for-word what you pasted: “${sample}”. Nothing was imported for it.`,
      });
      continue;
    }
    accepted.push({ ...selection, headline });
  }
  return { accepted, refused };
}

/** A source URL that is safe to print, or "" -- never half a URL. */
function cleanUrl(url: string): string {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return "";
  try {
    return sanitizePublicUrls([trimmed])[0] ?? "";
  } catch {
    return "";
  }
}

/**
 * File the ticked cards: one lead and one saved draft each, in the Queue.
 *
 * `inputSha256` is computed here from the text that actually arrived, not sent
 * by the client -- provenance that the client could choose is not provenance.
 */
export async function performImportFinishedStories(
  context: { userId: string; newsroomId: number },
  payload: ImportPayload,
  /** Test seam: the background capture is real by default, and a test must not
   * be handed a real network fetch after the test itself has returned. */
  deps: { capture?: typeof captureCitedPages } = {},
): Promise<ImportResult> {
  const empty: ImportResult = { ok: false, error: "", imported: [], refused: [] };
  const text = String(payload.text ?? "");
  if (!text.trim()) return { ...empty, error: "There is no text to import." };

  const { accepted, refused } = verifySelections(text, payload.stories ?? []);
  if (accepted.length === 0) {
    return {
      ...empty,
      refused,
      error: refused[0]?.reason || "Nothing was ticked to import.",
    };
  }

  const sql = await getSql();
  const imported: ImportResult["imported"] = [];
  const captures: CaptureTarget[] = [];
  const inputSha256 = importInputSha256(text);
  const importedAt = new Date().toISOString();

  for (const story of accepted) {
    const urls = sanitizePublicUrls(story.links.map((l) => cleanUrl(l.url)));
    const why = (story.dek.trim() || splitParagraphs(story.body)[0] || story.headline).slice(0, 800);
    const topic = story.section.trim().slice(0, 40);
    const disclosure = disclosureLine(story.disclosureKey, story.disclosureOther);
    const provenance = JSON.stringify({
      importer: context.userId,
      importedAt,
      inputSha256,
      tool: String(payload.tool ?? "").slice(0, 200),
      disclosureKey: story.disclosureKey,
      disclosureLine: disclosure,
      score: story.score,
      triage: story.triage,
    });
    const links = JSON.stringify(
      provenanceFromUrls(
        urls,
        story.links
          .map((l) => ({ url: cleanUrl(l.url), title: String(l.text ?? "").slice(0, 200) }))
          .filter((l) => urls.includes(l.url)),
      ),
    );

    const [lead] = await sql<{ id: number }>`
      insert into leads (
        user_id, newsroom_id, headline, why, topic, source_urls, evidence, newsworthiness,
        status, origin, provenance_json
      ) values (
        ${context.userId}, ${context.newsroomId}, ${story.headline.slice(0, 180)}, ${why},
        ${topic || "council"}, ${JSON.stringify(urls)}, ${why.slice(0, 400)}, 0,
        ${story.hold ? "held" : "new"}, ${IMPORT_ORIGIN}, ${provenance}
      ) returning id
    `;
    const leadId = lead?.id;
    if (!leadId) {
      refused.push({ headline: story.headline, reason: "Could not file that story." });
      continue;
    }
    await sql`
      insert into drafts (
        user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls,
        provenance_json, disclosure_text
      ) values (
        ${context.userId}, ${context.newsroomId}, ${leadId}, ${story.headline.slice(0, 240)},
        ${story.dek.trim().slice(0, 4000)}, ${story.body}, ${topic}, ${JSON.stringify(urls)},
        ${links}, ${disclosure}
      )
    `;
    if (story.reporterNextStep.trim()) {
      await sql`
        update leads
        set notes_json = ${JSON.stringify({ editorialAssignment: { origin: "import", text: story.reporterNextStep.trim().slice(0, 1000) } })}
        where id = ${leadId} and newsroom_id = ${context.newsroomId}
      `.catch(() => undefined);
    }
    await audit(context.userId, "lead", `imported ${leadId}`, context.newsroomId);
    imported.push({ leadId, headline: story.headline, hold: story.hold });
    for (const url of urls.slice(0, CAPTURE_LIMIT)) {
      captures.push({ url, headline: story.headline, leadId });
    }
  }

  await audit(
    context.userId,
    "import",
    `${imported.length} ${imported.length === 1 ? "story" : "stories"} read out of a pasted report${
      payload.tool ? ` (${String(payload.tool).slice(0, 80)})` : ""
    }`,
    context.newsroomId,
  );

  /*
    The captures are the last thing, they are best-effort, and they are
    deliberately not awaited: an editor who pasted a report should be looking
    at their Queue, not at a progress bar for a page that may never answer.
  */
  void (deps.capture ?? captureCitedPages)(
    { userId: context.userId, newsroomId: context.newsroomId },
    captures.slice(0, CAPTURE_LIMIT),
  ).catch(() => undefined);

  return { ok: true, error: "", imported, refused };
}

/**
 * Fetch the pages an imported story cites, so the editor can look at what the
 * sources actually said before publishing.
 *
 * This is the same capture path the desk already uses for the links an editor
 * supplies with a new story (`readStoryDocuments` in story-documents.server.ts,
 * its supplied-source block): `ingestDocument` does the fetch — including the
 * YouTube-transcript handling these reports lean on — and the result lands in
 * `story_documents` against the imported lead with `source_url` set, which is
 * exactly where the story editor and the document reader look for it. Nothing
 * new is invented and no second reader is built.
 *
 * What it deliberately does NOT do is the model reading pass: that costs a call
 * per document and produces a draft, and this feature's whole promise is that
 * pasting a finished report runs no AI unless the text has no structure.
 *
 * A page that will not load is counted, not stored, and never throws: a dead
 * link is not the editor's mistake and must not undo an import that already
 * succeeded.
 */
export async function captureCitedPages(
  context: { userId: string; newsroomId: number },
  targets: CaptureTarget[],
  deps: { ingest?: typeof ingestDocument; sql?: Sql } = {},
): Promise<{ captured: number; failed: number }> {
  if (targets.length === 0) return { captured: 0, failed: 0 };
  const sql = deps.sql ?? (await getSql());
  const ingest = deps.ingest ?? ingestDocument;
  await ensureStoryDocuments(sql);
  let captured = 0;
  let failed = 0;
  for (const target of targets) {
    const url = target.url.slice(0, 4000);
    const existing = await sql.query(
      "select id from story_documents where newsroom_id=$1 and source_url=$2",
      [context.newsroomId, url],
    );
    if (existing.length) continue;
    try {
      const got = await withTimeout(
        ingest(url, { newsroomId: String(context.newsroomId) }),
        CAPTURE_TIMEOUT_MS,
      );
      if (!got.ok || !got.text.trim()) {
        throw new Error(got.needsOcrReason || got.outcome);
      }
      const pdf = got.contentType.includes("pdf") && got.rawBytes;
      const stored = await storeStoryDocument(
        context.newsroomId,
        context.userId,
        `${(got.title || target.headline || "Source").slice(0, 200)}.${pdf ? "pdf" : "txt"}`,
        pdf ? "application/pdf" : "text/plain",
        pdf ? got.rawBytes! : new TextEncoder().encode(`SOURCE URL: ${url}\n${got.text}`),
      );
      /*
        `status` is left exactly as `storeStoryDocument` wrote it ("uploaded").
        Nothing has read this document, so marking it read would be a claim the
        row cannot support; left as it is, the story editor's ordinary document
        reading picks these captured pages up when an editor asks for it.
      */
      await sql.query(
        "update story_documents set lead_id=$1,source_url=$2,detail=$3 where id=$4 and newsroom_id=$5",
        [
          target.leadId,
          url,
          `Captured from a source link on the imported story “${target.headline.slice(0, 120)}”.`,
          stored.id,
          context.newsroomId,
        ],
      );
      captured += 1;
    } catch {
      /*
        No document row for a page that did not load. The existing supplied-source
        path (`readStoryDocuments`) throws instead of writing one, and a row with
        no bytes would be a "document" that says nothing while asking the
        document reader to try again. The count goes back to the caller, and the
        source link itself is still on the story.
      */
      failed += 1;
    }
  }
  return { captured, failed };
}

/** A promise that gives up after `ms`, so one slow host cannot stall the rest. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${Math.round(ms / 1000)}s`)), ms),
    ),
  ]);
}
