/*
  Firecrawl Local: an opt-in, one-time manual read of a watched page.

  Server-only. The service token never leaves this process -- it is read from a
  file, sent only as the bearer header, and deliberately kept out of every error
  sentence this module can produce. Nothing here starts the service, and there
  is no cloud fallback: if the local service is down, the read fails and the
  caller saves nothing.
*/
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { storableText } from "./storable-text.ts";
import type { IngestDocument } from "./ingest.ts";

export const FIRECRAWL_LOCAL_VERSION = "0.1.1";
export const FIRECRAWL_LOCAL_EXTRACTION_METHOD = `firecrawl-local:${FIRECRAWL_LOCAL_VERSION}`;
const DEFAULT_ORIGIN = "http://127.0.0.1:18764";

const NOT_SET_UP =
  "Firecrawl Local is not set up on this computer (no service token). Nothing was saved.";
const NOT_RUNNING =
  "Firecrawl Local is not running at 127.0.0.1:18764. Start it by hand, then try again. Nothing was saved.";
const CLOUD_REFUSED =
  "Firecrawl Local answered from the cloud. Cloud is not allowed. Nothing was saved.";

/** A refusal this module can explain in one sentence an editor can act on. */
export class FirecrawlLocalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirecrawlLocalError";
  }
}

export type ReadWithFirecrawlLocalOptions = {
  fetchImpl?: typeof fetch;
  /** Origin override; must still be this computer. */
  origin?: string;
  /** Token FILE path override (the token itself never crosses this seam). */
  token?: string;
  signal?: AbortSignal;
};

function defaultTokenFile(): string {
  const local = process.env.LOCALAPPDATA;
  if (local) return `${local}\\FirecrawlLocalPilot\\service-token`;
  return join(homedir(), "AppData", "Local", "FirecrawlLocalPilot", "service-token");
}

function assertLocalOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new FirecrawlLocalError(
      "Firecrawl Local must run on this computer (127.0.0.1, localhost or ::1). Nothing was saved.",
    );
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host))
    throw new FirecrawlLocalError(
      "Firecrawl Local must run on this computer (127.0.0.1, localhost or ::1). Nothing was saved.",
    );
  return parsed.origin;
}

async function readToken(file: string): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new FirecrawlLocalError(NOT_SET_UP);
  }
  const token = raw.trim();
  if (!/^[0-9a-f]{64}$/i.test(token)) throw new FirecrawlLocalError(NOT_SET_UP);
  return token;
}

/**
 * Read one page through the local Firecrawl service and map its answer to the
 * desk's `IngestDocument`. Throws `FirecrawlLocalError` -- never a raw network
 * or parse error -- so the caller can show the exact sentence.
 */
export async function readWithFirecrawlLocal(
  url: string,
  opts: ReadWithFirecrawlLocalOptions = {},
): Promise<IngestDocument> {
  const origin = assertLocalOrigin(
    opts.origin ?? process.env.TOWNREPORTER_FIRECRAWL_LOCAL_ORIGIN ?? DEFAULT_ORIGIN,
  );
  const token = await readToken(
    opts.token ?? process.env.TOWNREPORTER_FIRECRAWL_LOCAL_TOKEN_FILE ?? defaultTokenFile(),
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);
  if (opts.signal?.aborted) controller.abort();
  const fetchImpl = opts.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(`${origin}/v2/scrape`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown", "links"],
        onlyMainContent: true,
        timeout: 38000,
      }),
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    throw new FirecrawlLocalError(NOT_RUNNING);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }

  if (response.status === 401 || response.status === 403)
    throw new FirecrawlLocalError(
      `Firecrawl Local refused the request (status ${response.status}). Nothing was saved.`,
    );
  if (!response.ok)
    throw new FirecrawlLocalError(
      `Firecrawl Local could not read this page (status ${response.status}). Nothing was saved.`,
    );

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new FirecrawlLocalError(
      `Firecrawl Local could not read this page (status ${response.status}). Nothing was saved.`,
    );
  }
  const root = (payload ?? {}) as Record<string, unknown>;
  const data = (root.data ?? {}) as Record<string, unknown>;
  if (root.success !== true)
    throw new FirecrawlLocalError(
      `Firecrawl Local could not read this page (status ${response.status}). Nothing was saved.`,
    );
  if (root.source === "firecrawl-cloud" || data.source === "firecrawl-cloud")
    throw new FirecrawlLocalError(CLOUD_REFUSED);

  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const markdown = typeof data.markdown === "string" ? data.markdown : "";
  const status =
    typeof metadata.statusCode === "number" ? metadata.statusCode : 200;
  if (status >= 400)
    throw new FirecrawlLocalError(
      `The source answered with status ${status}. Nothing was saved.`,
    );

  const finalUrl =
    (typeof metadata.url === "string" && metadata.url) ||
    (typeof metadata.sourceURL === "string" && metadata.sourceURL) ||
    url;
  const redirectChain = finalUrl !== url ? [url, finalUrl] : [];
  const title = typeof metadata.title === "string" ? metadata.title : "";

  return {
    ok: true,
    status,
    outcome: "fetched",
    text: storableText(markdown),
    title: storableText(title),
    extras: [],
    contentType: "text/markdown",
    needsOcr: false,
    redirectChain,
    extractionMethod: FIRECRAWL_LOCAL_EXTRACTION_METHOD,
    pages: [],
    notices: [],
  };
}
