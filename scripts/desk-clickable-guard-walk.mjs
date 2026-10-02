#!/usr/bin/env node
/**
 * NOTHING CLICKABLE IS PLAIN TEXT -- the measured walk (unit UI1b, step 1).
 *
 * WHAT WAS WRONG. Scott, on the live desk: "That DOES NOT look like something
 * you can click. BAD interface. There are a ton of these text strings with no
 * identifying features that it's an action. These are scattered throughout the
 * interface and they're landmines for humans." A production auditor opened the
 * desk at 881cbfe8 in a real browser and measured every clickable: 463 of them
 * had a border or fill under 3:1 against the surface behind them. The single
 * biggest cause, and the worst offenders, were Quiet-level controls drawn with
 * a 1px `--line` edge -- a hairline RULE token, 1.4:1 on the cream panel:
 *
 *     "More" arrow 86 · Read report 27 · View 25 · Edit headline 25 ·
 *     Check now 25 · Pause 25 · Open the story 11 · Back to Today 9 ·
 *     Effort… 9 · Preview as reader 9 · Story details 9 · Hold 8 · Read it 7 ·
 *     Edit 7 · Delete 7 · Clear 3 · Restore saved material 3 · Redraft… 3
 *
 * UI1a fixed the CLASS (`.btn.quiet`'s edge is `--fg2` now) and gave the risky
 * actions a real control with the four phases. This unit CONVERTS NOTHING. It
 * is the guard and the baseline the conversion is sized against -- and it is
 * designed to be RED on today's build, because most of the 463 are still there.
 *
 * WHAT THIS WALK DOES
 *
 *   1. Boots its OWN built server on its own port over in-memory PGlite, with
 *      no model reachable, signs in as the first owner, completes first-run
 *      setup, and seeds enough rows that the list pages draw REAL controls
 *      rather than empty states (leads including a held one, drafts, a
 *      published story, an opinion draft with a failed job, follow-ups, an
 *      open Dark Desk file, captured records, watch-list sources).
 *   2. Visits EVERY desk route DERIVED FROM `src/routes/desk*.tsx`, so a route
 *      added later is picked up without anybody remembering to add it here --
 *      in both themes at 1280, and in the light theme again at 390.
 *   3. On each page collects every clickable -- button, a[href], role=button,
 *      role=link, summary, input[type=button|submit], select, [onclick], and
 *      any element whose computed cursor is `pointer` -- skipping the sidebar
 *      nav, hidden elements and anything inside `[aria-hidden=true]`.
 *   4. Classifies each one against the design system's rule (README §6, §2.6,
 *      §2.9): a link that goes somewhere is an UNDERLINED link in prose; a
 *      control that does something needs an EDGE or FILL at 3:1 (WCAG 1.4.11)
 *      in the theme it is drawn in; a target is 44px tall; a disabled control
 *      still shows its edge and its reason. The arithmetic lives in
 *      `scripts/lib/clickable-guard.mjs`, where the unit tests drive it.
 *   5. Writes a machine-readable report to `$GUARD_OUT_DIR` (default
 *      `tmp-guard/`, gitignored, never committed) and prints a summary grouped
 *      by route and by accessible name with counts, plus the top 25 failing
 *      labels.
 *
 * THE EXIT CODE. The walk FAILS (exit 1) when any non-allowlisted control
 * fails. THIS UNIT IS EXPECTED TO BE RED: `scripts/desk-clickable-allowlist.json`
 * is seeded EMPTY, so today's run fails by design -- the failure count IS the
 * deliverable. So that CI is not red before UI1b has done the conversion, the
 * CI step sets `GUARD_BASELINE_ONLY=1`, which prints exactly the same report
 * and exits 0. THAT SWITCH IS TEMPORARY: the last step of UI1b deletes it (and
 * the comment that sets it) and lets the walk fail the build for real.
 *
 * NO MODEL IS REACHED: the provider ladder is pointed at an address this walk
 * proves is dead before it boots, `ANTHROPIC_API_KEY` is cleared, and both
 * unattended CLI rungs point at files that do not exist. Nothing here drafts.
 *
 * PORTS. This walk owns 3595 (its server) and leaves 3596 empty on purpose.
 * THE BRIEF ASKED FOR 3592; that port belongs to
 * `scripts/desk-narrow-width-walk.mjs`'s dead-model check, and
 * `scripts/integration-ports-are-unique.test.mjs` fails any two integration
 * files that declare the same port -- a walk and a check sharing one would let
 * whichever bound first answer both. 3595 is free and is this walk's.
 *
 * The server under test must be BUILT (`npm run build`); this walk imports
 * `.output/server/index.mjs` itself.
 *
 *   node scripts/desk-clickable-guard-walk.mjs
 *
 * Knobs: GUARD_OUT_DIR (default <repo>/tmp-guard), GUARD_BASELINE_ONLY=1
 *        (report and exit 0 -- CI's temporary switch).
 */
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl, checkedOutputPath } from "./browser-guard.mjs";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";
import {
  DESK_THEMES,
  classifyControl,
  exemptFailures,
  planVisits,
  staleAllowlistEntries,
  validateAllowlist,
} from "./lib/clickable-guard.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** This walk's own listen port; see scripts/integration-ports-are-unique.test.mjs. */
const PORT_GUARD_DESK = 3595;
/** The address a model would be reached on. NOTHING listens here. */
const PORT_GUARD_NO_MODEL = 3596;

const base = checkedUrl(`http://127.0.0.1:${PORT_GUARD_DESK}`);

/** Where the report goes. Never committed; see .gitignore. */
const OUT_DIR = checkedOutputPath(
  resolve(process.env.GUARD_OUT_DIR || join(REPO, "tmp-guard")),
  [REPO, resolve(REPO, "..")],
  "report directory",
);

/** The allowlist: `{route, name, reason}`. Seeded empty; see the file. */
const ALLOWLIST_PATH = join(REPO, "scripts", "desk-clickable-allowlist.json");

/** The temporary CI switch. The last step of UI1b removes it. */
const BASELINE_ONLY = process.env.GUARD_BASELINE_ONLY === "1";

const stamp = Date.now();
const email = `desk-guard-${stamp}@townreporter.test`;
const password = "desk-clickable-guard-pass";

const done = [];
const facts = [];
/** Every clickable this walk saw, one row each. */
const seen = [];
/** Every clickable that failed the rule, allowlist or not. */
const allFailures = [];
/** The failures left once the allowlist has taken its share. */
const failures = [];
/** Desk routes that drew no desk chrome at all -- reported, never silent. */
const unreachable = [];
/** Routes that landed on a page already measured (a redirect), reported. */
const redirects = [];
/** One row per measured page: what it drew and what it cost. */
const pages = [];

let page;
let seeded = {};

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

async function dump(err) {
  const message = err instanceof Error ? err.message : String(err);
  let url = "";
  let text = "";
  try {
    url = page?.url() ?? "";
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 1200);
  } catch {
    /* the page is already gone */
  }
  console.error(
    JSON.stringify({ ok: false, error: message, url, text, completed: done }, null, 2),
  );
  process.exit(1);
}

/** The in-memory PGlite the server booted with, or a loud failure. */
async function db() {
  const pg = await globalThis.__pgliteInstance__;
  if (!pg) throw new Error("the server booted without a PGlite instance to read");
  return pg;
}

/**
 * The address a model would be reached on, checked before anything boots.
 *
 * A stranger answering there would mean a rung of the ladder could reach a real
 * model; this walk needs none, so it refuses to start if something is there.
 */
async function preconditions() {
  const problems = [];
  let answered = false;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT_GUARD_NO_MODEL}/v1/models`, {
      signal: AbortSignal.timeout(2_000),
    });
    answered = res.ok || res.status < 500;
  } catch {
    /* nothing there, which is what this walk needs */
  }
  if (answered) {
    problems.push(
      `something is answering on http://127.0.0.1:${PORT_GUARD_NO_MODEL}/v1, which this walk ` +
        `leaves empty on purpose.`,
    );
  }
  if (process.env.ANTHROPIC_API_KEY) {
    problems.push("ANTHROPIC_API_KEY is set: a rung of the ladder could answer with a real model.");
  }
  if (problems.length) throw new Error(`preconditions:\n  ${problems.join("\n  ")}`);
}

/** Boot the BUILT server here, on this walk's own port, over in-memory PGlite. */
async function bootTheServer() {
  process.env.PORT = String(PORT_GUARD_DESK);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.BETTER_AUTH_SECRET ||= "desk-clickable-guard-secret";
  process.env.LLM_BASE_URL = `http://127.0.0.1:${PORT_GUARD_NO_MODEL}/v1`;
  process.env.LLM_MODEL = "no-model-is-reachable";
  delete process.env.TOWNREPORTER_DEEPSEEK_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.TOWNREPORTER_CODEX = "0";
  process.env.CODEX_CLI_PATH = join(REPO, "scripts/fakes/no-such-codex-cli.mjs");
  process.env.CLAUDE_CLI_PATH = join(REPO, "scripts/fakes/no-such-claude-cli.mjs");
  await import(pathToFileURL(join(REPO, ".output/server/index.mjs")).href);
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the built server never answered on ${base}`);
}

async function ownTheDesk() {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("Clickable Guard");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await fillPendingSetupCodeIfPresent(page);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("the first account owns the desk");
}

/* ──────────────────────────────── the fixtures ──────────────────────────── */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(Date.now() - ms);

const PORTAL_URL = "https://longmont.primegov.com/public/portal";
const STUDY_URL = "https://assets.longmontcolorado.gov/water/rate-study-2026.pdf";

/**
 * A desk with rows on it.
 *
 * A screen with no rows draws an empty state and no controls, and a walk that
 * measured only empty states would report a clean desk. The fixture is what
 * makes this walk measure the screens the auditor measured: the Queue with a
 * row menu and a held lead, the Sources watch list with a paused row, Drafts,
 * Published with a real story, Opinion with a piece whose job failed, the Dark
 * Desk with an open file, Follow-ups in three states, and a story page whose
 * lead carries a draft WITH claims.
 */
async function seedTheDesk() {
  const pg = await db();
  const q = (sql, params) => pg.query(sql, params);
  const userId = (await q(`select id from "user" order by "createdAt" limit 1`)).rows[0]?.id;
  must(userId, "the first-run account exists in the database");

  await q(
    `insert into paper_settings (newsroom_id, onboarded, editor_email) values (1, true, $1)
     on conflict (newsroom_id) do update set onboarded = true, editor_email = excluded.editor_email`,
    ["desk@testerville.example"],
  );
  await q(`insert into section_config (newsroom_id) values (1) on conflict do nothing`);
  for (const [i, [key, name]] of [
    ["council", "Council"],
    ["schools", "Schools"],
    ["water", "Water"],
    ["opinion", "Opinion"],
  ].entries()) {
    await q(
      `insert into newsroom_sections (newsroom_id, key, name, position, visible)
       values (1, $1, $2, $3, true) on conflict do nothing`,
      [key, name, 10 * (i + 1)],
    );
  }

  /* The captured records the published story and the draft cite. */
  const versions = await q(
    `insert into artifact_versions (user_id, newsroom_id, url, content_hash, title, full_text,
                                    fetch_status, fetch_outcome, content_type, extraction_method, captured_at)
     values
       ($1, 1, $2, 'guard-hash-ordinance', 'Ordinance 2026-57 — adopted water rate schedule',
        $3, 200, 'fetched', 'html', 'text', $4),
       ($1, 1, $5, 'guard-hash-study', '2026 water rate study — scanned copy (OCR pending)',
        '', 200, 'fetched', 'application/pdf', 'ocr-pending', $6)
     returning id`,
    [
      userId,
      PORTAL_URL,
      "Ordinance 2026-57 — water rates, adopted September 15, 2026.\n\nExhibit A. East pressure zone: $9.85 per thousand gallons, up from $5.75.",
      ago(6 * HOUR),
      STUDY_URL,
      ago(4 * HOUR),
    ],
  );
  const ordinanceId = Number(versions.rows[0].id);
  const studyId = Number(versions.rows[1].id);

  /* Leads: three new (the list, the row menus, the tabs), one held, one killed,
     one drafted -- the seeded list the brief names. */
  const notes = JSON.stringify({ todo: [], found: [], verify: [], opened: [], scratch: "" });
  const leadIds = [];
  const statuses = ["new", "new", "new", "held", "killed", "drafted"];
  for (const [i, status] of statuses.entries()) {
    const lead = await q(
      `insert into leads (user_id, newsroom_id, headline, why, topic, topic_unchosen, status,
                          source_urls, evidence, newsworthiness, notes_json, created_at)
       values ($1, 1, $2, $3, $4, false, $5, $6, $7, $8, $9, $10) returning id`,
      [
        userId,
        `Fixture lead ${i + 1}: the council takes up the annexation`,
        "The adopted schedule prices the two pressure zones differently and the ordinance says nothing about why.",
        "council",
        status,
        JSON.stringify([PORTAL_URL]),
        "Five residents spoke; the utilities director answered the usage question from memory.",
        78 - i * 6,
        notes,
        ago(7 * HOUR + i * HOUR),
      ],
    );
    leadIds.push(Number(lead.rows[0].id));
  }
  const [leadId, leadId2, leadId3, heldLeadId, , draftedLeadId] = leadIds;

  /* The draft, with a dek and CLAIMS -- the story page and the draft screen. */
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
    evidenceReconciledAt: ago(38 * MIN).toISOString(),
    nameCheck: {
      version: 1,
      checkedAt: ago(40 * MIN).toISOString(),
      checkedText: "The council takes up the annexation",
      complete: true,
      note: "Every name matched a captured record.",
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
      version_count: 2,
      capture_event_id: null,
      disappeared: false,
      role: "primary",
    },
    {
      title: "2026 water rate study — scanned copy (OCR pending)",
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
  const findings = [
    {
      text: "The adopted schedule raises the rate only inside the east pressure zone.",
      source_urls: [PORTAL_URL],
      capture_event_ids: [],
      artifact_version_ids: [ordinanceId],
      locators: ["Exhibit A"],
      excerpt: "East pressure zone: $9.85 per thousand gallons, up from $5.75.",
    },
  ];
  const draft = await q(
    `insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls,
                        integrity_notes, provenance_json, form, found_note, unanswered, research_json,
                        disclosure_text, headline_source, model_headline, model_topic, updated_at)
     values ($1, 1, $2, $3, $4, $5, 'council', $6, $7, $8, 'reported', $9, '[]', $10, $11,
             'model', $3, 'council', $12)
     returning id`,
    [
      userId,
      draftedLeadId,
      "The council takes up the annexation",
      "The adopted schedule raises the rate inside the east pressure zone and leaves the west zone alone.",
      [
        "The water-rate schedule the council adopted on September 15 raises the rate inside the east pressure zone from $5.75 to $9.85 per thousand gallons.",
        "",
        "## Claim one",
        "",
        "Exhibit A of Ordinance 2026-57 prices the two pressure zones differently.",
      ].join("\n"),
      JSON.stringify([PORTAL_URL, STUDY_URL]),
      "The zone split is quoted from Exhibit A; the usage claim is the city's, not the record's.",
      JSON.stringify(provenance),
      JSON.stringify(findings),
      JSON.stringify(research),
      "A person reviewed and edited this story. AI tools helped find records and write the first draft.",
      ago(35 * MIN),
    ],
  );
  const draftId = Number(draft.rows[0].id);

  /* An Opinion piece whose job failed -- the Opinion desk's failed row. */
  const opinion = await q(
    `insert into drafts (user_id, newsroom_id, lead_id, headline, body, topic, source_urls,
                        form, research_json, updated_at)
     values ($1, 1, null, 'The quarry has had long enough', $2, 'opinion', '[]', 'editorial', '{}', $3)
     returning id`,
    [
      userId,
      "The county says it is waiting on the operator. The state's own schedule says the reports were due in July.",
      ago(3 * HOUR),
    ],
  );
  const opinionDraftId = Number(opinion.rows[0].id);

  /* Published: one real story, so the list is a list and not an empty state. */
  await q(
    `insert into articles (user_id, newsroom_id, slug, headline, dek, body, topic, source_urls,
                           status, published_at, provenance_json, form, found_note, unanswered, disclosure_text)
     values ($1, 1, 'water-rate-increase-one-side-of-town', 'Water rates rise on the east side of town',
             $2, $3, 'water', $4, 'published', $5, $6, 'reported', $7, '[]', $8)`,
    [
      userId,
      "The adopted schedule raises the rate inside the east pressure zone and leaves the west zone alone.",
      [
        "The council adopted a new water-rate schedule on a 5-2 vote on September 15.",
        "",
        "## Claims and sources",
        "",
        "Ordinance 2026-57, Exhibit A — https://longmont.primegov.com/public/portal",
      ].join("\n"),
      JSON.stringify([PORTAL_URL, STUDY_URL]),
      ago(5 * HOUR),
      JSON.stringify(provenance),
      JSON.stringify(findings),
      "A person reviewed and edited this story. AI tools helped find records and write the first draft.",
    ],
  );

  /* The watch list: on watch, and a paused row. */
  await q(
    `insert into sources (user_id, newsroom_id, url, title, kind, tier, status)
     values ($1, 1, $2, 'Longmont City Council agendas', 'official', 'A', 'accepted'),
            ($1, 1, $3, 'Boulder County planning', 'official', 'B', 'paused'),
            ($1, 1, $4, 'SVVSD board packets', 'official', 'B', 'proposed')`,
    [userId, PORTAL_URL, STUDY_URL, "https://www.svvsd.org/board/"],
  );

  /* Follow-ups in three states, so the list draws its real chips and menus. */
  await q(
    `insert into follow_ups (newsroom_id, user_id, who, what, due_on, status, created_at, updated_at,
                             agent_kind, targets_json, schedule, model_choice, last_run_at,
                             next_run_at, last_state, finding_json)
     values
       (1, $1, 'City of Longmont', 'The amended contract has not been posted.', current_date + 3,
        'open', $2, $2, null, '[]', '', 'auto', null, null, null, '{}'),
       (1, $1, 'Boulder County', 'The September readings are not published yet.',
        current_date + 1, 'active', $2, $2, 'recheck', '[]', 'daily', 'auto', $3, $4, 'no-change',
        $5),
       (1, $1, 'SVVSD', 'The board roster changed; nobody answered.', current_date - 1, 'active',
        $2, $2, 'agenda', '[]', 'weekly', 'auto', $3, $4, 'could-not-check', $6)`,
    [
      userId,
      ago(3 * DAY),
      ago(6 * HOUR),
      new Date(Date.now() + 12 * HOUR),
      JSON.stringify({
        title: "Ordinance 2026-57",
        summary: "The posted schedule is unchanged since the last check.",
        url: PORTAL_URL,
        reason: "",
        checked_at: ago(6 * HOUR).toISOString(),
        changed: false,
      }),
      JSON.stringify({
        title: "Board roster",
        summary: "",
        url: "https://www.svvsd.org/board/",
        reason: "The page did not answer.",
        checked_at: ago(6 * HOUR).toISOString(),
        changed: false,
      }),
    ],
  );

  /* The Dark Desk: one OPEN file, with a run and a signal under it. */
  const open = await q(
    `insert into investigations (user_id, newsroom_id, title, status, summary, hops, budget, created_at, updated_at)
     values ($1, 1, 'Feed rewrite on a nonprofit site', 'investigating',
             'Fourteen feed items were rewritten between Sep 12 and Sep 19.', 6, 8, $2, $3)
     returning id`,
    [userId, ago(3 * DAY), ago(2 * HOUR)],
  );
  const openId = Number(open.rows[0].id);
  await q(
    `insert into dark_runs (user_id, newsroom_id, investigation_id, started_at, finished_at,
                            summary, model_choice, model_effort, stop_reason, stage)
     values ($1, 1, $2, $3, $4, $5, 'auto', 'standard', 'hop-budget', 'dig')`,
    [
      userId,
      openId,
      ago(6 * MIN),
      ago(4 * MIN),
      "Read the feed, the Wayback capture and the plugin version. Two questions left.",
    ],
  );
  await q(
    `insert into dark_signals (user_id, newsroom_id, run_id, investigation_id, name, posture,
                               signal_type, strength, confidence, observation, pathway, handoff,
                               stage, verification_status)
     select $1, 1, r.id, $2, 'Feed rewrite on a nonprofit site', 'watch', 'record-change', 4, 0.4,
            'Fourteen feed items were rewritten between Sep 12 and Sep 19.',
            'Ask the organization and the host whether the write path was closed.',
            'HOLD FOR PATTERN', 'dark-desk', 'unverified'
     from dark_runs r where r.investigation_id = $2 order by r.id desc limit 1`,
    [userId, openId],
  );
  await q(
    `insert into investigations (user_id, newsroom_id, title, status, summary, pause_reason,
                                 hops, budget, created_at, updated_at)
     values ($1, 1, 'Air quality complaints near the quarry', 'paused',
             'Stopped mid-file to wait for the county''s monitoring data.',
             'Waiting on Boulder County to publish the September readings.', 9, 5, $2, $3)`,
    [userId, ago(5 * DAY), ago(20 * HOUR)],
  );

  /* One job per state, each on its own subject: a running one (the running
     box), a FAILED one (the Opinion desk's failed row) and a quota refusal. */
  await q(
    `insert into desk_jobs (newsroom_id, user_id, kind, subject_id, model_choice, status, stage,
                            created_at, updated_at, started_at, beat_at)
     values (1, $1, 'draft', $2, 'deepseek-flash', 'running', 'Writing the draft', $3, $4, $3, $4)`,
    [userId, leadId2, ago(9 * MIN), ago(1 * MIN)],
  );
  await q(
    `insert into desk_jobs (newsroom_id, user_id, kind, subject_id, model_choice, status, stage,
                            error, failover_note, created_at, updated_at, started_at, finished_at)
     values (1, $1, 'opinion', $2, 'deepseek-flash', 'failed', 'Writing the editorial',
             'DeepSeek API error 429: usage limit reached; resets 11:30pm (America/Denver).',
             '', $3, $4, $3, $4)`,
    [userId, opinionDraftId, ago(40 * MIN), ago(38 * MIN)],
  );
  await q(
    `insert into desk_jobs (newsroom_id, user_id, kind, subject_id, model_choice, status, stage,
                            error, created_at, updated_at, started_at, finished_at)
     values (1, $1, 'draft', $2, 'deepseek-flash', 'failed', 'Writing the draft',
             'Cancelled by the editor', $3, $4, $3, $4)`,
    [userId, leadId3, ago(30 * MIN), ago(29 * MIN)],
  );

  seeded = { leadId, leadId2, leadId3, heldLeadId, draftId, opinionDraftId, ordinanceId };
  facts.push({ leads: statuses.length, drafts: 2, sources: 3, followUps: 3, jobs: 3 });
  step("the desk has leads (one held), drafts, a published story, watch-list sources and an open file");
}

/* ─────────────────────────────── the routes ─────────────────────────────── */

/**
 * Every desk screen this build ships, read off `src/routes/desk*.tsx`.
 *
 * The brief's own instruction, and the reason a route added later cannot be
 * forgotten: the PATH is read out of each file's own `createFileRoute`, not
 * guessed from the filename, so TanStack's conventions (`desk.ops_.$card` ->
 * `/desk/ops/$card`, `index` -> the parent) need no second copy here.
 */
async function collectDeskRoutes() {
  const dir = join(REPO, "src", "routes");
  const files = (await readdir(dir)).filter((f) => /^desk.*\.tsx$/.test(f)).sort();
  const byPath = new Map();
  for (const file of files) {
    const text = await readFile(join(dir, file), "utf8");
    const match = text.match(/createFileRoute\(\s*"([^"]+)"\s*\)/);
    if (!match) continue;
    const path = cleanRoutePath(match[1]);
    /* `/desk` is the layout (desk.tsx) and `/desk/` is the index (desk.index.tsx):
       one URL, so one visit. */
    if (!byPath.has(path)) byPath.set(path, file);
  }
  return [...byPath.entries()]
    .map(([path, file]) => ({ path, file: `src/routes/${file}` }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * A route FILE's path literal -> the ADDRESS the browser asks for.
 *
 * TanStack writes the escape INTO the literal: `desk.ops_.$card.tsx` declares
 * `createFileRoute("/desk/ops_/$card")`, and the trailing `_` there marks a
 * pathless layout -- the real address is `/desk/ops/$card`. Reading the literal
 * and skipping the cleanup made this walk ask the server for
 * `/desk/ops_/$card`, get the 404 page (which draws no desk chrome at all, so
 * the theme check failed too), and report two clickables for a screen that does
 * not exist. `[.]` is a literal dot and has to be hidden before the split.
 */
function cleanRoutePath(literal) {
  const DOT = "\u0000";
  const segments = literal.replace(/\[\.\]/g, DOT).split("/").filter(Boolean);
  const parts = [];
  for (const segment of segments) {
    if (segment === "index") continue;
    const cleaned = segment.replace(/^_+/, "").replace(/_+$/, "").replaceAll(DOT, ".");
    if (!cleaned) continue;
    parts.push(cleaned);
  }
  return parts.length ? `/${parts.join("/")}` : "/";
}

/** The address each route with a param is visited at, from the fixtures. */
function addressOf(routePath) {
  const map = {
    "/desk/ops/$card": "/desk/ops/health",
    "/desk/story/$leadId": `/desk/story/${seeded.leadId}`,
    "/desk/story/draft/$draftId": `/desk/story/draft/${seeded.draftId}`,
    "/desk/transcript/$artifactId": "/desk/transcript/1",
  };
  return map[routePath] ?? routePath;
}

/* ───────────────────────────── measuring a page ─────────────────────────── */

/**
 * Every clickable on the current page, with the raw measurements the pure
 * classifier needs. Runs IN the page; returns plain data.
 *
 * WHAT IS SKIPPED, and why each one is not a hole in the guard:
 *   - the sidebar nav (`.astra-sidebar`): the brief excludes it, and it is
 *     chrome drawn on every screen -- 57 visits would count it 57 times.
 *   - anything inside `[aria-hidden=true]`, and anything CSS-hidden: nothing
 *     an editor can press.
 *   - a box with no pixels (0x0): not on the screen at all.
 */
function collectClickables() {
  const SEL = [
    "button",
    "a[href]",
    '[role="button"]',
    '[role="link"]',
    "summary",
    'input[type="button"]',
    'input[type="submit"]',
    "select",
    "[onclick]",
  ].join(", ");
  const SIDEBAR = ".astra-sidebar";

  const shown = (el) => {
    if (el.closest(SIDEBAR)) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkVisibilityCSS: true })) return false;
    } else {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    /*
      Parked off the top or the left edge: the skip link
      (`.astra-skip`, `position: fixed; top: -100px` until it takes focus) is
      the desk's own case. It is a real control an editor reaches with Tab, but
      it is not ON the screen, and measuring it as "a link with no underline"
      would put a 60-hit false positive at the top of the report. Only the
      NEGATIVE side is checked: an element below the fold is a control an
      editor scrolls to, and skipping those would empty the report.
    */
    const rect = el.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.right <= 0) return false;
    return true;
  };

  const collapse = (text) => String(text || "").replace(/\s+/g, " ").trim();

  const accessibleName = (el) => {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const named = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      if (collapse(named)) return collapse(named);
    }
    const label = el.getAttribute("aria-label");
    if (collapse(label)) return collapse(label);
    if (el.tagName === "SELECT") {
      const chosen = el.selectedOptions?.[0]?.textContent;
      return collapse(chosen || el.getAttribute("title") || el.getAttribute("name") || "(select)");
    }
    if (el.tagName === "INPUT") {
      return collapse(el.value || el.getAttribute("title") || el.getAttribute("name") || "(input)");
    }
    const text = collapse(el.innerText || el.textContent);
    if (text) return text;
    return collapse(el.getAttribute("title") || "");
  };

  const shortSelector = (el) => {
    const tag = el.tagName.toLowerCase();
    const cls = [...el.classList].slice(0, 3).join(".");
    let out = tag + (el.id ? `#${el.id}` : "") + (cls ? `.${cls}` : "");
    const parent = el.parentElement;
    if (parent) {
      const sameTag = [...parent.children].filter((c) => c.tagName === el.tagName);
      if (sameTag.length > 1) out += `:nth-of-type(${sameTag.indexOf(el) + 1})`;
    }
    return out;
  };

  const rowFor = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const ancestors = [];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const bg = getComputedStyle(p).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)") ancestors.push(bg);
    }
    const sides = [
      ["top", "Top"],
      ["right", "Right"],
      ["bottom", "Bottom"],
      ["left", "Left"],
    ].map(([side, cap]) => ({
      side,
      width: parseFloat(style[`border${cap}Width`]) || 0,
      style: style[`border${cap}Style`],
      color: style[`border${cap}Color`],
    }));

    const own = collapse(el.innerText || el.value || el.textContent);
    const describedBy = el.getAttribute("aria-describedby");
    let reasonBeside = Boolean(describedBy || el.getAttribute("title"));
    if (!reasonBeside && el.parentElement) {
      const around = collapse(el.parentElement.innerText).replace(own, "").trim();
      reasonBeside = around.length >= 4;
    }

    return {
      tag: el.tagName.toLowerCase(),
      name: accessibleName(el).slice(0, 80),
      selector: shortSelector(el),
      text: own.slice(0, 80),
      isLink: el.tagName === "A" && el.hasAttribute("href"),
      underlined: style.textDecorationLine.includes("underline"),
      inProse: Boolean(
        el.closest("p, li, td, th, h1, h2, h3, h4, h5, h6, dd, dt, figcaption, blockquote"),
      ),
      disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
      reasonBeside,
      height: Math.round(rect.height * 10) / 10,
      ownBackground: style.backgroundColor,
      ancestorBackgrounds: ancestors,
      pageBackground:
        getComputedStyle(document.documentElement).backgroundColor || "#ffffff",
      borderSides: sides,
    };
  };

  const matched = [...document.querySelectorAll(SEL)].filter(shown);
  const inSet = new Set(matched);
  const rows = matched.map(rowFor);

  /*
    The cheap click-handler probe: an element that is not one of the tags above
    but whose computed cursor says "press me". A React onClick on a `<span>` or
    `<div>` draws a control the tag list cannot see, and those are exactly
    Scott's "text strings with no identifying features".

    ONE ROW PER CLICKABLE THING, which takes two exclusions and both matter:

      - a box that CONTAINS one of the tags above is skipped: the control
        inside it is already a row, and reporting the wrapper too would charge
        the same defect twice (and name it "Start story S Hold H Kill X", the
        whole row's text).
      - `cursor` is an INHERITED property, so a rule on a row makes every
        descendant compute to `pointer` as well. Only the element where the
        cursor is INTRODUCED -- no ancestor also a candidate -- is a control;
        without this, one clickable row was reported five times, once per
        paragraph inside it.
  */
  const pointerish = [...document.querySelectorAll("body *")].filter((el) => {
    if (!shown(el)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return getComputedStyle(el).cursor === "pointer";
  });
  const introduced = pointerish.filter(
    (el) => !pointerish.some((other) => other !== el && other.contains(el)),
  );
  const reportable = introduced.filter(
    (el) => !inSet.has(el) && !el.closest(SEL) && !el.querySelector(SEL),
  );
  for (const el of reportable) rows.push(rowFor(el));

  return { rows, pointerOnly: reportable.length };
}

/** Everything behind a page has settled before it is measured. */
async function settle() {
  try {
    await page
      .locator(".deskmain, main, .ov-head, .astra-workspace")
      .first()
      .waitFor({ timeout: 20_000 });
  } catch {
    /* A screen that draws none of those is still a screen; the body is the
       only thing every route owes. */
    await page.locator("body").waitFor({ timeout: 20_000 });
  }
  await page.waitForTimeout(500);
}

/**
 * Ask for the theme BEFORE the page loads, and PROVE the desk took it.
 *
 * The choice goes through the same localStorage key the desk's own toggle
 * writes (`src/lib/appearance.ts`: `townreporter.desk.mode`), stamped in before
 * any page script runs -- so the desk's own pre-paint script reads it and the
 * FIRST frame is already in the right palette. It is asked for and checked
 * rather than assumed, because measuring the light palette and filing it under
 * `night` is how a guard reports half a desk as clean.
 */
async function setTheme(theme) {
  await page.addInitScript((mode) => {
    try {
      localStorage.setItem("townreporter.desk.mode", mode);
    } catch {
      /* a context with storage blocked is not this walk's subject */
    }
  }, theme === "night" ? "dark" : "light");
}

/**
 * The theme the desk actually drew, checked on every measured page.
 *
 * A page with no desk shell at all is not a themed page -- it is a screen the
 * walk could not reach (a redirect, a 404), and saying "the theme did not
 * apply" about it would be a misleading failure. It is REPORTED instead, so an
 * unreachable route shows up in the run rather than quietly measuring nothing.
 */
async function assertTheme(theme, path) {
  const applied = await page.evaluate(() => {
    const shell = document.querySelector(".desk-ltr.astra, .desk-ltr");
    return {
      shell: Boolean(shell),
      night: Boolean(shell?.classList.contains("night")),
      appearance: document.documentElement.dataset.appearance ?? "",
      title: (document.querySelector("h1, h2")?.textContent ?? "").trim().slice(0, 60),
    };
  });
  if (!applied.shell) {
    unreachable.push({ path, theme, said: applied.title });
    return;
  }
  must(
    applied.night === (theme === "night"),
    `the desk did not take the ${theme} theme on ${path} ` +
      `(shell .night=${applied.night}, appearance="${applied.appearance}")`,
  );
}

/* ─────────────────────────────── the walk ───────────────────────────────── */

async function measureEveryDeskPage(routes, allowlist) {
  const plan = planVisits(routes.map((r) => r.path));
  const address = new Map(routes.map((r) => [r.path, addressOf(r.path)]));
  let pointerOnly = 0;
  let visits = 0;
  const stripSlash = (p) => (p.length > 1 ? p.replace(/\/$/, "") : p);

  for (const visit of plan) {
    const path = address.get(visit.route);
    await page.setViewportSize({
      width: visit.viewport,
      height: visit.viewport <= 500 ? 844 : 900,
    });
    await setTheme(visit.theme);
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await settle();
    await assertTheme(visit.theme, path);
    /*
      ONE MEASUREMENT PER PAGE, not per route name.

      Two desk routes do not have a screen of their own: `/desk/memory` is a
      bare redirect to `/desk/published#beat-memory` (desk.memory.tsx), and
      `/desk/setup` redirects to `/desk` once setup is done. Measuring those
      would count the same screen twice and inflate every number in this report
      -- /desk/setup alone would have added a third of the whole desk. The
      landed page has its own route in this plan, so the redirect is REPORTED
      and skipped rather than measured under two names.
    */
    const landed = stripSlash(new URL(page.url()).pathname);
    if (landed !== stripSlash(path)) {
      redirects.push({ route: visit.route, path, landed, theme: visit.theme, viewport: visit.viewport });
      console.log(`  note  ${visit.route} redirects to ${landed}; measured as its own route`);
      continue;
    }
    const { rows, pointerOnly: extras } = await page.evaluate(collectClickables);
    pointerOnly += extras;
    visits += 1;

    const heading = await page
      .locator("h1, h2")
      .first()
      .innerText()
      .then((t) => t.replace(/\s+/g, " ").trim().slice(0, 80))
      .catch(() => "");
    const onThisPage = [];
    for (const row of rows) {
      const verdict = classifyControl(row);
      const record = {
        route: visit.route,
        path,
        theme: visit.theme,
        viewport: visit.viewport,
        ...row,
        kind: verdict.kind,
        failures: verdict.failures,
        notes: verdict.notes,
        edgeRatio: verdict.edgeRatio,
        fillRatio: verdict.fillRatio,
      };
      seen.push(record);
      if (!verdict.pass) {
        allFailures.push(record);
        onThisPage.push(record);
      }
    }
    const failing = exemptFailures(allowlist, onThisPage).length;
    pages.push({
      route: visit.route,
      path,
      landed,
      theme: visit.theme,
      viewport: visit.viewport,
      heading,
      clickables: rows.length,
      failing,
    });
    console.log(
      `  ${failing ? "FAIL" : "ok  "} ${visit.route} ${visit.theme}@${visit.viewport}  ` +
        `${rows.length} clickables, ${failing} failing`,
    );
  }
  facts.push({ visits, routes: routes.length, clickables: seen.length, pointerOnly });
}

/* ──────────────────────────────── the report ────────────────────────────── */

/** Count rows by a key, biggest first, ties broken by the key. */
function tally(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = key(row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

/** The report, as the structure both the JSON and the markdown are built from. */
function buildReport({ routes, allowlistProblems, staleEntries }) {
  const failing = failures;
  const byKind = tally(failing, (r) => (r.failures[0] ?? r.kind));
  const byRoute = tally(failing, (r) => `${r.route} ${r.theme}@${r.viewport}`);
  const byTheme = tally(failing, (r) => r.theme);
  const byName = tally(failing, (r) => r.name || "(no accessible name)");
  const top = byName.slice(0, 25).map(({ value: name, count }) => {
    const examples = failing.filter((r) => (r.name || "(no accessible name)") === name);
    return {
      name,
      count,
      kind: examples[0]?.failures[0] ?? "",
      routes: [...new Set(examples.map((r) => r.route))].sort(),
      selectors: [...new Set(examples.map((r) => r.selector))].slice(0, 6),
      heights: [...new Set(examples.map((r) => r.height))].sort((a, b) => a - b).slice(0, 6),
      edgeRatios: [...new Set(examples.map((r) => r.edgeRatio))].sort((a, b) => a - b).slice(0, 6),
    };
  });
  /* The two kinds that are not about an invisible edge, counted separately so
     the conversion work can be sized per kind rather than as one number. */
  const kinds = {
    noEdgeOrFill: failing.filter((r) => r.failures.includes("no edge/fill under 3:1")).length,
    linkNotUnderlined: failing.filter((r) => r.failures.includes("link not underlined")).length,
    targetUnder44: failing.filter((r) => r.failures.includes("target under 44px")).length,
  };
  const notes = tally(
    seen.filter((r) => r.notes.length),
    (r) => r.notes[0],
  );
  return {
    when: new Date().toISOString(),
    base,
    themes: DESK_THEMES,
    routes,
    allowlist: { entries: allowlistProblems.entries, problems: allowlistProblems.problems, stale: staleEntries },
    totals: {
      clickables: seen.length,
      failing: failing.length,
      routes: routes.length,
      visits: facts.find((f) => f.visits)?.visits ?? 0,
    },
    kinds,
    byKind,
    byTheme,
    byRoute,
    byName: byName.slice(0, 80),
    topFailingLabels: top,
    notes,
    pages,
    unreachable,
    redirects,
  };
}

function markdown(report) {
  const lines = [];
  lines.push("# The clickable-controls baseline (unit UI1b, step 1)");
  lines.push("");
  lines.push(`Measured ${report.when} against the built desk at ${report.base}.`);
  lines.push("");
  lines.push("## Totals");
  lines.push("");
  lines.push(`- clickables seen: **${report.totals.clickables}**`);
  lines.push(`- failing (not allowlisted): **${report.totals.failing}**`);
  lines.push(`- routes: ${report.totals.routes}, visits: ${report.totals.visits}`);
  lines.push("");
  lines.push("## Failures by kind");
  lines.push("");
  lines.push(`- no edge/fill under 3:1: **${report.kinds.noEdgeOrFill}**`);
  lines.push(`- link not underlined: **${report.kinds.linkNotUnderlined}**`);
  lines.push(`- target under 44px: **${report.kinds.targetUnder44}**`);
  lines.push("");
  lines.push("## Failures by theme");
  lines.push("");
  for (const row of report.byTheme) lines.push(`- ${row.value}: ${row.count}`);
  lines.push("");
  lines.push("## What each page drew");
  lines.push("");
  lines.push("| route | theme@width | clickables | failing | first heading |");
  lines.push("|---|---|---|---|---|");
  for (const row of report.pages) {
    lines.push(
      `| ${row.route} | ${row.theme}@${row.viewport} | ${row.clickables} | ${row.failing} | ` +
        `${String(row.heading).replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("");
  lines.push("## Failures by route");
  lines.push("");
  for (const row of report.byRoute) lines.push(`- ${row.value}: ${row.count}`);
  lines.push("");
  lines.push("## The top 25 failing labels");
  lines.push("");
  lines.push("| # | label | count | kind | routes | selector(s) |");
  lines.push("|---|---|---|---|---|---|");
  report.topFailingLabels.forEach((row, i) => {
    lines.push(
      `| ${i + 1} | ${row.name.replace(/\|/g, "\\|")} | ${row.count} | ${row.kind} | ` +
        `${row.routes.join(", ")} | \`${row.selectors.join("`, `")}\` |`,
    );
  });
  lines.push("");
  lines.push("## Failures by accessible name");
  lines.push("");
  for (const row of report.byName) lines.push(`- ${row.value}: ${row.count}`);
  lines.push("");
  if (report.notes.length) {
    lines.push("## Notes (recorded, never failed)");
    lines.push("");
    for (const row of report.notes) lines.push(`- ${row.value}: ${row.count}`);
    lines.push("");
  }
  if (report.unreachable.length) {
    lines.push("## Routes that drew no desk chrome (reported, never silent)");
    lines.push("");
    for (const row of report.unreachable) {
      lines.push(`- ${row.path} (${row.theme}): the page said "${row.said || "(no heading)"}"`);
    }
    lines.push("");
  }
  if (report.redirects.length) {
    lines.push("## Routes that redirected to a page already measured");
    lines.push("");
    for (const row of report.redirects) {
      lines.push(
        `- ${row.route} -> ${row.landed} at ${row.theme}@${row.viewport} (counted once, as ${row.landed})`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

/* ───────────────────────────────── the run ──────────────────────────────── */

async function main() {
  await preconditions();
  await bootTheServer();

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`));

  try {
    await ownTheDesk();
    await seedTheDesk();
    const routes = await collectDeskRoutes();
    step(`${routes.length} desk routes read from src/routes/desk*.tsx`);

    const allowlist = JSON.parse(await readFile(ALLOWLIST_PATH, "utf8"));
    const allowlistProblems = validateAllowlist(allowlist);
    must(
      allowlistProblems.length === 0,
      `the allowlist is not usable:\n  ${allowlistProblems.join("\n  ")}`,
    );
    step(`the allowlist is readable (${allowlist.length} entr${allowlist.length === 1 ? "y" : "ies"})`);

    await measureEveryDeskPage(routes, allowlist);
    failures.push(...exemptFailures(allowlist, allFailures));
    const visits = facts.find((f) => f.visits)?.visits ?? 0;
    step(`${seen.length} clickables measured over ${visits} visits`);

    /* The self-check the brief asks for: a run that measured one theme would
       otherwise read as a clean bill of health for the other. */
    const themesSeen = [...new Set(seen.map((r) => r.theme))].sort();
    assert.deepEqual(
      themesSeen,
      [...DESK_THEMES].sort(),
      "both themes must have been measured; this walk is red on purpose, but a theme it never visited is silence",
    );
    step(`both themes were measured (${themesSeen.join(", ")})`);

    const staleEntries = staleAllowlistEntries(allowlist, failures);
    must(
      staleEntries.length === 0,
      `these allowlist entries match no failure any more and must be deleted:\n  ` +
        staleEntries.map((e) => `${e.route} ${e.name}`).join("\n  "),
    );
    const remaining = failures;

    const report = buildReport({
      routes,
      allowlistProblems: { entries: allowlist.length, problems: allowlistProblems },
      staleEntries,
    });
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");
    await writeFile(join(OUT_DIR, "report.md"), markdown(report), "utf8");
    await writeFile(join(OUT_DIR, "failures.json"), JSON.stringify(failures, null, 2), "utf8");

    console.log("\n" + markdown(report));
    console.log(`\nReport: ${join(OUT_DIR, "report.json")} and ${join(OUT_DIR, "report.md")}`);
    facts.push({ failing: remaining.length, consoleErrors: consoleErrors.length });
    step(`the report is written to ${OUT_DIR}`);

    await browser.close();

    if (remaining.length && !BASELINE_ONLY) {
      console.error(
        `\nthe walk is RED on purpose: ${remaining.length} clickable control(s) are plain text, ` +
          `do not read as links, or are under 44px. This unit measured them; UI1b's next steps convert them.`,
      );
      process.exit(1);
    }
    if (remaining.length) {
      console.log(
        `\nGUARD_BASELINE_ONLY=1 (TEMPORARY, removed by UI1b's last step): ` +
          `${remaining.length} failure(s) reported, exit 0.`,
      );
    }
    console.log(
      JSON.stringify(
        { ok: true, baselineOnly: BASELINE_ONLY, steps: done.length, facts, totals: report.totals, kinds: report.kinds },
        null,
        2,
      ),
    );
    process.exit(0);
  } catch (err) {
    await dump(err);
  }
}

await main();
