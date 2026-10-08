import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { React, createRoot, h, detail, Route, RealPicker } from "./dark-file-model-flow.harness.mjs";

export async function fileScreen({ width = 1440, large = false, storedCopy = false } = {}) {
  detail.investigation.title = "r/longmont: Firestone Boulevard & I-25 Frontage Road Construction Contract";
  detail.investigation.ordinary_explanation = null;
  // The recorded file has 363 attempts and 262 saved records. Deliberately
  // give every saved record a long finding, exceeding the captured case.
  detail.claims = Array.from({ length: 262 }, (_, i) => ({ kind: "FINDING", capture_event_id: i + 1, body: "The public record describes the construction contract and the Board of Trustees hearing. ".repeat(6), confidence: 0.9 }));
  detail.sourceCaptures = detail.claims.map((_, i) => ({ id: i + 1, title: "Firestone Boulevard and I-25 Frontage Road Construction Contract — Board of Trustees hearing", url: "https://example.test/record/" + i }));
  globalThis.__darkFlow.fixtures["investigation-activity"] = Array.from({ length: 363 }, (_, i) => ({ id: String(i), occurredAt: "2026-10-08T12:00:00Z", tone: "plain", text: "Opened Firestone Boulevard and I-25 Frontage Road Construction Contract — Board of Trustees hearing, captured" }));
  if (storedCopy) { detail.claims[0].body = "An artifact records $1,200 after two hops. ".repeat(8); globalThis.__darkFlow.fixtures["investigation-activity"].forEach((a) => a.text = "Saved artifacts after 3 hops for $1,200"); }
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node);
  await React.act(async () => root.render(h(Route.component)));
  node.querySelector(".model-picker-stub").outerHTML = renderToStaticMarkup(h(RealPicker, { scope: "dark", layout: "stacked", compact: true, value: "codex", onChange() {}, onEffortChange() {}, effort: "medium" }));
  const markup = node.innerHTML;
  await React.act(async () => root.unmount()); node.remove();
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width, height: 1100 } });
  await page.route("**/*", (route) => route.abort());
  let css = (await readFile(new URL("../src/styles.css", import.meta.url), "utf8")).replace(/^@import[^;]+;/gm, "") + await readFile(new URL("../src/desk-astra.css", import.meta.url), "utf8");
  for (const weight of [500, 700, 800]) { const font = await readFile(`public/fonts/bricolage-grotesque-${weight}-normal-latin.woff2`); css += `@font-face{font-family:"Bricolage Grotesque";font-weight:${weight};src:url(data:font/woff2;base64,${font.toString("base64")})}`; }
  await page.setContent(`<style>body{margin:0}h1,h2,h3,p{margin:0}button,select{font:inherit}${css}</style><div class="desk-ltr astra ${large ? "large" : ""}" data-desk-page="dark" ><aside></aside><div class="astra-workspace"><main class="deskmain">${markup}</main></div></div>`);
  await page.evaluate((large) => { document.documentElement.dataset.deskSize = large ? "large" : "normal"; return document.fonts.ready; }, large);
  await mkdir("artifacts/dark-round-2", { recursive: true });
  return { page, close: () => browser.close() };
}
