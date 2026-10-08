// guards: editors must be able to open skipped sources and see how old their coverage is.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installDom, moduleUrl, transpileToUrl } from "./dom-harness.mjs";

const window = installDom();
const React = await import("react");
const { createRoot } = await import("react-dom/client");

const preflightStub = transpileToUrl(
  "export function looksLikeProviderAuthFailure() { return false; } export function providerAuthTarget() { return ''; }",
  "preflight-stub.js",
);
const leadMatchStub = transpileToUrl(
  "export function distinguishingOverlap() { return { subjects: 0, names: 0 }; }",
  "lead-match-stub.js",
);
const paperStub = transpileToUrl("export const TOPICS = [], PAPER = { timezone: \"America/Denver\" }; export const formatClockTime = () => \"\", formatListDateTime = () => \"\";", "paper-stub.js");
const copyUrl = await moduleUrl("src/lib/news/desk-copy.ts", {
  "./preflight.ts": preflightStub,
  "./lead-match.ts": leadMatchStub,
  "../paper.ts": paperStub,
});
const componentUrl = await moduleUrl("src/components/scan-source-coverage.tsx", {
  "@/lib/news/desk-copy": copyUrl,
});
const { ScanSourceCoverageList } = await import(componentUrl);

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(element));
  return {
    container,
    async click(node) {
      await React.act(async () => node.dispatchEvent(new window.Event("click", { bubbles: true })));
    },
    async close() {
      await React.act(async () => root.unmount());
      container.remove();
    },
  };
}

test("opening skipped sources shows their last-read date and age", async () => {
  const page = await mount(
    React.createElement(ScanSourceCoverageList, {
      entries: [
        {
          sourceId: 12,
          title: "School board notices",
          url: "https://school.example/notices",
          kind: "school",
          tier: "A",
          status: "skipped",
          reasonCode: "over-cap",
          reason: null,
          lastReadAt: "2026-09-29T12:00:00.000Z",
        },
        {
          sourceId: 15,
          title: "Public safety updates",
          url: "https://safety.example/updates",
          kind: "public-safety",
          tier: "B",
          status: "blocked",
          reasonCode: "fetch-failed",
          reason: "The site refused the request.",
          lastReadAt: null,
        },
      ],
      asOf: "2026-10-08T12:00:00.000Z",
      listId: "scan-coverage-proof",
      formatListDateTime: () => "Sept. 29, 6:00 a.m.",
    }),
  );
  try {
    const button = page.container.querySelector('button[aria-controls="scan-coverage-proof"]');
    assert.ok(button);
    assert.equal(page.container.querySelector("li"), null, "source details start closed");
    await page.click(button);
    assert.equal(button.getAttribute("aria-expanded"), "true");
    const report = page.container.querySelector("#scan-coverage-proof");
    assert.match(report?.textContent ?? "", /School board notices/);
    assert.match(report?.textContent ?? "", /Kind: school · Tier: A/);
    assert.match(report?.textContent ?? "", /Last read Sept\. 29, 6:00 a\.m\. · read 9 days ago/);
    assert.ok(report?.querySelector('a[href="https://school.example/notices"]'));
    assert.match(report?.textContent ?? "", /Public safety updates/);
    assert.match(report?.textContent ?? "", /The site refused the request\./);
    assert.match(report?.textContent ?? "", /Never read/);
  } finally {
    await page.close();
  }
});
