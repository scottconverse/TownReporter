import type { Browser } from "playwright";
import { assertPublicHttpUrl } from "./fetch-url.ts";

const JS_HOST =
  /(^|\.)(municode\.com|ecode360\.com|amlegal\.com|qcode\.us|granicus\.com|granicusondemand\.com|legistar\.com|civicclerk\.com|boarddocs\.com|civicplus\.com|granicusideas\.com)$/i;

export function hostNeedsRendering(url: URL): boolean {
  const host = url.hostname.replace(/^www\./i, "");
  return JS_HOST.test(host);
}

export function looksLikeAppShell(stripped: string, html = ""): boolean {
  const t = stripped.replace(/\s+/g, " ").trim();
  if (
    /internet explorer 9 and below|no longer supported\. please use a different browser|please enable javascript|javascript is required|this site requires javascript|this application requires javascript/i.test(
      t,
    )
  ) {
    return true;
  }
  if (t.length < 400 && /id=["'](?:root|app|__next|municode|main-app)["']/i.test(html)) return true;
  if (t.length < 220 && /<script/i.test(html) && /react|angular|vue|next/i.test(html)) return true;
  return false;
}

export function needsRenderedFetch(url: URL, stripped: string, html = ""): boolean {
  if (hostNeedsRendering(url)) return true;
  return looksLikeAppShell(stripped, html);
}

export type RenderedPage = {
  text: string;
  title: string;
  html: string;
  finalUrl: string;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 TownReporter/1.0";

let browser: Browser | null = null;
let launching: Promise<Browser | null> | null = null;
let slots = 2;
const waiters: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (slots <= 0) await new Promise<void>((r) => waiters.push(r));
  else slots -= 1;
  try {
    return await fn();
  } finally {
    const next = waiters.shift();
    if (next) next();
    else slots += 1;
  }
}

async function getBrowser(): Promise<Browser | null> {
  if (process.env.TOWNREPORTER_NO_PLAYWRIGHT === "1") return null;
  if (browser) return browser;
  if (launching) return launching;
  launching = (async () => {
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
      return browser;
    } catch {
      browser = null;
      return null;
    } finally {
      launching = null;
    }
  })();
  return launching;
}

export async function fetchRenderedPage(raw: string): Promise<RenderedPage | null> {
  const start = await assertPublicHttpUrl(raw);
  const br = await getBrowser();
  if (!br) return null;
  return withSlot(async () => {
    const ctx = await br.newContext({ userAgent: UA, javaScriptEnabled: true });
    const page = await ctx.newPage();
    try {
      await page.route("**/*", (route) => {
        const u = route.request().url();
        if (!/^https?:/i.test(u)) {
          void route.abort();
          return;
        }
        void route.continue();
      });
      await page.goto(start.toString(), { waitUntil: "domcontentloaded", timeout: 25000 });
      try {
        await page.waitForLoadState("networkidle", { timeout: 8000 });
      } catch {
        /* Municode often never goes idle. The body is still usable. */
      }
      await assertPublicHttpUrl(page.url());
      await page.evaluate(() => {
        for (const sel of [
          "#google_translate_element",
          ".goog-te-gadget",
          ".goog-te-combo",
          "#gt-nvframe",
        ]) {
          document.querySelectorAll(sel).forEach((n) => n.remove());
        }
      });
      const title = (await page.title()).replace(/\s+/g, " ").trim().slice(0, 140);
      const html = await page.content();
      let text = "";
      try {
        text = (await page.innerText("body")).replace(/\s+/g, " ").trim();
      } catch {
        text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      if (text.length < 40) return null;
      if (looksLikeAppShell(text, html)) return null;
      return { text, title: title || start.hostname, html, finalUrl: page.url() };
    } catch {
      return null;
    } finally {
      await page.close().catch(() => undefined);
      await ctx.close().catch(() => undefined);
    }
  });
}
