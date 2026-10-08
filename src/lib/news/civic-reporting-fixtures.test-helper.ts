/*
  Offline fixtures for the civic-reporting runner tests.

  WHY A MODULE. The runner is a real multi-pass method now: a warm accounting
  pass per tape window, an INDEPENDENT cold pass, a reconciliation, an
  adversarial pass, a scoring pass and a writer. A test that wants the whole
  method to run to COMPLETE has to (a) put a real scoped meeting in the meeting
  tables and (b) answer every pass, not one shape. Both live here so the run
  test reads as assertions about the method rather than fixture plumbing.

  NOTHING HERE TOUCHES THE NETWORK OR A REAL MODEL. Every seam is injected.
*/
import type { Sql } from "../db.ts";
import type { ingestDocument } from "./ingest.ts";
import type { DeskJob } from "./jobs.ts";

export const FIXTURE_NEWSROOM = 947;
export const FIXTURE_USER = "civic-reporting-runner-test";
export const FIXTURE_VIDEO = "zMglXtVlIMA";

/**
 * A REAL claimed `desk_jobs` row, shaped exactly as the drainer's claim leaves
 * it: `kind = 'reporting'`, `subject_id = <request id>`, `status = 'running'`
 * and a `claim_token` this worker owns. The run's final filing fence locks THIS
 * row and asserts the token, so a test that files a package has to seed the row
 * the fence will find -- a fake in-memory job with `id: 0` cannot pass it, and
 * weakening the fence to admit one would be the wrong repair.
 */
export async function seedClaimedJob(
  sql: Sql,
  input: { requestId: number; researchScope?: "public" | "supplied"; claimToken?: string; resultJson?: string },
): Promise<DeskJob> {
  const token = input.claimToken ?? "fixture-claim-" + String(input.requestId) + "-" + String(Date.now());
  const [row] = await sql<{ id: number }>`
    insert into desk_jobs
      (newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source,
       research_scope, lane, status, stage, claim_token, result_json)
    values
      (${FIXTURE_NEWSROOM}, ${FIXTURE_USER}, 'reporting', ${input.requestId},
       'auto', 'editor', ${input.researchScope ?? "public"}, 'default', 'running', 'Working', ${token},
       ${input.resultJson ?? "{}"})
    returning id
  `;
  return {
    id: Number(row!.id),
    newsroom_id: FIXTURE_NEWSROOM,
    user_id: FIXTURE_USER,
    kind: "reporting",
    subject_id: input.requestId,
    model_choice: "auto",
    model_choice_source: "editor",
    research_scope: input.researchScope ?? "public",
    lane: "default",
    status: "running",
    stage: "Working",
    claim_token: token,
    failover_note: "",
    error: null,
    result_json: input.resultJson ?? "{}",
    created_at: "",
    updated_at: "",
    started_at: null,
    finished_at: null,
    stages_json: null,
    cancel_requested: false,
    result_href: null,
  } as DeskJob;
}

/** Cancel a seeded job the way the editor's Cancel button does. */
export async function cancelSeededJob(sql: Sql, jobId: number): Promise<void> {
  await sql`update desk_jobs set cancel_requested = true, updated_at = now() where id = ${jobId}`;
}

/** Reclaim a job the way the drainer's stale-reclaim does: a NEW claim token. */
export async function reclaimSeededJob(sql: Sql, jobId: number, token = "successor-claim"): Promise<void> {
  await sql`update desk_jobs set claim_token = ${token}, updated_at = now() where id = ${jobId}`;
}

/** A short, real-looking council meeting: one vote on the airport contract. */
export const FIXTURE_SEGMENTS: { index: number; seconds: number; item: string; text: string }[] = [
  { index: 0, seconds: 0, item: "1", text: "Call to order and roll call. All members present." },
  { index: 1, seconds: 30, item: "6A", text: "We move to approve the airport-noise contract, resolution 2026-114, at a cost of $733,170." },
  { index: 2, seconds: 45, item: "6A", text: "Seconded. The motion carries 7-0. Staff will execute the contract by December 1, 2026." },
  { index: 3, seconds: 60, item: "6A", text: "Councilmember Reed asked staff to report the nighttime noise complaint count to the council in January." },
  { index: 4, seconds: 75, item: "PROC", text: "A motion to extend the meeting to 10:30 carries 6-1." },
];

/*
  The meeting-transcript artifact, its segments, the agenda alignment and the
  one recorded vote. Returns the artifact id. Idempotent: the runner tests share
  one PGLite instance, so a second call reuses the rows.
*/
export async function seedMeetingFixture(sql: Sql): Promise<number> {
  await sql`
    insert into meeting_transcript_artifacts
      (newsroom_id, video_id, artifact_type, storage_path, format, sha256, source_method, retention_mode)
    values (${FIXTURE_NEWSROOM}, ${FIXTURE_VIDEO}, 'transcript',
            '/fixtures/meeting-39.jsonl', 'jsonl', 'fixture-sha-39', 'fixture', 'transcript-only')
    on conflict (newsroom_id, video_id, artifact_type, sha256) do nothing
  `;
  const [artifact] = await sql<{ id: number }>`
    select id from meeting_transcript_artifacts
    where newsroom_id = ${FIXTURE_NEWSROOM} and video_id = ${FIXTURE_VIDEO} and sha256 = 'fixture-sha-39'
    limit 1
  `;
  const artifactId = Number(artifact!.id);
  for (const segment of FIXTURE_SEGMENTS) {
    await sql`
      insert into meeting_transcript_segments
        (artifact_id, segment_index, start_seconds, end_seconds, item, excerpt, caption_sha256)
      values (${artifactId}, ${segment.index}, ${segment.seconds}, ${segment.seconds + 10},
              ${segment.item}, ${segment.text}, ${"fixture-cap-" + String(segment.index)})
      on conflict (artifact_id, segment_index) do nothing
    `;
  }
  await sql`
    insert into meeting_agenda_chunks
      (newsroom_id, video_id, artifact_id, item, title, start_seconds, end_seconds, segment_indexes)
    values (${FIXTURE_NEWSROOM}, ${FIXTURE_VIDEO}, ${artifactId}, '6A',
            'Airport noise contract', 30, 135, ${JSON.stringify([1, 2, 3])})
    on conflict (newsroom_id, video_id, item) do nothing
  `;
  await sql`
    insert into meeting_structured_votes
      (newsroom_id, video_id, item, established, motion, tally, result, source)
    values (${FIXTURE_NEWSROOM}, ${FIXTURE_VIDEO}, '6A', true,
            'Approve the airport-noise contract', '7-0', 'carries', 'transcript 00:00:45')
    on conflict (newsroom_id, video_id, item) do nothing
  `;
  await sql`
    insert into meeting_capture_records
      (newsroom_id, video_id, channel_url, title, published, status)
    values (${FIXTURE_NEWSROOM}, ${FIXTURE_VIDEO}, 'https://youtube.com/@city',
            'City Council Study Session', '2026-09-29', 'captured')
    on conflict (newsroom_id, video_id) do nothing
  `;
  return artifactId;
}

/*
  A LEAD that names the scoped meeting -- so the runner resolves the meeting
  identity from the LEAD ARTIFACT, never from seeds[0]. This is the fixture that
  makes the "identity from the lead, not the first seed" regression real.
*/
export async function seedScopedLead(sql: Sql, artifactId: number): Promise<number> {
  const [existing] = await sql<{ id: number }>`
    select id from leads
    where newsroom_id = ${FIXTURE_NEWSROOM} and meeting_video_id = ${FIXTURE_VIDEO}
      and meeting_lead_purpose = 'whole-meeting'
    order by id limit 1
  `;
  if (existing) return Number(existing.id);
  const [lead] = await sql<{ id: number }>`
    insert into leads
      (user_id, newsroom_id, headline, why, topic, status,
       meeting_video_id, meeting_artifact_id, meeting_lead_purpose)
    values (${FIXTURE_USER}, ${FIXTURE_NEWSROOM},
            'Council weighs the airport-noise contract', 'It changes nighttime noise rules.', 'council', 'new',
            ${FIXTURE_VIDEO}, ${artifactId}, 'whole-meeting')
    returning id
  `;
  return Number(lead!.id);
}


/* ------------------------------------------------------------------ *
 * The multi-pass chat double.
 *
 * One `chat` fake cannot answer all five passes with one shape. This one reads
 * the pass marker each prompt carries and answers THAT pass, so the run test
 * exercises the real routing (warm per window, cold, adversarial, scoring,
 * writer) rather than a single canned reply the runner would mis-parse.
 * ------------------------------------------------------------------ */
export type ChatReply = { ok: true; text: string } | { ok: false; error: string };

export type ChatRoute = "warm" | "cold" | "contrary" | "reassessment" | "scoring" | "writer" | "other";

export function routeOf(prompt: string): ChatRoute {
  if (prompt.includes("Reassess these EARLIER contrary findings")) return "reassessment";
  if (prompt.includes("WARM ACCOUNTING pass for ONE bounded window")) return "warm";
  if (prompt.includes("COLD READER")) return "cold";
  if (prompt.includes("ADVERSARIAL pass")) return "contrary";
  if (prompt.includes("EDITOR scoring what this meeting story should lead on")) return "scoring";
  if (prompt.includes("WRITER of the substantial reporting package")) return "writer";
  return "other";
}

function json(value: unknown): ChatReply {
  return { ok: true, text: "```json\n" + JSON.stringify(value) + "\n```" };
}

/** The warm window reply: the one substantive action plus the procedural one. */
export function warmReply(): ChatReply {
  return json({
    windowRead: true,
    windowNote: "Read every line; one policy action and one procedural motion.",
    actions: [
      { actionId: "A1", timestamp: "00:00:30", agendaItem: "6A",
        motionOrAction: "Approve the airport-noise contract, resolution 2026-114, at a cost of $733,170",
        outcome: "carries", vote: "7-0", policyStage: "final",
        evidence: "tape 00:00:30, item 6A", disposition: "Lead story" },
      { actionId: "A2", timestamp: "00:01:15", agendaItem: "PROC",
        motionOrAction: "Extend the meeting to 10:30", outcome: "carries", vote: "6-1",
        policyStage: "procedural", evidence: "tape 00:01:15, item PROC", disposition: "routine" },
    ],
  });
}

/** The warm reply that omits the procedural motion -- used by the reconcile test. */
export function warmReplyWarmOnly(): ChatReply {
  return json({
    windowRead: true,
    windowNote: "Read every line.",
    actions: [
      { actionId: "A1", timestamp: "00:00:30", agendaItem: "6A",
        motionOrAction: "Approve the airport-noise contract, resolution 2026-114, at a cost of $733,170",
        outcome: "carries", vote: "7-0", policyStage: "final",
        evidence: "tape 00:00:30, item 6A", disposition: "Lead story" },
    ],
  });
}

/** The cold reply: the SAME meeting, re-derived, with a roster and the vote. */
export function coldReply(): ChatReply {
  return json({
    roster: ["Reed", "Nguyen", "Ortiz"],
    votes: [{ item: "6A", tally: "7-0", result: "carries" }],
    actions: [
      { actionId: "C1", timestamp: "00:00:30", agendaItem: "6A",
        motionOrAction: "Approve the airport-noise contract, resolution 2026-114, at a cost of $733,170",
        outcome: "carries", vote: "7-0", policyStage: "final",
        evidence: "tape 00:00:30, item 6A", disposition: "Lead story" },
      { actionId: "C2", timestamp: "00:01:15", agendaItem: "PROC",
        motionOrAction: "Extend the meeting to 10:30", outcome: "carries", vote: "6-1",
        policyStage: "procedural", evidence: "tape 00:01:15, item PROC", disposition: "routine" },
    ],
  });
}

/** The cold reply that finds an action the warm pass never saw. */
export function coldReplyColdOnly(): ChatReply {
  return json({
    roster: ["Reed"],
    votes: [{ item: "6A", tally: "7-0", result: "carries" }],
    actions: [
      { actionId: "C1", timestamp: "00:00:30", agendaItem: "6A",
        motionOrAction: "Approve the airport-noise contract, resolution 2026-114, at a cost of $733,170",
        outcome: "carries", vote: "7-0", policyStage: "final",
        evidence: "tape 00:00:30, item 6A", disposition: "Lead story" },
      { actionId: "C2", timestamp: "00:01:15", agendaItem: "7B",
        motionOrAction: "Direct staff to publish the noise complaint figures", outcome: "carries",
        vote: "unverified", policyStage: "direction", evidence: "tape 00:01:15, item 7B",
        disposition: "unresolved (cold pass only)" },
    ],
  });
}

/** The adversarial reply. */
export function contraryReply(): ChatReply {
  return json({
    contrary: [
      { challenge: "The contract's cost is stated, but the per-year noise-mitigation spend is not on the tape.",
        status: "unresolved", source: "packet p.57" },
    ],
    unknowns: ["The 2026 nighttime noise complaint count."],
  });
}

/** A malformed adversarial reply: prose wrapped around a truncated JSON block. */
export function contraryMalformedReply(): ChatReply {
  return {
    ok: true,
    text:
      "Here is my adversarial analysis. The contract cost is stated but the per-year spend is not.\n" +
      "```json\n{ \"contrary\": [ { \"challenge\": \"The per-year noise-mitigation spend is not on the tape.\", \"status\": \"unresol",
  };
}

/** The repair reply: the SAME content as the malformed reply, now valid JSON. */
export function contraryRepairReply(): ChatReply {
  return json({
    contrary: [
      { challenge: "The per-year noise-mitigation spend is not on the tape.", status: "unresolved", source: "packet" },
    ],
    unknowns: ["The 2026 nighttime noise complaint count."],
  });
}

/** A repair that ALSO fails to parse: the run must record the failure, not loop. */
export function contraryRepairStillBadReply(): ChatReply {
  return { ok: true, text: "```json\n{ \"contrary\": [ { \"challenge\": \"still broken" };
}

/** The scoring reply. */
export function scoringReply(): ChatReply {
  return json({
    score: { immediacy: 4, impact: 4, conflict: 2, novelty: 3, whyItMatters: "It sets the airport's nighttime noise rules." },
    readiness: 2,
    why: "A same-week council decision residents can still influence at the Oct. 6 hearing.",
  });
}

/*
  The writer reply. `claim` lets a test hand in a claim that must (or must not)
  survive the code-side item binding: the default is a VERIFIED claim whose
  tally is stated under item 6A, where the tape really says "seven to zero".
*/
export function writerReply(over: { draft?: string; claimText?: string; claimItem?: string } = {}): ChatReply {
  const draft =
    over.draft ??
    ("The city council voted seven to zero on Tuesday to approve a $733,170 airport-noise contract, " +
      "resolution 2026-114, a decision that rewrites when the airport must quiet its loudest nights for " +
      "the residents who live under the approach path. The vote caps a two-year fight that began when " +
      "neighbors in the Airport Road district filed a run of nighttime noise complaints and asked the " +
      "council to make the airport pay for the mitigation it had promised. Under the contract, staff " +
      "must execute the agreement by December 1, 2026, and report the nighttime noise complaint count " +
      "back to the council in January, a reporting duty Councilmember Reed asked for by name before " +
      "the vote. What the contract does not settle is how much the city will spend each year on the " +
      "mitigation itself; the tape states the contract total but never the annual figure, and the " +
      "packet does not carry it either. Residents who want to press that question have one live " +
      "opening left: a public hearing on the airport's noise rules is set for October 6, and the " +
      "council has not yet closed the record on the annual spending plan.");
  return json({
    stories: [
      {
        id: "s1",
        headline: "Council approves $733,170 airport-noise contract",
        dek: "City Council voted seven to zero to approve a $733,170 airport-noise contract that will change quiet hours for residents under the approach path.",
        draft,
        plainBrief: "A contract that changes nighttime noise rules for residents under the flight path.",
        cannotSay: "The exact annual noise-mitigation spend.",
        readinessTier: 2,
        claims: [
          {
            id: "C1",
            text: over.claimText ?? "The council voted seven to zero to approve the contract under item 6A.",
            item: over.claimItem ?? "6A",
            status: "VERIFIED",
            sourceIds: ["S1"],
            nextCheck: "",
          },
        ],
        sources: [
          { id: "S1", title: "Council transcript", tier: "A",
            url: "https://youtu.be/zMglXtVlIMA?t=45", locator: "00:00:45, item 6A", offlineReference: "" },
        ],
      },
    ],
    held: [],
  });
}

/** A `chat` fake that answers each pass by its marker. */
export function passChat(over: {
  warm?: () => ChatReply;
  cold?: () => ChatReply;
  contrary?: () => ChatReply;
  reassessment?: () => ChatReply;
  scoring?: () => ChatReply;
  writer?: () => ChatReply;
  count?: (route: ChatRoute, prompt: string) => void;
} = {}): (system: string, prompt: string) => Promise<ChatReply> {
  return async (_system: string, prompt: string) => {
    const route = routeOf(prompt);
    over.count?.(route, prompt);
    switch (route) {
      case "warm":
        return (over.warm ?? warmReply)();
      case "cold":
        return (over.cold ?? coldReply)();
      case "contrary":
        return (over.contrary ?? contraryReply)();
      case "reassessment":
        return (over.reassessment ?? (() => json({ findings: [] })))();
      case "scoring":
        return (over.scoring ?? scoringReply)();
      case "writer":
        return (over.writer ?? writerReply)();
      default:
        return { ok: false, error: "the test chat double was asked an unrecognised pass" };
    }
  };
}

/** A research double that returns one discovered page and its findings. */
export function researchDouble(over: {
  findings?: string;
  captures?: { url: string; title: string; captureEventId: number | null; locator?: string }[];
} = {}) {
  return async () => ({
    findings:
      over.findings ?? "The Sept. 29 packet lists the $733,170 airport-noise contract at p.57.",
    searches: 2,
    pages: 1,
    captures:
      over.captures ?? [
        { url: "https://city.example/packet-2026-09-29.pdf", title: "Sept. 29 council packet", captureEventId: 1, locator: "p.57" },
      ],
    window: null,
    stopReason: "page-ceiling" as const,
    stopDetail: null,
    nothingFoundReason: null,
  });
}

/** An ingest double that returns a readable document, so the seeds reconcile. */
export function ingestDouble(
  text = "Sept. 29 council packet. Item 6A: airport-noise contract, $733,170.",
): typeof ingestDocument {
  return async () => ({
    ok: true,
    status: 200,
    outcome: "fetched",
    text,
    title: "Sept. 29 packet",
    extras: [] as string[],
    contentType: "text/html",
    needsOcr: false,
    redirectChain: [] as string[],
    extractionMethod: "article",
    pages: [] as { page: number; text: string }[],
    notices: [] as string[],
  });
}
