import { assertPublicHttpUrl } from "./fetch-url.ts";
import { startGuardedRenderProxy } from "./render-proxy.ts";
import { looksLikeAppShell } from "./render-detect.ts";

export { hostNeedsRendering, looksLikeAppShell, needsRenderedFetch } from "./render-detect.ts";

export type RenderedPage = {
  text: string;
  title: string;
  html: string;
  finalUrl: string;
};

type ChromiumBrowser = {
  isConnected?: () => boolean;
  newContext: (opts: {
    userAgent: string;
    javaScriptEnabled: boolean;
    proxy?: { server: string };
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

/**
 * Forget the cached browser so the next call launches a fresh one.
 *
 * Chromium dies for ordinary reasons — an OOM kill under memory pressure is the
 * common one. The handle was cached forever, so after the first crash every
 * later render threw inside the caller's try/catch and silently returned null:
 * JS-heavy sources (Municode, PrimeGov) quietly degraded to app-shell HTML for
 * the rest of the process lifetime, with nothing in the logs saying why.
 */
function dropBrowser(reason: string) {
  if (browser) console.warn(`[render] dropping Chromium handle: ${reason}`);
  browser = null;
}

// Chromium's own OS-level renderer sandbox is the real barrier between a
// hostile page (arbitrary JS from a civic site we don't control) and this
// server's privileges. `--no-sandbox` disables it. It exists as a flag
// because the sandbox fails to *initialize* in some environments — running
// as root, or a container without the right namespaces/seccomp support —
// and Chromium just refuses to launch at all there. Most deploys aren't
// that environment, so the flag should not be on by default: a renderer
// exploit in fetched page content should stay inside Chromium's jail, not
// land with the process's own privileges. `TOWNREPORTER_CHROMIUM_NO_SANDBOX=1`
// is the documented escape hatch for the boxes that genuinely need it.
const SANDBOX_ESCAPE_HATCH = "TOWNREPORTER_CHROMIUM_NO_SANDBOX";
const BASE_CHROMIUM_ARGS = ["--disable-dev-shm-usage", "--disable-gpu"];

/**
 * The launch args to use *before* any runtime fallback. Exported so a test
 * can assert the default omits `--no-sandbox` without spinning up real
 * Chromium — this is the exact decision ENG-203 hardened, so it is the one
 * thing a mutation here must not be able to slip past unnoticed.
 */
export function sandboxedLaunchArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env[SANDBOX_ESCAPE_HATCH] === "1") {
    // Operator opted out explicitly. Costs the OS-level renderer jail.
    return ["--no-sandbox", ...BASE_CHROMIUM_ARGS];
  }
  return BASE_CHROMIUM_ARGS;
}

async function launchChromium(
  mod: { chromium: { launch: (opts: Record<string, unknown>) => Promise<ChromiumBrowser> } },
  args: string[],
): Promise<ChromiumBrowser> {
  return (await mod.chromium.launch({
    headless: true,
    args,
  })) as unknown as ChromiumBrowser;
}

async function getBrowser(): Promise<ChromiumBrowser | null> {
  if (typeof window !== "undefined") return null;
  if (process.env["VERCEL"] || process.env["TOWNREPORTER_NO_PLAYWRIGHT"] === "1") return null;
  if (browser) {
    // `isConnected` is false once the browser process is gone.
    if (browser.isConnected?.() === false) dropBrowser("browser disconnected");
    else return browser;
  }
  if (launching) return launching;
  launching = (async () => {
    try {
      // Variable specifier so Nitro does not trace Playwright into the Vercel function.
      const spec = "playwright";
      const mod = (await import(/* @vite-ignore */ spec)) as {
        chromium: { launch: (opts: Record<string, unknown>) => Promise<ChromiumBrowser> };
      };
      const args = sandboxedLaunchArgs();
      if (args.includes("--no-sandbox")) {
        browser = await launchChromium(mod, args);
        return browser;
      }
      try {
        browser = await launchChromium(mod, args);
      } catch (err) {
        // The sandbox failed to *initialize* (root user, missing container
        // namespaces), not a code bug we can retry away. Fall back once so a
        // render worker on such a box doesn't just stop working, but say so
        // loudly — silently running unsandboxed is the one thing worse than
        // a warning nobody reads.
        console.warn(
          `[render] Chromium sandbox failed to start (${err instanceof Error ? err.message : String(err)}); ` +
            `relaunching WITHOUT the OS sandbox. A renderer exploit can now reach this process's privileges. ` +
            `Set ${SANDBOX_ESCAPE_HATCH}=1 to silence this warning on boxes where the sandbox can never start.`,
        );
        browser = await launchChromium(mod, ["--no-sandbox", ...BASE_CHROMIUM_ARGS]);
      }
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

/**
 * Context options with the DNS-rebinding guard (ENG-201) welded on.
 *
 * Routes Chromium through the loopback proxy that resolves each host once via
 * `guardedLookup` and dials the vetted IP, so Chromium never performs a second,
 * rebindable lookup — for the top navigation or any subresource. If the proxy
 * cannot start (never, on a server), the pre-existing per-request
 * `assertPublicHttpUrl` guard still blocks the common cases.
 */
async function guardedContext(
  base: { userAgent: string; javaScriptEnabled: boolean },
): Promise<{ userAgent: string; javaScriptEnabled: boolean; proxy?: { server: string } }> {
  const proxy = await startGuardedRenderProxy();
  return proxy ? { ...base, proxy: { server: `http://127.0.0.1:${proxy.port}` } } : base;
}

export async function fetchRenderedPage(raw: string): Promise<RenderedPage | null> {
  if (typeof window !== "undefined") return null;
  const start = await assertPublicHttpUrl(raw);
  const br = await getBrowser();
  if (!br) return null;
  return withSlot(async () => {
    let ctx: Awaited<ReturnType<ChromiumBrowser["newContext"]>>;
    try {
      ctx = await br.newContext(await guardedContext({ userAgent: UA, javaScriptEnabled: true }));
    } catch (err) {
      // A dead browser fails right here. Drop it so the next caller relaunches
      // instead of inheriting the corpse.
      dropBrowser(err instanceof Error ? err.message : "newContext failed");
      return null;
    }
    const page = await ctx.newPage();
    try {
      await page.route("**/*", async (route) => {
        const u = route.request().url();
        if (!/^https?:/i.test(u)) {
          await route.abort();
          return;
        }
        try {
          await assertPublicHttpUrl(u);
          await route.continue();
        } catch {
          await route.abort();
        }
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
    let ctx: Awaited<ReturnType<ChromiumBrowser["newContext"]>>;
    try {
      ctx = await br.newContext(
        await guardedContext({
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          javaScriptEnabled: true,
        }),
      );
    } catch (err) {
      dropBrowser(err instanceof Error ? err.message : "newContext failed");
      return "";
    }
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
