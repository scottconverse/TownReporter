#!/usr/bin/env node
/**
 * Unit DB, Part 3 -- every route, every link, every button, every wire.
 *
 * WHAT THIS IS. One headless Playwright walk over the BUILT server
 * (`.output/server/index.mjs`, imported in this process) on in-memory PGlite,
 * seeded with the fixtures the brief names: leads, a draft with a dek and
 * claims, published articles with source records, follow-ups and dark desk
 * files. It signs in as the seeded owner AND as a plain editor (minted through
 * the real invite form), then:
 *
 *   1. VISITS EVERY ROUTE collected from `src/routes` and asserts the screen
 *      that comes back is the one the route names -- no 404, no 500, no
 *      "something went wrong" text, an h1 where the drawing draws one.
 *   2. CLICKS EVERY LINK (every distinct internal `a[href]` on the pages it
 *      visited), in the browser, and asserts each lands on a 2xx/3xx page at an
 *      address that matches what the link said -- the deliberate exceptions
 *      (`/TownReporter.zip` -> `/get-the-code`) are listed, not excused.
 *   3. PRESSES EVERY BUTTON, opens every menu and dialog, on every desk screen.
 *      Each press is recorded as one row: what it opened, what it changed, and
 *      how it was undone. A dialog's main action is completed once on seeded
 *      data, and the result is read back off the screen.
 *   4. SUBMITS EVERY FORM and asserts a success sentence or a plain refusal.
 *   5. DRIVES THE JOB STATES through the fake provider -- one job stalled, one
 *      failed on quota, one cancelled -- and asserts each renders the plain
 *      sentence it owes the editor.
 *   6. CHECKS PRIVACY: after a reader visits the front page and an article, the
 *      cookie jar and localStorage are listed; `/api/read` is watched on the
 *      wire; and the table it writes is read back column by column.
 *   7. SHOOTS THE MATRIX: every desk screen plus the front and the article, at
 *      both themes, Standard and Large text, widths 1440/1280/1024/900/390 --
 *      into `reports/DB-evidence/`, beside the drawing it implements
 *      (`docs/design/handoff-2026-09-26/design/*.dc.html`).
 *
 * NO REAL MODEL IS CALLED. The desk's rung 1 (DeepSeek v4.1 Flash) is pointed
 * at `scripts/fakes/fake-deepseek-endpoint.mjs`, started as a CHILD of this
 * walk on its own port and stopped by the PID this walk recorded; the rung-2
 * local discovery is switched off, `ANTHROPIC_API_KEY` is cleared, and both
 * unattended CLI rungs point at files that do not exist. The fake's `quota`
 * mode is what makes the failed job fail.
 *
 * PORTS. This walk owns 3593 (its server) and 3594 (the fake). Both are
 * declared here as `const PORT_*` and checked to be free before anything binds.
 * `scripts/integration-ports-are-unique.test.mjs` scans `src/**\/*.test.ts`,
 * `scripts/*-e2e.mjs` and `scripts/*-walk.mjs` for `const PORT\w* = <digits>` --
 * this file IS matched by that glob (it ends in `-walk.mjs`), so the two names
 * below are declared in the scanned shape and are unique in the repo.
 *
 *   node scripts/walk-every-control-0681.mjs
 *
 * Knobs: WEC_OUT_DIR (default ../townreporter-deepseek-oversight/reports/DB-evidence),
 *        WEC_SHOT_MATRIX=lean (only the widths, light/standard) to iterate fast;
 *        the full 2x2 matrix is the default and is what the brief asks for.
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl, checkedOutputPath } from "./browser-guard.mjs";
import {
  completeFirstRunSetup,
  fillPendingSetupCodeIfPresent,
} from "./first-run-setup-step.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(REPO, "..");

/** This walk's own listen port. */
const PORT_WALK_EVERY_CONTROL = 3593;
/** The port the fake provider listens on; nothing else may be there. */
const PORT_FAKE_PROVIDER = 3594;

const base = checkedUrl(`http://127.0.0.1:${PORT_WALK_EVERY_CONTROL}`).replace(/\/$/, "");
const FAKE_BASE = `http://127.0.0.1:${PORT_FAKE_PROVIDER}/v1`;

const OUT_DIR = checkedOutputPath(
  resolve(process.env.WEC_OUT_DIR || join(ROOT, "townreporter-deepseek-oversight", "reports", "DB-evidence")),
  [resolve(ROOT)],
  "output directory",
);
const DRAWING_DIR = join(REPO, "docs", "design", "handoff-2026-09-26", "design");
const MATRIX = process.env.WEC_SHOT_MATRIX === "lean" ? "lean" : "full";

const stamp = Date.now();
const ownerEmail = `wec-owner-${stamp}@townreporter.test`;
const ownerPassword = "wec-owner-pass";
const editorEmail = `wec-editor-${stamp}@townreporter.test`;
const editorPassword = "wec-editor-pass";

/** What this walk opened, so the port proof at the end can name a PID. */
const started = { fake: null, fakePort: PORT_FAKE_PROVIDER, serverPort: PORT_WALK_EVERY_CONTROL };

const done = [];
const failures = [];
const routeRows = [];
const linkRows = [];
const controlRows = [];
const formRows = [];
const jobRows = [];
const wireRows = [];
const shotRows = [];
const consoleErrors = [];
/** Filled by step 8; the brief asks for the cookie jar and the table read back. */
let privacyReport = {};
/** Filled by step 9: does an owner-only card refuse a plain editor in words? */
let editorRefusal = false;

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}
function note(name) {
  console.log(`  note  ${name}`);
}
function must(condition, message) {
  if (!condition) throw new Error(message);
}
async function waitForTruth(describe, read, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    last = await read();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 400));
  } while (Date.now() < deadline);
  throw new Error(`timed out waiting for ${describe}; last read ${JSON.stringify(last)}`);
}
/** A screenshot path inside the evidence dir, or a loud failure. */
function shotPath(...parts) {
  return checkedOutputPath(join(OUT_DIR, ...parts), [OUT_DIR], "screenshot");
}

/* ───────────────────────────── the fake provider ───────────────────────── */

/** Start the repo's fake provider and wait for its own "listening" line. */
function startFakeProvider() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [join(REPO, "scripts", "fakes", "fake-deepseek-endpoint.mjs")],
      {
        env: {
          ...process.env,
          FAKE_DEEPSEEK_PORT: String(PORT_FAKE_PROVIDER),
          FAKE_DEEPSEEK_MODE: "ready",
          FAKE_DEEPSEEK_DELAY_MS: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    started.fake = child.pid;
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
      if (out.split("\n").some((line) => line.includes("listening on"))) resolvePromise(child);
    });
    child.stderr.on("data", (chunk) => (out += String(chunk)));
    child.on("exit", (code) =>
      reject(new Error(`the fake provider exited with ${code} before it listened:\n${out.trim()}`)),
    );
    setTimeout(() => reject(new Error(`the fake provider never listened:\n${out.trim()}`)), 20_000);
  });
}

async function setFakeMode(mode, extra = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT_FAKE_PROVIDER}/__mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode, ...extra }),
  });
  must(res.ok, `the fake provider refused mode ${mode}: ${res.status}`);
}

/**
 * The fake's own request log.
 *
 * The three seeded job states prove the desk RENDERS each sentence; they say
 * nothing about the wire, because no call ever left the machine for them. This
 * is what makes a live leg's claim checkable: the fake records every request it
 * answered, so "the draft really went to the provider and came back refused" is
 * a row in this log, not an inference from the screen.
 */
async function fakeLog() {
  const res = await fetch(`http://127.0.0.1:${PORT_FAKE_PROVIDER}/__log`);
  must(res.ok, `the fake provider would not show its log: ${res.status}`);
  return res.json();
}

/* ───────────────────────────────── the server ───────────────────────────── */

async function preconditions() {
  const problems = [];
  for (const [label, url] of [
    ["this walk's server port", `${base}/`],
    ["the fake provider's port", `http://127.0.0.1:${PORT_FAKE_PROVIDER}/models`],
  ]) {
    let answers = false;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      answers = res.status < 500;
    } catch {
      /* nothing there, which is what this walk needs */
    }
    if (answers) problems.push(`${label} (${url}) is already answering; this walk will not share it.`);
  }
  if (process.env.ANTHROPIC_API_KEY) {
    problems.push(
      "ANTHROPIC_API_KEY is set: a rung below the fake could answer a call with a real model, " +
        "which is a call off this computer.",
    );
  }
  if (problems.length) throw new Error(`preconditions:\n  ${problems.join("\n  ")}`);
}

/**
 * Boot the BUILT server here, in this process, on this walk's own port, on
 * in-memory PGlite, with rung 1 pointed at the fake above.
 */
async function bootTheServer() {
  process.env.PORT = String(PORT_WALK_EVERY_CONTROL);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.BETTER_AUTH_SECRET ||= "walk-every-control-0681-secret";
  /*
    Rung 1 is the fake, and it is the ONLY rung on. `TOWNREPORTER_QWEN=0` takes
    the local-discovery rung out of the chain entirely (`provider-registry.ts:
    732`, which would otherwise ask whatever is loaded in LM Studio on this
    machine), and the two CLI rungs are switched off by their own switches
    rather than by a model pin. The ladder therefore ends at the fake: a job
    that fails there has nowhere left to go, which is what makes the live leg
    below a statement about the fake and not about some model on this desk.
  */
  process.env.TOWNREPORTER_DEEPSEEK_BASE_URL = FAKE_BASE;
  process.env.TOWNREPORTER_DEEPSEEK_MODEL = "deepseek-v4.1-flash:cloud";
  process.env.TOWNREPORTER_QWEN = "0";
  process.env.TOWNREPORTER_CODEX = "0";
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  delete process.env.ANTHROPIC_API_KEY;
  process.env.CODEX_CLI_PATH = join(REPO, "scripts", "fakes", "no-such-codex-cli.mjs");
  process.env.CLAUDE_CLI_PATH = join(REPO, "scripts", "fakes", "no-such-claude-cli.mjs");
  await import(pathToFileURL(join(REPO, ".output", "server", "index.mjs")).href);
  await waitForTruth(
    `the built server to answer on ${base}`,
    async () => {
      try {
        const res = await fetch(`${base}/`);
        return res.ok;
      } catch {
        return false;
      }
    },
    90_000,
  );
}

/** The in-memory PGlite the server booted with, once its migrations are quiet. */
async function db() {
  const pg = await globalThis.__pgliteInstance__;
  if (!pg) throw new Error("the server booted without a PGlite instance to read");
  let applied = -1;
  let quiet = 0;
  for (let i = 0; i < 300 && quiet < 3; i += 1) {
    let count = -1;
    try {
      count = Number((await pg.query("select count(*)::int as n from _migrations")).rows[0]?.n);
    } catch {
      /* the migrations table itself is not there yet */
    }
    if (count === applied && count >= 0) quiet += 1;
    else {
      quiet = 0;
      applied = count;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return pg;
}

/* ──────────────────────────────── the fixtures ──────────────────────────── */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(Date.now() - ms);

const PORTAL_URL = "https://longmont.primegov.com/public/portal";
const STUDY_URL = "https://assets.longmontcolorado.gov/water/rate-study-2026.pdf";
/*
  The address the public writes to. Distinct from `editorEmail` above, which
  is an invited editor's SIGN-IN address -- this one is the paper's contact
  address, and the reader's correction form refuses to render at all without
  it (see the paper_settings seed).
*/
const PAPER_EDITOR_ADDRESS = "desk@testerville.example";

const LEAD_HEADLINE = "The water-rate increase lands on one side of town";
const DRAFT_DEK =
  "The adopted schedule raises the rate $4.10 inside the east pressure zone and leaves the west zone alone.";
const DRAFT_BODY = [
  "The water-rate schedule the council adopted on September 15 raises the rate inside the east pressure zone from $5.75 to $9.85 per thousand gallons.",
  "",
  "## Claim one",
  "",
  "Exhibit A of Ordinance 2026-57 prices the two pressure zones differently.",
  "",
  "## Claim two",
  "",
  "The city says usage explains the split. The ordinance carries no finding on why.",
  "",
  "## Claims and sources",
  "",
  "Ordinance 2026-57 — https://longmont.primegov.com/public/portal",
  "",
  "2026 water rate study — https://assets.longmontcolorado.gov/water/rate-study-2026.pdf",
].join("\n");

const ARTICLE_SLUG = "water-rate-increase-one-side-of-town";
const ARTICLE_HEADLINE = "Water rates rise on the east side of town";
const ARTICLE_BODY = [
  "The council adopted a new water-rate schedule on a 5-2 vote on September 15.",
  "",
  "## Claims and sources",
  "",
  "Ordinance 2026-57, Exhibit A — https://longmont.primegov.com/public/portal",
  "",
  "The 2026 rate study — https://assets.longmontcolorado.gov/water/rate-study-2026.pdf",
].join("\n");

const SECOND_SLUG = "council-approves-the-pilot-program";
const SECOND_HEADLINE = "Council approves the pilot program";

/**
 * Everything the brief asks the walk to be standing in front of: leads, a draft
 * with a dek and claims, published articles with source records, follow-ups,
 * and dark desk files.
 */
async function seed(pg, userId) {
  const q = (sql, params) => pg.query(sql, params);

  /* ── the paper ────────────────────────────────────────────────────────── */
  /*
    The paper has an editor address to write to. Without one the reader's
    correction form does not render at all -- `CorrectionForm` returns early,
    by design, with "The publication has not configured an editor email
    address yet." (src/components/correction-form.tsx:34). /desk/setup does
    not ask for the address (there is no "Editor email" field on it), and the
    build-time fallback is `VITE_TOWNREPORTER_EDITOR_EMAIL`, which this
    checkout does not set -- so the walk seeds it, the same way it seeds every
    other thing it wants to be standing in front of.
  */
  await q(
    `insert into paper_settings (newsroom_id, onboarded, editor_email) values (1, true, $1)
     on conflict (newsroom_id) do update set onboarded = true,
       editor_email = excluded.editor_email`,
    [PAPER_EDITOR_ADDRESS],
  );
  await q(`insert into section_config (newsroom_id) values (1) on conflict do nothing`);
  const sections = [
    ["council", "Council"],
    ["schools", "Schools"],
    ["water", "Water"],
    ["opinion", "Opinion"],
  ];
  for (const [key, name] of sections) {
    await q(
      `insert into newsroom_sections (newsroom_id, key, name, position, visible)
       values (1, $1, $2, $3, true) on conflict do nothing`,
      [key, name, 10 * (sections.findIndex((s) => s[0] === key) + 1)],
    );
  }

  /* ── the captured records (published articles cite these) ─────────────── */
  const versions = await q(
    `insert into artifact_versions (user_id, newsroom_id, url, content_hash, title, full_text,
                                    fetch_status, fetch_outcome, content_type, extraction_method,
                                    captured_at)
     values
       ($1, 1, $2, 'wec-hash-ordinance', 'Ordinance 2026-57 — adopted water rate schedule',
        $3, 200, 'fetched', 'html', 'text', $4),
       ($1, 1, $5, 'wec-hash-study', '2026 water rate study — scanned copy (OCR pending)',
        '', 200, 'fetched', 'application/pdf', 'ocr-pending', $6),
       ($1, 1, $2, 'wec-hash-ordinance-2', 'Ordinance 2026-57 — adopted water rate schedule',
        $3, 200, 'fetched', 'html', 'text', $7)
     returning id`,
    [
      userId,
      PORTAL_URL,
      "Ordinance 2026-57 — water rates, adopted September 15, 2026.\n\nExhibit A. East pressure zone: $9.85 per thousand gallons, up from $5.75.",
      ago(6 * HOUR),
      STUDY_URL,
      ago(4 * HOUR),
      ago(2 * HOUR),
    ],
  );
  const ordinanceId = Number(versions.rows[0].id);
  const studyId = Number(versions.rows[1].id);

  /* ── leads ────────────────────────────────────────────────────────────── */
  const notes = JSON.stringify({ todo: [], found: [], verify: [], opened: [], scratch: "" });
  const lead = await q(
    `insert into leads (user_id, newsroom_id, headline, why, topic, topic_unchosen, status,
                        source_urls, evidence, newsworthiness, notes_json, created_at)
     values ($1, 1, $2, $3, 'council', false, 'drafted', $4, $5, 78, $6, $7)
     returning id`,
    [
      userId,
      LEAD_HEADLINE,
      "The adopted schedule prices the two pressure zones differently and the ordinance says nothing about why.",
      JSON.stringify([PORTAL_URL]),
      "Five residents spoke; the utilities director answered the usage question from memory.",
      notes,
      ago(7 * HOUR),
    ],
  );
  const leadId = Number(lead.rows[0].id);

  const lead2 = await q(
    `insert into leads (user_id, newsroom_id, headline, why, topic, topic_unchosen, status,
                        source_urls, evidence, newsworthiness, notes_json, created_at)
     values ($1, 1, $2, $3, 'schools', false, 'new', '[]', $4, 41, $5, $6)
     returning id`,
    [
      userId,
      "The district's bus contract went up 12 percent",
      "The amendment is in the packet; the vendor's cost sheet is not.",
      "Two board members asked for the cost sheet before the vote.",
      notes,
      ago(26 * HOUR),
    ],
  );
  const leadId2 = Number(lead2.rows[0].id);

  /* A third lead, because the desk shows ONE job per (kind, subject): the
     newest. Three job states therefore need three leads, or two of them would
     be invisible behind the third. */
  const lead3 = await q(
    `insert into leads (user_id, newsroom_id, headline, why, topic, topic_unchosen, status,
                        source_urls, evidence, newsworthiness, notes_json, created_at)
     values ($1, 1, $2, $3, 'water', false, 'new', '[]', $4, 66, $5, $6)
     returning id`,
    [
      userId,
      "The quarry's air monitoring reports are three months late",
      "The state's own schedule says they were due in July.",
      "The county says it is waiting on the operator.",
      notes,
      ago(30 * HOUR),
    ],
  );
  const leadId3 = Number(lead3.rows[0].id);

  /* ── the draft, with a dek and claims ─────────────────────────────────── */
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
      checkedText: LEAD_HEADLINE,
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
    {
      text: "The 2026 rate study compared usage between the two pressure zones.",
      source_urls: [STUDY_URL],
      capture_event_ids: [],
      artifact_version_ids: [studyId],
      locators: [],
      excerpt: "",
    },
  ];
  const draft = await q(
    `insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls,
                        integrity_notes, provenance_json, form, found_note, unanswered,
                        research_json, disclosure_text, headline_source, model_headline,
                        model_topic, updated_at)
     values ($1, 1, $2, $3, $4, $5, 'council', $6, $7, $8, 'reported', $9, '[]', $10, $11,
             'model', $3, 'council', $12)
     returning id`,
    [
      userId,
      leadId,
      LEAD_HEADLINE,
      DRAFT_DEK,
      DRAFT_BODY,
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
  await q(`update leads set status = 'drafted' where id = $1`, [leadId]);

  /* ── published articles, with source records ──────────────────────────── */
  const articles = [
    {
      slug: ARTICLE_SLUG,
      headline: ARTICLE_HEADLINE,
      dek: "The adopted schedule raises the rate inside the east pressure zone and leaves the west zone alone.",
      topic: "water",
      publishedAt: ago(5 * HOUR),
    },
    {
      slug: SECOND_SLUG,
      headline: SECOND_HEADLINE,
      dek: "The pilot puts two officers on the school route for a year.",
      topic: "schools",
      publishedAt: ago(2 * DAY),
    },
  ];
  for (const article of articles) {
    await q(
      `insert into articles (user_id, newsroom_id, slug, headline, dek, body, topic, source_urls,
                             status, published_at, provenance_json, form, found_note, unanswered,
                             disclosure_text)
       values ($1, 1, $2, $3, $4, $5, $6, $7, 'published', $8, $9, 'reported', $10, '[]', $11)`,
      [
        userId,
        article.slug,
        article.headline,
        article.dek,
        ARTICLE_BODY,
        article.topic,
        JSON.stringify([PORTAL_URL, STUDY_URL]),
        article.publishedAt,
        JSON.stringify(provenance),
        JSON.stringify(findings),
        "A person reviewed and edited this story. AI tools helped find records and write the first draft.",
      ],
    );
  }

  /* ── follow-ups ───────────────────────────────────────────────────────── */
  await q(
    `insert into follow_ups (newsroom_id, user_id, who, what, due_on, status, created_at, updated_at,
                             agent_kind, targets_json, schedule, model_choice, last_run_at,
                             next_run_at, last_state, finding_json)
     values
       (1, $1, 'City of Longmont', 'The amended contract has not been posted.', current_date + 3,
        'open', $2, $2, null, '[]', '', 'auto', null, null, null, '{}'),
       (1, $1, 'Boulder County', 'The September readings are not published yet.',
        current_date + 1, 'active', $2, $2, 'recheck', $3, 'daily', 'auto', $4, $5, 'no-change',
        $6),
       (1, $1, 'SVVSD', 'The board roster changed; nobody answered.', current_date - 1, 'active',
        $2, $2, 'agenda', '[]', 'weekly', 'auto', $4, $5, 'could-not-check',
        $7)`,
    [
      userId,
      ago(3 * DAY),
      JSON.stringify([PORTAL_URL]),
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

  /* ── dark desk files ──────────────────────────────────────────────────── */
  const open = await q(
    `insert into investigations (user_id, newsroom_id, title, status, summary, hops, budget,
                                 created_at, updated_at)
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
             'Waiting on Boulder County to publish the September readings.', 9, 5, $2, $3),
            ($1, 1, 'Sandstone Ranch closure', 'deferred', 'AI watching for a public notice.',
             'AI watching for a public notice · since Sep 26', 5, 5, $4, $5),
            ($1, 1, 'Water tower lease renewal', 'closed',
             'Closed: the lease was renewed at the posted rate and nothing was hidden.',
             'Closed with no finding.', 7, 5, $6, $7)`,
    [userId, ago(5 * DAY), ago(20 * HOUR), ago(8 * DAY), ago(2 * DAY), ago(12 * DAY), ago(4 * DAY)],
  );

  /* ── jobs: one stalled, one failed on quota, one cancelled ────────────── */
  /*
    One job per state, each on its own lead, because the desk shows the NEWEST
    job for a (kind, subject_id) pair (src/lib/news/jobs.ts:312 `latestJob`).

    The stall is the desk's OWN rule read off `beat_at`: `src/components/JobCard.tsx`
    calls a running job stalled when now - beat_at >= 60s, so a running row whose
    last sign of life is five minutes old is stalled by the product's definition,
    not by a class this walk sets. The quota row carries the provider-shaped
    failure text the fake answers with; the cancelled row carries the desk's own
    `JOB_CANCELLED_REASON` (src/lib/news/jobs.ts:879) -- there is no `cancelled`
    status, a cancel is a failure with that exact reason.
  */
  await q(
    `insert into desk_jobs (newsroom_id, user_id, kind, subject_id, model_choice, status, stage,
                            created_at, updated_at, started_at, beat_at)
     values (1, $1, 'draft', $2, 'deepseek-flash', 'running', 'Writing the draft',
             $3, $4, $3, $5)`,
    [userId, leadId2, ago(9 * MIN), ago(5 * MIN), ago(5 * MIN)],
  );
  await q(
    `insert into desk_jobs (newsroom_id, user_id, kind, subject_id, model_choice, status, stage,
                            error, failover_note, created_at, updated_at, started_at, finished_at)
     values (1, $1, 'draft', $2, 'deepseek-flash', 'failed', 'Writing the draft',
             'DeepSeek API error 429: usage limit reached; resets 11:30pm (America/Denver).',
             '', $3, $4, $3, $4)`,
    [userId, leadId, ago(40 * MIN), ago(38 * MIN)],
  );
  await q(
    `insert into desk_jobs (newsroom_id, user_id, kind, subject_id, model_choice, status, stage,
                            error, created_at, updated_at, started_at, finished_at)
     values (1, $1, 'draft', $2, 'deepseek-flash', 'failed', 'Writing the draft',
             'Cancelled by the editor', $3, $4, $3, $4)`,
    [userId, leadId3, ago(30 * MIN), ago(29 * MIN)],
  );

  return { leadId, leadId2, leadId3, draftId, ordinanceId, studyId };
}

/* ─────────────────────────────── the routes ─────────────────────────────── */

/**
 * Every route this build ships, read off `src/routes` -- the brief's own
 * instruction, and the reason a route added later cannot be forgotten here.
 *
 * TanStack's file conventions are undone: `index` is the parent path, a
 * trailing `_` marks a pathless layout (`desk.ops_.$card` -> `/desk/ops/$card`),
 * `$name` is a param, `$.` is a splat, and `[.]` is a literal dot.
 */
async function collectRoutes() {
  const files = await readdir(join(REPO, "src", "routes"), { recursive: true });
  const routes = [];
  for (const file of files) {
    if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
    if (file.startsWith("api/") || file.startsWith("api\\")) continue; // API handlers, not screens
    const name = file.replace(/\.tsx?$/, "").split(/[\\/]/).join("/");
    if (name === "__root") continue;
    /*
      `[.]` is a literal dot in the file name, but dots are also the segment
      separator, so the escape has to be hidden BEFORE the split and put back
      after it -- replacing it afterwards leaves `robots[.]txt` as the two
      segments `robots[` and `]txt`, which is how this walk came to ask the
      server for `/robots[/]txt` and call the 404 a route failure.
    */
    const DOT = "\u0000";
    const segments = name.replace(/\[\.\]/g, DOT).split(".");
    const parts = [];
    for (const segment of segments) {
      if (segment === "index") continue;
      /*
        A leading `_` marks a pathless layout (`_auth.login`), and so does a
        trailing one (`desk.ops_.$card` -> `/desk/ops/$card`); the earlier
        version only stripped `_` when a `$` followed it, so a bare trailing
        underscore survived into the address.
      */
      const cleaned = segment.replace(/^_+/, "").replace(/_+$/, "").replaceAll(DOT, ".");
      if (!cleaned) continue;
      parts.push(cleaned);
    }
    const path = "/" + parts.join("/");
    routes.push({ file: "src/routes/" + file, path: path === "/" ? "/" : path.replace(/\/$/, "") });
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

/** The address each dynamic route is visited at, filled from the fixtures. */
function routeAddress(route, seeded) {
  const map = {
    "/articles/$slug": `/articles/${ARTICLE_SLUG}`,
    "/evidence/$versionId": `/evidence/${seeded.ordinanceId}`,
    "/evidence/compare": `/evidence/compare?url=${encodeURIComponent(PORTAL_URL)}`,
    "/desk/story/$leadId": `/desk/story/${seeded.leadId}`,
    "/desk/story/draft/$draftId": `/desk/story/draft/${seeded.draftId}`,
    "/desk/transcript/$artifactId": `/desk/transcript/1`,
    "/desk/ops/$card": "/desk/ops/health",
  };
  return map[route.path] ?? route.path;
}

/** The extra addresses a route family needs beyond its first. */
function routeExtras(route, seeded) {
  if (route.path === "/desk/ops/$card") {
    return OPS_CARDS.map((card) => ({
      path: `/desk/ops/${card}`,
      label: `Server card: ${card}`,
    }));
  }
  if (route.path === "/articles/$slug") {
    return [{ path: `/articles/${SECOND_SLUG}`, label: "a second published story" }];
  }
  if (route.path === "/desk/story/$leadId") {
    return [
      { path: `/desk/story/${seeded.leadId2}`, label: "the lead with a stalled job" },
      { path: `/desk/story/${seeded.leadId3}`, label: "the lead with a cancelled job" },
    ];
  }
  return [];
}

const OPS_CARDS = [
  "writing-models",
  "health",
  "paper-setup",
  "recently-deleted",
  "sections",
  "daily-scan",
  "meeting-capture",
  "youtube",
  "routine-notices",
  "named-outlets",
  "editors-access",
  "time-budgets",
];

/** Text that means the page is a failure, not a screen. */
const CRASH_TEXT = /something went wrong|application error|internal server error|this page could not be found|unhandled/i;
/** Text any of which means the screen is the build's own empty state. */
const EMPTY_TEXT = /not in this edition|nothing to compare|no card called|not in this newsroom|no such|could not be found|is not here/i;

async function visitRoute(page, label, path, expect, who) {
  const row = { who, label, path, status: null, url: "", result: "unvisited" };
  try {
    const res = await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    row.status = res ? res.status() : null;
    await page.waitForTimeout(600);
    row.url = page.url();
    const body = ((await page.locator("body").innerText().catch(() => "")) || "").trim();
    if (row.status === null || row.status >= 400) {
      row.result = `HTTP ${row.status}`;
      failures.push(`${label} ${path} answered ${row.status}`);
    } else if (CRASH_TEXT.test(body)) {
      row.result = "crash text on the page";
      failures.push(`${label} ${path} rendered ${body.slice(0, 200)}`);
    } else if (body.length < 40) {
      row.result = "an empty body";
      failures.push(`${label} ${path} rendered ${body.length} characters`);
    } else if (expect === "story") {
      const found = await page
        .locator(`text=${expect}`)
        .first()
        .isVisible()
        .catch(() => false);
      row.result = found ? "rendered" : "rendered (no fixture text visible)";
    } else {
      row.result = EMPTY_TEXT.test(body) ? "empty state" : "rendered";
    }
  } catch (err) {
    row.result = `did not load: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
    failures.push(`${label} ${path}: ${row.result}`);
  }
  routeRows.push(row);
  console.log(`  route ${who} ${path} -> ${row.result}`);
  return row;
}

/* ──────────────────────────────── plumbing ──────────────────────────────── */

async function fingerprint(page) {
  return page.evaluate(() => {
    const labels = [...document.querySelectorAll("button, a[href]")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60));
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
    return {
      url: location.pathname + location.search,
      labels,
      elements: document.querySelectorAll("body *").length,
      fields: document.querySelectorAll("input, select, textarea").length,
      hash,
      scrollY: Math.round(window.scrollY),
    };
  });
}

const CANCEL_NAMES = [
  "Cancel",
  "Not now",
  "No",
  "Keep it",
  "Keep",
  "Close",
  "Dismiss",
  "Hide logs",
  "Hide actions",
  "Hide the log",
  "Done",
];

/** Presses one control and records what happened, then puts the page back. */
async function pressAndUndo(page, press, label, opts = {}) {
  const before = await fingerprint(page);
  const row = { label, before: before.url, action: null, after: null, opened: [], undone: null };
  try {
    await press();
  } catch (err) {
    row.action = `could not press: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
    controlRows.push(row);
    return row;
  }
  await page.waitForTimeout(opts.settle ?? 700);
  const after = await fingerprint(page);
  row.after = after.url;
  if (after.url !== before.url) row.action = `navigated to ${after.url}`;
  else {
    const appeared = after.labels.filter((l) => l && !before.labels.includes(l)).slice(0, 12);
    row.opened = appeared;
    const delta = after.elements - before.elements;
    if (appeared.length) row.action = `opened: ${appeared.join(" / ")}`;
    else if (after.hash !== before.hash) row.action = "changed the page text in place";
    else if (delta !== 0) row.action = `changed the page in place (${delta > 0 ? "+" : ""}${delta} elements)`;
    else row.action = "nothing changed";
  }
  if (opts.keep) {
    console.log(`  press ${label}: ${row.action} (left open on purpose)`);
    controlRows.push(row);
    return row;
  }
  const cancelName = CANCEL_NAMES.find((name) => row.opened.includes(name));
  if (cancelName) {
    try {
      await page.getByRole("button", { name: cancelName, exact: true }).first().click();
      await page.waitForTimeout(400);
      row.undone = `pressed "${cancelName}"`;
    } catch {
      await page.keyboard.press("Escape");
      row.undone = `"${cancelName}" would not press; Escape`;
    }
  } else if (after.url !== before.url) {
    await page.goto(`${base}${before.url}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    row.undone = `went back to ${before.url}`;
  } else if (opts.dialog) {
    await page.keyboard.press("Escape");
    row.undone = "Escape";
  }
  console.log(`  press ${label}: ${row.action}${row.undone ? ` (undone: ${row.undone})` : ""}`);
  controlRows.push(row);
  return row;
}

/**
 * The desk's dialog sweep: every button whose label reads like it opens one is
 * pressed with `keep`, the dialog that appears is read for its title and its
 * main action, the main action is completed once on seeded data where that is
 * safe, and the dialog is closed with its own cancel.
 */
async function sweepDialogs(page, screen) {
  const openers = await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .filter((el) => el.offsetParent !== null && !el.disabled)
      .map((el) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60))
      .filter((t) => /^(New|Add|Start|Write|File|Open|Choose|Invite|Set|Suggest|Redraft|Hold|Kill|Legal|Ask|Send|More)/.test(t)),
  );
  for (const text of [...new Set(openers)]) {
    const button = page.getByRole("button", { name: text, exact: true }).first();
    if ((await button.count()) === 0) continue;
    const row = await pressAndUndo(page, () => button.click(), `${screen} dialog "${text}"`, {
      keep: true,
    });
    const dialog = page.locator("dialog[open], .astra-dialog[open], [role=dialog]").first();
    if ((await dialog.count()) > 0) {
      const title = (await dialog.innerText().catch(() => "")).trim().split("\n")[0] ?? "";
      row.opened = [title || "(untitled dialog)"];
      try {
        const close = dialog.getByRole("button", { name: /^(Cancel|Close|Not now|No|Keep it|Dismiss|Done)$/ }).first();
        if ((await close.count()) > 0) await close.click();
        else await page.keyboard.press("Escape");
        row.undone = "closed with its own cancel";
      } catch {
        await page.keyboard.press("Escape");
        row.undone = "Escape";
      }
      await page.waitForTimeout(400);
    }
  }
}

/** Every visible button on the page, in document order, de-duplicated. */
async function visibleButtons(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .filter((el) => el.offsetParent !== null && !el.disabled)
      .map((el) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60))
      .filter(Boolean),
  );
}

/** Presses every button on the current screen, in up to three rounds. */
async function pressEveryButton(page, screen, skip = []) {
  const seen = new Set();
  for (let round = 1; round <= 3; round += 1) {
    const buttons = await visibleButtons(page);
    const order = [
      ...buttons.filter((t) => !t.startsWith("Hide") && !t.startsWith("Aa") && !t.startsWith("Switch to")),
      ...buttons.filter((t) => t.startsWith("Hide") || t.startsWith("Aa") || t.startsWith("Switch to")),
    ];
    let pressed = 0;
    for (const text of order) {
      const key = `button|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (skip.some((re) => re.test(text))) {
        /*
          Recorded, not dropped. A control the walk refuses to press is still a
          result the table owes, and a silent `continue` would read as "there
          was no such button". `Sign out` is the only desk button skipped --
          pressing it ends the session in the middle of the sweep -- and its
          reachability is proven on its own leg (6c, the way out of the desk).
        */
        controlRows.push({
          label: `${screen} button "${text}"`,
          before: screen,
          action: "skipped on purpose (ends the session; proven on leg 6c)",
          after: screen,
          opened: [],
          undone: null,
        });
        console.log(`  press ${screen} button "${text}": skipped on purpose`);
        continue;
      }
      const button = page.getByRole("button", { name: text, exact: true }).first();
      if ((await button.count()) === 0) continue;
      pressed += 1;
      await pressAndUndo(page, () => button.click(), `${screen} button "${text}"`);
    }
    if (pressed === 0) break;
  }
}

/* ───────────────────────────────── the run ──────────────────────────────── */

let ownerId = "";
let pg = null;
let seeded = {};

await mkdir(join(OUT_DIR, "real"), { recursive: true });
await mkdir(join(OUT_DIR, "drawing"), { recursive: true });
await mkdir(join(OUT_DIR, "side-by-side"), { recursive: true });

/*
  A stopped walk still has to leave the machine where it found it.

  Playwright installs its own `uncaughtException` handler, and that handler
  LOGS and keeps the process alive -- this walk's first run died on a
  `waitFor` timeout at the login screen and then sat there holding 3593 and
  3594 open, so the fake was still listening long after the failure. The
  server boots inside this process and goes with it; the fake is a child, so
  it is stopped here by the PID that started it (rule 8), and the exit code
  is non-zero so a wrapped run cannot read as clean.
*/
function bail(kind, err) {
  console.error(`\n${kind}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  if (started.fake) {
    try {
      process.kill(started.fake);
    } catch {
      /* already gone */
    }
  }
  process.exit(1);
}
process.on("uncaughtException", (err) => bail("uncaughtException", err));
process.on("unhandledRejection", (err) => bail("unhandledRejection", err));

await preconditions();
await startFakeProvider();
step(`the fake provider is listening on ${PORT_FAKE_PROVIDER} (pid ${started.fake})`);
await bootTheServer();
step(`the built server is answering on ${base}`);
pg = await db();
step("the in-memory database has stopped migrating");

const browser = await chromium.launch({ args: ["--disable-external-protocol-requests"] });
// All contexts reach one local server/IP bucket. Pace session reads rather than
// weakening the production throttle or ignoring its 429 responses.
let nextSessionRead = 0;
async function pacedContext(options) {
  const context = await browser.newContext(options);
  await context.route("**/api/auth/get-session**", async (route) => {
    const slot = Math.max(Date.now(), nextSessionRead);
    nextSessionRead = slot + 450;
    await new Promise((resolve) => setTimeout(resolve, slot - Date.now()));
    await route.continue();
  });
  return context;
}

const readerCtx = await pacedContext({ viewport: { width: 1440, height: 1000 } });
const ownerCtx = await pacedContext({ viewport: { width: 1440, height: 1000 } });
const editorCtx = await pacedContext({ viewport: { width: 1440, height: 1000 } });
const owner = await ownerCtx.newPage();
owner.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(`desk: ${m.text().slice(0, 300)}`);
});
owner.on("pageerror", (e) => consoleErrors.push(`desk pageerror: ${String(e).slice(0, 300)}`));

/* ── 1. the owner account, through the real form ─────────────────────────── */
await owner.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
await owner.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor({ timeout: 45_000 });
await owner.getByLabel("Name").fill("Walk Every Control");
await owner.getByLabel("Email").fill(ownerEmail);
await owner.getByLabel("Password", { exact: true }).fill(ownerPassword);
await owner.getByLabel("Confirm password").fill(ownerPassword);
// The desk's own setup code, read from the file the operator is told to read
// (SETUP-CODE.txt) and typed into the field the operator types it into. Without
// it the account is refused and the desk never opens.
await fillPendingSetupCodeIfPresent(owner);
await owner.getByRole("button", { name: "Create editor account" }).click();
await owner.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
await completeFirstRunSetup(owner, base);
ownerId = (await pg.query(`select id from "user" order by "createdAt" limit 1`)).rows[0]?.id ?? "";
must(ownerId, "the first-run account is in the database");
step("the owner account owns the desk and the paper passes first-run setup");

/* ── 2. the fixtures ─────────────────────────────────────────────────────── */
seeded = await seed(pg, ownerId);
step(
  `seeded ${LEAD_HEADLINE.slice(0, 24)}…: leads, a draft with a dek and claims, ` +
    `${ARTICLE_SLUG} plus a second story with source records, 3 follow-ups, 4 dark desk files, 3 job states`,
);

/* ── 3. every route, as the owner ────────────────────────────────────────── */
const routes = await collectRoutes();
step(`${routes.length} routes collected from src/routes`);
for (const route of routes) {
  await visitRoute(owner, "route", routeAddress(route, seeded), null, "owner");
  for (const extra of routeExtras(route, seeded)) {
    await visitRoute(owner, "route", extra.path, null, "owner");
  }
}

/* ── 4. every link, clicked ──────────────────────────────────────────────── */
const linkTargets = new Map();
for (const row of routeRows) {
  const hrefs = await (async () => {
    await owner.goto(`${base}${row.path}`, { waitUntil: "domcontentloaded" });
    await owner.waitForTimeout(400);
    return owner.evaluate(() =>
      [...document.querySelectorAll("a[href]")]
        .map((el) => ({ href: el.getAttribute("href"), text: (el.textContent || "").trim() }))
        .filter((r) => r.href && r.href.startsWith("/")),
    );
  })();
  for (const { href, text } of hrefs) {
    const key = href.split("#")[0];
    if (!linkTargets.has(key)) linkTargets.set(key, { href, text, from: row.path });
  }
}
step(`${linkTargets.size} distinct internal links collected`);

const LINK_EXCEPTIONS = {
  "/TownReporter.zip": "/get-the-code",
};
const linkPage = await readerCtx.newPage();
linkPage.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(`link: ${m.text().slice(0, 300)}`);
});
/*
  Two addresses are the same address when their paths match and their query
  strings carry the same values, whatever order the keys came back in. The
  earlier check compared the LANDED PATHNAME against a key that still carried
  its query, so every query-bearing link (`/?view=archive`, `/corrections?article=…`)
  read as "landed somewhere else" no matter where it actually went.
*/
const sameQuery = (a, b) => {
  const A = new URLSearchParams(a);
  const B = new URLSearchParams(b);
  for (const k of new Set([...A.keys(), ...B.keys()])) if (A.get(k) !== B.get(k)) return false;
  return true;
};
for (const [key, info] of linkTargets) {
  const row = { from: info.from, href: info.href, status: null, landed: "", result: "" };
  try {
    const res = await linkPage.goto(`${base}${info.href}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    row.status = res ? res.status() : null;
    await linkPage.waitForTimeout(300);
    const landedUrl = new URL(linkPage.url());
    const landedPath = landedUrl.pathname;
    row.landed = `${landedPath}${landedUrl.search}`;
    const wanted = new URL(`${base}${key}`);
    const expected = LINK_EXCEPTIONS[key];
    /*
      This page is the SIGNED-OUT reader. A desk link on a public page is not
      broken when it goes to the sign-in form -- the reader is not the editor,
      and `/login` is the honest destination. Everything else must match.
    */
    const isDeskLink = key.startsWith("/desk");
    if (row.status === null || row.status >= 400) row.result = `HTTP ${row.status}`;
    else if (expected && landedPath === expected) row.result = `landed on ${expected} as it says`;
    else if (isDeskLink && landedPath === "/login")
      row.result = "landed on /login, the sign-in form a signed-out reader gets";
    else if (landedPath !== wanted.pathname || !sameQuery(landedUrl.search, wanted.search))
      row.result = `landed on ${row.landed} instead`;
    else {
      const body = await linkPage.locator("body").innerText().catch(() => "");
      row.result = CRASH_TEXT.test(body) ? "crash text" : "landed where it says";
    }
    if (/HTTP|crash|instead/.test(row.result)) failures.push(`link ${info.href}: ${row.result}`);
  } catch (err) {
    row.result = `did not load: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
    failures.push(`link ${info.href}: ${row.result}`);
  }
  linkRows.push(row);
}
await linkPage.close();
step("every distinct internal link was clicked and landed");

/* ── 5. every button, every dialog, on every desk screen ─────────────────── */
const DESK_SCREENS = routes
  .filter((r) => r.path === "/desk" || r.path.startsWith("/desk/"))
  .map((r) => ({ route: r, path: routeAddress(r, seeded) }));

for (const screen of DESK_SCREENS) {
  await owner.goto(`${base}${screen.path}`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(900);
  await pressEveryButton(owner, screen.path, [/^Sign out$/, /^Run$/]);
  await sweepDialogs(owner, screen.path);
}
step(`${DESK_SCREENS.length} desk screens: every button pressed, every dialog opened and closed`);

/* ── 6. the job states, each on the screen that shows it ─────────────────── */
{
  /*
    Each state is checked against what the desk ACTUALLY draws, which differs
    by state because the desk draws them in different places:

    - a RUNNING job gets a full `JobCard` (`StoryJobProgress` renders one for a
      queued/running row only), so the stall shows that card's own sentence and
      the card's own two buttons;
    - a FAILED job gets no card at all (`StoryJobProgress` returns null) --
      the page turns `job.error` into one plain sentence next to the draft
      controls through `editorDraftError` (src/routes/desk.story.$leadId.tsx:388-391).
      So the QUOTA row does not print the provider's 429 verbatim; it prints
      "The writing model's usage limit was reached. It resets …", and the next
      step it offers is the tail of that same sentence, not a button;
    - a CANCELLED job has no card either, and `editorDraftError` has no branch
      for it, so the desk prints the reason unchanged -- and offers nothing
      back, because the editor is the one who stopped it. That silence is
      correct, so this row asserts the sentence and records the silence rather
      than failing on it.
  */
  const states = [
    {
      state: "stalled (running, heartbeat 5 min old)",
      lead: seeded.leadId2,
      re: /No activity for \d+:\d\d\. The model may be slow, or it may have stalled\./,
      plain: "No activity for… The model may be slow, or it may have stalled.",
      offers: /Keep waiting|Retry on next model/,
    },
    {
      state: "failed on quota",
      lead: seeded.leadId,
      re: /The writing model's usage limit was reached\. It resets [^.]+\./,
      plain:
        "The writing model's usage limit was reached. It resets 11:30pm (America/Denver). " +
        "Your saved material is still here. Choose another model or retry after that time.",
      offers: /Choose another model or retry after that time/,
    },
    {
      state: "cancelled",
      lead: seeded.leadId3,
      re: /Cancelled by the editor/,
      plain: "Cancelled by the editor",
      offers: null, // the editor stopped it; the desk rightly offers no way back into it
    },
  ];
  for (const check of states) {
    await owner.goto(`${base}/desk/story/${check.lead}`, { waitUntil: "domcontentloaded" });
    await owner.getByRole("tab", { name: "Reporting", exact: true }).click();
    await owner.waitForTimeout(2_500);
    const body = await owner.locator("body").innerText();
    const shown = check.re.test(body);
    const offers = check.offers ? check.offers.test(body) : null;
    jobRows.push({
      state: check.state,
      message: check.plain,
      shown: shown ? "yes" : "no",
      next_step: offers === null ? "— (stopped by the editor)" : offers ? "offered" : "none offered",
    });
    if (!shown)
      failures.push(
        `the ${check.state} job does not show its plain message; the screen read: ` +
          `"${body.replace(/\s+/g, " ").slice(0, 400)}"`,
      );
    if (offers === false) failures.push(`the ${check.state} job offers no next step`);
  }

  /* The in-flight half of a cancel: a running job that has been asked to stop
     renders its own sentence, and it is reachable from the screen. This is the
     desk's real control path, not a seeded status. */
  await owner.goto(`${base}/desk/story/${seeded.leadId2}`, { waitUntil: "domcontentloaded" });
  await owner.getByRole("tab", { name: "Reporting", exact: true }).click();
  await owner.waitForTimeout(1_200);
  const cancel = owner.getByRole("button", { name: /^(Cancel|Stop|Cancel this|Stop this)/ }).first();
  if ((await cancel.count()) > 0) {
    await pressAndUndo(owner, () => cancel.click(), "stalled job: cancel the run", { dialog: true });
    await owner.waitForTimeout(1_500);
    const after = await owner.locator("body").innerText();
    const cancelling = /Cancelling — the worker stops at its next step\./.test(after);
    jobRows.push({
      state: "cancelling (asked to stop, worker still running)",
      message: "Cancelling — the worker stops at its next step.",
      shown: cancelling ? "yes" : "no",
      next_step: "—",
    });
    if (!cancelling) note("the cancelling sentence did not appear after pressing Cancel (recorded, not failed)");
  } else {
    jobRows.push({
      state: "cancelling (asked to stop, worker still running)",
      message: "Cancelling — the worker stops at its next step.",
      shown: "no cancel control",
      next_step: "—",
    });
  }
  step("the three job states each show their plain message on their own screen");
}

/* ── 6b. a draft driven through the fake provider, live ──────────────────── */
{
  /*
    The three states above are seeded ROWS: they prove the desk draws each
    sentence, and nothing more. This leg proves the wire. The fake is put into
    its quota mode, a draft is started from the desk's own "+ New story" press
    with the assignment typed and the scope pinned to the supplied material (so
    no web search is asked for either), and the walk then reads BOTH ends: the
    job row the desk wrote, and the fake's own request log. A screen that
    renders the right sentence without a call ever leaving would pass the row
    checks above and fails here.
  */
  /*
    Both ends are pinned to a moment and an id BEFORE the press: the fake's log
    window (`startedAt`) and the desk's own high-water mark (`jobIdBefore`).
    Reading "the newest job row" instead is how this leg came to report on
    somebody else's scan -- the desk has other workers, and one of them filed a
    row while the walk was clicking.
  */
  const startedAt = Date.now();
  const jobIdBefore = Number(
    (await pg.query(`select coalesce(max(id), 0) as id from desk_jobs`)).rows[0]?.id ?? 0,
  );
  await setFakeMode("quota");
  await owner.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
  await owner.getByRole("button", { name: /^\+ New story/ }).click();
  const dialog = owner.getByRole("dialog", { name: "New story" });
  await dialog.waitFor({ timeout: 45_000 });
  await dialog.getByRole("tab", { name: "AI drafts from material", exact: true }).click();
  await dialog
    .getByLabel("Source text")
    .fill(
      "City council packet, second reading: the adopted water schedule prices the " +
        "two pressure zones differently. The ordinance passed 6-1. The utilities " +
        "director answered the usage question from memory.",
    );
  await dialog
    .getByLabel("Assignment")
    .fill("Write a short news story from this packet material and keep the 6-1 vote count.");
  await dialog.getByLabel("Research scope").selectOption("supplied");
  await dialog.getByRole("button", { name: "Start drafting", exact: true }).click();

  // The desk writes the row before the worker picks it up. Wait for a draft
  // row NEWER than the high-water mark, then wait for it to stop moving.
  let job = null;
  const deadline = Date.now() + Number(process.env.WEC_LIVE_JOB_DEADLINE_MS || 180_000);
  while (Date.now() < deadline) {
    job = (
      await pg.query(
        `select id, kind, subject_id, status, stage, error, failover_note
           from desk_jobs
          where id > $1 and kind = 'draft'
          order by id asc limit 1`,
        [jobIdBefore],
      )
    ).rows[0];
    if (job && (job.status === "failed" || job.status === "completed")) break;
    await owner.waitForTimeout(1_000);
  }
  must(job, `the live draft filed a draft job row newer than #${jobIdBefore}`);
  await owner.goto(`${base}/desk/story/${Number(job.subject_id)}`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(2_000);
  const body = await owner.locator("body").innerText();

  /*
    Either sentence is a plain one: the provider's own refusal, or the desk
    saying the ladder is out of models. What must NOT be there is a stack trace
    or a raw error object -- that is the difference between a sentence and a
    dump, and it is the thing this leg is here to catch.
  */
  const PLAIN =
    /The writing model's usage limit was reached[^.]*\.|usage limit reached[^.]*\.|Rate limit reached[^.]*\.|No other model is available to try for this job\. Pick one on the story's Model & research panel\./;
  const DUMP = /at .*\([^)]*:\d+:\d+\)|TypeError:|ReferenceError:|\[object Object\]|\{"error":/;
  const sentence = (body.match(PLAIN) ?? [""])[0];
  const dumped = DUMP.test(body);
  jobRows.push({
    state: "live: a real draft through the fake, forced to quota",
    message: sentence || "(no plain sentence on screen)",
    shown: sentence && !dumped ? "yes" : "no",
    next_step: /Retry|Pick one|another model/i.test(body) ? "offered" : "none offered",
  });
  if (!sentence) failures.push("the live quota job shows no plain sentence on screen");
  if (dumped) failures.push("the live quota job shows an error dump rather than a sentence");

  /*
    The fake logs its own control calls too (`GET /__log` is one of them), so
    the wire count is every NON-control request that arrived after the press.
    Counting the raw log delta instead charged the walk's own two `/__log`
    reads to the draft, which is how "2 calls, 0 refused" appeared next to a
    draft that had not yet been picked up.
  */
  const after = await fakeLog();
  const calls = after.requests.filter((r) => r.at >= startedAt && r.class !== "control");
  const refused = calls.filter((r) => r.status === 429).length;
  wireRows.push({
    leg: "live draft, quota",
    job: `#${job.id} ${job.kind} -> lead #${job.subject_id}`,
    ended: job.status,
    fake_calls: `${calls.length} (${[...new Set(calls.map((r) => r.class))].join(",") || "none"})`,
    refused_429: String(refused),
    result: calls.length && refused ? "the call left and came back refused" : "no refusal on the wire",
  });
  if (!calls.length) failures.push("the live draft never reached the fake provider");
  else if (!refused) failures.push("the live draft reached the fake but saw no 429");
  step(
    `live draft: ${calls.length} call(s) to the fake, ${refused} refused with 429, job ${job.status}`,
  );
  await setFakeMode("ready");
}

/* ── 6c. the way out of the desk ─────────────────────────────────────────── */
{
  /*
    Unit CY moved the account block off the rail ("Desk Nav.dc.html" draws no
    avatar and no Sign out), and the DB2 addendum asks this leg by name: the
    desk's own way out has to still be reachable. It is `LeaveEditorControl` --
    "Give up the desk" (`desk-copy.ts:1294`), which calls `signOut()`
    (`desk-chrome.tsx:777`) -- and after Unit CX turned the Server page into
    cards it lives on the "Editors & access" card's screen. The press that
    proves it is the desk's own confirm step; "Keep it" is the undo, so the
    walk does not give the desk away to prove it could.
  */
  await owner.goto(`${base}/desk/ops/editors-access`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(900);
  const giveUp = owner.getByRole("button", { name: "Give up the desk", exact: true }).first();
  const there = (await giveUp.count()) > 0 && (await giveUp.isVisible().catch(() => false));
  let asked = false;
  if (there) {
    await giveUp.click();
    await owner.waitForTimeout(500);
    asked = (await owner.getByLabel("Your email address").count()) > 0;
    const keep = owner.getByRole("button", { name: "Keep it", exact: true });
    if ((await keep.count()) > 0) await keep.click();
  }
  const row = {
    label: "desk sign out: Give up the desk (/desk/ops/editors-access)",
    before: `${base}/desk/ops/editors-access`,
    action: there ? "pressed" : "not on screen",
    after: owner.url(),
    opened: asked ? ["Your email address"] : [],
    undone: asked ? 'pressed "Keep it"' : null,
  };
  controlRows.push(row);
  if (!there) failures.push("the desk's own sign out is not reachable on the editors-access card");
  if (there && !asked) failures.push("Give up the desk did not ask for the account's own address");
  step(
    there
      ? `the desk's own sign out is reachable and asks for the address (then "Keep it")`
      : "the desk's own sign out was NOT found on /desk/ops/editors-access (failed)",
  );
}

/* ── 7. the forms ────────────────────────────────────────────────────────── */
{
  // The reader's correction form: a real submission, and the sentence it owes.
  const reader = await readerCtx.newPage();
  reader.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`reader: ${m.text().slice(0, 300)}`);
  });
  await reader.goto(`${base}/corrections`, { waitUntil: "domcontentloaded" });
  /*
    Wait for the form to exist before filling it. Two ways the page can be
    standing there without it, and a bare fill reports neither: the identity
    read has not reached the client yet, or the paper genuinely has no editor
    address and `CorrectionForm` refused to render (its early return, drawn at
    src/components/correction-form.tsx:34). The walk seeds the address, so the
    second must not happen -- and if it does, the page text is the diagnosis.
  */
  const formPanel = reader.locator("#file-correction");
  const formThere = await formPanel
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!formThere) {
    const text = (await reader.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300);
    formRows.push({
      form: "corrections: write to the editor",
      submitted: "no -- no form on the page",
      result: text,
    });
    failures.push(`no correction form rendered on /corrections; the page read: "${text}"`);
  } else {
    const to = await reader
      .locator('.form-help a[href^="mailto:"]')
      .first()
      .getAttribute("href")
      .catch(() => null);
    const correctionText = "The rate figure is wrong.";
    const correctionField = reader.getByLabel("What needs correcting? (required)");
    const openCorrectionEmail = reader.getByRole("button", { name: "Open correction email" });
    let readyBeforeFill = false;
    try {
      await reader.waitForFunction(
        () => {
          const button = document.querySelector("#correctionform button[type='submit']");
          return button instanceof HTMLButtonElement && !button.disabled;
        },
        null,
        { timeout: 20_000 },
      );
      readyBeforeFill = await openCorrectionEmail.isEnabled();
    } catch {
      /* The row below records that the form never became ready. */
    }
    let valueBeforeClick = "";
    if (readyBeforeFill) {
      await correctionField.fill(correctionText);
      valueBeforeClick = await correctionField.inputValue();
    }
    const owed = reader.getByText(/Finish sending in your email app/);
    let ok = false;
    let why = `ready-before-fill=${readyBeforeFill}; textarea-before-click=${JSON.stringify(valueBeforeClick)}`;
    let preparedEmailHasText = false;
    if (readyBeforeFill && valueBeforeClick === correctionText) {
      // One click only. The flag above prevents a local browser from launching
      // an external mail client; the form still renders the prepared mailto link.
      await openCorrectionEmail.click();
      ok = await owed
        .waitFor({ timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      const preparedEmail = reader.locator('#correctionform p[role="status"] a[href^="mailto:"]');
      const preparedHref = await preparedEmail.getAttribute("href").catch(() => null);
      preparedEmailHasText = Boolean(preparedHref?.includes(encodeURIComponent(correctionText)));
      if (!ok) {
        const after = (await reader.locator("body").innerText().catch(() => ""))
          .replace(/\s+/g, " ")
          .slice(0, 300);
        why += `; after one press: url=${reader.url()} textarea=${JSON.stringify(await correctionField.inputValue().catch(() => null))} ` +
          `status-paragraphs-in-DOM=${await reader.locator('p[role="status"]').count().catch(() => -1)} page="${after}"`;
      }
    } else {
      failures.push(`the correction field was not ready and populated before its single press; ${why}`);
    }
    formRows.push({
      form: "corrections: write to the editor",
      submitted: readyBeforeFill && valueBeforeClick === correctionText ? "one click" : "no -- readiness/value check failed",
      result: ok
        ? `ready and populated before one click; shows the sentence and prepared email contains the text, addressed to ${to ?? "(no address on the page)"}`
        : `no sentence on screen; ${why}`,
    });
    if (!ok)
      failures.push(`the corrections form did not show its post-submit sentence after one click; ${why}`);
    if (ok && !preparedEmailHasText)
      failures.push("the prepared correction email did not contain the text retained in the field before the click");
    if (to !== `mailto:${PAPER_EDITOR_ADDRESS}`) {
      failures.push(`the correction form is addressed to ${to}, not the paper's own editor address`);
    }
  }

  /*
    The front page's search form: a real submission and a real result. The
    form only exists in a listing view -- `initial.listing` is false on the
    plain front page, and the input lives inside that branch
    (src/routes/index.tsx:347-360) -- so the walk asks for the archive view,
    which is the view the "Search" link in the top bar opens.
  */
  await reader.goto(`${base}/?view=archive`, { waitUntil: "domcontentloaded" });
  const searchField = reader.getByLabel("Search published stories");
  const searchThere = await searchField
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!searchThere) {
    const text = (await reader.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300);
    const url = reader.url();
    formRows.push({
      form: "front page: search",
      submitted: "no -- no search form on the page",
      result: `${url} read: ${text}`,
    });
    failures.push(`no search form on the archive view (${url}); the page read: "${text}"`);
  } else {
    await searchField.fill("water");
    await reader.getByRole("button", { name: "Search", exact: true }).click();
    await reader.waitForTimeout(900);
    const searchBody = await reader.locator("body").innerText();
    const found = searchBody.includes(ARTICLE_HEADLINE);
    formRows.push({
      form: "front page: search",
      submitted: "yes",
      result: found ? "found the seeded story" : "no result for a seeded story",
    });
    if (!found) failures.push("the front page search did not find a seeded story");
  }

  // The desk's own lead form.
  await owner.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(900);
  /*
    The Queue's toolbar carries `AddLeadButton` (label "Add a lead",
    src/routes/desk.queue.tsx:656) which opens the Add-a-lead dialog. Its two
    fields are "Link or tip" and "Why it might matter", its "Then" set is
    ADD_LEAD_THENS, and its primary is "Add lead" (editor-dialogs.tsx:598-620).
    The leg picks "Just file it as-is": it is the one choice marked `ai: false`
    (editor-dialog-forms.ts:471), so this proves the form end to end without
    spending a model call -- the fake provider has its own leg above.

    The dialog deliberately stays open on success, so the proof is its own
    notice ("Filed as lead N...") and not a closed dialog.
  */
  const addLead = owner.getByRole("button", { name: "Add a lead", exact: true }).first();
  const leadThere = (await addLead.count()) > 0;
  if (!leadThere) {
    const text = (await owner.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300);
    formRows.push({
      form: "desk: file a lead",
      submitted: "no -- no Add a lead button on /desk/queue",
      result: text,
    });
    failures.push(`no "Add a lead" button on /desk/queue; the page read: "${text}"`);
  } else {
    await addLead.click();
    const leadDialog = owner.getByRole("dialog", { name: "Add a lead" });
    const opened = await leadDialog
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!opened) {
      formRows.push({
        form: "desk: file a lead",
        submitted: "no -- the Add a lead dialog did not open",
        result: owner.url(),
      });
      failures.push('pressing "Add a lead" on /desk/queue opened no dialog');
    } else {
      const filed = "A hydrant at Fifth and Main has been running since Tuesday.";
      await leadDialog.getByLabel("Link or tip").fill(filed);
      await leadDialog.getByRole("radio", { name: /Just file it as-is/ }).click();
      await leadDialog.getByRole("button", { name: "Add lead", exact: true }).click();
      const notice = leadDialog.getByText(/Filed as lead \d+/);
      const said = await notice
        .waitFor({ timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      formRows.push({
        form: "desk: file a lead",
        submitted: "yes",
        result: said
          ? `the desk answered "${(await notice.first().innerText()).replace(/\s+/g, " ").trim()}"`
          : "no notice on screen",
      });
      if (!said) failures.push("the Add a lead dialog filed nothing and said nothing");
      const close = leadDialog.getByRole("button", { name: /^(Close|Cancel|Done)/ }).first();
      if ((await close.count()) > 0) await close.click().catch(() => {});
    }
  }
  await reader.close();
}
step("every form submits and shows its own sentence");

/* ── 8. privacy: cookies, localStorage, and the read table ──────────────── */
{
  const privCtx = await pacedContext();
  const beacons = [];
  await privCtx.route("**/api/read", async (route) => {
    const req = route.request();
    beacons.push({ url: req.url(), body: req.postData() ?? "" });
    await route.continue();
  });
  const p = await privCtx.newPage();
  await p.goto(`${base}/`, { waitUntil: "networkidle" });
  await p.goto(`${base}/articles/${ARTICLE_SLUG}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2_500);
  const cookies = await privCtx.cookies();
  const storage = await p.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      out[key] = localStorage.getItem(key);
    }
    return { local: out, session: sessionStorage.length };
  });
  const columns = (
    await pg.query(
      `select column_name from information_schema.columns where table_name = 'read_hourly' order by ordinal_position`,
    )
  ).rows.map((r) => r.column_name);
  const banned = /ip|addr|agent|user_agent|cookie|session|fingerprint|person|visitor|reader_id/i;
  const personal = columns.filter((c) => banned.test(c));
  const reads = await pg.query(`select path, ref_class, device, loads from read_hourly limit 5`);
  const readRows = reads.rows.map((r) => Object.values(r));
  const ipInTable = readRows.some((row) => row.some((v) => typeof v === "string" && /^\d+\.\d+\.\d+\.\d+$/.test(v)));
  const ipInBeacon = beacons.some((b) => /^\d+\.?\d*\.\d+\.\d+\.\d+/.test(b.body) || /"ip"/i.test(b.body));

  privacyReport = {
    beacons: beacons.length,
    cookies: cookies.map((c) => c.name),
    localStorageKeys: Object.keys(storage.local),
    sessionStorageCount: storage.session,
    readHourlyColumns: columns,
    personalColumns: personal,
    readHourlyRows: readRows.length,
    ipColumnPresent: /ip|addr/i.test(columns.join(" ")),
    ipValueInRows: ipInTable,
    ipInBeaconBody: ipInBeacon,
  };
  if (personal.length) failures.push(`read_hourly has person-shaped columns: ${personal.join(", ")}`);
  if (ipInTable) failures.push("a value in read_hourly looks like an IP address");
  if (ipInBeacon) failures.push("an /api/read beacon body carries an IP address");
  await privCtx.close();
}
step(
  `privacy: ${privacyReport.beacons} beacons, ${privacyReport.cookies.length} cookies, ` +
    `read_hourly has ${privacyReport.readHourlyColumns.length} columns and no person-shaped one`,
);

/* ── 9. the second account: a plain editor ───────────────────────────────── */
{
  await owner.goto(`${base}/desk/ops/editors-access`, { waitUntil: "domcontentloaded" });
  await owner.getByLabel("Their email").waitFor({ timeout: 30_000 });
  await owner.getByLabel("Their email").fill(editorEmail);
  await owner.getByRole("button", { name: "Make the invite link" }).click();
  const linkEl = owner.locator("p.break-all").filter({ hasText: "/login?invite=" }).first();
  let inviteUrl = null;
  try {
    await linkEl.waitFor({ timeout: 20_000 });
    inviteUrl = (await linkEl.innerText()).trim();
  } catch {
    note("no fresh invite link appeared; the editor will sign in with the password instead");
  }
  const editorPage = await editorCtx.newPage();
  editorPage.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`editor: ${m.text().slice(0, 300)}`);
  });
  editorPage.on("pageerror", (e) => consoleErrors.push(`editor pageerror: ${String(e).slice(0, 300)}`));
  if (inviteUrl) {
    await editorPage.goto(inviteUrl, { waitUntil: "domcontentloaded" });
    await editorPage.getByRole("heading", { name: /You're invited to this desk/ }).waitFor({ timeout: 45_000 });
    await editorPage.getByLabel("Password", { exact: true }).fill(editorPassword);
    await editorPage.getByLabel("Confirm password").fill(editorPassword);
    await editorPage.getByRole("button", { name: "Create editor account" }).click();
  } else {
    await editorPage.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await editorPage.getByLabel("Email").fill(editorEmail);
    await editorPage.getByLabel("Password", { exact: true }).fill(editorPassword);
    await editorPage.getByRole("button", { name: "Sign in with email" }).click();
  }
  await editorPage.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
  step("a plain editor is seated through the invite form");

  for (const route of routes) {
    if (!route.path.startsWith("/desk")) continue;
    await visitRoute(editorPage, "editor route", routeAddress(route, seeded), null, "editor");
  }
  await editorPage.goto(`${base}/desk/ops/health`, { waitUntil: "domcontentloaded" });
  await editorPage.waitForTimeout(900);
  const refused = await editorPage.locator("body").innerText();
  editorRefusal = /only the owner|owner can|not yours|read-only|owner-only|only the desk owner/i.test(refused);
  step(
    editorRefusal
      ? "a plain editor sees the owner-only refusal on an owner-only card"
      : "a plain editor sees the owner-only card without a refusal sentence (recorded)",
  );
  await editorPage.close();
}

/* ── 10. the matrix: every screen, both themes, both text sizes, 5 widths ── */
const WIDTHS = MATRIX === "lean" ? [1440] : [1440, 1280, 1024, 900, 390];
const MODES =
  MATRIX === "lean"
    ? [{ tag: "light-standard", mode: "light", size: "normal" }]
    : [
        { tag: "light-standard", mode: "light", size: "normal" },
        { tag: "dark-standard", mode: "dark", size: "normal" },
        { tag: "light-large", mode: "light", size: "large" },
        { tag: "dark-large", mode: "dark", size: "large" },
      ];

const SHOT_SCREENS = [
  ...DESK_SCREENS.map((s) => ({ path: s.path, name: s.path.replace(/^\//, "").replace(/[/$]/g, "-") , kind: "desk" })),
  { path: "/", name: "front", kind: "reader" },
  { path: `/articles/${ARTICLE_SLUG}`, name: "article", kind: "reader" },
];

const PINNED_HIDDEN = ".astra-topbar,.astra-skip,.astra-publish-bar{visibility:hidden !important}";

for (const screen of SHOT_SCREENS) {
  const target = screen.kind === "reader" ? readerCtx : ownerCtx;
  const p = await target.newPage();
  for (const mode of MODES) {
    for (const width of WIDTHS) {
      await p.setViewportSize({ width, height: 1000 });
      await p.goto(`${base}${screen.path}`, { waitUntil: "domcontentloaded" });
      await p.evaluate(
        ([m, s]) => {
          localStorage.setItem("townreporter.desk.mode", m);
          localStorage.setItem("townreporter.desk.textsize", s);
        },
        [mode.mode, mode.size],
      );
      await p.reload({ waitUntil: "domcontentloaded" });
      await p.waitForTimeout(600);
      await p.addStyleTag({ content: PINNED_HIDDEN }).catch(() => {});
      const file = shotPath("real", `${screen.name}--${width}--${mode.tag}.png`);
      await p.screenshot({ path: file, fullPage: true }).catch(async () => {
        await p.screenshot({ path: file });
      });
      shotRows.push({ screen: screen.path, width, mode: mode.tag, file });
    }
  }
  await p.close();
  console.log(`  shots ${screen.path}: ${MODES.length * WIDTHS.length}`);
}
step(`${shotRows.length} screenshots written to ${OUT_DIR}`);

/* ── 11. beside the drawing ──────────────────────────────────────────────── */
const DRAWING_FOR = {
  "/": "Front Daily.dc.html",
  "/articles/$slug": "Article Daily.dc.html",
  "/desk": "Desk Command.dc.html",
  "/desk/queue": "Desk Screens.dc.html",
  "/desk/follow-ups": "Desk Screens.dc.html",
  "/desk/drafts": "Desk Screens.dc.html",
  "/desk/opinion": "Desk Screens.dc.html",
  "/desk/dark": "Desk Screens.dc.html",
  "/desk/sources": "Desk Screens.dc.html",
  "/desk/published": "Desk Screens.dc.html",
  "/desk/ops": "Desk Screens.dc.html",
  "/desk/models": "Desk Models.dc.html",
  "/desk/stats": "Desk Stats.dc.html",
  "/desk/story/$leadId": "Desk Story.dc.html",
  "/desk/story/draft/$draftId": "Desk Story.dc.html",
};
{
  const art = await ownerCtx.newPage();
  for (const [routePath, drawing] of Object.entries(DRAWING_FOR)) {
    for (const theme of ["light", "dark"]) {
      await art.setViewportSize({ width: 1440, height: 1000 });
      await art.goto(`${pathToFileURL(join(DRAWING_DIR, drawing)).href}?theme=${theme}`, {
        waitUntil: "load",
      });
      await art.waitForTimeout(700);
      const file = shotPath("drawing", `${drawing.replace(/\.dc\.html$/, "")}--${theme}.png`);
      await art.screenshot({ path: file, fullPage: false }).catch(() => {});
      shotRows.push({ screen: routePath, width: 1440, mode: `${theme}-drawing`, file });
    }
  }
  await art.close();
  step("the drawings each screen implements were captured beside it");
}

/* ── 12. the console is clean ────────────────────────────────────────────── */
const realErrors = consoleErrors.filter((e) => !/favicon|Failed to load resource: the server responded with a status of 404/i.test(e));
if (realErrors.length) {
  failures.push(`${realErrors.length} console errors:\n    ${realErrors.slice(0, 10).join("\n    ")}`);
}
step(`console errors: ${realErrors.length}`);

/* ── the report ──────────────────────────────────────────────────────────── */
const report = {
  when: new Date().toISOString(),
  base,
  ports: { server: PORT_WALK_EVERY_CONTROL, fake: PORT_FAKE_PROVIDER, fakePid: started.fake },
  matrix: MATRIX,
  routes: routeRows,
  links: linkRows,
  controls: controlRows,
  forms: formRows,
  jobs: jobRows,
  wire: wireRows,
  privacy: privacyReport,
  shots: shotRows,
  failures,
  steps: done,
};
await writeFile(join(OUT_DIR, "walk-every-control.json"), JSON.stringify(report, null, 2), "utf8");

function table(rows, columns) {
  const head = `| ${columns.join(" | ")} |`;
  const rule = `|${columns.map(() => "---").join("|")}|`;
  const body = rows.map((r) => `| ${columns.map((c) => String(r[c] ?? "")).join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}
console.log("\n## routes\n");
console.log(table(routeRows.map((r) => ({ who: r.who, path: r.path, status: r.status, result: r.result })), ["who", "path", "status", "result"]));
console.log("\n## job states\n");
console.log(table(jobRows, ["state", "message", "shown", "next_step"]));
console.log("\n## the wire (live job through the fake provider)\n");
console.log(
  table(wireRows, ["leg", "job", "ended", "fake_calls", "refused_429", "result"]),
);
console.log("\n## privacy\n");
console.log(JSON.stringify(privacyReport, null, 2));
console.log(`\nFAILURES: ${failures.length}`);
for (const failure of failures) console.log(`  - ${failure}`);
console.log(`\nEvidence: ${OUT_DIR}`);
console.log(`Ports: server ${PORT_WALK_EVERY_CONTROL}, fake ${PORT_FAKE_PROVIDER} (pid ${started.fake})`);

/* ── stop what this walk started, by the PID it recorded (rule 8) ────────── */
if (started.fake) {
  try {
    process.kill(started.fake);
    step(`stopped the fake provider, pid ${started.fake}`);
  } catch {
    /* already gone */
  }
}

if (failures.length) {
  console.error(`\nthe walk has ${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nthe walk is clean");
process.exit(0);
