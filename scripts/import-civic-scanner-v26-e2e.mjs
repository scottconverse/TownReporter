/**
 * Unit X4, step F: a civic-scanner v2.6 report, end to end through the desk.
 *
 * scripts/import-stories-e2e.mjs walks the Codex daily scan and
 * scripts/import-any-format-e2e.mjs walks the Claude report -- both v2.5
 * shapes, where the only thing that decided whether a card was a story or an
 * idea was its length. This walks the full-pipeline v2.6 report, the first
 * shape that says out loud how ready each packet is, and it exists for four
 * reasons:
 *
 * 1. The report states an editorial readiness tier per packet, and the tier
 *    decides the card -- Tier 1 ticked as a story, Tier 2 a story unticked and
 *    wearing its gaps, Tier 3 an unverified idea. On a v2.6 paste the length
 *    of a packet decides nothing.
 * 2. The Black Desk section carries hypotheses of 200-odd words each. Under
 *    the old length rule every one of them imported as a finished, ticked
 *    story: a paragraph of speculation offered as publication copy. This walk
 *    exists to hold the opposite, and it counts the fixture's words first.
 * 3. Each packet carries a claims ledger with VERIFIED / UNVERIFIED /
 *    CONTESTED statuses. The ledger goes to the editor notes, never into the
 *    published text, and a packet holding a claim the run could not confirm
 *    says so on its card.
 * 4. The run states PARTIAL with a list of what it did not get to, and the
 *    review screen says so before the editor reads the cards as a full sweep.
 *
 * Everything below is read off the running screen: the review cards as an
 * editor sees them, the ledger inside the notes panel, the Dark Desk's own box
 * opened by "Send it to Dark Desk", then the Queue after importing the two
 * Tier 1 packets. The pictures are taken at 1280 and 375.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/**
 * This walk's own listen port, registered with
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can quietly bind it and answer this one's requests. 3312-3322 were taken
 * when this was written (X3's walk holds 3322).
 */
const PORT_IMPORT_CIVIC_SCANNER_V26 = 3323;

const REPO = process.cwd();
const SHOTS = "C:/Users/scott/Desktop/Code/townreporter-deepseek-oversight/scratch/X4";
const base = checkedUrl(`http://127.0.0.1:${PORT_IMPORT_CIVIC_SCANNER_V26}`);

/** The v2.6 full-pipeline report, read from the repo's own copy. */
const FIXTURE = readFileSync(
  join(REPO, "src/lib/news/fixtures/civic-scanner-v26-full-pipeline-2026-09-25.md"),
  "utf8",
);

/** What the screen says it read, in its own words. */
const READ_LINE = "Read 3 stories and 5 story ideas out of the paste.";

/** The counts the reader produces from this report. */
const CARDS = 12;
/** Cards that are a section of the report rather than one of its packets. */
const SECTIONS = 4;
/** The two Tier 1 packets, and the only two cards ticked on arrival. */
const TIER1 = [
  "Council approves on-bill financing for efficiency upgrades",
  "21st Avenue rail crossing set for two closures",
];

/** A Tier 2 packet: a written draft, and a report that does not call it ready. */
const TIER2 = "Students to prepare free evening meals for Longmont seniors";
const TIER2_GAP = "the number of meals";
/** A Tier 3 packet: a headline and a date, read off an index and nothing else. */
const TIER3 = "County heat-pump buying program may reach Longmont";

/** The two hypotheses under "Possible Stories to Investigate (Unverified)". */
const BLACK_DESK = [
  "The Dry Creek annexation may have been amended to shrink the bike-share condition",
  "The police and fire union agreements may set a pay pattern the 2027 budget cannot hold",
];
/** The one whose handoff to the Dark Desk this walk follows. */
const HYPOTHESIS = BLACK_DESK[0];
const HYPOTHESIS_CHECK = "obtain a usable official recording or posted minutes for Sept. 22";

/** The held table's two rows, and the tier the report gives each of them. */
const HELD_DEVELOPING = "Growing Shade free trees";
const HELD_POTENTIAL = "Election service and ballot explainer";

const DEVELOPING_FLAG = "Developing — gaps marked";
const UNVERIFIED_FLAG = "Unverified — Black Desk";
/** A Black Desk hypothesis has to say out loud that it may not be printed. */
const UNVERIFIED_SENTENCE = "it is not publication copy in any form";

/** The sentence the report opens the first Tier 1 packet's draft with. */
const FIRST_SENTENCE =
  "Longmont's city council gave final approval to an on-bill financing program";

/** What one claim the run could not confirm does to a card. */
const TIER1_CLAIMS_WARNING =
  "1 claim is unverified or contested — read the claims ledger in the editor notes before publishing.";
const TIER2_CLAIMS_WARNING =
  "2 claims are unverified or contested — read the claims ledger in the editor notes before publishing.";

const stamp = Date.now();
const email = `civic-scanner-v26-${stamp}@townreporter.test`;
const password = "import-civic-scanner-v26-e2e-pass";

let page;
const done = [];
const shot = [];
const facts = [];

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
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 1800);
  } catch {
    /* the page is already gone */
  }
  console.error(JSON.stringify({ ok: false, error: message, url, text, completed: done }, null, 2));
  process.exit(1);
}

/** Boot the built server here, in this process, on its own port and database. */
async function bootTheServer() {
  process.env.PORT = String(PORT_IMPORT_CIVIC_SCANNER_V26);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.BETTER_AUTH_SECRET ||= "import-civic-scanner-v26-e2e-secret";
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

/** The first account owns the desk and finishes setup, as a person would. */
async function ownTheDesk() {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("V26 Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk");
}

/** Paste the v2.6 report and read it. */
async function readTheReport() {
  await page.goto(`${base}/desk/import`, { waitUntil: "networkidle" });
  await page.getByLabel("Paste the report or the story").fill(FIXTURE);
  await page.getByRole("button", { name: "Read the stories", exact: true }).click();
  await page
    .getByRole("heading", { name: "Check every story", exact: true })
    .waitFor({ timeout: 60_000 });
}

/**
 * One card whose headline is this one, ticked or not.
 *
 * Matched on the tick label's headline span and not on the whole card: this
 * report's own section cards carry the packets' prose in their bodies, so a
 * `hasText` filter over the card can match the section rather than the packet.
 */
function cardFor(headline) {
  return page
    .locator('li:has(> div > input[id^="tick-"])')
    .filter({ has: page.locator('label[for^="tick-"] > span.block', { hasText: headline }) })
    .first();
}

/**
 * One read of every card's own state: the kind off the tick label's first
 * span, the headline off its second, the report's own flags off the
 * uppercased spans, and the whole card's text for the warnings.
 */
async function cardFacts() {
  return page.evaluate(() => {
    const norm = (text) => (text ?? "").replace(/\s+/g, " ").trim();
    const upper = (el) =>
      [...el.querySelectorAll("span")]
        .filter((s) => /(^|\s)uppercase(\s|$)/.test(s.className))
        .map((s) => norm(s.textContent))
        .filter(Boolean);
    return [...document.querySelectorAll('input[id^="tick-"]')].map((input) => {
      const li = input.closest("li");
      const label = document.querySelector(`label[for="${input.id}"]`);
      return {
        key: input.id.replace(/^tick-/, ""),
        checked: input.checked,
        kind: norm(label?.querySelector("span")?.textContent),
        headline: norm(label?.querySelector("span.block")?.textContent).replace(
          /^(Story idea|Not a story): /,
          "",
        ),
        flags: upper(li),
        text: norm(li.textContent),
      };
    });
  });
}

/* ---------------------------------------------------------------- the walk */

async function theReportIsRead() {
  await readTheReport();
  const said = await page.locator("body").innerText();
  must(said.includes(READ_LINE), `the screen did not say what it read: looking for "${READ_LINE}"`);
  step(`the v2.6 report is read: "${READ_LINE}"`);
}

/** The run's own PARTIAL status, above the cards and before the editor reads them. */
async function thePartialRunIsBannered() {
  must(FIXTURE.includes("**Run status: PARTIAL.**"), "the fixture no longer states a PARTIAL run");
  must(
    FIXTURE.includes("retrieve and review the Sept. 22 council recording"),
    "the fixture no longer lists what the run did not get to",
  );
  /*
    The label is set in small caps by the stylesheet, so `innerText` hands it
    back uppercased even though the source reads "Run status:".
  */
  const said = await page.locator("body").innerText();
  must(
    /run status:\s*partial/i.test(said),
    "the review screen does not banner a run that stopped early",
  );
  must(
    said.includes("The scan that wrote this paste stopped before it finished."),
    "the banner does not say what a PARTIAL status means for the cards below it",
  );
  must(
    /retrieve and review the Sept\. 22 council recording/.test(said),
    "the banner does not quote the run's own list of what remains",
  );
  /*
    The banner sits above the first card, not under the last one: a status the
    editor reads after the cards have already been read as a full sweep is a
    status that arrived too late.
  */
  const above = await page.evaluate(() => {
    const banner = document.querySelector("div.border-2");
    const first = document.querySelector('input[id^="tick-"]');
    if (!banner || !first) return null;
    return banner.getBoundingClientRect().top < first.getBoundingClientRect().top;
  });
  must(above === true, "the PARTIAL banner is not above the cards it qualifies");
  step("the PARTIAL run is bannered above the cards, quoting the run's own list of what remains");
}

/** Twelve cards: the two Tier 1 ticked, everything the run could not stand behind unticked. */
async function theTiersDecide() {
  const read = await cardFacts();
  must(read.length === CARDS, `expected ${CARDS} cards, found ${read.length}`);
  must(
    read.filter((c) => c.kind === "Not a story — import it anyway?").length === SECTIONS,
    `the report's own sections are not read as ${SECTIONS} sections`,
  );

  const ticked = read.filter((c) => c.checked);
  must(
    ticked.length === TIER1.length,
    `${ticked.length} cards arrived ticked, expected ${TIER1.length}`,
  );
  for (const headline of TIER1) {
    const card = read.find((c) => c.headline === headline);
    must(Boolean(card), `no card for the Tier 1 packet "${headline}"`);
    must(card.checked, `the Tier 1 packet "${headline}" did not arrive ticked`);
    must(card.kind === "Import this story", `"${headline}" is not offered as a finished story`);
    must(
      !card.flags.includes(DEVELOPING_FLAG) && !card.flags.includes(UNVERIFIED_FLAG),
      `a Tier 1 packet wears a flag it should not: ${card.flags.join(", ")}`,
    );
    must(
      card.text.includes(TIER1_CLAIMS_WARNING),
      "the Tier 1 packet's unconfirmed claim is not warned about on its card",
    );
  }

  /*
    The tier the report states, over the length the old rule counted. S3 came
    out at 162 words and S4 at 45; both were written as packets, and what
    settles each of them is what the report says about it.
  */
  const tier2 = read.find((c) => c.headline === TIER2);
  must(Boolean(tier2), `no card for the Tier 2 packet "${TIER2}"`);
  must(tier2.kind === "Import this story", "a Tier 2 packet with a draft under it is not a story");
  must(!tier2.checked, "a Tier 2 packet arrived ticked, as if the report had called it ready");
  must(
    tier2.flags.includes(DEVELOPING_FLAG),
    `the Tier 2 packet is not wearing "${DEVELOPING_FLAG}"`,
  );
  must(!tier2.flags.includes(UNVERIFIED_FLAG), "a Tier 2 packet is wearing the unverified flag");
  must(
    tier2.text.includes(TIER2_CLAIMS_WARNING),
    "the Tier 2 packet's two unconfirmed claims are not warned about on its card",
  );

  const tier3 = read.find((c) => c.headline === TIER3);
  must(Boolean(tier3), `no card for the Tier 3 packet "${TIER3}"`);
  must(tier3.kind === "Import this idea", "a Tier 3 packet is offered as a finished story");
  must(!tier3.checked, "a Tier 3 packet arrived ticked");
  must(
    tier3.flags.includes(UNVERIFIED_FLAG),
    `the Tier 3 packet is not wearing "${UNVERIFIED_FLAG}"`,
  );
  must(
    tier3.text.includes(UNVERIFIED_SENTENCE),
    "a Tier 3 packet does not say it may not be printed",
  );

  const heldDeveloping = read.find((c) => c.headline === HELD_DEVELOPING);
  must(Boolean(heldDeveloping), `no card for the held table's row "${HELD_DEVELOPING}"`);
  must(!heldDeveloping.checked, "a held row of the table arrived ticked");
  must(
    heldDeveloping.flags.includes(DEVELOPING_FLAG),
    "the held table's Tier 2 row is not wearing its tier",
  );
  const heldPotential = read.find((c) => c.headline === HELD_POTENTIAL);
  must(Boolean(heldPotential), `no card for the held table's row "${HELD_POTENTIAL}"`);
  must(!heldPotential.checked, "a held row of the table arrived ticked");
  must(
    heldPotential.flags.includes(UNVERIFIED_FLAG),
    "the held table's Tier 3 row is not wearing its tier",
  );
  step(
    "twelve cards: the two Tier 1 packets ticked as stories, the Tier 2 packets unticked and developing, the Tier 3 packets and the table's rows unverified ideas",
  );
}

/**
 * The safety rule this unit exists for: a Black Desk hypothesis of 200-odd
 * words is an idea, never a draft, however long it runs.
 */
async function theHypothesesAreNeverStories() {
  must(
    FIXTURE.includes("Black Desk — Possible Stories to Investigate (Unverified)"),
    "the fixture no longer carries a Black Desk heading",
  );
  /*
    The words are counted off the fixture first, so a clean screen cannot pass
    by there being nothing long enough to misread as a story.
  */
  for (const headline of BLACK_DESK) {
    const start = FIXTURE.indexOf(headline);
    must(start > 0, `the fixture no longer writes "${headline.slice(0, 40)}…"`);
    const body = FIXTURE.slice(start, FIXTURE.indexOf("**Next check:**", start));
    const words = body.split(/\s+/).filter(Boolean).length;
    must(
      words > 150,
      `"${headline.slice(0, 30)}…" is only ${words} words; this probe would prove nothing`,
    );
  }
  const read = await cardFacts();
  for (const headline of BLACK_DESK) {
    const card = read.find((c) => c.headline === headline);
    must(Boolean(card), `no card for the Black Desk hypothesis "${headline.slice(0, 40)}…"`);
    must(card.kind === "Import this idea", `"${headline.slice(0, 40)}…" is offered as a story`);
    must(!card.checked, "a Black Desk hypothesis arrived ticked, as publication copy");
    must(
      card.flags.includes(UNVERIFIED_FLAG),
      `a Black Desk hypothesis is not wearing "${UNVERIFIED_FLAG}"`,
    );
    must(
      card.text.includes(UNVERIFIED_SENTENCE),
      "a Black Desk hypothesis does not say it may not be printed",
    );
    must(
      card.text.includes("Send it to Dark Desk"),
      "a Black Desk hypothesis offers no way to hand it to the Dark Desk",
    );
  }
  step(
    "two 200-word Black Desk hypotheses arrive as unverified ideas, unticked, each with a way to the Dark Desk",
  );
}

/** The ledger the report attaches: readable on the card, and out of the draft. */
async function theLedgerIsInTheNotes() {
  const card = cardFor(TIER2);
  await card.locator("summary").filter({ hasText: "Editor notes — never published" }).click();
  /*
    The card's first `pre` is the pasted text; the ledger is the one inside the
    notes panel behind the summary.
  */
  const notes = await card.locator("details pre").first().innerText({ timeout: 15_000 });
  must(
    notes.includes("Claims ledger — never published"),
    `the ledger is not in the editor notes; the panel reads: ${notes.slice(0, 300)}`,
  );
  must(notes.includes("UNVERIFIED"), "the ledger is in the notes without its statuses");
  must(notes.includes("CONTESTED"), "the ledger's contested claim is not in the notes");
  must(
    notes.includes("S3-A1"),
    "the ledger is in the notes without the source IDs behind each claim",
  );
  must(
    notes.includes(TIER2_GAP),
    "the tier's own qualifier — the gaps the report admits to — is not in the notes",
  );
  must(!notes.includes("| Claim |"), "the ledger is in the notes as a raw markdown table");

  const heldCard = cardFor(HELD_DEVELOPING);
  await heldCard.locator("summary").filter({ hasText: "Editor notes — never published" }).click();
  const heldNotes = await heldCard.locator("details pre").first().innerText({ timeout: 15_000 });
  must(
    heldNotes.includes("Compare the county's eligibility map"),
    `the table's own next-check text is not in the row's notes: ${heldNotes.slice(0, 200)}`,
  );
  step("the claims ledger, its statuses and source IDs, and the table's next check are in the notes");
}

/** The pictures of the review screen, taken on a paste nothing has happened to yet. */
async function theReviewPictures() {
  const headline = 'label[for^="tick-"] > span.block';
  // The label reads "Story idea: <headline>" on an idea card, so the prefix
  // comes off before the match -- the same strip the facts reader does.
  const indexOf = (wanted) =>
    page
      .locator(headline)
      .evaluateAll(
        (els, text) =>
          els.findIndex(
            (el) =>
              (el.textContent ?? "").replace(/^(Story idea|Not a story): /, "").trim() === text,
          ),
        wanted,
      );
  const tier2Index = await indexOf(TIER2);
  must(tier2Index >= 0, "no card on the review screen for the Tier 2 packet");
  const blackIndex = await indexOf(HYPOTHESIS);
  must(blackIndex >= 0, "no card on the review screen for the first Black Desk hypothesis");

  // Framed on the Tier 2 packet: a draft the report wrote and does not call ready.
  facts.push(await screenshot("review-tier2-1280-light.png", 1280, 900, headline, tier2Index));
  await page.getByRole("button", { name: "Switch to dark appearance" }).click();
  await page.waitForTimeout(400);
  facts.push(await screenshot("review-tier2-1280-dark.png", 1280, 900, headline, tier2Index));
  await page.getByRole("button", { name: "Switch to light appearance" }).click();
  await page.waitForTimeout(400);
  // Framed on a hypothesis: 200 words, and not a story.
  facts.push(await screenshot("review-blackdesk-1280-light.png", 1280, 900, headline, blackIndex));
  // The banner a PARTIAL run puts above the cards.
  facts.push(await screenshot("review-partial-banner-1280-light.png", 1280, 900, "div.border-2"));

  await page.setViewportSize({ width: 375, height: 720 });
  facts.push(await fitsAt375("the import review screen", true));
  facts.push(await screenshot("review-375-light.png", 375, 720, headline, blackIndex));
  await page.setViewportSize({ width: 1280, height: 900 });
}

/**
 * "Send it to Dark Desk" opens the Dark Desk's own start box holding the
 * hypothesis and the check the report named, and a later visit does not
 * re-open it.
 */
async function theHypothesisReachesTheDarkDesk() {
  const card = cardFor(HYPOTHESIS);
  await card.getByRole("link", { name: "Send it to Dark Desk" }).click();
  await page.waitForURL(/\/desk\/dark/, { timeout: 30_000 });
  const box = page.getByLabel("Tip, URL, or subject to investigate");
  await box.waitFor({ timeout: 45_000 });
  const seeded = await box.inputValue();
  must(
    seeded.startsWith(`Unverified — Black Desk · BD1 — ${HYPOTHESIS}`),
    `the Dark Desk box did not open with the hypothesis and its label: "${seeded.slice(0, 120)}…"`,
  );
  must(
    seeded.includes("could not check against a record"),
    "the seeded box does not hold the hypothesis as the report wrote it",
  );
  must(
    seeded.split("Next check:").length - 1 === 1,
    "the seeded box carries a next check that is not the one the report wrote, or carries two",
  );
  must(
    seeded.includes(HYPOTHESIS_CHECK),
    "the seeded box does not carry the check the report named",
  );
  step("a hypothesis opens the Dark Desk's box: its label, its text and the report's own next check");

  facts.push(
    await screenshot(
      "dark-desk-seeded-1280-light.png",
      1280,
      900,
      '[aria-label="Tip, URL, or subject to investigate"]',
    ),
  );
  await page.setViewportSize({ width: 375, height: 720 });
  facts.push(await fitsAt375("the Dark Desk with a seeded box"));
  facts.push(
    await screenshot(
      "dark-desk-seeded-375-light.png",
      375,
      720,
      '[aria-label="Tip, URL, or subject to investigate"]',
    ),
  );
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`${base}/desk/dark`, { waitUntil: "networkidle" });
  const after = page.getByLabel("Tip, URL, or subject to investigate");
  await after.waitFor({ timeout: 45_000 });
  must(
    (await after.inputValue()) === "",
    "the Dark Desk re-opened the hypothesis on a second visit, as if it had not been taken",
  );
  step("and a later visit opens its own empty box: the seed is taken once");
}

/** Import the two Tier 1 packets, and nothing the run could not stand behind. */
async function theTwoReadyStoriesLandOnTheQueue() {
  await readTheReport();
  await page
    .getByText("2 ticked · 2 ready to import", { exact: false })
    .first()
    .waitFor({ timeout: 30_000 });

  const button = page.getByRole("button", { name: /^Import 2 stories to the Queue$/ });
  await button.waitFor({ timeout: 30_000 });
  await button.click();
  await page
    .getByRole("heading", { name: "In the Queue", exact: true })
    .waitFor({ timeout: 60_000 });

  const panel = page.locator("section", {
    has: page.getByRole("heading", { name: "In the Queue", exact: true }),
  });
  const listed = await panel.innerText();
  for (const headline of TIER1) {
    must(listed.includes(headline), `"${headline}" is missing from the import result panel`);
  }
  for (const headline of [TIER2, TIER3, ...BLACK_DESK, HELD_DEVELOPING, HELD_POTENTIAL]) {
    must(
      !listed.includes(headline.slice(0, 40)),
      `"${headline.slice(0, 40)}…" was imported, and the report never called it ready`,
    );
  }
  await page
    .locator('[role="status"]')
    .filter({ hasText: "2 stories in the Queue, marked Imported. Nothing is published." })
    .first()
    .waitFor({ timeout: 15_000 });
  step("the two Tier 1 packets import; the developing, potential and unverified cards do not");

  await panel.getByRole("link", { name: "Open the Queue", exact: true }).click();
  await page.waitForURL(/\/desk\/queue/, { timeout: 30_000 });
  await page.locator(".chip.imported").first().waitFor({ timeout: 45_000 });
  const imported = await page.locator(".chip.imported").count();
  must(imported === 2, `the Queue shows ${imported} Imported leads, expected 2`);
  const queue = await page.locator("body").innerText();
  for (const headline of [TIER2, TIER3, ...BLACK_DESK, HELD_DEVELOPING, HELD_POTENTIAL]) {
    must(
      !queue.includes(headline.slice(0, 40)),
      `"${headline.slice(0, 40)}…" is on the Queue, and it is not publication copy`,
    );
  }
  facts.push(await screenshot("queue-1280-light.png", 1280, 900, ".chip.imported"));
  await page.setViewportSize({ width: 375, height: 720 });
  facts.push(await fitsAt375("the Queue after the import"));
  facts.push(await screenshot("queue-375-light.png", 375, 720, ".chip.imported"));
  await page.setViewportSize({ width: 1280, height: 900 });
  step("the Queue shows two Imported leads and none of the six the report did not stand behind");
}

/** The imported draft is the report's own text, and the ledger is not in it. */
async function theDraftIsTheReportsTextWithoutItsLedger() {
  const row = page.locator(".lead-row", { hasText: TIER1[0] });
  await row.getByRole("link", { name: TIER1[0], exact: true }).click();
  await page.waitForURL(/\/desk\/story\/\d+/, { timeout: 30_000 });
  const body = page.getByLabel("Body");
  await body.waitFor({ timeout: 45_000 });
  const text = await body.inputValue();
  must(
    text.includes(FIRST_SENTENCE),
    `the imported draft does not hold the report's own text; it reads: ${text.slice(0, 200)}`,
  );
  for (const leak of ["| Claim |", "Claims ledger", "VERIFIED", "UNVERIFIED", "CONTESTED"]) {
    must(!text.includes(leak), `the ledger reached the published text: found "${leak}" in the draft`);
  }
  step("the imported draft is the report's own text, with the ledger kept out of it");
}

/** Nothing is published by an import. */
async function nothingPrinted() {
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  const paper = await page.locator("body").innerText();
  for (const headline of [TIER1, TIER2, TIER3, BLACK_DESK, HELD_DEVELOPING, HELD_POTENTIAL].flat()) {
    must(
      !paper.includes(headline),
      `"${headline.slice(0, 40)}…" is on the public paper before any editor published it`,
    );
  }
  step("nothing is published: the paper does not carry the imported packets");
}

/** No sideways scroll, and the type an editor has to read is not shrunk below 14px. */
async function fitsAt375(note, enforceType = false) {
  const measured = await page.evaluate((enforce) => {
    const size = (el) => Number.parseFloat(getComputedStyle(el).fontSize);
    const own = enforce
      ? [
          ...document.querySelectorAll(
            'ul:has(> li > div > input[id^="tick-"]) label, ul:has(> li > div > input[id^="tick-"]) p',
          ),
        ]
      : [];
    const limit = window.innerWidth + 1;
    return {
      over: document.documentElement.scrollWidth - window.innerWidth,
      wide: [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > limit)
        .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
        .map(
          (el) =>
            `${el.tagName}.${el.className || "-"} right=${Math.round(el.getBoundingClientRect().right)} ` +
            `"${(el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)}"`,
        )
        .slice(0, 6),
      smallest: own.length ? Math.min(...own.map(size)) : null,
      under: own.filter((el) => size(el) < 14).length,
    };
  }, enforceType);
  must(
    measured.over <= 1,
    `${note} scrolls sideways by ${measured.over}px at 375px` +
      (measured.wide.length ? `. Widest:\n  ${measured.wide.join("\n  ")}` : ""),
  );
  if (enforceType) {
    must(
      measured.under === 0,
      `${measured.under} labels or paragraphs on the review screen are under 14px ` +
        `(smallest ${measured.smallest}px)`,
    );
  }
  step(
    `${note} fits 375px${enforceType ? `, its labels and paragraphs at ${measured.smallest}px` : ""}`,
  );
  return measured;
}

/** One screenshot of a finished page, its colours measured and printed. */
async function screenshot(name, width, height, anchor, index = 0) {
  await page.setViewportSize({ width, height });
  const measured = await page.evaluate(
    ({ selector, at }) => {
      const running = document.getAnimations();
      const names = running
        .map((a) => a.transitionProperty || a.animationName || "?")
        .filter(Boolean);
      running.forEach((a) => {
        try {
          a.finish();
        } catch {
          /* an infinite animation will not finish, and it is not a fade */
        }
      });
      const el = document.querySelectorAll(selector)[at];
      el?.scrollIntoView({ block: "center", behavior: "instant" });
      let background = "rgba(0, 0, 0, 0)";
      let up = el;
      while (up && (background === "rgba(0, 0, 0, 0)" || background === "transparent")) {
        background = getComputedStyle(up).backgroundColor;
        up = up.parentElement;
      }
      return {
        text: (el?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 90),
        color: el ? getComputedStyle(el).color : "",
        background,
        finishedAnimations: names,
      };
    },
    { selector: anchor, at: index },
  );
  mkdirSync(SHOTS, { recursive: true });
  const file = join(SHOTS, name);
  await page.screenshot({ path: file, fullPage: false });
  /*
    A sidecar of what the frame actually shows. The picture alone cannot be read
    back without an image viewer, and the point of these shots is that a
    reviewer can check the screen an editor saw -- so the visible text is
    written beside the PNG, measured in the same instant as it.
  */
  const visible = (await page.locator("body").innerText()).trim();
  writeFileSync(file.replace(/\.png$/, ".txt"), `${visible}\n`);
  shot.push(file);
  step(
    `shot ${name} (${width}x${height}): "${measured.text}" ${measured.color} on ` +
      `${measured.background}; animations still running: ${measured.finishedAnimations.join(", ") || "none"}`,
  );
  return {
    file,
    width,
    height,
    ...measured,
    visibleLines: visible.split("\n").filter((line) => line.trim()).length,
    visibleHead: visible.replace(/\s+/g, " ").trim().slice(0, 200),
  };
}

async function main() {
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
  try {
    await ownTheDesk();
    await theReportIsRead();
    await thePartialRunIsBannered();
    await theTiersDecide();
    await theHypothesesAreNeverStories();
    await theLedgerIsInTheNotes();
    await theReviewPictures();
    await theHypothesisReachesTheDarkDesk();
    await theTwoReadyStoriesLandOnTheQueue();
    await theDraftIsTheReportsTextWithoutItsLedger();
    await nothingPrinted();
  } catch (err) {
    await dump(err);
  }
  await browser.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        steps: done.length,
        screenshots: shot,
        measured: facts,
        consoleErrors: consoleErrors.slice(0, 10),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

await main();
