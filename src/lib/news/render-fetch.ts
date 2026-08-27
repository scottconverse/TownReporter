import { assertPublicHttpUrl } from "./fetch-url.ts";
import { looksLikeAppShell } from "./render-detect.ts";

export { hostNeedsRendering, looksLikeAppShell, needsRenderedFetch } from "./render-detect.ts";

export type RenderedPage = {
  text: string;
  title: string;
  html: string;
  finalUrl: string;
};

type ChromiumBrowser = {
  newContext: (opts: {
    userAgent: string;
    javaScriptEnabled: boolean;
  }) => Promise<{
    newPage: () => Promise<{
      route: (pattern: string, handler: (route: { request: () => { url: () => string }; abort: () => unknown; continue: () => unknown }) => void) => Promise<void>;
      goto: (url: string, opts: { waitUntil: string; timeout: number }) => Promise<unknown>;
      waitForLoadState: (state: string, opts: { timeout: number }) => Promise<unknown>;
      url: () => string;
      title: () => Promise<string>;
      content: () => Promise<string>;
      innerText: (sel: string) => Promise<string>;
      evaluate: (fn: () => void) => Promise<unknown>;
      close: () => Promise<unknown>;
    }>;
    close: () => Promise<unknown>;
  }>;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 TownReporter/1.0";

let browser: ChromiumBrowser | null = null;
let launching: Promise<ChromiumBrowser | null> | null = null;
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

async function getBrowser(): Promise<ChromiumBrowser | null> {
  if (typeof window !== "undefined") return null;
  if (process.env["VERCEL"] || process.env["TOWNREPORTER_NO_PLAYWRIGHT"] === "1") return null;
  if (browser) return browser;
  if (launching) return launching;
  launching = (async () => {
    try {
      // Variable specifier so Nitro does not trace Playwright into the Vercel function.
      const spec = "playwright";
      const mod = (await import(/* @vite-ignore */ spec)) as {
        chromium: { launch: (opts: Record<string, unknown>) => Promise<ChromiumBrowser> };
      };
      browser = (await mod.chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      })) as unknown as ChromiumBrowser;
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
  if (typeof window !== "undefined") return null;
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
        const { htmlToPlainText } = await import("./html-text.ts");
        text = htmlToPlainText(html);
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

/** Click "...more" → "Show transcript" on a YouTube watch page and return the panel text. */
export async function scrapeYoutubeShowTranscript(videoId: string): Promise<string> {
  if (typeof window !== "undefined") return "";
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return "";
  const br = await getBrowser();
  if (!br) return "";
  return withSlot(async () => {
    const ctx = await br.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      javaScriptEnabled: true,
    });
    const page = await ctx.newPage();
    const p = page as unknown as {
      goto: (url: string, opts: { waitUntil: string; timeout: number }) => Promise<unknown>;
      locator: (sel: string) => {
        first: () => { click: (o: { force: boolean }) => Promise<void>; count: () => Promise<number> };
      };
      getByRole: (
        role: string,
        opts: { name: RegExp },
      ) => { first: () => { click: (o: { force: boolean }) => Promise<void>; count: () => Promise<number> } };
      evaluate: (fn: () => unknown) => Promise<unknown>;
      on: (ev: string, fn: (res: { url: () => string; text: () => Promise<string> }) => void) => void;
      close: () => Promise<unknown>;
    };
    let panelJson = "";
    try {
      p.on("response", async (res) => {
        if (res.url().includes("/youtubei/v1/get_panel")) {
          try {
            panelJson = await res.text();
          } catch {
            /* ignore */
          }
        }
      });
      const watch = `https://www.youtube.com/watch?v=${videoId}`;
      await assertPublicHttpUrl(watch);
      await p.goto(watch, { waitUntil: "domcontentloaded", timeout: 25000 });
      await new Promise((r) => setTimeout(r, 2500));
      if (await p.locator("#description-inline-expander #expand").first().count()) {
        await p.locator("#description-inline-expander #expand").first().click({ force: true });
        await new Promise((r) => setTimeout(r, 800));
      }
      const show = p.getByRole("button", { name: /show transcript/i });
      if (!(await show.first().count())) return "";
      await show.first().click({ force: true });
      let panel = "";
      for (let i = 0; i < 16; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        if (panelJson) {
          try {
            const cues = collectTranscriptCues(JSON.parse(panelJson));
            if (cues.length >= 2) return cues.join("\n");
          } catch {
            /* keep waiting */
          }
        }
        panel = String(
          await p.evaluate(() => {
            const el =
              document.querySelector("ytd-engagement-panel-section-list-renderer[target-id*='transcript']") ||
              document.querySelector("#panels ytd-engagement-panel-section-list-renderer");
            return ((el as HTMLElement | null)?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
          }),
        );
        if (panel.length > 120 && /[.]/.test(panel)) break;
      }
      return panel;
    } catch {
      return "";
    } finally {
      await page.close().catch(() => undefined);
      await ctx.close().catch(() => undefined);
    }
  });
}

function collectTranscriptCues(data: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    const item = rec.timelineItemViewModel as
      | { timestamp?: string; contentItems?: unknown }
      | undefined;
    if (item && (item.timestamp || item.contentItems)) {
      const bits: string[] = [];
      const grab = (n: unknown) => {
        if (!n || typeof n !== "object") return;
        const r = n as Record<string, unknown>;
        const vm = r.transcriptSegmentViewModel as { simpleText?: string } | undefined;
        if (vm?.simpleText?.trim()) bits.push(vm.simpleText.trim());
        for (const v of Object.values(r)) {
          if (v && typeof v === "object") grab(v);
        }
      };
      grab(item.contentItems ?? rec);
      if (bits.length) {
        const ts = item.timestamp?.trim();
        out.push(ts ? `[${ts}] ${bits.join(" ")}` : bits.join(" "));
        return;
      }
    }
    const vm = rec.transcriptSegmentViewModel as { simpleText?: string } | undefined;
    if (vm?.simpleText?.trim()) out.push(vm.simpleText.trim());
    for (const v of Object.values(rec)) {
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(data);
  return out;
}
