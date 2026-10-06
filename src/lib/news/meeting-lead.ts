import type { Sql } from "../db.ts";
import { meetingEvidenceBlock } from "./meeting-draft-input.ts";

/**
 * Files the meeting lead that carries a transcript to the desk.
 *
 * This is the bridge that has never existed. Section 5 produces aligned agenda
 * items, structured votes and resolved citations, and then returns them to a
 * caller that drops them: nothing files a lead, nothing enqueues a job, nothing
 * writes a draft. A four-hour council meeting becomes a well-organised record
 * and the paper gains nothing from it.
 *
 * The lead is an ordinary lead in the existing Queue. It is not a new surface
 * and it does not short-circuit review. It differs in two ways: its `why` names
 * the agenda items the meeting actually covered, and its `notes_json` carries the
 * citations, so the draft step can record which transcript positions the prose
 * drew from and the revision re-check finally has something to look at.
 *
 * Votes are carried as the structured record states them. Nothing here infers a
 * tally from prose.
 */
export type MeetingLeadCitation = {
  item: string;
  segmentIndex: number;
  timestampSeconds: number;
  excerpt: string;
  captionSha256: string;
};

function timestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function storedNotes(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Refuse to replace a note blob we cannot preserve as an object.
  }
  throw new Error("Cannot refresh the meeting lead because its saved notes are not a JSON object.");
}

/**
 * The desk's own headline cap: an edited headline is stored at `desk.ts` at 180,
 * so a capture headline is bounded here rather than arriving longer than the
 * field the editor is allowed to write.
 */
const HEADLINE_MAX = 180;

/**
 * What the lead is titled from: the decision the record established, or the
 * agenda item the transcript covered.
 *
 * The capture path used to title a lead from the recording's own title, which
 * for a routine meeting is the body's name and a date -- "City Council Regular
 * Session - September 22, 2026". That is the shape a real dev scan filed five of
 * as leads (REAL-SCAN-DEV-2 §3), and the desk has no way to tell a meeting record
 * from news: an agenda posted, a session set, nothing decided. The lead is titled
 * from what the meeting actually covered instead, the same "name the item"
 * standard the scan prompt asks the model for. Both the model prompt
 * (./desk-copy.ts) and this function now refuse a meeting that names nothing.
 *
 * `item` keeps the packet's own agenda id. "9C" stays "9C" -- the desk's reader
 * looks that id up in the packet, and `9c` or `9` would not find it.
 */
export type MeetingLeadSubject = {
  kind: "decision" | "item";
  /** The agenda item id, exactly as the packet prints it. */
  item: string;
  /** One line naming the decision or the item, in the record's own words. */
  text: string;
};

export function meetingLeadSubject(input: {
  items: { item: string; title: string }[];
  votes: { item: string; established: boolean; motion: string | null; tally: string | null; result: string | null }[];
}): MeetingLeadSubject | null {
  /*
    A decision first. The news from a meeting is what it decided, and a vote the
    structured record established is the only decision this pass can name without
    inferring one from prose. The motion and the outcome are quoted as the record
    states them: "Approve Ordinance O-2026-47" and a result of "Passed" is not
    rewritten into "approves".
  */
  const decided = input.votes.find((vote) => vote.established && (vote.motion ?? "").trim());
  if (decided) {
    const outcome = [decided.result, decided.tally]
      .map((part) => (part ?? "").trim())
      .filter(Boolean)
      .join(" ");
    return {
      kind: "decision",
      item: decided.item,
      text: `item ${decided.item} ${decided.motion!.trim()}${outcome ? ` — ${outcome}` : ""}`,
    };
  }
  /*
    No decision: fall back to the item the transcript covered. A packet item can
    carry an empty title, and an item whose title is blank names nothing, so it
    does not count.
  */
  const covered = input.items.find((item) => (item.title ?? "").trim());
  if (covered) return { kind: "item", item: covered.item, text: `item ${covered.item} ${covered.title.trim()}` };
  return null;
}

/**
 * The lead headline and why, derived only from what the transcript established.
 *
 * Deliberately plain: a meeting lead is an assignment to look at the meeting, not
 * a story. It names the items that were actually covered and how many votes the
 * structured record established, and it says so when that number is zero rather
 * than implying a vote the record does not support.
 *
 * Null when the record names no item and establishes no decision. A lead titled
 * "Council meeting, date" is the record the desk keeps filing and cannot use, so
 * this path files nothing rather than filing one. The caller records why.
 */
export function meetingLeadCopy(input: {
  title: string;
  meetingDate: string | null;
  items: { item: string; title: string }[];
  establishedVotes: number;
  /** The structured record's votes. The first established decision titles the lead. */
  votes: { item: string; established: boolean; motion: string | null; tally: string | null; result: string | null }[];
}): { headline: string; why: string } | null {
  const subject = meetingLeadSubject(input);
  if (!subject) return null;
  const when = input.meetingDate ? ` (${input.meetingDate})` : "";
  /*
    The meeting itself stays in the headline in front of the item: the desk needs
    to know which session this is before it needs to know which item. The
    parenthesized capture stamp stays at the end, where the standing-page rule R5
    reads it (./lead-newsworthiness.ts `CAPTURE_STAMP`).
  */
  const stem = `${input.title}: ${subject.text}`;
  const room = HEADLINE_MAX - when.length;
  const headline = (stem.length > room ? `${stem.slice(0, Math.max(0, room - 1)).trimEnd()}…` : stem) + when;
  const named = input.items
    .slice(0, 8)
    .map((i) => `item ${i.item}${i.title ? ` ${i.title}` : ""}`)
    .join("; ");
  const voteLine = input.establishedVotes > 0
    ? `${input.establishedVotes} vote${input.establishedVotes === 1 ? "" : "s"} established from the structured record`
    : "no vote established from the structured record";
  const why = [
    `Meeting transcript captured and aligned to ${input.items.length} agenda item${input.items.length === 1 ? "" : "s"}.`,
    named ? `Covered: ${named}.` : "",
    `Votes: ${voteLine}.`,
    "Every claim in a draft from this meeting resolves to an item, a timestamp and the verbatim words.",
  ].filter(Boolean).join(" ");
  return { headline, why };
}

/**
 * What filing did.
 *
 * "Filed nothing" is a real outcome, not a failure: a capture whose record names
 * no item and establishes no decision has no lead to file, and inventing a
 * headline for it is what put "Council meeting, date" in the queue. The caller
 * reports the reason; nothing is written, and on a revision any lead already on
 * the meeting is left alone rather than blanked.
 */
export type MeetingLeadFiling =
  | { filed: true; leadId: number; headline: string }
  | { filed: false; leadId: null; headline: null; reason: string };

/**
 * Files the lead and returns its id. No draft is created here and no model is
 * called; drafting happens through the desk's ordinary job flow, so the model
 * ladder, refusals, budgets and evidence receipts behave exactly as they do for
 * every other draft.
 */
export async function fileMeetingLead(
  sql: Sql,
  input: {
    newsroomId: number;
    userId: string;
    videoId: string;
    title: string;
    meetingDate: string | null;
    topic: string;
    sourceUrls: string[];
    items: { item: string; title: string; startSeconds?: number; excerpt?: string }[];
    establishedVotes: number;
    citations: MeetingLeadCitation[];
    artifactId: number;
    /** The structured record, as the pipeline extracted it. Never inferred from prose. */
    votes: {
      item: string;
      established: boolean;
      motion: string | null;
      mover: string | null;
      seconder: string | null;
      tally: string | null;
      result: string | null;
      /** Null when the record names no source; the evidence block says so rather than guessing. */
      source: string | null;
    }[];
  },
): Promise<MeetingLeadFiling> {
  const copy = meetingLeadCopy(input);
  /*
    Nothing to name: file nothing.

    This is the whole of the fix for the record-shaped leads. It comes before the
    evidence block and the insert so a revision that suddenly names nothing does
    not overwrite a lead that names something.
  */
  if (!copy) {
    return {
      filed: false,
      leadId: null,
      headline: null,
      reason:
        `no lead filed: the record for ${input.title} names no agenda item and establishes no vote, ` +
        "so there is no item or decision to title a lead from",
    };
  }
  /*
    The evidence block, written into scratch.

    scratch is the field the drafting step reads as evidence -- the same field
    the "Write a story" box fills with the pasted text. A meeting lead that did
    not fill it would reach the writer with a headline and a URL and no
    transcript at all, and draft from nothing: the failure would look like a thin
    story rather than a missing one.
  */
  const scratch = meetingEvidenceBlock({
    title: input.title,
    meetingDate: input.meetingDate,
    videoUrl: input.sourceUrls[0] ?? `https://www.youtube.com/watch?v=${input.videoId}`,
    items: input.items.map((item) => {
      const itemCitations = input.citations.filter((citation) => citation.item === item.item);
      return {
        item: item.item,
        title: item.title,
        startSeconds: item.startSeconds ?? itemCitations[0]?.timestampSeconds ?? 0,
        excerpt: item.excerpt?.trim() || itemCitations.map((citation) => citation.excerpt).join(" "),
      };
    }),
    votes: input.votes,
  });
  /*
    researchScope must be on the lead.

    draftLead resolves scope as input.researchScope ?? parseNotes(lead.notes_json)
    .researchScope ?? "public". Nothing passes the first, so a meeting lead
    without this defaults to PUBLIC scope and the writer goes looking for a
    different story on the web while the transcript sits unused in scratch.
    Supplied scope is what makes this lead draft from its own record.
  */
  const priorLeads = await sql.query<{ notes_json: string | null }>(
    `select notes_json from leads
       where newsroom_id=$1 and meeting_video_id=$2 and meeting_lead_purpose='transcript-story'
       order by id desc limit 1 for update`,
    [input.newsroomId, input.videoId],
  );
  const priorNotes = storedNotes(priorLeads[0]?.notes_json ?? null);
  // Scratch is editor state after filing and can contain a generated excerpt,
  // edited text, or both; retain it as saved. The immutable artifact and
  // citation fields below are the current-capture evidence and always advance.
  const scratchForLead = Object.hasOwn(priorNotes, "scratch") && typeof priorNotes.scratch === "string"
    ? priorNotes.scratch
    : scratch;
  const researchScope = priorNotes.researchScope === "public" || priorNotes.researchScope === "supplied"
    ? priorNotes.researchScope
    : "supplied";
  const notesWithScratch = JSON.stringify({
    ...priorNotes,
    meeting: {
      videoId: input.videoId,
      title: input.title,
      date: input.meetingDate,
      artifactId: input.artifactId,
    },
    /*
      These immutable references describe the current capture. Replacing them
      on revision keeps A's hashes from being presented as evidence for B.
    */
    transcriptCitations: input.citations.map((c) => ({
      item: c.item,
      segmentIndex: c.segmentIndex,
      timestampSeconds: c.timestampSeconds,
      timestamp: timestamp(c.timestampSeconds),
      excerpt: c.excerpt,
      captionSha256: c.captionSha256,
    })),
    researchScope,
    scratch: scratchForLead,
  });
  const rows = await sql.query<{ id: number }>(
    `insert into leads (user_id, newsroom_id, headline, why, topic, source_urls, evidence, newsworthiness, status, notes_json,
                        meeting_video_id,meeting_artifact_id,meeting_lead_purpose)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'transcript-story')
     on conflict (newsroom_id,meeting_video_id,meeting_lead_purpose)
       where meeting_video_id is not null and meeting_artifact_id is not null and meeting_lead_purpose is not null
     do update set headline=excluded.headline,
                   why=excluded.why,
                   topic=excluded.topic,
                   source_urls=excluded.source_urls,
                   evidence=excluded.evidence,
                   notes_json=excluded.notes_json,
                   meeting_artifact_id=excluded.meeting_artifact_id
     returning id`,
    [
      input.userId, input.newsroomId, copy.headline, copy.why, input.topic,
      JSON.stringify(input.sourceUrls), copy.why.slice(0, 400), 0, "new", notesWithScratch,
      input.videoId, input.artifactId,
    ],
  );
  const leadId = rows[0]?.id;
  if (!leadId) throw new Error("Could not file the meeting lead.");
  return { filed: true, leadId, headline: copy.headline };
}

