import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { collectStoryDates, storyDateRows } from "../src/lib/story-dates.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const typescript = require("typescript");
const jsxRuntimeUrl = pathToFileURL(require.resolve("react/jsx-runtime")).href;
const [appCss, deskCss] = await Promise.all([
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../src/desk-astra.css", import.meta.url), "utf8"),
]);
const mailboxCopySource = await readFile(
  new URL("../src/lib/news/newsletter-copy.ts", import.meta.url),
  "utf8",
);
const mailboxCopyJs = typescript.transpileModule(mailboxCopySource, {
  fileName: "newsletter-copy.ts",
  compilerOptions: { module: typescript.ModuleKind.ESNext },
}).outputText;
const mailboxCopyUrl = `data:text/javascript;base64,${Buffer.from(mailboxCopyJs).toString("base64")}`;
const { mailboxSaveResultText } = await import(mailboxCopyUrl);

function transpiledModuleUrl(source, fileName, imports = {}, jsx = false) {
  let output = typescript.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      ...(jsx ? { jsx: typescript.JsxEmit.ReactJSX } : {}),
    },
  }).outputText;
  for (const [name, url] of Object.entries({ ...imports, ...(jsx ? { "react/jsx-runtime": jsxRuntimeUrl } : {}) })) {
    output = output.replaceAll(JSON.stringify(name), JSON.stringify(url));
  }
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

const findingDisplaySource = await readFile(
  new URL("../src/lib/news/finding-evidence-display.ts", import.meta.url),
  "utf8",
);
const findingDisplayUrl = transpiledModuleUrl(
  findingDisplaySource,
  "finding-evidence-display.ts",
);
const citedRecordSource = await readFile(
  new URL("../src/components/cited-record-checks.tsx", import.meta.url),
  "utf8",
);
const citedRecordUrl = transpiledModuleUrl(
  citedRecordSource,
  "cited-record-checks.tsx",
  { "@/lib/news/finding-evidence-display": findingDisplayUrl },
  true,
);
const { CitedRecordChecks } = await import(citedRecordUrl);

const reactModuleUrl = pathToFileURL(require.resolve("react")).href;
const routerLinkSource = `import React from ${JSON.stringify(reactModuleUrl)};\n` +
  `export const Link = ({ children, params }) => React.createElement("a", { href: "/articles/" + params.slug }, children);`;
const routerLinkUrl = `data:text/javascript;base64,${Buffer.from(routerLinkSource).toString("base64")}`;
const datesPanelSource = await readFile(
  new URL("../src/components/paper/dates-panel.tsx", import.meta.url),
  "utf8",
);
const datesPanelUrl = transpiledModuleUrl(
  datesPanelSource,
  "dates-panel.tsx",
  { "@tanstack/react-router": routerLinkUrl },
  true,
);
const { DatesPanel } = await import(datesPanelUrl);
const transcriptRecordSource = await readFile(
  new URL("../src/components/meeting-transcript-record.tsx", import.meta.url),
  "utf8",
);
const transcriptDatesSource = await readFile(
  new URL("../src/lib/news/transcript-dates.ts", import.meta.url),
  "utf8",
);
const transcriptDatesUrl = transpiledModuleUrl(transcriptDatesSource, "transcript-dates.ts");
const transcriptRecordUrl = transpiledModuleUrl(
  transcriptRecordSource,
  "meeting-transcript-record.tsx",
  { "@/lib/news/transcript-dates": transcriptDatesUrl },
  true,
);
const { TranscriptRecordHeader, TranscriptStorageDetails } = await import(transcriptRecordUrl);
const reportingSummarySource = await readFile(
  new URL("../src/components/reporting-run-summary.tsx", import.meta.url),
  "utf8",
);
const reportingRunCopySource = await readFile(
  new URL("../src/lib/news/reporting-run-summary.ts", import.meta.url),
  "utf8",
);
const reportingRunCopyUrl = transpiledModuleUrl(reportingRunCopySource, "reporting-run-summary.ts");
const reportingSummaryUrl = transpiledModuleUrl(
  reportingSummarySource,
  "reporting-run-summary.tsx",
  { "@/lib/news/reporting-run-summary": reportingRunCopyUrl },
  true,
);
const { ReportingRunSummary } = await import(reportingSummaryUrl);

function rgb(value) {
  const parts = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  assert.ok(parts?.length === 3, `Expected an RGB color, received ${value}`);
  return parts.map((part) => {
    const channel = part / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
}

function contrastRatio(foreground, background) {
  const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const [a, b] = [luminance(rgb(foreground)), luminance(rgb(background))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

test("FA09: selected desk navigation stays readable on the first dark-mode frame", async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(
        '<html><body><div class="desk-ltr astra"><nav class="astra-navigation">' +
          '<a id="selected" class="astra-nav active" aria-current="page">Queue</a>' +
        '</nav></div></body></html>',
      );
      await page.addStyleTag({ content: appCss });
      await page.addStyleTag({ content: deskCss });
      const frame = await page.locator("#selected").evaluate((element) => {
        document.documentElement.dataset.appearance = "desk-dark";
        const style = getComputedStyle(element);
        return { foreground: style.color, background: style.backgroundColor };
      });
      const ratio = contrastRatio(frame.foreground, frame.background);
      assert.ok(
        ratio >= 4.5,
        `${width}px first dark frame contrast was ${ratio.toFixed(2)}:1 (${frame.foreground} on ${frame.background})`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("FB21: the one-time invite message wraps its long link at phone width", async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const token = "a".repeat(180);
    const message = `You are invited to edit the paper. Open this link on the computer you will write from:\nhttps://127.0.0.1:3400/login?invite=${token}\nIt works once and expires in seven days.`;
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(
        `<html data-desk-size="large"><body style="margin:0"><div class="desk-ltr astra">` +
          `<section style="width:calc(100vw - 32px);max-width:640px;margin:16px">` +
          `<p id="message" class="invite-copy-message" style="white-space:pre-wrap;font-size:calc(16px * var(--ts, 1))">${message}</p>` +
          `</section></div></body></html>`,
      );
      await page.addStyleTag({ content: appCss });
      await page.addStyleTag({ content: deskCss });
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        message: document.querySelector("#message").scrollWidth,
        messageWidth: document.querySelector("#message").clientWidth,
      }));
      assert.ok(
        layout.document <= layout.viewport && layout.message <= layout.messageWidth,
        `${width}px invite message overflowed: document ${layout.document}px; message ${layout.message}/${layout.messageWidth}px`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("FB12: the saved mailbox status tells the truth when no password exists", async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent('<main><p id="save-result" role="status"></p></main>');
    const noPasswordText = mailboxSaveResultText(false, false);
    await page.locator("#save-result").evaluate((element, text) => {
      element.textContent = text;
    }, noPasswordText);
    const screenText = await page.locator("#save-result").innerText();
    assert.match(screenText, /no password is stored yet/i);
    assert.doesNotMatch(screenText, /password was kept/i);
    assert.match(mailboxSaveResultText(false, true), /stored password was kept/i);
  } finally {
    await browser.close();
  }
});

test("FA10: evidence cards lead with a readable date, passage and review action", async () => {
  const capture = {
    versionId: 41,
    captureEventId: 92,
    url: "https://records.example/agenda",
    title: "Council agenda",
    capturedAt: "2026-09-08T10:00:00Z",
    available: true,
    readable: true,
    takenDown: false,
    excerptState: "found",
    newerCapture: null,
    viewHref: "/evidence/41",
  };
  const markup = renderToStaticMarkup(
    React.createElement(CitedRecordChecks, {
      variant: "finding",
      captures: [capture],
      passage: "The council approved the playground plan.",
      onOpen: () => {},
      pending: false,
    }),
  );
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(`<main>${markup}</main>`);
      const visible = await page.locator("main").innerText();
      assert.match(visible, /September 8, 2026 at 10:00 AM UTC/);
      assert.match(visible, /The council approved the playground plan\./);
      assert.match(visible, /Open the saved source copy/);
      assert.equal(await page.locator("details").count(), 1);
      assert.doesNotMatch(visible, /capture event 92|saved copy 41/);
      await page.getByText("Details for support").click();
      assert.match(await page.locator("main").innerText(), /capture event 92.*saved copy 41/);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("FA11: the October 12 public date names the Hover Acres playground plans", async () => {
  const headline = "Longmont Commits to New Playground, Swings at Hover Acres; Residents Get Until Oct. 12 to Weigh In on the Rest";
  const items = collectStoryDates([{
    slug: "hover-acres-playground",
    section: "environment-open-space",
    records: [],
    headline,
    published_on: "2026-09-30",
  }], { from: "2026-10-11", days: 7 });
  const itemRows = storyDateRows(items);
  const markup = renderToStaticMarkup(
    React.createElement(DatesPanel, { title: "This week", items: itemRows }),
  );
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(`<main>${markup}</main>`);
      const link = page.locator(".datespanel a");
      assert.equal(await link.count(), 1);
      const title = await link.innerText();
      assert.equal(title, headline);
      assert.match(title, /Hover Acres/);
      assert.match(title, /playground/i);
      assert.match(title, /Oct\. 12 to Weigh In/);
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= width);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

const transcriptView = {
  artifactId: 12,
  videoId: "museum-42",
  title: "Museum Advisory Board Meeting, September 21, 2026",
  meetingDate: "2026-09-21",
  postedDate: "2026-09-30",
  storagePath: "D:/captures/newsroom-1/museum-42/transcript-ab.srv3",
  sha256: "c".repeat(64),
  format: "srv3",
  byteSize: 1_351_168,
  capturedAt: "2026-09-30 03:10:00+00",
  lines: [{ segmentIndex: 0, startSeconds: 0, excerpt: "The meeting was called to order." }],
};

test("FC08: the transcript names its meeting date separately from the video post date", async () => {
  const markup = renderToStaticMarkup(
    React.createElement(TranscriptRecordHeader, { view: transcriptView }),
  );
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(`<main>${markup}</main>`);
      const visible = await page.locator("main").innerText();
      assert.match(visible, /Meeting date: September 21, 2026/);
      assert.match(visible, /Video posted September 30, 2026/);
      assert.match(visible, /Open the meeting video/);
      assert.doesNotMatch(visible, /Meeting of 2026-09-30/);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("FC11: storage diagnostics stay behind the technical details disclosure", async () => {
  const markup = renderToStaticMarkup(
    React.createElement(TranscriptStorageDetails, { view: transcriptView }),
  );
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(`<main>${markup}</main>`);
      assert.equal(await page.locator("details").count(), 1);
      assert.equal(await page.locator("details").evaluate((details) => details.open), false);
      let visible = await page.locator("main").innerText();
      assert.match(visible, /Technical storage details/);
      assert.doesNotMatch(visible, /transcript-ab\.srv3|c{64}|srv3/);
      await page.getByText("Technical storage details").click();
      visible = await page.locator("main").innerText();
      assert.match(visible, /transcript-ab\.srv3/);
      assert.match(visible, /c{64}/);
      assert.match(visible, /srv3/);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("FC20: the reporting package explains its result in editor words before technical details", async () => {
  const report = {
    runStatus: "PARTIAL",
    runNote: "Research scope is supplied-sources-only: independent public discovery was not run and no document beyond the editor's own seeds was fetched. The retained record and supplied sources are still fully accounted for. no retained tape was scoped; warm 0 / cold 0 actions; warm and cold passes agreed; 1 saved story packet; coverage gate did not pass.",
    coverageComplete: false,
    actions: [],
    stories: [{ id: "story-1", sources: [{ id: "source-1" }] }],
    meetingCoverage: [],
    unknowns: [],
    held: [],
  };
  const markup = renderToStaticMarkup(
    React.createElement(ReportingRunSummary, {
      report,
      methodDetails: "Method 2.6.0 - full-pipeline - Model DeepSeek v4.1 Flash",
    }),
  );
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(`<main>${markup}</main>`);
      const visible = await page.locator("main").innerText();
      assert.match(visible, /What was read/i);
      assert.match(visible, /What was established/i);
      assert.match(visible, /What still needs checking/i);
      assert.match(visible, /Next action/i);
      assert.match(visible, /No saved meeting transcript or recording was included/i);
      assert.match(visible, /Start a follow-up run/i);
      assert.match(visible, /1 story draft was saved\. No meeting actions were recorded\./i);
      assert.doesNotMatch(visible, /warm|cold|full-pipeline|no retained tape|Method 2\.6\.0/i);
      assert.equal(await page.locator("details").count(), 1);
      await page.getByText("Technical run details").click();
      const details = await page.locator("main").innerText();
      assert.match(details, /warm 0 \/ cold 0 actions/);
      assert.match(details, /full-pipeline/);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
