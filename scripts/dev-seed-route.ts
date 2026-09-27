/*
  DEV TOOL -- NOT A ROUTE, NOT PART OF THE BUILD.

  This is the seed route the redesign shot walk (scripts/bj-redesign-p2c-shots.mjs)
  posts to. It lives here, outside src/, so nothing can serve it: it is never
  imported, tsconfig only includes "src" and "server", and the vite build never
  reads it. To re-take the captures, copy it to src/routes/api/dev-seed.ts on a
  dev server bound to 127.0.0.1:8090, then delete the copy and restore
  src/routeTree.gen.ts before committing -- exactly as the phase 2c second pass
  did. Shipping it would put a write-anything endpoint on a live paper.

  Below is the file as it was used; its own guards (404 under
  import.meta.env.PROD) stay in place.

*/
/**
 * DEV ONLY. Writes one realistic desk into the newsroom so the redesign
 * captures are of a working paper rather than an empty one.
 *
 * This file is NOT committed and must never ship. Two guards: it 404s under
 * `import.meta.env.PROD`, and the shot script only ever posts to it on a dev
 * server bound to 127.0.0.1:8090.
 *
 * Why a route and not a script: the dev desk runs on PGLite, in memory, one
 * instance per process (src/lib/db.ts). Rows written by a separate `node`
 * process land in a different database and the server never sees them. The
 * only way in is over HTTP, on the same process that serves the pages.
 *
 * Everything below is insert-only fiction for screenshots. No model is called,
 * no external fetch happens, no DATABASE_URL is read.
 */

const NEWSROOM_ID = 1;

/*
  Times are computed in JS and passed as `Date`s rather than as
  `now() - $1::interval`. PGLite's scanner rejects the parameterised interval
  cast (`scanner_yyerror` on `now() - $1::interval`), and the same shape fails
  for `current_date - $1`. A `Date` binds cleanly on both backends.
*/
/* The imports the route body needs. They were dropped when the file was first
   committed as a record of the pass, which left the copy unrunnable: the first
   POST answers "getSql is not defined", then "ensureInvestigateSchema is not
   defined", then `seedSources` cannot find `SEED_SOURCES`. BJ3 restored them.

   `SEED_SOURCES` is the paper's own watch list from `src/lib/paper.ts`, which
   is what `seedSources` below keys its plan to -- `ensureNewsroomSources` re-adds
   any seed URL that is missing on every render of /desk/sources, so a row keyed
   to the real list is the only way to hold a chosen state steady. */
import { createFileRoute } from "@tanstack/react-router";
import { getSql, type Sql } from "@/lib/db";
import { ensureInvestigateSchema } from "@/lib/news/investigate";
import { ensureDarkSchema } from "@/lib/news/dark";
import { SEED_SOURCES } from "@/lib/paper";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);
const dateOnly = (ms: number) => ago(ms).toISOString().slice(0, 10);

async function ownerId(sql: Sql): Promise<string> {
  const member = await sql<{ user_id: string }>`
    select user_id from newsroom_members where role = 'owner' order by created_at limit 1
  `;
  if (member[0]?.user_id) return member[0].user_id;
  const account = await sql<{ id: string }>`
    select id from "user" order by "createdAt" limit 1
  `;
  return account[0]?.id ?? "dev-seed-owner";
}

async function wipe(sql: Sql) {
  await sql`delete from drafts where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from editorial_requests where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from editorial_extras where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from meeting_article_revision_reviews where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from meeting_article_transcript_links where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from meeting_transcript_artifacts where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from article_body_history where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from corrections where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from page_views where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from beat_memory where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from follow_ups where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from leads where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from articles where newsroom_id = ${NEWSROOM_ID} and slug <> 'welcome-to-townreporter'`;
  await sql`delete from artifacts where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from frontier_items where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from claims where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from hypotheses where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from anomalies where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from dark_signals where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from dark_promises where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from dark_runs where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from investigations where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from source_monitors where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from desk_jobs where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from snapshots where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from sources where newsroom_id = ${NEWSROOM_ID}`;
  await sql`delete from scan_runs where newsroom_id = ${NEWSROOM_ID}`;
}

async function seedSources(sql: Sql, user: string) {
  /*
    The paper's own watch list, each row in a different state, so the Sources
    screen shows every chip the drawing shows. Using SEED_SOURCES rather than
    invented URLs matters: `ensureNewsroomSources` runs on every render of
    /desk/sources and re-adds any seed URL that is missing, so rows keyed to
    the real list are the only way to hold a chosen state steady.
  */
  const plan: {
    at: number;
    status: "accepted" | "paused";
    fetchedMin: number | null;
    error: string | null;
    changed: number;
  }[] = [
    { at: 0, status: "accepted", fetchedMin: 41, error: null, changed: 2 },
    { at: 1, status: "accepted", fetchedMin: 41, error: null, changed: 1 },
    { at: 2, status: "accepted", fetchedMin: 42, error: null, changed: 0 },
    { at: 3, status: "accepted", fetchedMin: 43, error: null, changed: 0 },
    {
      at: 4,
      status: "accepted",
      fetchedMin: 6 * 60,
      error: "HTTP 403: the page refused our fetch.",
      changed: 0,
    },
    { at: 5, status: "paused", fetchedMin: 2 * 24 * 60, error: null, changed: 0 },
    { at: 6, status: "accepted", fetchedMin: 44, error: null, changed: 0 },
    {
      at: 7,
      status: "accepted",
      fetchedMin: 6 * 60,
      error: "Timed out after 30 seconds.",
      changed: 0,
    },
    { at: 8, status: "accepted", fetchedMin: null, error: null, changed: 0 },
    { at: 9, status: "accepted", fetchedMin: null, error: null, changed: 0 },
    { at: 10, status: "accepted", fetchedMin: null, error: null, changed: 0 },
  ];

  for (const p of plan) {
    const seed = SEED_SOURCES[p.at];
    if (!seed) continue;
    const rows = await sql<{ id: number }>`
      insert into sources (user_id, newsroom_id, url, title, kind, tier, status, last_hash,
                           last_fetched_at, last_error)
      values (${user}, ${NEWSROOM_ID}, ${seed.url}, ${seed.title}, ${seed.kind}, ${seed.tier},
              ${p.status},
              ${p.fetchedMin ? `hash-${p.at}-${p.changed}` : null},
              ${p.fetchedMin ? ago(p.fetchedMin * MINUTE) : null},
              ${p.error})
      returning id
    `;
    const id = rows[0]!.id;
    /*
      Snapshot age is what makes the "N new items" chip: the screen counts
      snapshots newer than the newest scan run. The chosen ones land after it,
      the rest well before.
    */
    for (let i = 0; i < p.changed; i++) {
      await sql`
        insert into snapshots (user_id, newsroom_id, source_id, content_hash, excerpt, url,
                               fetch_status, created_at)
        values (${user}, ${NEWSROOM_ID}, ${id}, ${`snap-${p.at}-${i}`},
                ${"Council packet item 7 replaced; the utilities line moved from $2.1M to $2.6M."},
                ${seed.url}, 200, now() - interval '31 minutes')
      `;
    }
    if (p.fetchedMin) {
      await sql`
        insert into snapshots (user_id, newsroom_id, source_id, content_hash, excerpt, url,
                               fetch_status, created_at)
        values (${user}, ${NEWSROOM_ID}, ${id}, ${`baseline-${p.at}`},
                ${"Baseline captured on the last pass."}, ${seed.url}, 200,
                now() - interval '5 hours')
      `;
    }
  }

  /*
    The subreddit the rail's foot names. `getTipSubreddit` wants exactly one
    unambiguous subreddit URL on watch, and "Check r/longmont for signals" is
    the drawn label -- so it has to be here, accepted, or the button reads
    "Reddit unavailable".
  */
  await sql`
    insert into sources (user_id, newsroom_id, url, title, kind, tier, status, last_fetched_at)
    values (${user}, ${NEWSROOM_ID}, ${"https://www.reddit.com/r/longmont/"},
            ${"r/longmont"}, ${"news"}, ${"B"}, ${"accepted"}, now() - interval '40 minutes')
  `;

  // One source the scanner proposed and nobody has ruled on yet.
  await sql`
    insert into sources (user_id, newsroom_id, url, title, kind, tier, status, proposed_reason,
                         proposed_by)
    values (${user}, ${NEWSROOM_ID}, ${"https://www.timescall.com/longmont/"},
            ${"Longmont Times-Call"}, ${"news"}, ${"B"}, ${"proposed"},
            ${"Linked from three council stories this week."}, ${"scan"})
  `;
}

async function seedScans(sql: Sql, user: string) {
  /*
    Three earlier passes. `started_at` of the newest is the line the Sources
    chips are measured against, so it is deliberately late.
  */
  await sql`
    insert into scan_runs (user_id, newsroom_id, started_at, finished_at, sources_fetched,
                           leads_created, sources_proposed, sources_selected, sources_attempted,
                           sources_failed, sources_analyzed, model_batches_used, summary,
                           execution_origin)
    values (${user}, ${NEWSROOM_ID}, now() - interval '26 hours',
            now() - interval '26 hours' + interval '4 minutes', 11, 2, 0, 11, 11, 0, 11, 2,
            ${"Two leads filed from the council packet and the water-rate notice."}, ${"manual"})
  `;
  await sql`
    insert into scan_runs (user_id, newsroom_id, started_at, finished_at, sources_fetched,
                           leads_created, sources_proposed, sources_selected, sources_attempted,
                           sources_failed, sources_analyzed, model_batches_used,
                           model_batches_failed, error, execution_origin)
    values (${user}, ${NEWSROOM_ID}, now() - interval '3 hours' + interval '20 minutes',
            now() - interval '3 hours' + interval '22 minutes', 4, 0, 0, 11, 4, 0, 0, 0, 1,
            ${"HTTP 429: the model provider's usage limit was reached. Resets at 9:00 PM."},
            ${"scheduled"})
  `;
  await sql`
    insert into scan_runs (user_id, newsroom_id, started_at, finished_at, sources_fetched,
                           leads_created, sources_proposed, sources_selected, sources_attempted,
                           sources_failed, sources_analyzed, model_batches_used, summary,
                           execution_origin)
    values (${user}, ${NEWSROOM_ID}, now() - interval '50 minutes',
            now() - interval '50 minutes' + interval '3 minutes', 10, 3, 1, 12, 12, 1, 11, 2,
            ${"Three leads filed; one new source proposed."}, ${"manual"})
  `;
}

async function seedDarkDesk(sql: Sql, user: string) {
  /*
    The open file, as drawn: a question, an ordinary explanation to rule out, a
    bounded scope, six records, four open follow-up entries, and an activity
    trail with one failed capture in it.
  */
  const open = await sql<{ id: number }>`
    insert into investigations (user_id, newsroom_id, title, status, summary, hops, budget,
                                created_at, updated_at)
    values (${user}, ${NEWSROOM_ID},
            ${"Why is HOPE for Longmont's website feed publishing defaced pages?"},
            ${"open"},
            ${"Ordinary explanation to rule out first: an expired plugin or hosting compromise unrelated to the organization."},
            24, 6, now() - interval '3 days', now() - interval '6 minutes')
    returning id
  `;
  const openId = open[0]!.id;

  const artifacts: [string, string, string, number | null, string | null, string | null][] = [
    [
      "https://hopeforlongmont.org/feed",
      "hopeforlongmont.org/feed",
      "Opened the feed and captured it whole.",
      200,
      null,
      null,
    ],
    [
      "https://hopeforlongmont.org/feed",
      "Feed item titles, Sep 12 capture",
      "Found: 14 feed items replaced with spam links since Sep 19.",
      200,
      null,
      null,
    ],
    [
      "https://web.archive.org/web/20250912/hopeforlongmont.org/feed",
      "Wayback capture from Sep 12",
      "Opened the Sep 12 capture: the feed was normal.",
      200,
      null,
      null,
    ],
    [
      "https://status.hostingprovider.example/",
      "Hosting provider status page",
      "Could not open hosting provider status page (timeout).",
      0,
      "timeout",
      null,
    ],
    [
      "https://hopeforlongmont.org/wp-includes/version.php",
      "hopeforlongmont.org/wp-includes/version.php",
      "Found: the plugin version on the site is 3 years old.",
      200,
      null,
      "ocr",
    ],
    [
      "https://hopeforlongmont.org/donations",
      "hopeforlongmont.org/donations",
      "Opened the donation page; the form still posts over TLS.",
      200,
      null,
      null,
    ],
  ];
  let age = 40;
  for (const [url, title, summary, status, outcome, method] of artifacts) {
    await sql`
      insert into artifacts (user_id, newsroom_id, investigation_id, url, title, full_text,
                             classification, fetch_status, fetch_outcome, extraction_method,
                             content_hash, created_at)
      values (${user}, ${NEWSROOM_ID}, ${openId}, ${url}, ${title}, ${summary}, ${"discovered"},
              ${status}, ${outcome}, ${method}, ${`sha-${url.length}-${age}`},
              ${ago(age * MINUTE)})
    `;
    age -= 5;
  }

  for (const [label, why] of [
    ["Whether the defacement is still live on the public feed", "The feed served spam at 07:04."],
    ["Who holds the hosting account", "Nobody named on the public pages."],
    ["Whether donor data was reachable", "The donation form is third-party."],
    ["What the Sep 19 revision changed", "Only the feed changed, not the site."],
  ] as [string, string][]) {
    /*
      'investigating', not 'open': an open frontier item is also a Signals to
      review card (gatherWorthALook reads status in ('reopened','open')), and
      these four belong to the file, not to the inbox.
    */
    await sql`
      insert into frontier_items (user_id, newsroom_id, investigation_id, kind, label,
                                  label_norm, why, priority, status)
      values (${user}, ${NEWSROOM_ID}, ${openId}, ${"question"}, ${label},
              ${label.toLowerCase().trim()}, ${why}, 6, ${"investigating"})
    `;
  }

  for (const [kind, body, evidence, confidence] of [
    [
      "FACT",
      "Defacement began between Sep 12 and Sep 19. The pages are spam, not a message.",
      "Wayback captured the feed clean on Sep 12; the live feed served spam on Sep 19.",
      0.9,
    ],
    [
      "FACT",
      "The plugin version on the site is three years old.",
      "version.php read on Sep 26.",
      0.8,
    ],
    [
      "QUESTION",
      "Is the organization aware? Is donor data exposed?",
      "",
      null,
    ],
  ] as [string, string, string, number | null][]) {
    await sql`
      insert into claims (user_id, newsroom_id, investigation_id, body, kind, evidence,
                          confidence)
      values (${user}, ${NEWSROOM_ID}, ${openId}, ${body}, ${kind}, ${evidence}, ${confidence})
    `;
  }

  await sql`
    insert into hypotheses (user_id, newsroom_id, investigation_id, body, supporting,
                            contradicting, status)
    values (${user}, ${NEWSROOM_ID}, ${openId},
            ${"An expired plugin let a spam crawler write the feed, and nobody has updated it since 2022."},
            ${"Three years of no plugin updates; the feed is the only writable surface."},
            ${"The donation page is third-party and untouched, so the crawl was narrow."},
            ${"open"})
  `;

  await sql`
    insert into dark_runs (user_id, newsroom_id, investigation_id, started_at, finished_at,
                           summary, model_choice, model_effort, stop_reason, stage)
    values (${user}, ${NEWSROOM_ID}, ${openId}, now() - interval '6 minutes',
            now() - interval '4 minutes',
            ${"Read the feed, the Wayback capture and the plugin version. Two questions left."},
            ${"auto"}, ${"standard"}, ${"hop-budget"}, ${"dig"})
  `;
  await sql`
    insert into dark_runs (user_id, newsroom_id, investigation_id, started_at, finished_at,
                           error, model_choice, model_effort, stop_reason, stage)
    values (${user}, ${NEWSROOM_ID}, ${openId}, now() - interval '2 hours',
            now() - interval '2 hours' + interval '90 seconds',
            ${"Could not open hosting provider status page (timeout)."},
            ${"auto"}, ${"standard"}, ${"error"}, ${"dig"})
  `;

  await sql`
    insert into dark_signals (user_id, newsroom_id, run_id, investigation_id, name, posture,
                              signal_type, strength, confidence, observation, pathway, handoff,
                              stage, verification_status)
    select ${user}, ${NEWSROOM_ID}, r.id, ${openId}, ${"Feed rewrite on a nonprofit site"},
           ${"watch"}, ${"record-change"}, 4, 0.4,
           ${"Fourteen feed items were rewritten between Sep 12 and Sep 19."},
           ${"Ask the organization and the host whether the write path was closed."},
           ${"HOLD FOR PATTERN"}, ${"dark-desk"}, ${"unverified"}
    from dark_runs r
    where r.newsroom_id = ${NEWSROOM_ID} and r.investigation_id = ${openId}
    order by r.id desc limit 1
  `;

  // Second open file: started, thin, waiting on one record.
  const bus = await sql<{ id: number }>`
    insert into investigations (user_id, newsroom_id, title, status, summary, hops, budget,
                                created_at, updated_at)
    values (${user}, ${NEWSROOM_ID}, ${"Bus contract vendor change"}, ${"investigating"},
            ${"Waiting on one record: the amended contract has not been posted."}, 3, 5,
            now() - interval '2 days', now() - interval '70 minutes')
    returning id
  `;
  await sql`
    insert into artifacts (user_id, newsroom_id, investigation_id, url, title, full_text,
                           classification, fetch_status, content_hash, created_at)
    values (${user}, ${NEWSROOM_ID}, ${bus[0]!.id},
            ${"https://longmont.primegov.com/public/portal"},
            ${"PrimeGov agenda packet, Oct 7"},
            ${"The packet lists the vendor but the amended contract is not attached."},
            ${"discovered"}, 200, ${"sha-bus-packet"}, ${ago(80 * MINUTE)})
  `;

  // Third open file: paused mid-dig, which the drawing calls waiting on a follow-up.
  await sql`
    insert into investigations (user_id, newsroom_id, title, status, summary, pause_reason,
                                hops, budget, created_at, updated_at)
    values (${user}, ${NEWSROOM_ID}, ${"Air quality complaints near the quarry"}, ${"paused"},
            ${"Stopped mid-file to wait for the county's monitoring data."},
            ${"Waiting on Boulder County to publish the September readings."}, 9, 5,
            now() - interval '5 days', now() - interval '20 hours')
  `;

  /*
    "Set aside" (the build's third pile; the drawing names it "Waiting on an AI
    follow-up"). Two parked files so the pile is not empty.
  */
  await sql`
    insert into investigations (user_id, newsroom_id, title, status, summary, pause_reason,
                                hops, budget, created_at, updated_at)
    values (${user}, ${NEWSROOM_ID}, ${"Sandstone Ranch closure"}, ${"deferred"},
            ${"AI watching for a public notice."},
            ${"AI watching for a public notice · since Sep 26"}, 5, 5,
            now() - interval '8 days', now() - interval '2 days')
  `;
  await sql`
    insert into investigations (user_id, newsroom_id, title, status, summary, pause_reason,
                                hops, budget, created_at, updated_at)
    values (${user}, ${NEWSROOM_ID}, ${"Water tower lease renewal"}, ${"closed"},
            ${"Closed: the lease was renewed at the posted rate and nothing was hidden."},
            ${"Closed with no finding."}, 7, 5, now() - interval '12 days',
            now() - interval '4 days')
  `;
}

async function seedSignals(sql: Sql, user: string) {
  /*
    What fills "Signals to review". Anomalies are free text, so the two cards
    the drawing shows can be named exactly; the rest are ordinary new leads.
  */
  await sql`
    insert into anomalies (user_id, newsroom_id, kind, summary, url, details)
    values (${user}, ${NEWSROOM_ID}, ${"reddit-tip"},
            ${"r/longmont: water bills doubled on east side"},
            ${"https://www.reddit.com/r/longmont/comments/1f2k9x/"},
            ${"3 posts · unverified"})
  `;
  await sql`
    insert into anomalies (user_id, newsroom_id, kind, summary, url, details)
    values (${user}, ${NEWSROOM_ID}, ${"page-changed"},
            ${"Watched page changed: HHS board roster"},
            ${"https://www.svvsd.org/board/"}, ${"2 names removed"})
  `;

  const lead = await sql<{ id: number }>`
    insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls,
                       evidence, newsworthiness, created_at)
    values (${user}, ${NEWSROOM_ID}, ${"Water rates rise 6% for east-side customers"},
            ${"The adopted schedule raises the tier-2 rate for the east pressure zone."},
            ${"utilities"}, ${"new"}, ${'["https://longmont.primegov.com/public/portal"]'},
            ${"Adopted rate schedule, item 12."}, 8, now() - interval '3 hours')
    returning id
  `;
  void lead;
  await sql`
    insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls,
                       evidence, newsworthiness, created_at)
    values (${user}, ${NEWSROOM_ID}, ${"Council packet drops the downtown parking study"},
            ${"The study was funded in June and is not in the October packet."},
            ${"council"}, ${"new"}, ${'["https://longmont.primegov.com/public/portal"]'},
            ${"June appropriation, item 4; October packet has no matching line."}, 7,
            now() - interval '3 hours')
  `;
  await sql`
    insert into dark_promises (user_id, newsroom_id, who_promised, what, when_due, source_cite,
                               status)
    values (${user}, ${NEWSROOM_ID}, ${"City Manager"},
            ${"A public dashboard for the water-rate change"}, ${"end of October"},
            ${"Council meeting, Sep 23"}, ${"open"})
  `;
}

async function seedOpinion(sql: Sql, user: string) {
  /*
    One request in each drawn state. The "Published" one needs a draft whose
    headline matches a published article's headline, because that is how the
    screen decides.
  */
  const publishedHeadline = "The water-rate change deserves a plainer explanation";
  const publishedDraft = await sql<{ id: number }>`
    insert into drafts (user_id, newsroom_id, lead_id, headline, body, topic, source_urls,
                        provenance_json, form, found_note, unanswered, research_json,
                        disclosure_text, headline_source, integrity_notes)
    values (${user}, ${NEWSROOM_ID}, null, ${publishedHeadline},
            ${"The rate change is real and the schedule is public. What is not public is why the east pressure zone carries the increase alone, and the council has not said. An editorial is the right place to ask, and this one asks it once, plainly, with the numbers attached."},
            ${"opinion"}, ${'["https://longmont.primegov.com/public/portal"]'},
            ${"{}"}, ${"editorial"}, ${""}, ${"[]"}, ${"{}"}, ${""}, ${"model"},
            ${"Rate schedule cited to the adopted ordinance; no quote is unattributed."})
    returning id
  `;
  await sql`
    insert into articles (user_id, newsroom_id, slug, headline, dek, body, topic, source_urls,
                          status, published_at)
    values (${user}, ${NEWSROOM_ID}, ${"the-water-rate-change-deserves-a-plainer-explanation"},
            ${publishedHeadline},
            ${"The schedule is public. The reasoning is not."},
            ${"The rate change is real and the schedule is public. What is not public is why the east pressure zone carries the increase alone, and the council has not said."},
            ${"opinion"}, ${'[]'}, ${"published"}, now() - interval '20 hours')
  `;
  await sql`
    insert into editorial_requests (user_id, newsroom_id, subject, source_kind, source_ref,
                                    asked_for, pointers_json, model_choice, draft_id,
                                    created_at, finished_at)
    values (${user}, ${NEWSROOM_ID}, ${"The water-rate change"}, ${"paste"},
            ${"https://longmont.primegov.com/public/portal"},
            ${"An editorial arguing the reasoning should be public."}, ${"[]"}, ${"auto"},
            ${publishedDraft[0]!.id}, now() - interval '21 hours',
            now() - interval '20 hours')
  `;

  // Failed: the quota wall, which is where a usage limit lands.
  await sql`
    insert into editorial_requests (user_id, newsroom_id, subject, source_kind, source_ref,
                                    asked_for, pointers_json, model_choice, error, created_at,
                                    finished_at)
    values (${user}, ${NEWSROOM_ID}, ${"Downtown parking study"}, ${"note"}, ${""},
            ${"Why the study disappeared from the packet."}, ${"[]"}, ${"auto"},
            ${"HTTP 429: the writing model's usage limit was reached. Resets at 9:00 PM."},
            now() - interval '5 hours', now() - interval '5 hours' + interval '40 seconds')
  `;

  // Finished, but the claims check came back thin.
  const thin = await sql<{ id: number }>`
    insert into drafts (user_id, newsroom_id, lead_id, headline, body, topic, source_urls,
                        provenance_json, form, found_note, unanswered, research_json,
                        disclosure_text, headline_source, integrity_notes)
    values (${user}, ${NEWSROOM_ID}, null, ${"A quarry and a summer of complaints"},
            ${"Eleven complaints were filed between June and August. The county has not published the readings that would say whether they were justified, and this piece says so rather than guessing."},
            ${"opinion"}, ${'[]'}, ${"{}"}, ${"editorial"}, ${""}, ${"[]"}, ${"{}"}, ${""},
            ${"model"}, ${"Two claims are attributed to a single complainant."})
    returning id
  `;
  await sql`
    insert into editorial_requests (user_id, newsroom_id, subject, source_kind, source_ref,
                                    asked_for, pointers_json, model_choice, draft_id,
                                    created_at, finished_at)
    values (${user}, ${NEWSROOM_ID}, ${"Quarry complaints"}, ${"note"}, ${""},
            ${"A short piece on the complaint record."}, ${"[]"}, ${"auto"}, ${thin[0]!.id},
            now() - interval '2 days', now() - interval '2 days' + interval '2 minutes')
  `;

  // Still writing, with a live job row behind it.
  const writing = await sql<{ id: number }>`
    insert into editorial_requests (user_id, newsroom_id, subject, source_kind, source_ref,
                                    asked_for, pointers_json, model_choice, created_at)
    values (${user}, ${NEWSROOM_ID}, ${"The library's Sunday hours"}, ${"note"}, ${""},
            ${"Why Sunday hours were cut."}, ${"[]"}, ${"auto"}, now() - interval '50 seconds')
    returning id
  `;
  await sql`
    insert into desk_jobs (newsroom_id, user_id, kind, subject_id, status, stage, started_at)
    values (${NEWSROOM_ID}, ${user}, ${"editorial"}, ${writing[0]!.id}, ${"running"},
            ${"Reading the budget line"}, now() - interval '45 seconds')
  `;

  // Started, then the process died: no job, no finish -- the stalled state.
  await sql`
    insert into editorial_requests (user_id, newsroom_id, subject, source_kind, source_ref,
                                    asked_for, pointers_json, model_choice, created_at)
    values (${user}, ${NEWSROOM_ID}, ${"NextLight's franchise fee"}, ${"note"}, ${""},
            ${"Where the franchise fee actually goes."}, ${"[]"}, ${"auto"},
            now() - interval '4 hours')
  `;
}

async function seedPublished(sql: Sql, user: string) {
  const council = await sql<{ id: number }>`
    insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls,
                       newsworthiness)
    values (${user}, ${NEWSROOM_ID}, ${"Council extends the HOPE contract"}, ${"Filed from the packet."},
            ${"council"}, ${"published"}, ${'[]'}, 8)
    returning id
  `;
  const stories: [string, string, string, string, string][] = [
    [
      "longmont-council-extends-the-hope-contract",
      "Longmont council extends the HOPE contract by two years",
      "The extension passed 5-2 with no discussion of the audit.",
      "council",
      "The council voted 5-2 on Tuesday to extend its contract with HOPE for two more years. The audit the city commissioned in March was not discussed, and the extension carries the same reporting requirements as the last one.",
    ],
    [
      "water-rates-rise-six-percent-for-east-side-customers",
      "Water rates rise 6% for east-side customers",
      "The tier-2 rate change lands on one pressure zone only.",
      "utilities",
      "The adopted schedule raises the tier-2 rate for the east pressure zone by 6% starting in January. Customers in the west zone see no change. The council adopted the schedule 6-1 without a separate vote on the zone split.",
    ],
    [
      "two-names-leave-the-hhs-board-roster",
      "Two names leave the HHS board roster",
      "The roster changed quietly between meetings.",
      "schools",
      "The district's human-services board roster lost two members between the August and September meetings. The district has not said whether the departures were resignations or term expirations, and the minutes do not record either.",
    ],
  ];
  const made: number[] = [];
  for (const [slug, headline, dek, topic, body] of stories) {
    const first = slug === stories[0]![0];
    const rows = await sql<{ id: number }>`
      insert into articles (user_id, newsroom_id, lead_id, slug, headline, dek, body, topic,
                            source_urls, status, published_at)
      values (${user}, ${NEWSROOM_ID}, ${first ? council[0]!.id : null},
              ${slug}, ${headline}, ${dek}, ${body}, ${topic}, ${'[]'}, ${"published"},
              ${ago(first ? 6 * HOUR : 30 * HOUR)})
      returning id
    `;
    made.push(rows[0]!.id);
    for (const [days, views] of [
      [0, 412],
      [1, 268],
      [2, 155],
      [7, 90],
    ] as [number, number][]) {
      await sql`
        insert into page_views (newsroom_id, target, day, count)
        values (${NEWSROOM_ID}, ${`story:${slug}`}, ${dateOnly(days * DAY)}, ${views})
        on conflict (newsroom_id, target, day) do update set count = excluded.count
      `;
    }
  }
  await sql`
    insert into page_views (newsroom_id, target, day, count)
    values (${NEWSROOM_ID}, ${"site"}, ${dateOnly(0)}, 1_240)
    on conflict (newsroom_id, target, day) do update set count = excluded.count
  `;

  await sql`
    insert into corrections (user_id, newsroom_id, article_id, body, created_at)
    values (${user}, ${NEWSROOM_ID}, ${made[1]!},
            ${"An earlier version said the increase applies to both pressure zones. It applies to the east zone only."},
            now() - interval '4 hours')
  `;

  /*
    A pending correction on the third story. This is the meeting-revision
    review table, not `corrections` -- it is what draws "Review needed".
  */
  const prior = await sql<{ id: number }>`
    insert into meeting_transcript_artifacts (newsroom_id, video_id, storage_path, format,
                                              sha256, captured_at, source_method, retention_mode)
    values (${NEWSROOM_ID}, ${"hhs-board-sep"}, ${"meetings/hhs-board-sep.vtt"}, ${"vtt"},
            ${"sha256-prior-hhs"}, now() - interval '3 days', ${"youtube-captions"},
            ${"transcript-only"})
    returning id
  `;
  const current = await sql<{ id: number }>`
    insert into meeting_transcript_artifacts (newsroom_id, video_id, storage_path, format,
                                              sha256, captured_at, source_method, retention_mode)
    values (${NEWSROOM_ID}, ${"hhs-board-sep"}, ${"meetings/hhs-board-sep-rev.vtt"}, ${"vtt"},
            ${"sha256-current-hhs"}, now() - interval '10 hours', ${"youtube-captions"},
            ${"transcript-only"})
    returning id
  `;
  const link = await sql<{ id: number }>`
    insert into meeting_article_transcript_links (newsroom_id, article_id, artifact_id,
                                                  artifact_sha256, video_id, citation_snapshot)
    values (${NEWSROOM_ID}, ${made[2]!}, ${prior[0]!.id}, ${"sha256-prior-hhs"},
            ${"hhs-board-sep"},
            ${"[00:14:20] Board chair: the roster will be updated before the next meeting."})
    returning id
  `;
  await sql`
    insert into meeting_article_revision_reviews (newsroom_id, article_link_id, article_id,
                                                  video_id, prior_artifact_id,
                                                  current_artifact_id, revision_reason, status)
    values (${NEWSROOM_ID}, ${link[0]!.id}, ${made[2]!}, ${"hhs-board-sep"}, ${prior[0]!.id},
            ${current[0]!.id}, ${"hash"}, ${"pending"})
  `;

  await sql`
    insert into beat_memory (user_id, newsroom_id, entity, last_angle, article_id)
    values (${user}, ${NEWSROOM_ID}, ${"HOPE for Longmont"},
            ${"Contract extension and the missing audit."}, ${made[0]!.id})
  `;
  await sql`
    insert into follow_ups (newsroom_id, user_id, article_id, who, what, due_on, status)
    values (${NEWSROOM_ID}, ${user}, ${made[0]!.id}, ${"City Clerk"},
            ${"Ask when the March audit will be published."}, current_date + 3, ${"open"})
  `;
  await sql`
    insert into follow_ups (newsroom_id, user_id, article_id, who, what, status, answered_at,
                            reply_text)
    values (${NEWSROOM_ID}, ${user}, ${made[1]!.id}, ${"Utilities department"},
            ${"Confirm the tier-2 boundary on the published map."}, ${"answered"},
            now() - interval '2 hours',
            ${"Confirmed: the boundary follows the pressure zone, not the billing district."})
  `;
  await sql`
    insert into follow_ups (newsroom_id, user_id, who, what, due_on, status, nudged_at)
    values (${NEWSROOM_ID}, ${user}, ${"SVVSD communications"},
            ${"Why two board members left the roster."}, current_date - 2, ${"open"},
            now() - interval '1 day')
  `;
  await sql`
    insert into follow_ups (newsroom_id, user_id, who, what, status)
    values (${NEWSROOM_ID}, ${user}, ${"Former council candidate"},
            ${"Interview about the parking study."}, ${"dropped"})
  `;
}

async function seed() {
  const sql = await getSql();
  await ensureInvestigateSchema();
  await ensureDarkSchema();
  const user = await ownerId(sql);

  /*
    An onboarded paper, so `ensureNewsroomSources` will re-add any of the
    paper's seed URLs this seed does not already hold -- which is why the seed
    writes those URLs rather than its own.
  */
  await sql`
    insert into paper_settings (newsroom_id, name, city, state, location, timezone, onboarded,
                                named_outlets_revision)
    values (${NEWSROOM_ID}, ${"TownReporter Longmont"}, ${"Longmont"}, ${"Colorado"},
            ${"Longmont, Colorado"}, ${"America/Denver"}, true, 0)
    on conflict (newsroom_id) do update set onboarded = true
  `;

  await wipe(sql);
  for (const [stage, run] of [
    ["sources", seedSources],
    ["scans", seedScans],
    ["dark", seedDarkDesk],
    ["signals", seedSignals],
    ["opinion", seedOpinion],
    ["published", seedPublished],
  ] as [string, (s: Sql, u: string) => Promise<void>][]) {
    try {
      await run(sql, user);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`seed stage "${stage}" failed: ${message}`);
    }
  }

  const counts = await sql<{ what: string; n: number }>`
    select 'sources' as what, count(*)::int as n from sources where newsroom_id = ${NEWSROOM_ID}
    union all select 'scan_runs', count(*)::int from scan_runs where newsroom_id = ${NEWSROOM_ID}
    union all select 'investigations', count(*)::int from investigations where newsroom_id = ${NEWSROOM_ID}
    union all select 'artifacts', count(*)::int from artifacts where newsroom_id = ${NEWSROOM_ID}
    union all select 'claims', count(*)::int from claims where newsroom_id = ${NEWSROOM_ID}
    union all select 'articles', count(*)::int from articles where newsroom_id = ${NEWSROOM_ID}
    union all select 'editorial_requests', count(*)::int from editorial_requests where newsroom_id = ${NEWSROOM_ID}
    union all select 'follow_ups', count(*)::int from follow_ups where newsroom_id = ${NEWSROOM_ID}
    union all select 'anomalies', count(*)::int from anomalies where newsroom_id = ${NEWSROOM_ID}
    union all select 'reviews', count(*)::int from meeting_article_revision_reviews where newsroom_id = ${NEWSROOM_ID}
  `;
  return { ok: true, user, counts };
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
