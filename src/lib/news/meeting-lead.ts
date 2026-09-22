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

/**
 * The lead headline and why, derived only from what the transcript established.
 *
 * Deliberately plain: a meeting lead is an assignment to look at the meeting, not
 * a story. It names the items that were actually covered and how many votes the
 * structured record established, and it says so when that number is zero rather
 * than implying a vote the record does not support.
 */
export function meetingLeadCopy(input: {
  title: string;
  meetingDate: string | null;
  items: { item: string; title: string }[];
  establishedVotes: number;
}): { headline: string; why: string } {
  const when = input.meetingDate ? ` (${input.meetingDate})` : "";
  const headline = `${input.title}${when}`;
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
    items: { item: string; title: string }[];
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
): Promise<{ leadId: number; headline: string }> {
  const copy = meetingLeadCopy(input);
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
    items: input.citations.map((c) => ({
      item: c.item, title: input.items.find((i) => i.item === c.item)?.title ?? "",
      startSeconds: c.timestampSeconds, excerpt: c.excerpt,
    })),
    votes: input.votes,
  });
  const notesJson = JSON.stringify({
    meeting: {
      videoId: input.videoId,
      title: input.title,
      date: input.meetingDate,
      artifactId: input.artifactId,
    },
    /*
      The draft step reads these and records which positions the prose actually
      drew from. Carried on the lead so the citations survive the trip from the
      capture pass into the desk, which is where they were being dropped.
    */
    transcriptCitations: input.citations.map((c) => ({
      item: c.item,
      segmentIndex: c.segmentIndex,
      timestampSeconds: c.timestampSeconds,
      timestamp: timestamp(c.timestampSeconds),
      excerpt: c.excerpt,
      captionSha256: c.captionSha256,
    })),
  });
  const notesWithScratch = JSON.stringify({ ...(JSON.parse(notesJson) as Record<string, unknown>), scratch });
  const rows = await sql.query<{ id: number }>(
    `insert into leads (user_id, newsroom_id, headline, why, topic, source_urls, evidence, newsworthiness, status, notes_json)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning id`,
    [
      input.userId, input.newsroomId, copy.headline, copy.why, input.topic,
      JSON.stringify(input.sourceUrls), copy.why.slice(0, 400), 0, "new", notesWithScratch,
    ],
  );
  const leadId = rows[0]?.id;
  if (!leadId) throw new Error("Could not file the meeting lead.");
  return { leadId, headline: copy.headline };
}

