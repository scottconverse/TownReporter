#!/usr/bin/env node
/**
 * The Server page must refuse to be framed, in a real browser.
 *
 * A gate audit found no protective headers on any route. On a reader's page
 * that is untidy; on `/desk/ops` it is a hole, because that page carries
 * controls that restart the app and the Cloudflare Tunnel on the operator's
 * own machine.
 *
 * The session guard does not help. A hostile page frames the desk, floats
 * something inviting over the restart button, and waits for a signed-in editor
 * to click. What follows is a genuine same-origin request carrying the real
 * cookie, so `assertSameSiteRequest` is satisfied -- it answers "did this come
 * from our origin", never "did the operator mean it". Only the browser can
 * refuse to draw the frame.
 *
 * Checking the header with curl proves the string is sent. This loads an
 * attacker page in Chromium, points an iframe at the desk, and asks the
 * browser whether it drew it -- which is the property that actually matters.
 *
 *   SECURITY_HEADERS_BASE_URL=http://127.0.0.1:3218 node scripts/security-headers-e2e.mjs
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

const base = checkedUrl(
  process.env.SECURITY_HEADERS_BASE_URL || "http://127.0.0.1:8080",
).replace(/\/$/, "");

const done = [];
const step = (n) => {
  done.push(n);
  console.log(`  ok    ${n}`);
};

/** Routes a browser renders, and therefore routes a browser can be told to frame. */
const FRAMED = ["/", "/login", "/desk", "/desk/ops"];

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  console.log(`security headers: ${base}`);

  for (const path of FRAMED) {
    const res = await page.goto(base + path, { waitUntil: "domcontentloaded" });
    const h = res?.headers() ?? {};
    if ((h["x-frame-options"] ?? "").toUpperCase() !== "DENY") {
      throw new Error(`${path}: X-Frame-Options is "${h["x-frame-options"] ?? "absent"}", expected DENY`);
    }
    if (!/frame-ancestors\s+'none'/.test(h["content-security-policy"] ?? "")) {
      throw new Error(`${path}: no frame-ancestors 'none' in the policy`);
    }
    if ((h["x-content-type-options"] ?? "") !== "nosniff") {
      throw new Error(`${path}: X-Content-Type-Options is not nosniff`);
    }
    step(`${path} refuses framing and sniffing`);
  }

  /*
    The part a header check cannot do: ask the browser.

    An attacker page is served from a data: URL, which is a different origin
    from the app, and told to frame the desk. If the browser honours the
    policy the frame stays blank and its document is unreachable.
  */
  const attacker = `data:text/html,${encodeURIComponent(
    `<h1>totally unrelated page</h1><iframe id="f" src="${base}/desk/ops" width="800" height="600"></iframe>`,
  )}`;
  await page.goto(attacker, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const framed = await page.evaluate(() => {
    const el = document.getElementById("f");
    try {
      const doc = el.contentDocument;
      if (!doc) return { drew: false, why: "no contentDocument" };
      const text = (doc.body?.innerText ?? "").trim();
      return { drew: text.length > 0, why: text.slice(0, 80) };
    } catch (err) {
      return { drew: false, why: `blocked: ${String(err).slice(0, 60)}` };
    }
  });

  if (framed.drew) {
    throw new Error(`a hostile page framed /desk/ops and could read it: ${framed.why}`);
  }
  step(`a hostile page cannot frame the Server page (${framed.why})`);

  await context.close();
  await browser.close();
  console.log(JSON.stringify({ ok: true, steps: done.length }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message ?? err), completed: done }, null, 2));
  process.exit(1);
});
