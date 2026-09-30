#!/usr/bin/env node
/**
 * Unit CO: read the transcript -- the walk that proves the three doors open.
 *
 * The owner's story (live /desk/story/297) was drafted from a council meeting's
 * YouTube captions. Twenty citations pointed into a 1.35 MB `.srv3` that sat on
 * `meeting_transcript_artifacts.storage_path`, and there was no way to read it:
 * the story page showed four-line excerpts, "Claims & evidence" landed on an
 * empty panel because the draft's `source_urls` was `[]` and it has no
 * URL-receipt claims, and the published story named no source at all. This walk
 * drives the built server and the real database to check each door:
 *
 *   1. "Open transcript" from the story page -> the whole tape, one line per
 *      caption segment, `[h:mm:ss]` in front of each and the stamp a link to the
 *      video at that second; "Copy all" and "Download original file" beside the
 *      stored path, its SHA-256 and its capture time.
 *   2. The Claims & evidence panel shows the draft's transcript citations -- and
 *      both refusals hold: a path in the request, and another newsroom's
 *      artifact.
 *   3. The published story's source list names the recording.
 *
 * The database is PGlite, in memory, in THIS process: `bootTheServer` imports
 * `.output/server/index.mjs` here, so `globalThis.__pgliteInstance__` is the same
 * instance the pages read (the same way scripts/front-page-river-e2e.mjs does
 * it). Nothing external is fetched, no model is called, and the seed rows are
 * written by the real writers where a real writer exists.
 *
 *   node --experimental-strip-types scripts/co-transcript-walk.mjs
 */
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCaptionFile } from "../src/lib/news/caption-parse.ts";
import { linkDraftToTranscript } from "../src/lib/news/meeting-draft-transcript-link.ts";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/* A spare port on this machine: never 3000, 3100, 3095 or 8080. */
const PORT = Number(process.env.CO_WALK_PORT || 3571);
const base = `http://127.0.0.1:${PORT}`;

const SHOTS = process.env.CO_SHOTS_DIR
  ? resolve(process.env.CO_SHOTS_DIR)
  : "C:/Users/scott/Desktop/Code/townreporter-deepseek-oversight/reports/CO-evidence";
const WORK = join(tmpdir(), `co-transcript-walk-${Date.now()}`);
mkdirSync(SHOTS, { recursive: true });
mkdirSync(WORK, { recursive: true });

const done = [];
const step = (name) => {
  done.push(name);
  console.log(`  ok    ${name}`);
};
let failures = 0;
function must(condition, message) {
  if (condition) return;
  failures += 1;
  console.log(`  FAIL  ${message}`);
  throw new Error(message);
}

/* The fixture: an .srv3 caption file, the format the live artifact is stored in. */
const VIDEO_ID = "coTesterville0926";
const VIDEO_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
/* A captured document the story also cites -- the record that used to hide the tape. */
const PACKET_URL = "https://testerville.gov/packet-2026-09-15.pdf";
const SRV3_PATH = join(WORK, "testerville-council-2026-09-15.srv3");
const SRV3 = `<?xml version="1.0" encoding="utf-8"?>
<timedtext format="3"><body>
<p t="0" d="4000">The meeting was called to order at seven.</p>
<p t="75000" d="5000">Mayor Ortega: we will take item nine, the water rate schedule.</p>
<p t="600000" d="6000">Councilmember Diaz moved to adopt the schedule as printed.</p>
<p t="18450000" d="5000">the motion carries six to one</p>
<p t="18460000" d="4000">with Councilmember Pike dissenting.</p>
</body></timedtext>
`;
writeFileSync(SRV3_PATH, SRV3, "utf8");
const fixture = parseCaptionFile(SRV3, SRV3_PATH);
const fixtureBytes = readFileSync(SRV3_PATH);
const fixtureSha = createHash("sha256").update(fixtureBytes).digest("hex");
must(fixture.segments.length === 5, `the fixture must parse to 5 segments, got ${fixture.segments.length}`);

const clock = (seconds) => {
  const whole = Math.max(0, Math.floor(seconds));
  const hh = String(Math.floor(whole / 3600)).padStart(2, "0");
  const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, "0");
  const ss = String(whole % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};
const expectedPlainText = fixture.segments.map((s) => `[${clock(s.startSeconds)}] ${s.excerpt}`).join("\n");

let page;
async function bootTheServer() {
  process.env.PORT = String(PORT);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.BETTER_AUTH_SECRET ||= "co-transcript-walk-secret";
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

/** The migration pass publishes the instance before it is migrated; wait for quiet. */
async function migrated() {
  // Awaitable, not the instance itself: `createPgliteSql` publishes the
  // instance as a promise while it is still being opened.
  const pg = await globalThis.__pgliteInstance__;
  if (!pg) throw new Error("the server booted without a PGlite instance to seed");
  let applied = -1;
  let quiet = 0;
  for (let i = 0; i < 240 && quiet < 3; i += 1) {
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
    await new Promise((r) => setTimeout(r, 500));
  }
  const sql = { query: (text, params = []) => pg.query(text, params).then((r) => r.rows) };
  return { pg, sql };
}

/**
 * One meeting, its transcript, a draft written from it, and a published story.
 *
 * The rows are the ones the capture pass and the drafting step write: the
 * segments come out of the real parser run over the real fixture file, and the
 * draft link comes from `linkDraftToTranscript` -- the writer that repairs the
 * "0 rows since migration 0070" defect -- so nothing here is a shape the app
 * would not itself produce.
 */
async function seed(sql) {
  const [{ id: userId }] = await sql.query(`select id from "user" order by "createdAt" limit 1`);

  await sql.query(
    `insert into paper_settings (newsroom_id, name, city, state, location, timezone, onboarded)
     values (1,$1,'Testerville','Wyoming','Testerville, Wyoming','America/Denver',true)
     on conflict (newsroom_id) do update set onboarded=true, name=$1`,
    ["Testerville Ledger"],
  );

  await sql.query(
    `insert into meeting_capture_records (newsroom_id, video_id, channel_url, title, published, captured_at, status, capture_disposition)
     values (1,$1,'https://www.youtube.com/@Testerville','Testerville City Council Regular Session','2026-09-15', now(), 'captured', 'final')`,
    [VIDEO_ID],
  );

  const [artifact] = await sql.query(
    `insert into meeting_transcript_artifacts
       (newsroom_id, video_id, storage_path, format, sha256, byte_size, captured_at, source_method, retention_mode)
     values (1,$1,$2,'srv3',$3,$4, now() - interval '2 hours', 'youtube-captions', 'transcript-only')
     returning id`,
    [VIDEO_ID, SRV3_PATH, fixtureSha, fixtureBytes.length],
  );

  const segmentRows = fixture.segments.map((segment, index) => ({
    index,
    segment,
    sha: createHash("sha256").update(segment.excerpt, "utf8").digest("hex"),
  }));
  for (const row of segmentRows) {
    await sql.query(
      `insert into meeting_transcript_segments
         (artifact_id, segment_index, start_seconds, end_seconds, excerpt, caption_sha256)
       values ($1,$2,$3,$4,$5,$6)`,
      [artifact.id, row.index, row.segment.startSeconds, row.segment.endSeconds, row.segment.excerpt, row.sha],
    );
  }
  await sql.query(
    `insert into meeting_agenda_chunks (newsroom_id, video_id, artifact_id, item, title, start_seconds, end_seconds, segment_indexes)
     values (1,$1,$2,'9','Water rate schedule', 0, 18460000, $3)`,
    [VIDEO_ID, artifact.id, JSON.stringify(segmentRows.map((r) => r.index))],
  );

  const [lead] = await sql.query(
    `insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, newsworthiness)
     values ($1,1,'Testerville council adopts the water rate schedule','Filed from the tape.','council','drafting',$2,8)
     returning id`,
    [userId, JSON.stringify([VIDEO_URL])],
  );
  const [draft] = await sql.query(
    `insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls, provenance_json, found_note, unanswered, research_json)
     values ($1,1,$2,'Testerville council adopts the water rate schedule','The vote was six to one.',
             'The council adopted the water rate schedule on a 6-1 vote. Councilmember Pike dissented.','council',$3,'[]','','[]','{}')
     returning id`,
    [userId, lead.id, JSON.stringify([VIDEO_URL])],
  );
  await linkDraftToTranscript(sql, {
    newsroomId: 1,
    draftId: Number(draft.id),
    artifactId: Number(artifact.id),
    citations: [
      { segmentIndex: 3, captionSha256: segmentRows[3].sha },
      { segmentIndex: 4, captionSha256: segmentRows[4].sha },
    ],
  });

  /*
    Another newsroom's transcript, to prove the artifact read is scoped. It is a
    real row pointing at a real file, so a refusal cannot come from the file
    being missing -- only from whose row it is.
  */
  const [otherArtifact] = await sql.query(
    `insert into meeting_transcript_artifacts
       (newsroom_id, video_id, storage_path, format, sha256, byte_size, captured_at, source_method, retention_mode)
     values (2,'someoneElsesMeeting',$1,'srv3',$2,$3, now(), 'youtube-captions', 'transcript-only')
     returning id`,
    [SRV3_PATH, fixtureSha, fixtureBytes.length],
  );

  /*
    A published story that carries a provenance record AND cites the recording.
    This is the shape that hid the video: the reader page printed the records or
    the cited URLs, never both, so one captured document was enough to drop the
    tape from a story written from it. The packet is in `source_urls` as well as
    in the records, which is what the writer does -- the reader page filters
    records to the URLs the story cites.
  */
  await sql.query(
    `insert into articles (user_id, newsroom_id, lead_id, slug, headline, dek, body, topic, source_urls, provenance_json, status, published_at)
     values ($1,1,$2,'testerville-council-adopts-the-water-rate-schedule',
             'Testerville council adopts the water rate schedule','The vote was six to one.',
             'The council adopted the water rate schedule on a 6-1 vote. Councilmember Pike dissented.',
             'council',$3,$4,'published', now() - interval '1 hour')`,
    [
      userId,
      lead.id,
      JSON.stringify([PACKET_URL, VIDEO_URL]),
      JSON.stringify([
        { title: "September 15 packet", organization: "testerville.gov", document_date: "2026-09-15", url: PACKET_URL, role: "source" },
      ]),
    ],
  );

  return { userId, leadId: Number(lead.id), draftId: Number(draft.id), artifactId: Number(artifact.id), otherArtifactId: Number(otherArtifact.id) };
}

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  console.log(`Booting the built server on ${base} over in-memory PGlite`);
  await bootTheServer();
  const { sql } = await migrated();
  step("the built server answers on its own port, over its own PGlite");

  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  page = await context.newPage();
  page.setDefaultTimeout(45_000);
  page.on("pageerror", (e) => console.log(`  note  pageerror: ${e.message}`));

  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Name").fill("CO Editor");
  await page.getByLabel("Email").fill("co-editor@townreporter.test");
  await page.getByLabel("Password", { exact: true }).fill("co-walk-pass-12345");
  await page.getByLabel("Confirm password").fill("co-walk-pass-12345");
  // See the note in publish-blockers-walk.mjs: the login form has carried a
  // first-owner SETUP CODE since unit CJ (0.6.80), and this walk was written
  // before it. Without the code the account is never created and the wait
  // below times out on a page that is still the sign-up form.
  const { completeFirstRunSetup, fillPendingSetupCodeIfPresent } = await import(
    "./first-run-setup-step.mjs"
  );
  await fillPendingSetupCodeIfPresent(page);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("owns the desk");

  const seedFacts = await seed(sql);
  step(`seeded one meeting, its tape, its draft link and a published story (artifact ${seedFacts.artifactId})`);

  /* ------------------------------------------------------------------ *
   * 1. The door on the story page, and the tape behind it.
   * ------------------------------------------------------------------ */
  await page.goto(`${base}/desk/story/${seedFacts.leadId}`, { waitUntil: "networkidle" });
  const openTranscript = page.getByRole("link", { name: "Open transcript" }).first();
  await openTranscript.waitFor({ timeout: 45_000 });
  step("the story page offers Open transcript");

  const [transcriptTab] = await Promise.all([
    context.waitForEvent("page"),
    openTranscript.click(),
  ]);
  await transcriptTab.waitForLoadState("networkidle");
  await transcriptTab.waitForTimeout(500);
  const transcriptUrl = transcriptTab.url();
  must(
    transcriptUrl.endsWith(`/desk/transcript/${seedFacts.artifactId}`),
    `Open transcript must open the tape at /desk/transcript/${seedFacts.artifactId}, it opened ${transcriptUrl}`,
  );
  step(`Open transcript opens the tape in its own tab: ${new URL(transcriptUrl).pathname}`);

  const lineLocator = transcriptTab.locator("ol.transcript-lines li.transcript-line");
  await lineLocator.first().waitFor({ timeout: 30_000 });
  const lineCount = await lineLocator.count();
  must(lineCount === fixture.segments.length, `the page must print all ${fixture.segments.length} segments, it printed ${lineCount}`);
  const firstLine = (await lineLocator.first().innerText()).replace(/\s+/g, " ").trim();
  must(/^\[00:00:00\] The meeting was called to order at seven\./.test(firstLine), `the first line must be stamped and readable, got "${firstLine}"`);
  step(`${lineCount} lines, one per caption segment, each stamped [h:mm:ss]`);

  const stampHref = await transcriptTab.locator("ol.transcript-lines li.transcript-line a").nth(3).getAttribute("href");
  must(
    stampHref === `https://www.youtube.com/watch?v=${VIDEO_ID}&t=18450s`,
    `each stamp must link to the video at that second, got ${stampHref}`,
  );
  step("every timestamp is a link to the video at that second");

  const bodyText = await transcriptTab.locator("body").innerText();
  must(bodyText.includes(`Stored at: ${SRV3_PATH}`) || bodyText.includes(SRV3_PATH), "the page must print the stored file path");
  must(bodyText.includes(fixtureSha), "the page must print the file's SHA-256");
  must(/Captured/.test(bodyText), "the page must print when the tape was captured");
  step("the page prints the stored path, its SHA-256 and its capture time");

  await transcriptTab.screenshot({ path: join(SHOTS, "transcript-light.png"), fullPage: true });

  /* Copy all: the clipboard, and the plain text it must hold. */
  await transcriptTab.getByRole("button", { name: "Copy all" }).click();
  let copied = "";
  try {
    copied = await transcriptTab.evaluate(() => navigator.clipboard.readText());
  } catch (error) {
    copied = await transcriptTab.locator("#transcript-plaintext").inputValue().catch(() => "");
    console.log(`  note  clipboard read fell back to the page's own textarea: ${error.message}`);
  }
  /*
    The clipboard is compared line for line, not byte for byte: Windows
    normalises the newlines on the way in, so the same text arrives as CRLF.
    What must match is every line and its order.
  */
  must(
    copied.replace(/\r\n/g, "\n").trim() === expectedPlainText.trim(),
    `Copy all must put the plain text of every line on the clipboard.\n--- got ---\n${copied}\n--- want ---\n${expectedPlainText}`,
  );
  step("Copy all copies the whole tape as plain text, [h:mm:ss] and all");

  /* Download original: the stored bytes, under the stored name. */
  const [download] = await Promise.all([
    transcriptTab.waitForEvent("download"),
    transcriptTab.getByRole("link", { name: /Download original file/ }).click(),
  ]);
  const downloaded = join(WORK, "downloaded.srv3");
  await download.saveAs(downloaded);
  const downloadedBytes = readFileSync(downloaded);
  must(
    download.suggestedFilename() === "testerville-council-2026-09-15.srv3",
    `the download must carry the stored filename, got ${download.suggestedFilename()}`,
  );
  must(
    downloadedBytes.equals(fixtureBytes),
    `Download original must return the stored bytes (${fixtureBytes.length}), got ${downloadedBytes.length}`,
  );
  step(`Download original file returns the stored bytes under their real name (${downloadedBytes.length} bytes)`);

  /* ------------------------------------------------------------------ *
   * 2. Both refusals, plus the happy path, at the HTTP boundary.
   * ------------------------------------------------------------------ */
  const probe = (query) =>
    transcriptTab.evaluate(async (q) => {
      const res = await fetch(`/api/transcript-file?${q}`);
      const text = await res.text();
      return { status: res.status, length: text.length };
    }, query);

  const withPath = await probe(`artifactId=${seedFacts.artifactId}&path=${encodeURIComponent("C:/Windows/win.ini")}`);
  must(withPath.status === 403, `a path in the request must be refused with 403, got ${withPath.status}`);
  const otherNewsroom = await probe(`artifactId=${seedFacts.otherArtifactId}`);
  must(otherNewsroom.status === 404, `another newsroom's artifact must not be served (404), got ${otherNewsroom.status}`);
  const missing = await probe("artifactId=999999");
  must(missing.status === 404, `an id with no row must answer 404, got ${missing.status}`);
  const noId = await probe("path=x");
  must(noId.status === 400, `a request with no artifact id must answer 400, got ${noId.status}`);
  const served = await transcriptTab.evaluate(
    async (id) => {
      const res = await fetch(`/api/transcript-file?artifactId=${id}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      let hash = "";
      for (const b of buf) hash += String.fromCharCode(b);
      return { status: res.status, length: buf.length, disposition: res.headers.get("content-disposition"), hash };
    },
    seedFacts.artifactId,
  );
  must(served.status === 200 && served.length === fixtureBytes.length, `the happy path must serve the file (200, ${fixtureBytes.length} bytes), got ${served.status}, ${served.length}`);
  step("refusals hold: path-in-request 403, other newsroom 404, unknown id 404, no id 400; the owner's row serves 200");

  /* Anonymous callers get nothing either. */
  const anonymous = await browser.newContext().then(async (ctx) => {
    const p = await ctx.newPage();
    await p.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    const out = await p.evaluate(async (id) => {
      const res = await fetch(`/api/transcript-file?artifactId=${id}`);
      return res.status;
    }, seedFacts.artifactId);
    await ctx.close();
    return out;
  });
  must(anonymous === 401, `a signed-out caller must be refused with 401, got ${anonymous}`);
  step("a signed-out caller cannot download the tape (401)");

  /* ------------------------------------------------------------------ *
   * 3. The Claims & evidence panel on a meeting story.
   * ------------------------------------------------------------------ */
  await page.goto(`${base}/desk/story/${seedFacts.leadId}`, { waitUntil: "networkidle" });
  /*
    The Checks tab, by its own id (unit CW2). This used to click "Review claims
    and sources" and let the link do the navigating, because the panel lived in
    the Reporting tab's notes and that link switched tabs on the way. Unit CW2
    moved the review onto the Checks tab, where it is the body of the drawn
    Evidence check list; the one such link left on the page belongs to the
    stale-evidence notice and still means the *reporting* notes, which is a
    different place now. So the walk names the tab the panel is on instead of
    going through a link that has moved out from under it. What the walk is
    here for -- the citations, their timestamps and their state -- is
    unchanged.
  */
  await page.locator("#inspector-tab-checks").click();
  const panel = page.locator("#finding-evidence-review");
  await panel.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  const panelText = (await panel.innerText()).replace(/\s+/g, " ");
  /*
    Case-insensitively: the kicker is uppercased by the stylesheet, and
    `innerText` returns the text as RENDERED, so the DOM's "Meeting transcript
    citations" arrives here as "MEETING TRANSCRIPT CITATIONS".
  */
  must(/meeting transcript citations/i.test(panelText), `the panel must show the transcript citations, it read "${panelText.slice(0, 400)}"`);
  must(panelText.includes("the motion carries six to one"), "the panel must print the cited words from the tape");
  must(/Item 9/.test(panelText), "the panel must name the agenda item");
  const citationLinks = await panel.locator('a[href*="youtube.com/watch"]').evaluateAll((els) =>
    els.map((el) => el.getAttribute("href")),
  );
  must(
    citationLinks.includes(`https://www.youtube.com/watch?v=${VIDEO_ID}&t=18450s`),
    `the citations must link to the cited second, the panel offered ${JSON.stringify(citationLinks)}`,
  );
  must(/Resolves against artifact/.test(panelText), "the panel must say whether the citation still resolves");
  must(await panel.locator('a[href$="/desk/transcript/' + seedFacts.artifactId + '"]').count() > 0, "the panel must offer the tape from the address the button promises");
  step("Claims & evidence shows the citations, their timestamps and their state instead of an empty panel");

  /* ------------------------------------------------------------------ *
   * 4. The recording reaches the published story's sources.
   * ------------------------------------------------------------------ */
  await page.goto(`${base}/articles/testerville-council-adopts-the-water-rate-schedule`, { waitUntil: "networkidle" });
  const sources = page.locator("#sources");
  await sources.waitFor({ timeout: 30_000 });
  const sourcesText = (await sources.innerText()).replace(/\s+/g, " ");
  must(sourcesText.includes("How we reported this"), `the story must print its sources, it read "${sourcesText.slice(0, 200)}"`);
  /*
    Both doors out, by href rather than by text: a source card prints a title
    and a host, not the URL, so the text check would pass on the wrong card.
  */
  must(await sources.locator(`a[href="${VIDEO_URL}"]`).count() > 0, `the recording must appear in the story's sources, the block read "${sourcesText.slice(0, 400)}"`);
  must(await sources.locator(`a[href="${PACKET_URL}"]`).count() > 0, "the provenance record must still appear beside it");
  must(sourcesText.includes("September 15 packet"), "the recorded document must still be named as a card");
  step("the published story names the recording beside its other source");

  /* ------------------------------------------------------------------ *
   * 5. Appearance: WCAG AA in both themes, nothing under 14px.
   * ------------------------------------------------------------------ */
  const SAMPLER = `(() => {
    const lum = (c) => { const [r,g,b] = c; const f = (v) => { v/=255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
    const rgb = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(",").map((x)=>parseFloat(x)); return { c: [p[0],p[1],p[2]], a: p.length > 3 ? p[3] : 1 }; };
    const bgOf = (el) => { let node = el; while (node) { const b = rgb(getComputedStyle(node).backgroundColor); if (b && b.a > 0.9) return b.c; node = node.parentElement; } return [255,255,255]; };
    const ratio = (a, b) => { const la = lum(a), lb = lum(b); const hi = Math.max(la,lb), lo = Math.min(la,lb); return (hi+0.05)/(lo+0.05); };
    const out = { minFont: Infinity, minFontSample: "", worst: 99, worstSample: "", appearance: document.documentElement.getAttribute("data-appearance") ?? "" };
    for (const el of [...document.querySelectorAll("body *")]) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width <= 0 || r.height <= 0 || s.visibility === "hidden" || s.display === "none") continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).length > 0;
      if (!own) continue;
      const px = parseFloat(s.fontSize);
      if (px && px < out.minFont) { out.minFont = px; out.minFontSample = el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0]; }
      const fg = rgb(s.color);
      if (fg && fg.a > 0.5) {
        const cr = ratio(fg.c, bgOf(el));
        const bold = parseInt(s.fontWeight, 10) >= 700;
        const large = px >= 24 || (px >= 18.66 && bold);
        const need = large ? 3 : 4.5;
        const score = cr - need;
        if (score < out.worst) { out.worst = score; out.worstSample = (el.textContent ?? "").trim().slice(0, 40) + " @ " + cr.toFixed(2) + ":1"; }
      }
    }
    return out;
  })()`;

  async function audit(target, label, shot) {
    const measured = await target.evaluate(SAMPLER);
    must(measured.minFont >= 13.9, `${label}: nothing may print under 14px, smallest was ${measured.minFont}px (${measured.minFontSample})`);
    must(measured.worst >= 0, `${label}: every text colour must clear WCAG AA, worst was ${measured.worstSample}`);
    await target.screenshot({ path: join(SHOTS, shot), fullPage: true });
    step(`${label}: AA in both themes, smallest text ${measured.minFont}px (appearance "${measured.appearance}")`);
  }

  await audit(transcriptTab, "transcript page, light", "transcript-light.png");
  await transcriptTab.evaluate(() => localStorage.setItem("townreporter.desk.mode", "dark"));
  await transcriptTab.reload({ waitUntil: "networkidle" });
  await transcriptTab.waitForTimeout(700);
  const darkAppearance = await transcriptTab.evaluate(() => document.documentElement.getAttribute("data-appearance"));
  must(darkAppearance === "desk-dark", `the dark pass must actually run dark, the document says "${darkAppearance}"`);
  await audit(transcriptTab, "transcript page, dark", "transcript-dark.png");

  /*
    The story page is audited in both themes too -- it is the page the editor
    presses "Open transcript" from, and the button carries the appearance
    change with it.
  */
  await page.evaluate(() => localStorage.setItem("townreporter.desk.mode", "light"));
  await page.goto(`${base}/desk/story/${seedFacts.leadId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await audit(page, "story page, light", "story-light.png");

  await page.evaluate(() => localStorage.setItem("townreporter.desk.mode", "dark"));
  await page.goto(`${base}/desk/story/${seedFacts.leadId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await audit(page, "story page, dark", "story-dark.png");

  console.log(JSON.stringify({ ok: failures === 0, failures, completed: done, shots: SHOTS, work: WORK }, null, 2));
  process.exit(failures === 0 ? 0 : 1);
} catch (error) {
  const text = page ? await page.locator("body").innerText().catch(() => "") : "";
  console.error(JSON.stringify({ ok: false, error: error.message, url: page?.url() ?? "", text: text.slice(0, 900), completed: done, shots: SHOTS }, null, 2));
  await browser.close().catch(() => {});
  process.exit(1);
}
