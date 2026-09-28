/*
  DEV TOOL -- NOT A ROUTE, NOT PART OF THE BUILD.

  This is the seed route unit CW's proof walk (scripts/cw-story-shots.mjs) posts
  to. It lives here, outside src/, so nothing can serve it: it is never
  imported, tsconfig only includes "src" and "server", and the vite build never
  reads it. To re-take the captures, copy it to src/routes/api/dev-seed.ts on a
  dev server bound to 127.0.0.1:8090, then delete the copy and restore
  src/routeTree.gen.ts before committing -- exactly as the sibling
  scripts/dev-seed-route.ts records.

  Why a route and not a script: the dev desk runs on PGLite, in memory, one
  instance per process (src/lib/db.ts). Rows written by a separate `node`
  process land in a different database and the server never sees them. The only
  way in is over HTTP, on the same process that serves the pages.

  Everything below is insert-only fiction for screenshots. No model is called,
  no external fetch happens, no DATABASE_URL is read.
*/
import { createFileRoute } from "@tanstack/react-router";
import { getSql, type Sql } from "@/lib/db";
import { ensureInvestigateSchema } from "@/lib/news/investigate";
import { ensureJobsSchema } from "@/lib/news/jobs";
import {
  loadFindingEvidenceReview,
  persistFindingEvidenceJudgment,
} from "@/lib/news/finding-evidence-review";
import type { StoryFinding } from "@/lib/news/findings";

const NEWSROOM_ID = 1;

/*
  Times are computed in JS and passed as `Date`s rather than as
  `now() - $1::interval`. PGLite's scanner rejects the parameterised interval
  cast, and the same shape fails for `current_date - $1`. A `Date` binds
  cleanly on both backends.
*/
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ago = (ms: number) => new Date(Date.now() - ms);

async function ownerId(sql: Sql): Promise<string> {
  const member = await sql<{ user_id: string }>`
    select user_id from newsroom_members where role = 'owner' order by created_at limit 1
  `;
  if (member[0]?.user_id) return member[0].user_id;
  const account = await sql<{ id: string }>`
    select id from "user" order by "createdAt" limit 1
  `;
  return account[0]?.id ?? "cw-seed-owner";
}

/*
  Only the rows this seed owns. The redesign seed's blanket wipe would take the
  paper's own watch list and the welcome article with it, and a CW capture is
  about one lead.
*/
async function wipe(sql: Sql) {
  await sql`delete from desk_jobs where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from drafts where newsroom_id = ${NEWSROOM_ID}`;
  /*
    `named_outlet_overrides` is not cleared: migration 0086 makes it append-only
    by trigger (the same reason `named-outlet-gate.test.ts:53` leaves it alone).
    A press of "Override Longmont Times-Call" leaves a row behind, the row is
    scoped to the draft that was on the screen, and this seed always inserts a
    fresh draft -- so a re-run's screen is not reached by a previous run's row.
  */
  await sql`delete from leads where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from articles where newsroom_id = ${NEWSROOM_ID} and slug <> 'welcome-to-townreporter'`;
  await sql`delete from artifact_versions where newsroom_id = ${NEWSROOM_ID}`;
}

const PORTAL_URL = "https://longmont.primegov.com/public/portal";
const STUDY_URL = "https://assets.longmontcolorado.gov/water/rate-study-2026.pdf";
const PAPER_URL = "https://www.timescall.com/2026/09/16/longmont-water-rates/";

const ORDINANCE_TEXT = [
  "Ordinance 2026-57 — water rates, adopted September 15, 2026.",
  "",
  "Section 4. The schedule in Exhibit A applies to all metered accounts in the",
  "east pressure zone. Accounts in the west pressure zone remain on the 2024",
  "schedule through the end of the 2027 rate year.",
  "",
  "Exhibit A. East pressure zone: $9.85 per thousand gallons, up from $5.75.",
  "West pressure zone: $5.75 per thousand gallons, unchanged.",
  "",
  "The ordinance carries no separate finding on usage, leakage or main",
  "condition. The council adopted the schedule on a 5-2 vote after a public",
  "hearing at which four residents spoke.",
].join("\n");

const PAPER_TEXT = [
  "Longmont approves water rate change",
  "",
  "The council approved a new water rate schedule Tuesday on a 5-2 vote. The",
  "change raises rates across the city by roughly 4 percent next year, with",
  "the largest share of the increase spread evenly over every metered account.",
  "",
  "“Everyone on the system pays a little more,” a utilities spokesperson said.",
  "",
  "The schedule takes effect January 1.",
].join("\n");

const STUDY_TITLE = "2026 water rate study — scanned copy (OCR pending)";

const HEADLINE = "The water-rate increase lands on one side of town";
const DEK =
  "The adopted schedule raises the rate $4.10 inside the east pressure zone and leaves the west zone alone. The city says usage explains it. The ordinance does not.";

const BODY = [
  "The water-rate schedule the council adopted on September 15 raises the rate inside the east pressure zone from $5.75 to $9.85 per thousand gallons. West of Main Street the 2024 schedule holds through the end of the 2027 rate year.",
  "",
  "That split is in Exhibit A of Ordinance 2026-57. It is the only place in the adopted record where the two zones are priced differently, and the ordinance carries no finding on why — no usage figures, no leakage figures, no main-condition figures.",
  "",
  "The city's answer, given at the hearing, is that the east zone uses more water per account. Nothing in the packet the council adopted says so. The 2026 rate study that would have measured it is still a scanned PDF with no machine-readable text, so the desk could not read it either.",
  "",
  "The Times-Call reported in September that the increase was spread evenly across every metered account. The adopted schedule does not do that.",
  "",
  "Two residents spoke against the schedule at the hearing. Both asked for the zone-by-zone numbers before the vote rather than after it. The council voted 5-2.",
].join("\n");

const NAMES_CHECKED_TEXT = [HEADLINE, DEK, BODY].join("\n\n");

async function seedStory(sql: Sql, user: string) {
  /*
    ── The paper ─────────────────────────────────────────────────────────────
    Onboarded, with no `named_outlets` stored, so the gate reads the shipped
    list (named-outlet-rules.ts) -- which is what makes a body that names the
    Times-Call a blocker on its own.
  */
  await sql`
    insert into paper_settings (newsroom_id, name, city, state, location, timezone, onboarded,
                                named_outlets_revision)
    values (${NEWSROOM_ID}, ${"TownReporter Longmont"}, ${"Longmont"}, ${"Colorado"},
            ${"Longmont, Colorado"}, ${"America/Denver"}, true, 0)
    on conflict (newsroom_id) do update set onboarded = true
  `;

  /*
    ── The captured records ─────────────────────────────────────────────────
    Two the desk can read and one it cannot: the scanned rate study has no
    `full_text`, which is what a "Could not check" row is made of.
  */
  const versions = await sql<{ id: number }>`
    insert into artifact_versions (user_id, newsroom_id, url, content_hash, title, full_text,
                                   fetch_status, fetch_outcome, content_type, extraction_method,
                                   captured_at)
    values
      (${user}, ${NEWSROOM_ID}, ${PORTAL_URL}, ${"cw-hash-ordinance"},
       ${"Ordinance 2026-57 — adopted water rate schedule"},
       ${ORDINANCE_TEXT}, ${200}, ${"fetched"}, ${"html"}, ${"text"}, ${ago(6 * HOUR)}),
      (${user}, ${NEWSROOM_ID}, ${PAPER_URL}, ${"cw-hash-paper"},
       ${"Longmont approves water rate change"},
       ${PAPER_TEXT}, ${200}, ${"fetched"}, ${"html"}, ${"text"}, ${ago(5 * HOUR)}),
      (${user}, ${NEWSROOM_ID}, ${STUDY_URL}, ${"cw-hash-study"}, ${STUDY_TITLE},
       ${""}, ${200}, ${"fetched"}, ${"application/pdf"}, ${"ocr-pending"}, ${ago(4 * HOUR)})
    returning id
  `;
  const ordinanceId = Number(versions[0]!.id);
  const paperId = Number(versions[1]!.id);
  const studyId = Number(versions[2]!.id);

  /*
    ── The lead ─────────────────────────────────────────────────────────────
    A section the model chose and nobody had to confirm (`topic_unchosen`
    false), so `sectionReady` is true and the section is not a blocker. The one
    unticked gate item is the absence claim the desk still has to confirm.
  */
  const notes = {
    todo: [
      {
        t: "No public record shows the east pressure zone was assessed on its own usage.",
        done: false,
        src: "gate",
        q: "east pressure zone usage assessment",
      },
    ],
    opened: [],
  };
  const leads = await sql<{ id: number }>`
    insert into leads (user_id, newsroom_id, headline, why, topic, topic_unchosen, status,
                       source_urls, evidence, newsworthiness, notes_json, created_at)
    values (${user}, ${NEWSROOM_ID}, ${HEADLINE},
            ${"The adopted schedule prices the two pressure zones differently and the ordinance says nothing about why."},
            ${"council"}, ${false}, ${"new"}, ${JSON.stringify([PORTAL_URL])},
            ${"Five residents spoke; the utilities director answered the usage question from memory."},
            ${78}, ${JSON.stringify(notes)}, ${ago(7 * HOUR)})
    returning id
  `;
  const leadId = Number(leads[0]!.id);

  /*
    The findings, in the shape `parseFindings` reads. finding:3 is left
    unreviewed on purpose and cites a record the desk CAN read: that is the
    "! Needs review" row -- the one state the list draws that no judgment can
    produce.
  */
  const findings: StoryFinding[] = [
    {
      text: "The adopted schedule raises the rate only inside the east pressure zone.",
      source_urls: [PORTAL_URL],
      capture_event_ids: [],
      artifact_version_ids: [ordinanceId],
      locators: ["Exhibit A"],
      excerpt: "East pressure zone: $9.85 per thousand gallons, up from $5.75.",
    },
    {
      text: "The 2026 rate study compared usage between the two pressure zones.",
      source_urls: [STUDY_URL],
      capture_event_ids: [],
      artifact_version_ids: [studyId],
      locators: [],
      excerpt: "",
    },
    {
      text: "The increase is spread evenly across every metered account in the city.",
      source_urls: [PAPER_URL],
      capture_event_ids: [],
      artifact_version_ids: [paperId],
      locators: [],
      excerpt: "the largest share of the increase spread evenly over every metered account",
    },
    {
      text: "The rate study was published with the council packet before the vote.",
      source_urls: [STUDY_URL],
      capture_event_ids: [],
      artifact_version_ids: [studyId],
      locators: [],
      excerpt: "",
    },
  ];

  /*
    ── The draft ────────────────────────────────────────────────────────────
    `research_json` carries everything the review reads other than the rows
    themselves: the claims, the hour the check ran (the drawn run line), and
    the name check with one name the check could not settle. It is written
    whole and once -- `findingEvidenceContentToken` stringifies this record, so
    touching it after a judgment would invalidate every judgment.
  */
  const research = {
    reportedClaims: {
      version: 1,
      rows: [
        {
          fact: "Ordinance 2026-57 prices the east pressure zone at $9.85 per thousand gallons.",
          url: PORTAL_URL,
          kind: "record",
        },
        {
          fact: "The 2026 rate study measured usage in both pressure zones.",
          url: STUDY_URL,
          kind: "record",
        },
      ],
    },
    evidenceReconciledAt: ago(38 * MINUTE).toISOString(),
    nameCheck: {
      version: 1,
      checkedAt: ago(40 * MINUTE).toISOString(),
      checkedText: NAMES_CHECKED_TEXT,
      complete: false,
      note: "Two names matched the record; one did not settle.",
      rows: [
        {
          name: "Longmont City Council",
          role: "body",
          status: "matched",
          spelling: "Longmont City Council",
          reason: "",
          url: PORTAL_URL,
          excerpt: "The council voted 5-2.",
          captureId: ordinanceId,
        },
        {
          name: "Ordinance 2026-57",
          role: "body",
          status: "matched",
          spelling: "Ordinance 2026-57",
          reason: "",
          url: PORTAL_URL,
          excerpt: "Ordinance 2026-57 — water rates, adopted September 15, 2026.",
          captureId: ordinanceId,
        },
        {
          name: "Main Street",
          role: "body",
          status: "unresolved",
          spelling: "Main Street",
          reason: "no captured record in this draft names the boundary",
          url: "",
          excerpt: "",
        },
      ],
    },
  };

  const provenance = [
    {
      title: "Ordinance 2026-57 — adopted water rate schedule",
      organization: "City of Longmont",
      document_date: "2026-09-15",
      url: PORTAL_URL,
      captured_at: ago(6 * HOUR).toISOString(),
      version_id: ordinanceId,
      version_count: 1,
      capture_event_id: null,
      disappeared: false,
      role: "primary",
    },
    {
      title: STUDY_TITLE,
      organization: "City of Longmont",
      document_date: "2026-08-01",
      url: STUDY_URL,
      captured_at: ago(4 * HOUR).toISOString(),
      version_id: studyId,
      version_count: 1,
      capture_event_id: null,
      disappeared: false,
      role: "primary",
    },
  ];

  const drafts = await sql<{ id: number }>`
    insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls,
                        integrity_notes, provenance_json, form, found_note, unanswered,
                        research_json, disclosure_text, headline_source, model_headline,
                        model_topic, updated_at)
    values (${user}, ${NEWSROOM_ID}, ${leadId}, ${HEADLINE}, ${DEK}, ${BODY}, ${"council"},
            ${JSON.stringify([PORTAL_URL, STUDY_URL])},
            ${"The zone split is quoted from Exhibit A; the usage claim is the city's, not the record's."},
            ${JSON.stringify(provenance)}, ${"reported"}, ${JSON.stringify(findings)}, ${"[]"},
            ${JSON.stringify(research)},
            ${"A person reviewed and edited this story. AI tools helped find records and write the first draft."},
            ${"model"}, ${HEADLINE}, ${"council"}, ${ago(35 * MINUTE)})
    returning id
  `;
  const draftId = Number(drafts[0]!.id);

  /*
    ── The jobs ─────────────────────────────────────────────────────────────
    One completed draft job, so the Writer row can say whose words these are
    and at what hour; one completed reconcile, so the run line can name the
    model the check ran on. Both rows are the desk's own record of work that
    happened -- nothing here starts a job.
  */
  await sql`
    insert into desk_jobs (newsroom_id, user_id, kind, subject_id, model_choice, status, stage,
                           result_json, created_at, updated_at, started_at, finished_at)
    values (${NEWSROOM_ID}, ${user}, ${"draft"}, ${leadId}, ${"codex-frontier"},
            ${"completed"}, ${""}, ${JSON.stringify({ draftId })}, ${ago(2 * HOUR)},
            ${ago(110 * MINUTE)}, ${ago(2 * HOUR)}, ${ago(110 * MINUTE)})
  `;
  await sql`
    insert into desk_jobs (newsroom_id, user_id, kind, subject_id, model_choice, status, stage,
                           result_json, created_at, updated_at, started_at, finished_at)
    values (${NEWSROOM_ID}, ${user}, ${"reconcile"}, ${draftId}, ${"codex-frontier"},
            ${"completed"}, ${""}, ${JSON.stringify({ draftId })}, ${ago(38 * MINUTE)},
            ${ago(36 * MINUTE)}, ${ago(38 * MINUTE)}, ${ago(36 * MINUTE)})
  `;

  /*
    ── The judgments ────────────────────────────────────────────────────────
    Recorded through the app's own writer, not by hand-writing the memo: a
    hand-written `findingEvidenceReview` would carry no `evidenceBinding`, and
    the screen invalidates a judgment whose binding is missing. The key always
    comes from the review that was just loaded, because `claimKey` is a hash
    this file cannot compute, and the review is re-loaded before each write so
    the evidence token is the current one.
  */
  const judged: Array<{
    key: string;
    judgment: "supports" | "does-not-support" | "needs-reporting";
    reason: string;
  }> = [
    {
      key: "finding:0",
      judgment: "supports",
      reason: "Exhibit A of the adopted ordinance is the zone split, verbatim.",
    },
    {
      key: "finding:1",
      judgment: "needs-reporting",
      reason: "The study is a scan with no readable text, so nothing could be checked against it.",
    },
    {
      key: "finding:2",
      judgment: "does-not-support",
      reason: "The article says the increase is spread evenly; Exhibit A prices the two zones differently.",
    },
  ];
  for (const item of judged) {
    const review = await loadFindingEvidenceReview(sql, NEWSROOM_ID, leadId);
    await persistFindingEvidenceJudgment({ newsroomId: NEWSROOM_ID }, {
      leadId,
      draftId: review.draftId,
      findingKey: item.key,
      judgment: item.judgment,
      reason: item.reason,
      contraryVersionId: null,
      evidenceToken: review.evidenceToken,
    });
  }
  /*
    The two claims, keyed from the review itself. The second one cites the
    unreadable scan, which is where its "Could not check" comes from.
  */
  const claims: Array<{ index: number; judgment: "supports" | "needs-reporting"; reason: string }> = [
    { index: 0, judgment: "supports", reason: "The per-thousand-gallon figure is printed in Exhibit A." },
    { index: 1, judgment: "needs-reporting", reason: "The study has no readable text in this capture." },
  ];
  for (const item of claims) {
    const review = await loadFindingEvidenceReview(sql, NEWSROOM_ID, leadId);
    const key = review.claimRows[item.index]?.key;
    if (!key) continue;
    await persistFindingEvidenceJudgment({ newsroomId: NEWSROOM_ID }, {
      leadId,
      draftId: review.draftId,
      findingKey: key,
      judgment: item.judgment,
      reason: item.reason,
      contraryVersionId: null,
      evidenceToken: review.evidenceToken,
    });
  }

  const after = await loadFindingEvidenceReview(sql, NEWSROOM_ID, leadId);
  return {
    leadId,
    draftId: after.draftId,
    rows: after.rows.map((row) => ({ key: row.key, judgment: row.judgment.value })),
    claimRows: after.claimRows.map((row) => ({ key: row.key, judgment: row.judgment.value })),
  };
}

async function seed() {
  const sql = await getSql();
  await ensureInvestigateSchema();
  await ensureJobsSchema();
  const user = await ownerId(sql);
  await wipe(sql);
  const story = await seedStory(sql, user);
  return { ok: true, user, ...story };
}

export const Route = createFileRoute("/api/dev-seed")({
  server: {
    handlers: {
      POST: async () => {
        /*
          The gate. A production build has no business writing fiction into a
          newsroom, and this is the one line that makes that true even if the
          route file were somehow deployed.
        */
        if (import.meta.env.PROD) {
          return new Response("Not found", { status: 404 });
        }
        try {
          const out = await seed();
          return Response.json(out);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
