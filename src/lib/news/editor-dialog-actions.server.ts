import { editorWarning, type EditorWarningResult } from "./editor-override.ts";
import { paperSetupWarning } from "./paper-settings.ts";
import { checkRate } from "./ops.ts";
/**
 * The server half of the editor's new dialogs (Unit BK).
 *
 * Every function here is a `perform*` with the `createServerFn` shells left in
 * `editor-dialog-actions.ts`. The split is the one the rest of the newsroom
 * uses (`model-request-commit.server.ts` and its callers) for one reason: the
 * `createServerFn` shells cannot be imported by a `node --test` file, and the
 * decisions in here -- which lead the score was written to, whether the kill
 * pattern counted the right reason, what the confirm press actually saves --
 * are exactly the decisions that have to be tested with a fake model and a
 * database that is not there.
 *
 * NOTHING IN HERE INVENTED A MODEL CALL. Five of the six go through
 * `resolveJobModel` and hand the resolved provider to `deps.chat`, which is
 * `grokChat` unless a test replaced it. The sixth (`sourceKillPattern`) reads
 * and never writes; it is the one the brief asks for by name -- "show the
 * pattern only, never change weights".
 *
 * WHY NO MIGRATION 0102. The Hold dialog is the only one that wanted a column
 * (`hold_reason`, `held_at`), and `leads` is hand-built by twenty-nine test
 * files (the real `migrations/0002_newsroom.sql` plus twenty-eight copies), so
 * adding a column means editing all of them to apply the migration from disk
 * for a single optional note that nothing queries. `leads.notes_json` already
 * carries structured reporting notes through `parseNotes`/`packNotes`, so the
 * hold reason goes there, stamped with its own time. The deviation is recorded
 * in the unit's report rather than hidden.
 */
import { getSql, type Sql } from "../db.ts";
import { grokChat, type EffectiveProviderChoice, type LocalModelOverride } from "./ai.ts";
import { storableText } from "./storable-text.ts";
import type { StoryModelChoice } from "./model-choice.ts";
import {
  cleanJobEffort,
  resolveJobModel,
  type JobModelResolution,
  type ModelAssignmentRow,
} from "./model-assignments.ts";
import { readModelAssignments } from "./model-assignments-store.ts";
import { resolveLocalModelChoice } from "./provider-settings.ts";
import { saveDraftForEditor, type DraftEditInput } from "./draft-edit.server.ts";
import { beatsForSource, replacementTopic } from "./source-replacements.ts";
import { insertProposedNewsroomSource } from "./source-seeds.server.ts";
import { linkStoryDocuments } from "./story-documents.server.ts";
import { commitStoryDraftForAuthenticatedEditor } from "./model-request-commit.server.ts";
import { parseNotes, packNotes } from "./notes.ts";
import { parseSourceLines } from "./source-lines.ts";
import { sourceIdentity } from "./url-guard.ts";
import { headlineFromUrl, looksLikeUrl } from "./desk-copy.ts";
import { holdChoice, isBadSourceReason } from "./kill-reasons.ts";
import { setLeadStatusForEditor } from "./lead-lifecycle.ts";
import {
  appendPastedText,
  findSourcesPrompt,
  insertUpdateAtTop,
  parseProposedSources,
  parseScore,
  scorePrompt,
  sourceUrlsContain,
  weavePrompt,
} from "./editor-dialog-logic.ts";

/** A lead's own row, as the Hold and Headline dialogs need it. */
type LeadRow = { id: number; headline: string; status: string; notes_json: string | null };
/** The latest draft, as Add-to-story and Headline need it. */
type DraftRow = { id: number; headline: string; dek: string; body: string; topic: string };

/** What `insertLeadWithDraft` in `desk.ts` gives back. Injected, not imported:
 *  `desk.ts` is the one module in this directory a `node --test` file cannot
 *  load (`@/lib` is a build-time alias), and a dialog test must never need it. */
export type InsertLead = (
  context: { userId: string; newsroomId?: number },
  input: { headline: string; why: string; topic: string; urls: string[]; notesJson?: string },
) => Promise<{ ok: true; id: number } | { ok: false; error: string }>;

/**
 * Everything a test needs to replace.
 *
 * Two of these are required rather than defaulted -- `insertLead` and `commitDraft`
 * live in modules this file deliberately does not import -- so a caller that
 * forgets one gets a type error instead of a dynamic import that works in the
 * app and explodes under `node --test`.
 */
export type EditorDialogDeps = {
  getSql: () => Promise<Sql>;
  chat: typeof grokChat;
  readAssignments: (newsroomId?: number) => Promise<ModelAssignmentRow[]>;
  resolveLocalModel: (newsroomId: number, scope: "story" | "scan") => Promise<LocalModelOverride | null>;
  saveDraft: (context: { userId: string; newsroomId: number }, data: DraftEditInput) => Promise<{ ok: true }>;
  proposeSource: typeof insertProposedNewsroomSource;
  linkDocuments: typeof linkStoryDocuments;
  insertLead: InsertLead;
  commitDraft: typeof commitStoryDraftForAuthenticatedEditor;
  now: () => Date;
  paperSetupWarning?: typeof paperSetupWarning;
  checkRate?: typeof checkRate;
};

export type EditorDialogContext = { userId: string; newsroomId: number };

/* ------------------------------------------------------------------- model -- */

/**
 * The phase 5 resolution, in one place, for every AI path in these dialogs.
 *
 * The order is the brief's: the editor's pick for THIS dialog, then
 * `model_assignments`, then the surface default. `exactModel` is `null` for the
 * same reason `performSuggestHeadlines` does not pass one -- no caller in this
 * codebase has resolved a local or custom rung's model before the call, and
 * `grokChat` resolves it itself when it is not told.
 *
 * The effort only comes from the editor when the editor also picked the model:
 * an effort stored beside an assignment describes that assignment's provider,
 * and carrying it onto a different provider is how a dialog would ask a model
 * for a reasoning level it does not have. `cleanJobEffort` is the desk's own
 * answer to that question, so it is read from there rather than re-decided.
 */
export function jobModelFor(
  jobKey: string,
  explicit: string | null | undefined,
  effort: string | null | undefined,
  assignments: readonly ModelAssignmentRow[],
): JobModelResolution {
  const resolved = resolveJobModel({ jobKey, explicit, assignments, exactModel: null });
  if (resolved.source !== "explicit") return resolved;
  return { ...resolved, effort: cleanJobEffort(resolved.providerId, effort ?? null, null) };
}

async function localOverrideFor(
  deps: EditorDialogDeps,
  newsroomId: number,
  providerId: string,
  scope: "story" | "scan",
): Promise<LocalModelOverride | undefined> {
  if (providerId !== "local-model") return undefined;
  return (await deps.resolveLocalModel(newsroomId, scope)) ?? undefined;
}

async function resolveFor(
  deps: EditorDialogDeps,
  jobKey: string,
  explicit: string | null | undefined,
  effort: string | null | undefined,
  newsroomId: number,
): Promise<JobModelResolution> {
  const assignments = await deps.readAssignments(newsroomId).catch(() => []);
  return jobModelFor(jobKey, explicit, effort, assignments);
}

/** The one sentence a dialog prints when the desk could not use a saved pick. */
function noticeLine(resolution: JobModelResolution): string | null {
  return resolution.notice;
}

/* --------------------------------------------------------------- add a lead -- */

export type AddLeadResult =
  | {
      ok: true;
      leadId: number;
      then: "score" | "draft" | "as-is";
      /** The usefulness number, when "Research and score it" worked. */
      score?: number;
      reason?: string;
      /** A sentence the dialog shows in the warning style. Never a silent no-op. */
      notice?: string | null;
    }
  | { ok: false; error: string; warning?: { key: string; sentence: string } };

/**
 * "Add a lead": file it, then do whatever "Then" asked for.
 *
 * The filing is `insertLeadWithDraft` -- the desk's own insert, which writes
 * both the lead and the draft row `publishLead` reads its sources from. It is
 * reached through `deps.insertLead` because it lives in `desk.ts` (see the
 * `InsertLead` note above). Nothing here re-implements that insert, so a lead
 * added from this dialog is the same shape as one filed from the desk.
 *
 * `why` is optional in the design ("Optional note for the AI"), so it is not
 * required here either -- which is why the headline comes from the paste rather
 * than from the editor: the design draws no headline field, and a lead with no
 * headline cannot be listed. A pasted URL becomes its readable name
 * (`headlineFromUrl`, the same rule the Dark Desk open path uses), or the URL
 * itself when that name is too short to list; anything else becomes its own
 * first line.
 *
 * THE THREE ENDINGS ARE NOT THREE SUCCESS SHAPES. "Just file it as-is" is done
 * when the row exists. The other two can still fail after the row exists, and
 * when they do the answer is `ok: true` WITH A NOTICE, not `ok: false`: the
 * lead is on the desk either way, and telling the editor the add failed would
 * send them to add it a second time.
 */
export async function performAddLead(
  context: EditorDialogContext,
  data: {
    paste: string;
    override?: string[];
    why?: string;
    then: "score" | "draft" | "as-is";
    modelChoice?: string;
    modelEffort?: string | null;
  },
  deps: EditorDialogDeps,
): Promise<AddLeadResult> {
  const paste = data.paste.trim().slice(0, 20_000);
  if (!paste.length) return { ok: false as const, error: "Give the desk a link or a tip." };

  const firstLine = paste.split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
  /*
    A pasted link is content even when its readable name is short.

    `headlineFromUrl("https://x.gov/news")` is "News" -- seven characters -- so
    the eight-character floor below refused a link its own dialog had just
    accepted, with "Give the desk a link or a tip." to an editor who had given
    one. The floor is for a typed tip, where eight characters is the difference
    between a thought and a keystroke. A link with a name worth reading is filed
    under that name; a link whose name is too short to list is filed under the
    URL the editor pasted.
  */
  const isLink = looksLikeUrl(firstLine);
  const derived = isLink ? headlineFromUrl(firstLine).trim() : "";
  const headline = (derived.length >= 8 ? derived : isLink ? firstLine : firstLine || paste.slice(0, 120))
    .trim()
    .slice(0, 180);
  if (headline.length < 8) {
    const warning = await editorWarning(context, data.override, "lead-short-headline", "This headline is shorter than 8 characters.", { kind: "newsroom", id: context.newsroomId });
    if (warning) return warning;
  }

  const why = (data.why ?? "").trim().slice(0, 800);
  /*
    The URLs come out of `parseSourceLines`, the parser the "Paste a list" tab
    and `addSourcesBulk` already share, so a link written as "https://x, Name"
    is read the same way here as everywhere else. A tip with no URL is a normal
    case and answers an empty array.
  */
  const urls = parseSourceLines(paste).map((row) => row.url);
  if (data.then === "draft") {
    const setup = await (deps.paperSetupWarning ?? paperSetupWarning)(context, data.override, "draft this story");
    if (setup) return setup;
    const rate = await (deps.checkRate ?? checkRate)(context.userId, "draft", context.newsroomId, data.override, { record: false });
    if (rate) return rate;
  }
  const filed = await deps.insertLead(
    { userId: context.userId, newsroomId: context.newsroomId },
    { headline, why, topic: "council", urls },
  );
  if (!filed.ok) return { ok: false as const, error: filed.error };
  const leadId = filed.id;

  if (data.then === "as-is") return { ok: true as const, leadId, then: "as-is" as const };

  const resolution = await resolveFor(
    deps,
    data.then === "score" ? "lead-score" : "story-draft",
    data.modelChoice,
    data.modelEffort,
    context.newsroomId,
  );
  const notice = noticeLine(resolution);

  if (data.then === "score") {
    const localModel = await localOverrideFor(deps, context.newsroomId, resolution.providerId, "scan");
    const prompt = scorePrompt({ headline, text: paste });
    const got = await deps.chat(prompt.system, prompt.user, 700, {
      choice: resolution.providerId as EffectiveProviderChoice,
      newsroomId: context.newsroomId,
      reasoningEffort: resolution.effort,
      localModel,
    });
    if (!got.ok) {
      return {
        ok: true as const,
        leadId,
        then: "score" as const,
        notice: "Filed it, but the desk could not reach a model to score it. The lead is in the Queue unscored.",
      };
    }
    const scored = parseScore(got.text);
    if (!scored) {
      return {
        ok: true as const,
        leadId,
        then: "score" as const,
        notice: "Filed it, but the model's answer was not a score. The lead is in the Queue unscored.",
      };
    }
    const sql = await deps.getSql();
    /*
      The score model's explanation, written to `leads.evidence`. `scored.reason`
      is free prose the model wrote about the story it just read, so it gets the
      same guard a lead's own `why` and `evidence` get in `fileScanLeads`: a NUL
      in it fails this UPDATE, and the UPDATE is how the editor's filed lead
      gets its score -- the failure would read as "the desk could not reach a
      model", which is not what happened.

      `|| null` is kept on the outside of the guard so a model that wrote no
      reason at all still stores NULL rather than an empty string.
    */
    await sql`
      update leads set newsworthiness = ${scored.score}, evidence = ${storableText(scored.reason) || null}
      where id = ${leadId} and newsroom_id = ${context.newsroomId}
    `;
    return { ok: true as const, leadId, then: "score" as const, score: scored.score, reason: scored.reason, notice };
  }

  const started = await deps
    .commitDraft(
      {
        context: { userId: context.userId, newsroomId: context.newsroomId },
        leadId,
        override: data.override,
        modelChoice: resolution.providerId as StoryModelChoice,
        modelEffort: resolution.effort,
      },
      { ratePreflight: true },
    )
    .catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : "Could not start the draft." }));
  if (!started.ok) {
    return {
      ok: true as const,
      leadId,
      then: "draft" as const,
      notice: `Filed it, but the draft did not start. ${started.error}`,
    };
  }
  return { ok: true as const, leadId, then: "draft" as const, notice };
}

/* --------------------------------------------------------------------- hold -- */

export type HoldLeadResult =
  | { ok: true; held: true; key: string; notice: string | null }
  | { ok: false; error: string };

/**
 * Hold a lead, with or without a reason.
 *
 * The reason goes into `leads.notes_json`, not a column (see the file header).
 * `parseNotes`/`packNotes` are the desk's own reader and writer for that
 * column, so a note written here comes back out through the same code that
 * reads every other note on every other lead.
 *
 * "Hold, no reason" is a real press and stores `{ key: "none" }` with its own
 * time: a later reader can then tell "the editor chose not to say why" from
 * "nobody ever opened the dialog", and those are different facts.
 *
 * WAITING ON AN AI FOLLOW-UP DOES NOT CREATE ONE. `MODEL_JOB_KEYS` carries a
 * `follow-up` row with `built: false`, and `performCreateFollowUp` is a
 * *person*-chase (it needs a `who` and a `what`), so a dialog with no such
 * fields could not fill one in even if it wanted to. The reason is recorded and
 * the answer says plainly that nothing will chase it -- the alternative, a
 * silent success, would be a control that does nothing.
 */
export async function performHoldLead(
  context: EditorDialogContext,
  data: { id: number; choice: string; note?: string; override?: string[] },
  deps: EditorDialogDeps,
): Promise<HoldLeadResult> {
  const sql = await deps.getSql();
  const rows = await sql<LeadRow>`
    select id, headline, status, notes_json from leads
    where id = ${data.id} and newsroom_id = ${context.newsroomId} limit 1
  `;
  const lead = rows[0];
  if (!lead) return { ok: false as const, error: "That lead is not on the desk." };

  const chosen = data.choice === "none" ? undefined : holdChoice(data.choice);
  if (data.choice !== "none" && !chosen) return { ok: false as const, error: "That is not a hold reason." };

  if ((data.note ?? "").trim().length > 1000) {
    const warning = await editorWarning({ ...context, sql }, data.override, "hold-note-length",
      "This hold note is longer than the usual 1,000 characters.", { kind: "lead", id: data.id });
    if (warning) return warning;
  }
  const notes = parseNotes(lead.notes_json);
  notes.hold = {
    key: data.choice === "none" ? "none" : chosen!.key,
    reason: chosen?.label ?? "",
    note: (data.note ?? "").trim(),
    at: deps.now().toISOString(),
  };
  const held = await setLeadStatusForEditor(sql, context, { id: data.id, status: "held", override: data.override }, packNotes(notes));
  if (!held.ok) return held;
  const notice =
    chosen?.key === "follow-up"
      ? "Recorded. Nothing will chase this on its own yet — AI follow-ups are not built, so the reason is on the lead for a person to pick up."
      : null;
  return { ok: true as const, held: true as const, key: notes.hold.key, notice };
}

/* ---------------------------------------------------------- kill pattern ---- */

export type SourceKillPatternResult =
  | {
      ok: true;
      source: { id: number; url: string; name: string };
      /** Kills from this source whose reason says the source was the problem. */
      badSource: number;
      /** Every kill whose lead was filed with this source. */
      killedFromSource: number;
      examples: { id: number; headline: string }[];
    }
  | { ok: false; error: string };

/**
 * "Leads killed from this source" and how many of them were the source's fault.
 *
 * SHOWS THE PATTERN, CHANGES NOTHING. There is no write in this function and no
 * weight anywhere in it: the brief asks for the count and says explicitly not
 * to touch source weights, and the cheapest way to be sure of that is for the
 * function to have no way to write.
 *
 * WHY IT IS NOT A JOIN. `leads` has no `source_id`. The only link between a
 * lead and a source is the JSON array of URLs the lead was filed with, so the
 * match is `sourceUrlsContain` -- `sourceIdentity` (host plus path, `www.`
 * stripped), which is the same identity the watch list de-duplicates on. A
 * substring test would count `.../news-archive` as `.../news`, and an operator
 * that is merely wrong is worse than no number at all.
 */
export async function performSourceKillPattern(
  context: EditorDialogContext,
  data: { sourceId: number },
  deps: EditorDialogDeps,
): Promise<SourceKillPatternResult> {
  const sql = await deps.getSql();
  const sources = await sql<{ id: number; url: string; title: string | null }>`
    select id, url, title from sources
    where id = ${data.sourceId} and newsroom_id = ${context.newsroomId} limit 1
  `;
  const source = sources[0];
  if (!source) return { ok: false as const, error: "That source is not on the watch list." };
  const identity = sourceIdentity(source.url);
  if (!identity) {
    return { ok: false as const, error: "That source's URL cannot be matched to a lead." };
  }

  const killed = await sql<{ id: number; headline: string; kill_reason: string | null; source_urls: string | null }>`
    select id, headline, kill_reason, source_urls from leads
    where newsroom_id = ${context.newsroomId} and status = ${"killed"}
    order by killed_at desc nulls last, id desc
    limit 500
  `;
  const fromSource = killed.filter((row) => sourceUrlsContain(row.source_urls, identity));
  const badSource = fromSource.filter((row) => isBadSourceReason(row.kill_reason));
  return {
    ok: true as const,
    source: { id: source.id, url: source.url, name: (source.title || source.url).trim() },
    badSource: badSource.length,
    killedFromSource: fromSource.length,
    examples: badSource.slice(0, 5).map((row) => ({ id: row.id, headline: row.headline })),
  };
}

/* --------------------------------------------------------------- find sources -- */

export type FindSourcesResult =
  | { ok: true; proposed: number; alreadyExisted: number; skipped: number; notice: string | null }
  | { ok: false; error: string } | EditorWarningResult;

/**
 * "Ask AI to find sources": propose pages, land them in Suggested sources.
 *
 * Every proposed row goes through `insertProposedNewsroomSource`, which is the
 * one function in the codebase that decides a suggestion is acceptable (it
 * refuses search-result pages, cannot-identify URLs, and social profiles on a
 * paper that does not watch social sources). Nothing here re-checks any of
 * that, deliberately: two copies of the rule would drift, and the drift would
 * show up as a suggestion the editor accepts and the scan then ignores.
 *
 * "skipped" is the honest other half of the answer. A model that offers eight
 * rows and has six refused has not proposed eight sources, and a dialog that
 * reported the model's number would be reporting rows that are not there.
 *
 * The job key is `scan`: the scan is what proposes newsroom sources today, so
 * the editor's assignments for scan are the ones this search should follow.
 */
export async function performFindSources(
  context: EditorDialogContext,
  data: { topic: string; scope: string; modelChoice?: string; modelEffort?: string | null; override?: string[] },
  deps: EditorDialogDeps,
): Promise<FindSourcesResult> {
  const topic = data.topic.trim();
  if (!topic) return { ok: false as const, error: "Say what the paper should cover." };
  if (topic.length < 4 || topic.length > 800) {
    const warning = await editorWarning({ ...context, sql: await deps.getSql() }, data.override,
      "source-search-topic", "This search topic is outside the usual 4 to 800 characters.", { kind: "newsroom", id: context.newsroomId });
    if (warning) return warning;
  }

  const resolution = await resolveFor(deps, "scan", data.modelChoice, data.modelEffort, context.newsroomId);
  const localModel = await localOverrideFor(deps, context.newsroomId, resolution.providerId, "scan");
  const prompt = findSourcesPrompt(topic, data.scope);
  const got = await deps.chat(prompt.system, prompt.user, 1400, {
    choice: resolution.providerId as EffectiveProviderChoice,
    newsroomId: context.newsroomId,
    reasoningEffort: resolution.effort,
    localModel,
  });
  if (!got.ok) {
    return {
      ok: false as const,
      error: "The model could not be reached, so no sources were proposed. The existing suggestion list is untouched.",
    };
  }
  const rows = parseProposedSources(got.text);
  if (!rows.length) {
    return {
      ok: true as const,
      proposed: 0,
      alreadyExisted: 0,
      skipped: 0,
      notice: "The model came back with nothing the desk could use as a source. Try a narrower topic.",
    };
  }
  const sql = await deps.getSql();
  let proposed = 0;
  let alreadyExisted = 0;
  for (const row of rows) {
    const added = await deps.proposeSource(sql, {
      userId: context.userId,
      newsroomId: context.newsroomId,
      url: row.url,
      title: row.name,
      reason: row.reason,
      proposedBy: "editor",
    });
    if (added) proposed += 1;
    else {
      const stored = await sql<{url: string}>`select url from sources where newsroom_id=${context.newsroomId}`;
      if (stored.some(source => sourceIdentity(source.url) === sourceIdentity(row.url))) alreadyExisted += 1;
    }
  }
  return {
    ok: true as const,
    proposed,
    alreadyExisted,
    skipped: rows.length - proposed,
    notice:
      proposed === 0
        ? "Nothing new: every page the model named is already a source, already suggested, or one the desk will not watch."
        : noticeLine(resolution),
  };
}

/* ------------------------------------------------------- find a replacement -- */

export type FindReplacementResult =
  | {
      ok: true;
      /** How many rows reached the review list. */
      proposed: number;
      /** What the model offered that the door refused -- the model's number is
       *  not the desk's, and a dialog must not report rows that are not there. */
      skipped: number;
      /** The topic the beat produced, so the editor can see what was asked. */
      topic: string;
      notice: string | null;
    }
  | { ok: false; error: string };

/**
 * "Find a replacement" (unit SH0-9): the AI tier, on the editor's press.
 *
 * IT REUSES THE FIND-SOURCES PATH RATHER THAN A SECOND ONE. The prompt, the
 * parser, the provider resolution and the one door every suggestion goes
 * through are all `performFindSources`'s -- `findSourcesPrompt`,
 * `parseProposedSources` and `deps.proposeSource`. What is new here is the
 * seeding and the provenance: the topic comes from the BEAT (the sections the
 * owner filed the source under, or the recorded guess, or the source's own
 * title), and every row is filed with `replacesSourceId` and
 * `proposedBy: "desk"` so the editor knows what they are looking at.
 *
 * EXACTLY ONE MODEL CALL, ON AN EXPLICIT PRESS. Same shape as its neighbour:
 * one `deps.chat`, 1400 tokens, `noTools: true` -- the desk is asking for a
 * list of pages, not for an agent to go and read them. The model comes from the
 * newsroom's own picker through `resolveFor`, never from a constant here, so
 * the editor's Automatic choice is what decides.
 *
 * NOTHING IS ACCEPTED. `insertProposedNewsroomSource` writes
 * `status='proposed'` and nothing in this function or below it can write
 * anything else; accepting stays the editor's existing press on the Sources
 * screen. That is the owner's line ("never auto-add"), and it is pinned by
 * test.
 */
export async function performFindReplacement(
  context: EditorDialogContext,
  data: {
    sourceId: number;
    /**
     * The editor's "Use this instead" press on a candidate the desk already
     * showed them. When it is present NO MODEL IS CALLED AT ALL -- the page is
     * already chosen, and the only thing left to do is file it for approval,
     * which is what the AI tier's rows end up doing anyway. One function
     * because it is one door: the two presses differ in where the URL came
     * from, and in nothing else.
     */
    url?: string;
    title?: string;
    modelChoice?: string;
    modelEffort?: string | null;
  },
  deps: EditorDialogDeps,
): Promise<FindReplacementResult> {
  const sql = await deps.getSql();
  const rows = await sql<{
    id: number;
    url: string;
    title: string | null;
    proposed_section: string | null;
  }>`
    select id, url, title, proposed_section from sources
    where id = ${data.sourceId} and newsroom_id = ${context.newsroomId} limit 1
  `;
  const source = rows[0];
  if (!source) return { ok: false as const, error: "That source is not on the watch list." };

  /*
    THE BEAT, RESOLVED THE WAY THE FREE TIER RESOLVES IT -- the same function,
    so the panel's siblings and the model's topic cannot describe the source
    differently. The sections come from `section_sources` (the owner's own
    filing), then the recorded guess, then the source's title matched against
    the newsroom's sections.
  */
  const filed = await sql<{ section_key: string }>`
    select section_key from section_sources
    where newsroom_id = ${context.newsroomId} and source_id = ${source.id}
  `;
  const sections = await sql<{ key: string; name: string }>`
    select key, name from newsroom_sections
    where newsroom_id = ${context.newsroomId} and visible = true
    order by position asc
  `;
  const beats = beatsForSource({
    sections: filed.map((row) => row.section_key),
    proposedSection: source.proposed_section,
    title: source.title,
    knownSections: sections,
  });
  const topic = replacementTopic({ beats, knownSections: sections, title: source.title });
  if (topic.trim().length < 4) {
    return {
      ok: false as const,
      error:
        "The desk cannot tell what this source was for, so it has nothing to search on. File it under a section, or add the replacement by hand.",
    };
  }

  /*
    THE FREE TIER'S PRESS. A candidate the desk read off this site, chosen by
    the editor: no model, no fetch, one row through the door -- and the same
    honest answer about whether it landed.
  */
  const chosen = String(data.url ?? "").trim();
  if (chosen) {
    const added = await deps.proposeSource(sql, {
      userId: context.userId,
      newsroomId: context.newsroomId,
      url: chosen,
      title: String(data.title ?? "").trim() || chosen,
      reason: "Suggested as a replacement for a source the desk could not read.",
      proposedBy: "desk",
      replacesSourceId: source.id,
    });
    return {
      ok: true as const,
      proposed: added ? 1 : 0,
      skipped: added ? 0 : 1,
      topic,
      notice: added
        ? "Added to Suggested sources. Nothing is fetched until you accept it."
        : "That page is already a source, already suggested, or one the desk will not watch.",
    };
  }

  const resolution = await resolveFor(deps, "scan", data.modelChoice, data.modelEffort, context.newsroomId);
  const localModel = await localOverrideFor(deps, context.newsroomId, resolution.providerId, "scan");
  const prompt = findSourcesPrompt(topic, "records");
  const got = await deps.chat(prompt.system, prompt.user, 1400, {
    choice: resolution.providerId as EffectiveProviderChoice,
    newsroomId: context.newsroomId,
    reasoningEffort: resolution.effort,
    localModel,
    /*
      No tools, deliberately. This is a "name some pages" question; an agent
      that can fetch would go and read the very host that just refused the
      desk, which is the one thing the whole feature is built not to do.
    */
    noTools: true,
  });
  if (!got.ok) {
    return {
      ok: false as const,
      error: "The model could not be reached, so no replacement was suggested. Nothing was changed.",
    };
  }

  const offered = parseProposedSources(got.text);
  if (!offered.length) {
    return {
      ok: true as const,
      proposed: 0,
      skipped: 0,
      topic,
      notice: "The model came back with nothing the desk could use as a source.",
    };
  }

  let proposed = 0;
  for (const row of offered) {
    const added = await deps.proposeSource(sql, {
      userId: context.userId,
      newsroomId: context.newsroomId,
      url: row.url,
      title: row.name,
      reason: row.reason,
      proposedBy: "desk",
      replacesSourceId: source.id,
      /*
        No `via`: the four values that column carries (`feed`, `sitemap`,
        `moved`, `canonical`) all describe a signpost the desk READ. A page a
        model named is not one of those, and null -- "not recorded" -- is the
        honest answer rather than the nearest label.
      */
    });
    if (added) proposed += 1;
  }
  return {
    ok: true as const,
    proposed,
    skipped: offered.length - proposed,
    topic,
    notice:
      proposed === 0
        ? "Nothing new: every page the model named is already a source, already suggested, or one the desk will not watch."
        : noticeLine(resolution),
  };
}

/* ------------------------------------------------------------- add to story -- */

export type WeaveIntoStoryResult =
  | {
      ok: true;
      /** True on the confirm press: the reviewed bytes are the saved ones. */
      saved: boolean;
      mode: "weave" | "update" | "as-is";
      /** The body before, and the body to show the editor. */
      before: string;
      after: string;
      /** How many documents this press attached, on the saving press only. */
      documents: number;
      notice: string | null;
    }
  | { ok: false; error: string };

/**
 * "Add to this story": compute the new body, then save the body the editor read.
 *
 * TWO PRESSES, AND THE SECOND ONE DOES NOT RE-RUN THE MODEL. The dialog's foot
 * line is the promise -- "Shows exactly what changed before saving" -- so the
 * first press returns `before` and `after` and writes nothing, and the confirm
 * press sends the bytes it was shown back as `saveText`. Re-running a model on
 * the confirm would rewrite the prose after the editor approved it, which is
 * the one failure mode this shape exists to prevent.
 *
 * The two no-AI modes are computed here rather than in the component, because
 * what "Add as an update" writes is a decision (the stamp goes at the TOP, the
 * as-is paste goes at the END) and a decision that only exists inside a React
 * component is a decision nothing can test.
 *
 * Documents are attached on the saving press only. `linkStoryDocuments` refuses
 * a document that is already attached, so running it on the review press would
 * make pressing "Add" then "Save" refuse the second time.
 */
export async function performWeaveIntoStory(
  context: EditorDialogContext,
  data: {
    leadId: number;
    mode: "weave" | "update" | "as-is";
    material: string;
    documentIds?: string[];
    saveText?: string;
    modelChoice?: string;
    modelEffort?: string | null;
  },
  deps: EditorDialogDeps,
): Promise<WeaveIntoStoryResult> {
  const sql = await deps.getSql();
  const drafts = await sql<DraftRow>`
    select id, headline, dek, body, topic from drafts
    where lead_id = ${data.leadId} and newsroom_id = ${context.newsroomId}
    order by updated_at desc, id desc limit 1
  `;
  const draft = drafts[0];
  if (!draft) return { ok: false as const, error: "This lead has no draft to add to yet." };

  if (data.saveText !== undefined) {
    await deps.saveDraft(
      { userId: context.userId, newsroomId: context.newsroomId },
      {
        leadId: data.leadId,
        headline: draft.headline,
        dek: draft.dek,
        body: data.saveText,
        topic: draft.topic,
      },
    );
    const ids = data.documentIds ?? [];
    if (ids.length) {
      await deps.linkDocuments(sql, context.newsroomId, context.userId, data.leadId, ids);
    }
    return {
      ok: true as const,
      saved: true,
      mode: data.mode,
      before: draft.body,
      after: data.saveText,
      documents: ids.length,
      notice: null,
    };
  }

  const material = data.material.trim();
  if (material.length < 4) return { ok: false as const, error: "Paste or drop something to add." };

  let after: string;
  let notice: string | null = null;
  if (data.mode === "as-is") {
    after = appendPastedText(draft.body, material);
  } else if (data.mode === "update") {
    after = insertUpdateAtTop(draft.body, material, deps.now());
  } else {
    const resolution = await resolveFor(deps, "story-draft", data.modelChoice, data.modelEffort, context.newsroomId);
    const localModel = await localOverrideFor(deps, context.newsroomId, resolution.providerId, "story");
    notice = noticeLine(resolution);
    const prompt = weavePrompt({ headline: draft.headline, body: draft.body, material });
    const got = await deps.chat(prompt.system, prompt.user, 2400, {
      choice: resolution.providerId as EffectiveProviderChoice,
      newsroomId: context.newsroomId,
      reasoningEffort: resolution.effort,
      localModel,
    });
    if (!got.ok) {
      return {
        ok: false as const,
        error: "The story model could not be reached, so nothing was rewritten. Your draft is exactly as it was.",
      };
    }
    const woven = got.text.trim();
    if (woven.length < 40) {
      return {
        ok: false as const,
        error: "The story model came back with too little to be the story. Your draft is exactly as it was.",
      };
    }
    after = woven;
  }
  return {
    ok: true as const,
    saved: false,
    mode: data.mode,
    before: draft.body,
    after,
    documents: (data.documentIds ?? []).length,
    notice,
  };
}

/* ----------------------------------------------------------------- headline -- */

export type ChooseHeadlineResult = { ok: true; headline: string } | { ok: false; error: string } | EditorWarningResult;

/**
 * "Use this headline": write the chosen line onto the draft.
 *
 * The write goes through `saveDraftForEditor`, the one function that saves a
 * draft, so the chosen line gets everything an editor's own save gets --
 * including `headline_source`, which `headlineSourceAfterEdit` stamps as the
 * editor's. That stamp is not a detail: it is what stops the next redraft from
 * replacing the headline the editor just chose.
 *
 * The rest of the draft is read back and sent unchanged, because the alternative
 * -- an UPDATE of one column written here -- would be a second writer of the
 * drafts table that knows nothing about the evidence reconciliation, the
 * stripped reporter notebook or the style record the real save performs.
 *
 * A lead with no draft gets a refusal rather than a new empty draft row: the
 * Headline dialog is mounted on the story workbench, where a draft exists, and
 * inventing one here would file a story with a headline and no text.
 */
export async function performChooseHeadline(
  context: EditorDialogContext,
  data: { id: number; headline: string; override?: string[] },
  deps: EditorDialogDeps,
): Promise<ChooseHeadlineResult> {
  const headline = data.headline.trim();
  if (!headline) return { ok: false as const, error: "The headline is empty." };
  if (headline.length < 8 || headline.length > 180) {
    const warning = await editorWarning({ ...context, sql: await deps.getSql() }, data.override,
      "headline-length", "This headline is outside the usual 8 to 180 characters.", { kind: "lead", id: data.id });
    if (warning) return warning;
  }

  const sql = await deps.getSql();
  const drafts = await sql<DraftRow>`
    select id, headline, dek, body, topic from drafts
    where lead_id = ${data.id} and newsroom_id = ${context.newsroomId}
    order by updated_at desc, id desc limit 1
  `;
  const draft = drafts[0];
  if (!draft) return { ok: false as const, error: "This lead has no draft yet. Write one first." };

  await deps.saveDraft(
    { userId: context.userId, newsroomId: context.newsroomId },
    { leadId: data.id, headline, dek: draft.dek, body: draft.body, topic: draft.topic },
  );
  return { ok: true as const, headline };
}

/** The defaults, with the two injected modules still injected. */
export function editorDialogDeps(overrides: Partial<EditorDialogDeps> & Pick<EditorDialogDeps, "insertLead" | "commitDraft">): EditorDialogDeps {
  return {
    getSql,
    paperSetupWarning,
    checkRate,
    chat: grokChat,
    readAssignments: readModelAssignments,
    resolveLocalModel: async (newsroomId, scope) =>
      (await resolveLocalModelChoice(newsroomId, scope)).override,
    saveDraft: saveDraftForEditor,
    proposeSource: insertProposedNewsroomSource,
    linkDocuments: linkStoryDocuments,
    now: () => new Date(),
    ...overrides,
  };
}
