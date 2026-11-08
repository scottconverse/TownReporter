import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { rolldown } from "rolldown";
import { chromium } from "playwright";
import { screenModuleUrl } from "./screen-render-harness.mjs";

// Every other control on the screen is a stub: these tests are about the
// Drafts rows themselves, not about what the rest of the desk draws.
const DRAFTS_OVERRIDES = {
  DeskShell: `({children,title,lede})=>h("main",{},h("h1",{},title),lede,children)`,
  DeskMoreMenu: `()=>null`,
  DeskJobCard: `()=>null`,
  Link: `({children,to,hash,className})=>h("a",{href:(typeof to==="string"?to:String(to))+(hash?"#"+hash:""),className},children)`,
  editorTitle: `(headline)=>headline`,
  useDeskJobs: `()=>({data:[]})`,
  useNowMs: `()=>0`,
};

/**
 * Mount the real Drafts screen into a blank page. No stylesheet is loaded and
 * every request is aborted, so this proves the DOM the screen draws -- the
 * order of the blocks in a row, the names of its controls -- and never the
 * pixels. `screenData` is what the stubbed `useQuery` hands back, keyed by the
 * first element of each query key ("drafts-desk", "desk").
 */
async function mountDrafts(t, overrides, screenData) {
  const screen = await screenModuleUrl(
    "src/routes/desk.drafts.tsx",
    { ...DRAFTS_OVERRIDES, ...overrides },
    ["@/lib/news/desk-drafts", "@/lib/news/draft-item", "@/components/draft-item-boundary"],
  );
  const entry = `
    import * as React from ${JSON.stringify(import.meta.resolve("react"))};
    import {createRoot} from ${JSON.stringify(import.meta.resolve("react-dom/client"))};
    import {Route} from ${JSON.stringify(screen)};
    globalThis.screenData = ${JSON.stringify(screenData)};
    createRoot(document.getElementById("root")).render(React.createElement(Route.component));
  `;
  const bundle = await rolldown({
    input: "fixture",
    plugins: [
      {
        name: "isolated-drafts-screen",
        resolveId(id) {
          if (id === "fixture" || id.startsWith("data:")) return id;
          if (id.startsWith("file:")) return fileURLToPath(id);
        },
        load(id) {
          if (id === "fixture") return entry;
          if (id.startsWith("data:")) return Buffer.from(id.split(",")[1], "base64").toString();
        },
      },
    ],
    transform: {
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
        "import.meta.env": "{}",
      },
    },
  });
  t.after(() => bundle.close());
  const { output } = await bundle.generate({ format: "iife" });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: output[0].code });
  return { page, pageErrors };
}

test("Drafts keeps a queued empty draft and isolates one unreadable row", async (t) => {

  const queued = {
    id: 376,
    lead_id: 477,
    headline: "Queued draft stays visible",
    topic: "council",
    updated_at: "2026-10-11T18:02:35.302Z",
    has_body: false,
    story_readiness: {
      version: 1,
      state: "not-ready",
      openCount: 0,
      totalCount: 0,
      reason: "No draft has been written.",
    },
    job_status: "queued",
    job_stage: "Queued",
    job_started_at: null,
    job_updated_at: null,
    job_model_choice: "local-model",
    job_error: null,
    evidence_required: false,
    evidence_decision: null,
    evidence_checked_at: null,
    names_checked_at: null,
    imported_text: false,
    name_check_complete: false,
    names_unresolved: 0,
    unreviewed_claims: 0,
    unreviewed_claims_accepted_count: 0,
    headline_source: null,
    model_headline: null,
  };
  const saved = {
    ...queued,
    id: 378,
    lead_id: 479,
    headline: "A saved draft also stays visible",
    has_body: true,
    job_status: null,
  };
  const data = {
    "drafts-desk": {
      rows: [null, queued, saved],
      total: 3,
      counts: { all: 3, running: 1, "needs-you": 0, yours: 0, failed: 0 },
    },
  };
  const { page, pageErrors } = await mountDrafts(t, {}, data);

  await page.getByRole("heading", { name: "Drafts" }).waitFor();
  await page.getByRole("link", { name: "+ New story" }).waitFor();
  assert.equal(await page.locator(".drafts-row").count(), 2);
  await page.getByRole("heading", { name: "Queued draft stays visible" }).waitFor();
  await page.getByRole("heading", { name: "A saved draft also stays visible" }).waitFor();
  assert.match(await page.locator(".drafts-row").first().innerText(), /Queued/);

  const unavailable = page.getByRole("alert");
  assert.equal(await unavailable.count(), 1);
  assert.match(await unavailable.innerText(), /Draft 1: This draft could not be shown:/);
  assert.match(await unavailable.innerText(), /Cannot read properties of null/);
  await page.getByRole("link", { name: "Open it from the Queue." }).waitFor();
  assert.deepEqual(pageErrors, []);
});

/**
 * The roundup rows on this page are not draft rows: they carry their own class
 * (`roundup-row`), their opened text and their kill question are blocks of the
 * row itself rather than of the headline cell, and the Open control renames
 * itself when it becomes a Close. None of that is pixel layout -- it is the DOM
 * the layout is drawn on, which is what a headless page without a stylesheet
 * can prove.
 */
test("A roundup row keeps its opened text and kill question as blocks of the row", async (t) => {
  const data = {
    "drafts-desk": {
      rows: [],
      total: 0,
      counts: { all: 0, running: 0, "needs-you": 0, yours: 0, failed: 0 },
    },
    desk: [{ id: 12, channel: "today", issueDate: "Nov 8, 2026", headline: "The week in town" }],
  };
  const { page, pageErrors } = await mountDrafts(
    t,
    {
      getWaitingRoundup: `async () => ({dek:"A short dek.",body:"The roundup body.",sourceUrls:["https://example.test/record"]})`,
    },
    data,
  );

  await page.getByRole("heading", { name: "Roundups waiting" }).waitFor();
  const row = page.locator(".roundup-row");
  assert.equal(await row.count(), 1);
  // The row also still wears `drafts-row`, so the page's own row plumbing
  // (the hairline, the padding) is unchanged for it.
  assert.match(await row.getAttribute("class"), /\bdrafts-row\b/);

  // Closed: the one control reads Open, and the label says so.
  await page.getByRole("button", { name: "Open: The week in town" }).waitFor();
  assert.equal(await page.locator(".roundup-row .roundup-preview").count(), 0);

  await page.getByRole("button", { name: "Open: The week in town" }).click();
  // Open: the same control is now the Close, and a screen reader is told the
  // same thing the eye is.
  const close = page.getByRole("button", { name: "Close: The week in town" });
  await close.waitFor();
  assert.equal(await close.innerText(), "Close");
  assert.equal(await page.getByRole("button", { name: "Open: The week in town" }).count(), 0);

  // The opened roundup is a block of the row, not of the headline cell.
  assert.equal(await row.locator("> .drafts-main > .roundup-preview").count(), 0);
  assert.equal(await row.locator("> .roundup-preview").count(), 1);
  await page.getByRole("heading", { name: "Sources & public records" }).waitFor();

  // The kill question is a block of the row as well, and is the row's own
  // group of two presses.
  await page.getByRole("button", { name: "Kill: The week in town" }).click();
  const question = page.getByRole("group", { name: "Kill The week in town" });
  await question.waitFor();
  assert.equal(await row.locator("> .roundup-kill").count(), 1);
  assert.match(await question.innerText(), /Kill this roundup\? It will not print\./);
  await question.getByRole("button", { name: "Yes, kill it" }).waitFor();
  await question.getByRole("button", { name: "Cancel" }).waitFor();

  assert.deepEqual(pageErrors, []);
});

/**
 * A roundup body prints its feed lines as long unbroken addresses
 * ("Source: https://..."). The Test walk of Nov. 8 opened one on a 390px phone
 * and the page went 960px wide. This draws the real desk stylesheet at phone
 * width and opens a roundup whose body carries such an address: the page must
 * not scroll sideways.
 */
test("An opened roundup with a long source address fits a phone screen", async (t) => {
  const data = {
    "drafts-desk": {
      rows: [],
      total: 0,
      counts: { all: 0, running: 0, "needs-you": 0, yours: 0, failed: 0 },
    },
    desk: [{ id: 12, channel: "weekend", issueDate: "Nov 8, 2026", headline: "This weekend" }],
  };
  const longUrl =
    "https://calendar.google.com/calendar/ical/r5a1ofr4s6d7mvuicgvq36l6tc%40group.calendar.google.com/public/basic.ics";
  const { page, pageErrors } = await mountDrafts(
    t,
    {
      DeskShell: `({children,title,lede})=>h("div",{className:"desk-ltr astra"},h("main",{},h("h1",{},title),lede,children))`,
      // The story body draws each plain block as a pre-wrap paragraph; this
      // stand-in draws the feed line the same way.
      StoryBody: `({body})=>h("div",{},body.split("\\n\\n").map((b,i)=>h("p",{key:i,className:"whitespace-pre-wrap",style:{whiteSpace:"pre-wrap"}},b)))`,
      getWaitingRoundup: `async () => ({dek:"A short dek.",body:${JSON.stringify(`Events this weekend.\n\nSource: ${longUrl}`)},sourceUrls:[${JSON.stringify(longUrl)}]})`,
    },
    data,
  );
  await page.addStyleTag({ path: fileURLToPath(new URL("../src/desk-astra.css", import.meta.url)) });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByRole("button", { name: "Open: This weekend" }).click();
  await page.getByRole("button", { name: "Close: This weekend" }).waitFor();
  await page.locator(".roundup-preview").getByText(/Source: https:/).waitFor();
  const [scrollWidth, clientWidth] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  assert.ok(scrollWidth <= clientWidth, `page is ${scrollWidth}px wide on a ${clientWidth}px screen`);
  assert.deepEqual(pageErrors, []);
});
