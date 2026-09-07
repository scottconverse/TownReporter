/*
  Real OCR for a scanned PDF, through whichever model the editor picked.

  The owner's framing: "Claude just did this via the browser — it looked at
  the no-text-layer PDF pages and read them. Claude and Codex can both open
  and look directly at a scan." So this module does not run a rasterizer or
  a Tesseract binary. It pulls the page IMAGES already embedded in the PDF
  (extractEmbeddedJpegs/extractEmbeddedPngs below — most scanners embed one
  JPEG or PNG per page) and asks a vision-capable model to transcribe each
  one, through the exact same PROVIDER_REGISTRY every other AI call in this
  desk goes through (../provider-registry.ts) — never a hardcoded provider.

  Four transports, matching `ProviderKind`:
    - Anthropic API (ANTHROPIC_API_KEY set): Messages API image blocks.
    - Codex CLI: `codex exec --image <file>` (ai-codex.server.ts).
    - Claude Code CLI: `claude -p --tools "Read"` naming ONE temp file in a
      per-run temp dir — the only place in this desk a live tool is handed
      to the CLI on purpose (ai-claude-code.server.ts's `claudeCodeReadChat`).
    - A local OpenAI-compatible server, only when the chosen model is marked
      `vision` by local-models.ts's discovery.

  A PDF that has no embedded page images at all (CCITT Group 4 / JBIG2 fax
  scans store pixels a different way — no lift-outable JPEG/PNG stream)
  yields no text here, honestly, with a reason ingest.ts's `needs-ocr`
  outcome carries to the editor. That is a real gap, not a bug to paper
  over with a guess.
*/
import type { OcrImpl, OcrOptions, PdfPage } from "./ingest.ts";
import { isSelfReferential } from "./claim-hygiene.ts";
import { providerEntry, providerModel, type ProviderKind } from "./provider-registry.ts";

const JPEG_SOI = [0xff, 0xd8, 0xff];

/** Pull embedded JPEG streams from a PDF so a scanned packet can be OCRed without a rasterizer. */
export function extractEmbeddedJpegs(buf: Uint8Array, max = 4): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < buf.length - 4 && out.length < max; i++) {
    if (buf[i] === JPEG_SOI[0] && buf[i + 1] === JPEG_SOI[1] && buf[i + 2] === JPEG_SOI[2]) {
      let j = i + 2;
      while (j < buf.length - 1) {
        if (buf[j] === 0xff && buf[j + 1] === 0xd9) {
          const slice = buf.slice(i, j + 2);
          if (slice.byteLength > 4000) out.push(slice);
          i = j + 2;
          break;
        }
        j++;
      }
    }
  }
  return out;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Pull embedded PNG images out of a PDF, the same lift-out trick as
 * `extractEmbeddedJpegs`. PNG is a chunked format (`length|type|data|crc`
 * repeated after an 8-byte signature) rather than a simple start/end marker
 * pair, so this walks chunks until it finds `IEND` instead of scanning for a
 * trailer byte sequence.
 */
export function extractEmbeddedPngs(buf: Uint8Array, max = 12): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < buf.length - 8 && out.length < max; i++) {
    let matches = true;
    for (let k = 0; k < PNG_SIGNATURE.length; k++) {
      if (buf[i + k] !== PNG_SIGNATURE[k]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    let j = i + 8;
    let end = -1;
    while (j + 8 <= buf.length) {
      const len = ((buf[j]! << 24) | (buf[j + 1]! << 16) | (buf[j + 2]! << 8) | buf[j + 3]!) >>> 0;
      const type = String.fromCharCode(buf[j + 4]!, buf[j + 5]!, buf[j + 6]!, buf[j + 7]!);
      const chunkEnd = j + 8 + len + 4;
      if (!/^[A-Za-z]{4}$/.test(type) || chunkEnd <= j || chunkEnd > buf.length) break;
      if (type === "IEND") {
        end = chunkEnd;
        break;
      }
      j = chunkEnd;
    }
    if (end > i) {
      const slice = buf.slice(i, end);
      if (slice.byteLength > 4000) out.push(slice);
      i = end - 1;
    }
  }
  return out;
}

export type PageImage = { bytes: Uint8Array; mime: "image/jpeg" | "image/png" };

/** Extractable embedded images, JPEGs first, capped at `max`. No PDF page association or order is established. */
export function extractEmbeddedPageImages(buf: Uint8Array, max = 12): PageImage[] {
  const jpegs = extractEmbeddedJpegs(buf, max).map((bytes) => ({
    bytes,
    mime: "image/jpeg" as const,
  }));
  if (jpegs.length >= max) return jpegs.slice(0, max);
  const pngs = extractEmbeddedPngs(buf, max - jpegs.length).map((bytes) => ({
    bytes,
    mime: "image/png" as const,
  }));
  return [...jpegs, ...pngs].slice(0, max);
}

/*
  Caps, stated once and honoured everywhere below:
    - at most 12 extracted images read, JPEGs first (not PDF page order);
    - at most 2 MiB per image (an image over that is skipped, not failed);
    - at most 10 minutes wall clock for the whole read, checked before every
      image so a slow provider stops taking images rather than blowing past it.
*/
export const OCR_MAX_PAGES = 12;
// Historical API name retained; this is an extracted-image cap, not a PDF page count.
export const OCR_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const OCR_TOTAL_BUDGET_MS = 10 * 60 * 1000;
const OCR_MIN_CALL_MS = 15_000;
const OCR_MAX_CALL_MS = 90_000;

export const TRANSCRIBE_INSTRUCTION =
  "Transcribe the text on this scanned document page verbatim, as plain text. Preserve headings and tables as text. Transcribe only; do not summarize or interpret. Return only the transcription — no preamble, no commentary, no description of the image.";

function env(key: string): string | undefined {
  const value = process.env[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

type Plan =
  | { kind: "anthropic"; apiKey: string; model: string }
  | { kind: "codex"; model: string }
  | { kind: "claude-code"; model: string }
  | { kind: "local"; baseUrl: string; apiKey: string; model: string };

type PlanFailure = { needsOcr: true; reason: string };

/** One vision transcription call. Overridable per-transport for hermetic tests. */
export type OcrPageTranscriber = (image: PageImage, timeoutMs: number) => Promise<string>;
export type OcrAdapters = Partial<Record<ProviderKind, OcrPageTranscriber>>;

async function resolveVisionLocal(
  override?: { baseUrl: string; id: string } | null,
): Promise<Plan | null> {
  const { discoverLocalModels } = await import("./local-models.ts");
  const catalog = await discoverLocalModels();
  const apiKey = env("LLM_API_KEY") ?? env("OPENAI_API_KEY") ?? "not-needed";
  if (override?.baseUrl && override.id) {
    const server = catalog.servers.find((s) => s.baseUrl === override.baseUrl && s.reachable);
    const model = server?.models.find((m) => m.id === override.id);
    return model?.vision
      ? { kind: "local", baseUrl: override.baseUrl, model: override.id, apiKey }
      : null;
  }
  for (const server of catalog.servers) {
    if (!server.reachable) continue;
    const visionModel = server.models.find((m) => m.vision);
    if (visionModel)
      return { kind: "local", baseUrl: server.baseUrl, model: visionModel.id, apiKey };
  }
  return null;
}

const NO_VISION_AVAILABLE =
  "No vision-capable model is available to read this scan: no ANTHROPIC_API_KEY, no Codex CLI, no signed-in Claude Code CLI, and no local model marked vision (· vision in the picker) was found.";

/** Which provider actually reads the pages, honouring the editor's picker choice. */
async function resolvePlan(opts: OcrOptions): Promise<Plan | PlanFailure> {
  const provider = opts.provider;
  if (!provider || provider === "auto") {
    // Automatic order: Anthropic API -> Codex -> Claude Code CLI -> a
    // vision-capable local default -> needs-ocr. Mirrors ai.ts's Automatic
    // ladder (the operator's own signed-in providers before a local guess).
    const apiKey = env("ANTHROPIC_API_KEY");
    if (apiKey)
      return { kind: "anthropic", apiKey, model: env("ANTHROPIC_MODEL") || "claude-opus-5" };
    const { probeCodex } = await import("./ai-codex.server.ts");
    const codex = await probeCodex();
    if (codex.ok)
      return { kind: "codex", model: env("TOWNREPORTER_CODEX_TERRA_MODEL") || "gpt-5.6-terra" };
    const { probeClaudeCode } = await import("./ai-claude-code.server.ts");
    const claude = await probeClaudeCode();
    if (claude.ok) return { kind: "claude-code", model: env("ANTHROPIC_MODEL") || "claude-opus-5" };
    const local = await resolveVisionLocal(opts.localModel);
    if (local) return local;
    return { needsOcr: true, reason: NO_VISION_AVAILABLE };
  }

  const entry = providerEntry(provider);
  if (!entry) return { needsOcr: true, reason: `"${provider}" is not a model this desk knows.` };

  if (entry.kind === "claude-code") {
    const apiKey = env("ANTHROPIC_API_KEY");
    if (apiKey) return { kind: "anthropic", apiKey, model: providerModel(entry) };
    const { probeClaudeCode } = await import("./ai-claude-code.server.ts");
    const claude = await probeClaudeCode();
    if (claude.ok) return { kind: "claude-code", model: providerModel(entry) };
    return {
      needsOcr: true,
      reason:
        "Claude is not set up on this machine (no ANTHROPIC_API_KEY and no signed-in Claude Code CLI).",
    };
  }
  if (entry.kind === "codex") {
    const { probeCodex } = await import("./ai-codex.server.ts");
    const codex = await probeCodex(entry.label);
    if (!codex.ok) return { needsOcr: true, reason: codex.error };
    return { kind: "codex", model: providerModel(entry) };
  }
  if (entry.kind === "local") {
    const local = await resolveVisionLocal(opts.localModel);
    if (local) return local;
    return {
      needsOcr: true,
      reason:
        "the chosen local model cannot read images — pick a vision model (marked · vision in the picker).",
    };
  }
  return { needsOcr: true, reason: `${entry.label} cannot read images.` };
}

function planLabel(plan: Plan): string {
  if (plan.kind === "anthropic" || plan.kind === "claude-code") return "Claude";
  if (plan.kind === "codex") return "Codex";
  return plan.model;
}

async function withTempImageFile<T>(
  image: PageImage,
  fn: (filePath: string) => Promise<T>,
): Promise<T> {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "trd-ocr-"));
  const ext = image.mime === "image/png" ? "png" : "jpg";
  const filePath = join(dir, `page.${ext}`);
  await writeFile(filePath, image.bytes);
  try {
    return await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      /* best-effort; a leftover temp file is not worth failing the read over */
    });
  }
}

async function anthropicTranscribePage(
  image: PageImage,
  apiKey: string,
  model: string,
  timeoutMs: number,
): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  const res = await client.messages.create({
    model,
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: image.mime, data: b64(image.bytes) },
          },
          { type: "text", text: TRANSCRIBE_INSTRUCTION },
        ],
      },
    ],
  });
  return res.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

async function codexTranscribePage(
  image: PageImage,
  model: string,
  timeoutMs: number,
): Promise<string> {
  return withTempImageFile(image, async (filePath) => {
    const { codexChat } = await import("./ai-codex.server.ts");
    const result = await codexChat({
      system: TRANSCRIBE_INSTRUCTION,
      user: "Transcribe the attached page image.",
      model,
      timeoutMs,
      imagePaths: [filePath],
    });
    if (!result.ok) throw new Error(result.error);
    return result.text;
  });
}

async function claudeCodeTranscribePage(
  image: PageImage,
  model: string,
  timeoutMs: number,
): Promise<string> {
  return withTempImageFile(image, async (filePath) => {
    const { claudeCodeReadChat } = await import("./ai-claude-code.server.ts");
    const result = await claudeCodeReadChat({
      prompt: TRANSCRIBE_INSTRUCTION,
      filePath,
      model,
      timeoutMs,
    });
    if (!result.ok) throw new Error(result.error);
    return result.text;
  });
}

async function localTranscribePage(
  image: PageImage,
  baseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs: number,
): Promise<string> {
  const dataUri = `data:${image.mime};base64,${b64(image.bytes)}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey && apiKey !== "not-needed") headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${trimSlash(baseUrl)}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUri } },
            { type: "text", text: TRANSCRIBE_INSTRUCTION },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`local vision model API error ${res.status}`);
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return (body.choices?.[0]?.message?.content ?? "").trim();
}

async function transcribePage(
  plan: Plan,
  image: PageImage,
  timeoutMs: number,
  adapters?: OcrAdapters,
): Promise<string> {
  const adapter = adapters?.[plan.kind];
  if (adapter) return adapter(image, timeoutMs);
  if (plan.kind === "anthropic")
    return anthropicTranscribePage(image, plan.apiKey, plan.model, timeoutMs);
  if (plan.kind === "codex") return codexTranscribePage(image, plan.model, timeoutMs);
  if (plan.kind === "claude-code") return claudeCodeTranscribePage(image, plan.model, timeoutMs);
  return localTranscribePage(image, plan.baseUrl, plan.apiKey, plan.model, timeoutMs);
}

/**
 * Every self-referential / tool-talk line an OCR transcript could echo back
 * (a vision model narrating its own reasoning, a CLI's tool chatter leaking
 * into the answer) is dropped line by line, reusing the exact filter claims
 * are already held to (claim-hygiene.ts's `isSelfReferential`) rather than a
 * second, drifting copy of the same rules.
 */
function stripNarration(text: string): string {
  return text
    .split("\n")
    .filter((line) => !isSelfReferential(line))
    .join("\n")
    .trim();
}

function callTimeoutMs(startedAt: number, imagesLeft: number): number {
  const remaining = OCR_TOTAL_BUDGET_MS - (Date.now() - startedAt);
  if (remaining <= 0) return 0;
  const share = Math.floor(remaining / Math.max(1, imagesLeft));
  return Math.max(OCR_MIN_CALL_MS, Math.min(OCR_MAX_CALL_MS, share));
}

/**
 * Read a scanned PDF's page images through whichever vision model the desk
 * resolves to. See this module's top doc comment for the four transports
 * and provider-registry.ts for how "the editor's picker choice" is honoured.
 */
export const productionOcr: OcrImpl = async (buf, opts = {}) => {
  const images = extractEmbeddedPageImages(buf, OCR_MAX_PAGES);
  if (images.length === 0) {
    return {
      text: "",
      pages: [],
      reason:
        "This scan format is not supported yet (no embedded JPEG or PNG page images were found in the PDF — likely a CCITT Group 4 or JBIG2 fax-style scan).",
    };
  }

  const plan = await resolvePlan(opts);
  if ("needsOcr" in plan) {
    return { text: "", pages: [], reason: plan.reason };
  }

  const started = Date.now();
  const pages: PdfPage[] = [];
  let pagesRead = 0;
  for (let i = 0; i < images.length; i++) {
    const imagesLeft = images.length - i;
    const timeoutMs = callTimeoutMs(started, imagesLeft);
    if (timeoutMs <= 0) break; // out of the total 10-minute budget
    const image = images[i]!;
    if (image.bytes.byteLength > OCR_MAX_IMAGE_BYTES) continue; // over the 2MB-per-page cap
    let raw: string;
    try {
      raw = await transcribePage(plan, image, timeoutMs, opts.adapters as OcrAdapters | undefined);
    } catch {
      continue; // one page failing should not lose the pages already read
    }
    const cleaned = stripNarration(raw);
    if (cleaned) {
      pages.push({ page: null, imageIndex: i + 1, text: cleaned });
      pagesRead++;
    }
  }

  const text = pages
    .map((p) => p.text)
    .join("\n\n")
    .trim();
  return {
    text,
    pages,
    provider: planLabel(plan),
    pagesRead,
    // Historical field names retained for stored extraction-method compatibility.
    // This is the capped extracted-image inventory, never the PDF's page count.
    pagesTotal: images.length,
  };
};
