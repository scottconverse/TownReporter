import type { Sql } from "../db.ts";
import type { EffectiveProviderChoice } from "./ai.ts";
import { ingestDocument, type IngestDocument } from "./ingest.ts";
import { primeGovDocumentsForTitle, compiledDocumentUrl, preferredDocuments, type PrimeGovMeeting } from "./primegov.ts";
import { primeGovOriginForNewsroom } from "./primegov-source.ts";
import { storableText } from "./storable-text.ts";
import type { ReportChat, ReportedDraft } from "./report.ts";
import {
  runWholeMeetingWriter,
  usesWholeMeetingWriter,
  type ClaimCheck,
  type LedgerItem,
  type MeetingSegment,
  type PacketPage,
  type RunStats,
  type StructuredVoteRow,
  type WholeMeetingChat,
} from "./meeting-whole.ts";

export { usesWholeMeetingWriter };

/** What the whole-meeting path hands back to the desk's own finalisation. */
export type WholeMeetingDraftResult = {
  draft: ReportedDraft;
  ledger: LedgerItem[];
  claims: ClaimCheck[];
  /** The check results and cold-check list, uncapped (drafts.meeting_notes). */
  meetingNotes: string;
  runStats: RunStats;
  packetRead: boolean;
  /** The story_documents row the packet was retained as, when one was written. */
  packetDocumentId: string | null;
};

export type WholeMeetingDraftDeps = {
  /** Test seam: which portal this newsroom watches. See ./primegov-source.ts. */
  primeGovOrigin?: typeof primeGovOriginForNewsroom;
  /** Test seam: the packet lookup itself, so a test never reaches a real portal. */
  packetForTitle?: typeof primeGovDocumentsForTitle;
  /** Test seam: the document fetch, so a test never reaches the network. */
  ingest?: (url: string) => Promise<IngestDocument>;
};

type SegmentRow = {
  segment_index: number;
  start_seconds: number | string;
  excerpt: string;
};

type ChunkRow = { item: string; title: string; segment_indexes: string };

type VoteRow = {
  item: string;
  established: boolean;
  motion: string | null;
  tally: string | null;
  result: string | null;
  source: string | null;
};

function indexes(raw: string): number[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value)
      ? value.map(Number).filter((n) => Number.isInteger(n) && n >= 0)
      : [];
  } catch {
    return [];
  }
}

/**
 * Read the immutable meeting tables into the writer's own shapes: the tape as
 * timestamped segments (each carrying the agenda item it was aligned to), the
 * structured vote rows, and the meeting identity. A segment the capture never
 * aligned to an item carries empty item fields rather than a guessed one.
 */
export async function loadWholeMeetingInput(
  sql: Sql,
  input: { newsroomId: number; artifactId: number; videoId: string; fallbackTitle: string; videoUrl?: string },
): Promise<{
  segments: MeetingSegment[];
  votes: StructuredVoteRow[];
  meeting: { videoId: string; title: string; date: string | null; artifactId: number; videoUrl: string };
}> {
  const segments = await sql.query<SegmentRow>(
    `select segment_index,start_seconds,excerpt from meeting_transcript_segments
      where artifact_id=$1 order by segment_index`,
    [input.artifactId],
  );
  if (!segments.length) throw new Error("The meeting transcript has no stored segments.");
  const chunks = await sql.query<ChunkRow>(
    `select item,title,segment_indexes from meeting_agenda_chunks
      where newsroom_id=$1 and video_id=$2 and artifact_id=$3 order by start_seconds,id`,
    [input.newsroomId, input.videoId, input.artifactId],
  );
  const itemByIndex = new Map<number, { item: string; title: string }>();
  for (const chunk of chunks) {
    for (const index of indexes(chunk.segment_indexes)) {
      if (!itemByIndex.has(index)) itemByIndex.set(index, { item: chunk.item, title: chunk.title });
    }
  }
  const rows: MeetingSegment[] = segments.map((segment) => {
    const aligned = itemByIndex.get(Number(segment.segment_index));
    return {
      index: Number(segment.segment_index),
      seconds: Number(segment.start_seconds),
      text: segment.excerpt,
      item: aligned?.item ?? "",
      itemTitle: aligned?.title ?? "",
    };
  });
  const votes = await sql.query<VoteRow>(
    `select item,established,motion,tally,result,source from meeting_structured_votes
      where newsroom_id=$1 and video_id=$2 order by item`,
    [input.newsroomId, input.videoId],
  );
  const captures = await sql.query<{ title: string | null; published: string | null }>(
    `select title,published from meeting_capture_records where newsroom_id=$1 and video_id=$2 limit 1`,
    [input.newsroomId, input.videoId],
  );
  const capture = captures[0];
  return {
    segments: rows,
    votes: votes.map((vote) => ({
      item: vote.item,
      established: Boolean(vote.established),
      motion: vote.motion,
      tally: vote.tally,
      result: vote.result,
      source: vote.source,
    })),
    meeting: {
      videoId: input.videoId,
      title: capture?.title?.trim() || input.fallbackTitle,
      date: capture?.published ? String(capture.published).slice(0, 10) : null,
      artifactId: input.artifactId,
      videoUrl: input.videoUrl || `https://www.youtube.com/watch?v=${input.videoId}`,
    },
  };
}

/**
 * The packet document for a meeting: the one the portal calls a packet when it
 * names one, otherwise the portal's own first preference (minutes, then packet,
 * then agenda). The templateId -- not the document id -- is what the compiled
 * URL takes; see `compiledDocumentUrl`.
 */
export function packetDocumentForMeeting(
  meeting: PrimeGovMeeting,
  origin: string,
): { url: string; name: string } | null {
  const docs = meeting.documentList ?? [];
  const packet = docs.find((doc) => /\bpacket\b/i.test(doc.templateName));
  const chosen = packet ?? preferredDocuments(meeting)[0];
  if (!chosen) return null;
  return {
    url: compiledDocumentUrl(origin, chosen),
    name: `${packet ? "Packet" : chosen.templateName || "Document"} - ${meeting.title}.pdf`.slice(0, 200),
  };
}

/**
 * Fetch the meeting packet once and retain it as a `story_documents` row linked
 * to the lead, returning its text by page.
 *
 * Never throws: a meeting draft written from the tape alone is a valid draft,
 * and the run notes say the packet was not read. A packet already retained for
 * this lead (a redraft) is reused rather than fetched again.
 */
export async function loadOrFetchMeetingPacket(
  sql: Sql,
  input: {
    newsroomId: number;
    userId: string;
    leadId: number;
    title: string;
    modelChoice: EffectiveProviderChoice;
    onStage?: (stage: string) => void | Promise<void>;
  },
  deps: WholeMeetingDraftDeps = {},
): Promise<{ pages: PacketPage[]; documentId: string | null; note: string }> {
  const retained = await sql.query<{ id: string; full_text: string | null; extraction_pages: string }>(
    `select id,full_text,extraction_pages from story_documents
      where newsroom_id=$1 and lead_id=$2 and status='read' and full_text is not null
        and (source_url like '%CompiledDocument%' or filename ilike '%packet%')
      order by created_at,id limit 1`,
    [input.newsroomId, input.leadId],
  );
  const existing = retained[0];
  if (existing) {
    const pages = parsePages(existing.extraction_pages);
    if (pages.length) return { pages, documentId: existing.id, note: "The packet was already retained for this lead." };
  }

  try {
    const origin = await (deps.primeGovOrigin ?? primeGovOriginForNewsroom)(sql, input.newsroomId);
    if (!origin) return { pages: [], documentId: null, note: "No PrimeGov portal is configured for this newsroom." };
    const found = await (deps.packetForTitle ?? primeGovDocumentsForTitle)(input.title, origin);
    if (!found?.meeting) {
      return { pages: [], documentId: null, note: "No packet was found for this meeting." };
    }
    const chosen = packetDocumentForMeeting(found.meeting, origin);
    if (!chosen) return { pages: [], documentId: null, note: "The portal listed no documents for this meeting." };

    await input.onStage?.("Fetching the meeting packet");
    const ingested = await (
      deps.ingest ??
      ((url: string) => ingestDocument(url, { provider: input.modelChoice, newsroomId: String(input.newsroomId) }))
    )(chosen.url);
    // The ingest already parsed the PDF page by page. Prefer re-extracting from
    // the retained original through the document path so the pages are stored
    // in the same `[filename, page N, ...]` form every other reader uses; fall
    // back to the ingest's own pages when the original was not retained (a PDF
    // over the 4 MB raw-bytes cap, or an HTML packet).
    const pages = ingested.rawBytes?.length
      ? await retainAndExtractPacket(sql, input, chosen, ingested)
      : ingestPages(ingested);
    if (!pages.length) {
      return { pages: [], documentId: null, note: "The packet was fetched but carried no readable page text." };
    }
    return { pages, documentId: null, note: "" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { pages: [], documentId: null, note: `The packet could not be read: ${reason}` };
  }
}

function ingestPages(ingested: IngestDocument): PacketPage[] {
  return (ingested.pages ?? [])
    .filter((page) => page.page !== null && page.text.trim().length > 0)
    .map((page) => ({ page: page.page as number, text: page.text }));
}

/** Store the packet's original, link it to the lead, and extract it page by page. */
async function retainAndExtractPacket(
  sql: Sql,
  input: { newsroomId: number; userId: string; leadId: number; modelChoice: EffectiveProviderChoice },
  chosen: { url: string; name: string },
  ingested: IngestDocument,
): Promise<PacketPage[]> {
  const { storeStoryDocument, linkStoryDocuments, extractStoryDocument } = await import("./story-documents.server.ts");
  const stored = await storeStoryDocument(
    input.newsroomId,
    input.userId,
    chosen.name,
    ingested.contentType || "application/pdf",
    ingested.rawBytes!,
  );
  await linkStoryDocuments(sql, input.newsroomId, input.userId, input.leadId, [stored.id]);
  await sql`update story_documents set source_url=${chosen.url} where id=${stored.id} and newsroom_id=${input.newsroomId}`;
  const collected = new Map<number, string>();
  const result = await extractStoryDocument(
    {
      id: stored.id,
      filename: chosen.name,
      mime: ingested.contentType || "application/pdf",
      original: ingested.rawBytes!,
      full_text: null,
      pages: null,
      status: "uploaded",
      source_url: chosen.url,
    },
    input.modelChoice,
    input.newsroomId,
    async () => {},
    { reasoningEffort: null },
    {
      onPageCheckpoint: async (_page, text) => {
        const parsed = /page (\d+),/.exec(text);
        if (parsed) collected.set(Number(parsed[1]), text);
      },
    },
  );
  const pages = [...collected.entries()]
    .sort(([left], [right]) => left - right)
    .map(([page, text]) => ({ page, text }));
  await sql`update story_documents set full_text=${result.text},pages=${result.pages},extraction_pages=${JSON.stringify(pages)},status=${result.text ? "read" : "uploaded"} where id=${stored.id} and newsroom_id=${input.newsroomId}`;
  return pages;
}

function parsePages(raw: string | null | undefined): PacketPage[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const record = row as Record<string, unknown>;
        const page = Number(record.page);
        const text = String(record.text ?? "");
        return Number.isInteger(page) && page > 0 && text.trim() ? { page, text } : null;
      })
      .filter((page): page is PacketPage => Boolean(page));
  } catch {
    return [];
  }
}

/**
 * Run WR1 for one lead: read the tape and packet, run the whole-meeting writer,
 * and hand the desk a `ReportedDraft` shaped like every other one -- with the
 * ledger, claims, meeting notes and run stats carried out alongside for the
 * desk to persist against the row it inserts.
 *
 * `meetingEvidenceWide` is set so the desk's citation derivation runs over
 * every transcript candidate rather than a single focus: this writer read the
 * whole meeting on purpose.
 */
export async function runWholeMeetingDraft(
  input: {
    sql: Sql;
    newsroomId: number;
    userId: string;
    leadId: number;
    artifactId: number;
    videoId: string;
    fallbackTitle: string;
    videoUrl?: string;
    modelChoice: EffectiveProviderChoice;
    chat: ReportChat;
    onStage?: (stage: string) => void | Promise<void>;
    /** The desk's own per-call budget; 0 lets the chat wrapper size the call. */
    callTimeoutMs?: number;
  },
  deps: WholeMeetingDraftDeps = {},
): Promise<WholeMeetingDraftResult> {
  const material = await loadWholeMeetingInput(input.sql, input);
  const packet = await loadOrFetchMeetingPacket(
    input.sql,
    {
      newsroomId: input.newsroomId,
      userId: input.userId,
      leadId: input.leadId,
      title: material.meeting.title,
      modelChoice: input.modelChoice,
      onStage: input.onStage,
    },
    deps,
  );

  const chat: WholeMeetingChat = (system, user, maxTokens) =>
    input.chat(system, user, maxTokens, input.modelChoice, { timeoutMs: input.callTimeoutMs ?? 0 });

  const result = await runWholeMeetingWriter({
    meeting: { title: material.meeting.title, date: material.meeting.date, videoUrl: material.meeting.videoUrl },
    segments: material.segments,
    packetPages: packet.pages,
    votes: material.votes,
    chat,
    packetRead: packet.pages.length > 0,
    onStage: input.onStage,
  });

  const notes = [packet.note, result.integrityNotes].filter(Boolean).join("\n");
  const flagged = result.claims.filter((claim) => claim.checkStatus === "flagged");
  const draft: ReportedDraft = {
    headline: result.headline,
    dek: result.dek,
    body: result.body,
    topic: material.meeting.title.slice(0, 200),
    source_urls: [material.meeting.videoUrl],
    citation_status: "not-applicable",
    integrity_notes: notes,
    memory_entities: [],
    form: "reported",
    provenance: [],
    found_note: "",
    findings: [],
    unanswered: [],
    // Only what needs an editor's eye becomes a to-do; the whole claim list is
    // stored in `draft_claims` for the panel.
    claims: flagged.map((claim) => ({
      fact: claim.claim.slice(0, 800),
      url: material.meeting.videoUrl,
      kind: "record" as const,
    })),
    research_memo: {
      nameCheck: result.nameCheck,
      meetingEvidenceWide: true,
      news: result.dek || result.headline,
      why_it_matters: "",
      angle: result.headline,
      form: "reported",
      questions: [],
      unknowns: [],
      follow: "",
      captured: [],
    },
  };

  return {
    draft,
    ledger: result.ledger,
    claims: result.claims,
    meetingNotes: result.meetingNotes,
    runStats: result.runStats,
    packetRead: result.packetRead,
    packetDocumentId: packet.documentId,
  };
}

/**
 * Persist the WR1 accounting against the draft row the desk just inserted.
 * Separate from the INSERT because the draft id only exists after it; the
 * ledger and claims are additive rows, and the notes and run stats update the
 * same row rather than a new one.
 */
export async function persistWholeMeetingAccounting(
  sql: Sql,
  input: {
    newsroomId: number;
    draftId: number;
    leadId: number;
    ledger: LedgerItem[];
    claims: ClaimCheck[];
    meetingNotes: string;
    runStats: RunStats;
  },
): Promise<void> {
  for (const item of input.ledger) {
    await sql`
      insert into meeting_ledger_items
        (newsroom_id,draft_id,lead_id,item_no,kind,text,start_seconds,packet_page,status,reason,source_excerpt)
      values (
        ${input.newsroomId},${input.draftId},${input.leadId},${item.itemNo},
        ${storableText(item.kind).slice(0, 60)},${storableText(item.text)},
        ${item.startSeconds},${item.packetPage},${item.status},${storableText(item.reason)},
        ${storableText(item.sourceExcerpt)}
      )`;
  }
  for (const claim of input.claims) {
    await sql`
      insert into draft_claims
        (newsroom_id,draft_id,claim,source_kind,source_ref,check_status,note)
      values (
        ${input.newsroomId},${input.draftId},${storableText(claim.claim)},
        ${claim.sourceKind},${storableText(claim.sourceRef)},${claim.checkStatus},${storableText(claim.note)}
      )`;
  }
  await sql`
    update drafts set meeting_notes=${storableText(input.meetingNotes)},run_stats=${JSON.stringify(input.runStats)}::jsonb
    where id=${input.draftId} and newsroom_id=${input.newsroomId}`;
}
