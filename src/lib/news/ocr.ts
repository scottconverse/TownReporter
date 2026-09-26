/*
  Real OCR for a scanned PDF, through whichever model the editor picked.

  The owner's framing: "Claude just did this via the browser — it looked at
  the no-text-layer PDF pages and read them. Claude and Codex can both open
  and look directly at a scan." This module renders actual PDF pages through
  PDF.js and native canvas, then asks a vision-capable model to transcribe
  each page in document order. It does not require a Tesseract installation.
  It uses the exact same PROVIDER_REGISTRY every other AI call in this
  desk goes through (../provider-registry.ts) — never a hardcoded provider.

  Four transports, matching `ProviderKind`:
    - Anthropic API (ANTHROPIC_API_KEY set): Messages API image blocks.
    - Codex CLI: `codex exec --image <file>` (ai-codex.server.ts).
    - Claude Code CLI: `claude -p --tools "Read"` naming ONE temp file in a
      per-run temp dir — the only place in this desk a live tool is handed
      to the CLI on purpose (ai-claude-code.server.ts's `claudeCodeReadChat`).
    - A local OpenAI-compatible server, only when the chosen model is marked
      `vision` by local-models.ts's discovery.

  Rendering/reading failures and page, image-size or time limits are reported
  as incomplete. The legacy embedded-image helpers below remain available;
  their results do not establish PDF page order. A running PDF render cannot
  be forcibly interrupted by the cooperative whole-document time budget.
*/
import type { OcrImpl, OcrOptions, PdfPage } from "./ingest.ts";
import { isSelfReferential } from "./claim-hygiene.ts";
import { isCustomModelChoice } from "./model-choice.ts";
import {
  modelEffort,
  providerEntry,
  providerModel,
  type ProviderId,
  type ProviderKind,
} from "./provider-registry.ts";
import { automaticFailoverReason, looksLikeContentRefusal } from "./automatic-failover.ts";
import { OCR_BATCH_PAGE_LIMIT } from "./ocr-batches.ts";

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

type RenderedPdfPageImage = PageImage & { page: number };
type RenderedPdfPages = {
  images: RenderedPdfPageImage[];
  totalPages: number;
  reason?: string;
};

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
/** Maximum pages in one bounded provider call. Complete packet jobs chain and checkpoint batches. */
export const OCR_MAX_PAGES = OCR_BATCH_PAGE_LIMIT;
// Historical API name retained; this is an extracted-image cap, not a PDF page count.
export const OCR_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const OCR_TOTAL_BUDGET_MS = 10 * 60 * 1000;
const OCR_RENDER_WIDTH = 1600;
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
  | { kind: "openai"; baseUrl: string; apiKey: string; model: string }
  | { kind: "local"; baseUrl: string; apiKey: string; model: string };

type PlanFailure = { needsOcr: true; reason: string };

/** One vision transcription call. Overridable per-transport for hermetic tests. */
export type OcrPageTranscriber = (
  image: PageImage,
  timeoutMs: number,
  selected?: { transport: ProviderKind; model: string },
) => Promise<string>;
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

/*
  OCR's own unattended order, and deliberately NOT `automaticLadder()`.

  Unit Y (0.6.63) re-pointed the WRITING/RESEARCH ladder at DeepSeek v4.1
  Flash, then the local model on this computer, then Codex Terra. Nobody asked
  OCR to change, and 0.6.62's unattended OCR order was Codex Terra, then Claude
  (Sonnet or Haiku), then a discovered local vision model. Because both of
  those new writing rungs are `kind: "local"` entries -- which OCR treats as a
  *discovery* (`resolveVisionLocal`), not a registry rung -- iterating the
  writing ladder here silently deleted Claude from an unattended scan and left
  the two `claude-code` branches below dead. This constant keeps OCR on its own
  order so a later ladder change for writing cannot quietly un-read scans.

  A local vision model is still OCR's final capability, but it is appended
  after these rungs by the builders below rather than named in this list.
*/
export const OCR_AUTOMATIC_ORDER = [
  "codex-balanced",
  "claude-sonnet",
] as const satisfies readonly ProviderId[];

const NO_VISION_AVAILABLE =
  "No vision-capable model is available to read this scan. OCR's unattended order is Codex Terra, then Claude (an ANTHROPIC_API_KEY when one is set, otherwise the signed-in Claude Code CLI), then a local model marked vision (· vision in the picker) — and none of them answered.";

function injectedAutomaticPlans(opts: OcrOptions): Plan[] {
  const adapters = opts.adapters as OcrAdapters | undefined;
  if (!adapters) return [];
  const plans: Plan[] = [];
  for (const id of OCR_AUTOMATIC_ORDER) {
    const entry = providerEntry(id);
    if (!entry) continue;
    if (entry.kind === "codex" && adapters.codex) {
      plans.push({ kind: "codex", model: providerModel(entry) });
      continue;
    }
    if (entry.kind === "claude-code") {
      if (adapters.anthropic) {
        plans.push({ kind: "anthropic", apiKey: "test-adapter", model: providerModel(entry) });
      } else if (adapters["claude-code"]) {
        plans.push({ kind: "claude-code", model: providerModel(entry) });
      }
    }
  }
  if (adapters.local && opts.localModel) {
    plans.push({
      kind: "local",
      baseUrl: opts.localModel.baseUrl,
      model: opts.localModel.id,
      apiKey: "test-adapter",
    });
  }
  return plans;
}

async function productionAutomaticPlans(opts: OcrOptions, firstOnly = false): Promise<Plan[]> {
  const plans: Plan[] = [];
  for (const id of OCR_AUTOMATIC_ORDER) {
    const entry = providerEntry(id);
    if (!entry) continue;
    if (entry.kind === "codex") {
      const { probeCodex } = await import("./ai-codex.server.ts");
      const codex = await probeCodex();
      if (codex.ok) plans.push({ kind: "codex", model: providerModel(entry) });
    } else if (entry.kind === "claude-code") {
      const apiKey = env("ANTHROPIC_API_KEY");
      if (apiKey) {
        plans.push({ kind: "anthropic", apiKey, model: providerModel(entry) });
      } else {
        const { probeClaudeCode } = await import("./ai-claude-code.server.ts");
        const claude = await probeClaudeCode();
        if (claude.ok) plans.push({ kind: "claude-code", model: providerModel(entry) });
      }
    }
    if (firstOnly && plans.length) break;
  }
  if (!firstOnly || plans.length === 0) {
    const local = await resolveVisionLocal(opts.localModel);
    if (local) plans.push(local);
  }
  return plans;
}

/**
 * Tests inject complete transports, not partial spies over the live machine.
 * Resolve only from that closed set so a cached readiness probe or developer
 * login can never turn a hermetic OCR test into a real provider call.
 */
function resolveInjectedPlan(opts: OcrOptions): Plan | PlanFailure | null {
  const adapters = opts.adapters as OcrAdapters | undefined;
  if (!adapters) return null;

  const unavailable = (kind: ProviderKind): PlanFailure => ({
    needsOcr: true,
    reason: `The selected ${kind} OCR reader is unavailable in the injected adapter set.`,
  });
  if (opts.forcedPlan) {
    if (!adapters[opts.forcedPlan.kind]) return unavailable(opts.forcedPlan.kind);
    if (opts.forcedPlan.kind === "local") {
      return {
        kind: "local",
        baseUrl: opts.forcedPlan.baseUrl,
        model: opts.forcedPlan.model,
        apiKey: "test-adapter",
      };
    }
    return opts.forcedPlan;
  }

  const provider = opts.provider;
  if (!provider || provider === "auto") {
    return injectedAutomaticPlans(opts)[0] ?? { needsOcr: true, reason: NO_VISION_AVAILABLE };
  }

  // Custom connections still need their injected resolver to supply the
  // endpoint/model identity; transcribePage below keeps the transport closed.
  if (isCustomModelChoice(provider)) return null;
  const entry = providerEntry(provider);
  if (!entry) return null;
  if (entry.kind === "codex") {
    return adapters.codex ? { kind: "codex", model: providerModel(entry) } : unavailable("codex");
  }
  if (entry.kind === "claude-code") {
    if (adapters.anthropic) {
      return { kind: "anthropic", apiKey: "test-adapter", model: providerModel(entry) };
    }
    return adapters["claude-code"]
      ? { kind: "claude-code", model: providerModel(entry) }
      : unavailable("claude-code");
  }
  if (entry.kind === "local") {
    return adapters.local && opts.localModel
      ? {
          kind: "local",
          baseUrl: opts.localModel.baseUrl,
          model: opts.localModel.id,
          apiKey: "test-adapter",
        }
      : unavailable("local");
  }
  return null;
}

/** Which provider actually reads the pages, honouring the editor's picker choice. */
async function resolvePlan(opts: OcrOptions): Promise<Plan | PlanFailure> {
  const injected = resolveInjectedPlan(opts);
  if (injected) return injected;
  if (opts.forcedPlan) {
    if (opts.forcedPlan.kind === "local") {
      const local = await resolveVisionLocal({
        baseUrl: opts.forcedPlan.baseUrl,
        id: opts.forcedPlan.model,
      });
      return (
        local ?? {
          needsOcr: true,
          reason: "the selected local model cannot read images.",
        }
      );
    }
    return opts.forcedPlan;
  }
  const provider = opts.provider;
  if (!provider || provider === "auto") {
    // Automatic follows OCR's OWN unattended order (OCR_AUTOMATIC_ORDER):
    // Codex Terra, then Claude, then a discovered local vision model. This is
    // NOT provider-registry.ts's writing/research ladder and must not be
    // re-pointed when that one changes -- see the constant's comment.
    return (await productionAutomaticPlans(opts, true))[0] ?? {
      needsOcr: true,
      reason: NO_VISION_AVAILABLE,
    };
  }

  if (isCustomModelChoice(provider)) {
    const newsroomId = Number(opts.newsroomId);
    if (!Number.isSafeInteger(newsroomId) || newsroomId <= 0) {
      return {
        needsOcr: true,
        reason: "The selected custom AI connection cannot read this scan without its newsroom.",
      };
    }
    try {
      const resolve =
        opts.resolveCustom ??
        (await import("./custom-ai-connections.server.ts")).resolveCustomAiChoice;
      const connection = await resolve(newsroomId, provider.slice("custom:".length));
      return {
        kind: "openai",
        baseUrl: connection.baseUrl,
        apiKey: connection.apiKey || "not-needed",
        model: connection.modelId,
      };
    } catch (error) {
      return {
        needsOcr: true,
        reason:
          error instanceof Error
            ? error.message
            : "The selected custom AI connection is unavailable for OCR.",
      };
    }
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
  if (entry.kind === "xai-oauth") {
    return {
      needsOcr: true,
      reason:
        "Grok (SuperGrok) is a text-only connection in TownReporter and cannot read scan images. Choose Anthropic, Codex, Claude Code, or a local model marked · vision for OCR.",
    };
  }
  return { needsOcr: true, reason: `${entry.label} cannot read images.` };
}

function samePlan(a: Plan, b: Plan): boolean {
  return a.kind === b.kind && a.model === b.model &&
    (!("baseUrl" in a) || !("baseUrl" in b) || a.baseUrl === b.baseUrl);
}

/** Resolve fallback transports only after a page's selected reader has a
 * classified technical failure. Every returned plan is vision-capable by
 * construction: named Claude/Codex readers, an Anthropic image model, or a
 * discovered local model explicitly marked vision. Grok never enters this list. */
async function resolveVisionFallbackPlans(opts: OcrOptions, primary?: Plan): Promise<Plan[]> {
  const candidates: Plan[] = [];
  const adapters = opts.adapters as OcrAdapters | undefined;
  for (const forced of opts.visionFallbackPlans ?? []) {
    if (adapters && !adapters[forced.kind]) continue;
    if (forced.kind === "local") {
      const local = adapters
        ? { kind: "local" as const, baseUrl: forced.baseUrl, model: forced.model, apiKey: "test-adapter" }
        : await resolveVisionLocal({ baseUrl: forced.baseUrl, id: forced.model });
      if (local) candidates.push(local);
    } else candidates.push(forced);
  }
  if (!opts.visionFallbackPlans) {
    candidates.push(
      ...(adapters ? injectedAutomaticPlans(opts) : await productionAutomaticPlans(opts)),
    );
  }
  return candidates.filter(
    (candidate, index) =>
      (!primary || !samePlan(candidate, primary)) &&
      candidates.findIndex((earlier) => samePlan(earlier, candidate)) === index,
  );
}

function effortForPlan(plan: Plan, effort: OcrOptions["reasoningEffort"]) {
  if (plan.kind === "local" || plan.kind === "openai") {
    // OpenAI-compatible is a wire shape, not an effort capability. Revalidate
    // against the exact resolved model before adding anything to the payload.
    return modelEffort("local-model", effort, plan.model);
  }
  const choice = plan.kind === "codex"
    ? "codex-balanced"
    : plan.kind === "anthropic" || plan.kind === "claude-code"
      ? (/haiku/i.test(plan.model) ? "claude-haiku" : "claude-sonnet")
      : "local-model";
  return modelEffort(choice, effort);
}

function isTechnicalOcrFailure(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return automaticFailoverReason(detail) !== null;
}

function acceptedOcrText(raw: string): string {
  if (looksLikeContentRefusal(raw)) throw new Error(raw);
  return stripNarration(raw);
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
  reasoningEffort?: import("./provider-registry.ts").ModelEffort | null,
): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  const res = await client.messages.create({
    model,
    max_tokens: 4000,
    ...(reasoningEffort
      ? {
          thinking: { type: "adaptive" as const },
          output_config: { effort: reasoningEffort as "low" | "medium" | "high" | "max" },
        }
      : {}),
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
  reasoningEffort?: import("./provider-registry.ts").ModelEffort | null,
): Promise<string> {
  return withTempImageFile(image, async (filePath) => {
    const { codexChat } = await import("./ai-codex.server.ts");
    const result = await codexChat({
      system: TRANSCRIBE_INSTRUCTION,
      user: "Transcribe the attached page image.",
      model,
      timeoutMs,
      imagePaths: [filePath],
      reasoningEffort,
    });
    if (!result.ok) throw new Error(result.error);
    return result.text;
  });
}

async function claudeCodeTranscribePage(
  image: PageImage,
  model: string,
  timeoutMs: number,
  reasoningEffort?: import("./provider-registry.ts").ModelEffort | null,
): Promise<string> {
  return withTempImageFile(image, async (filePath) => {
    const { claudeCodeReadChat } = await import("./ai-claude-code.server.ts");
    const result = await claudeCodeReadChat({
      prompt: TRANSCRIBE_INSTRUCTION,
      filePath,
      model,
      timeoutMs,
      reasoningEffort,
    });
    if (!result.ok) throw new Error(result.error);
    return result.text;
  });
}

async function openAiCompatibleTranscribePage(
  image: PageImage,
  baseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs: number,
  reasoningEffort?: import("./provider-registry.ts").ModelEffort | null,
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
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
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
  if (!res.ok) throw new Error(`vision model API error ${res.status}`);
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
  reasoningEffort?: import("./provider-registry.ts").ModelEffort | null,
): Promise<string> {
  const adapter = adapters?.[plan.kind];
  if (adapter) return adapter(image, timeoutMs, { transport: plan.kind, model: plan.model });
  if (adapters) {
    throw new Error(`${planLabel(plan)} OCR reader is unavailable in the injected adapter set.`);
  }
  if (plan.kind === "anthropic")
    return anthropicTranscribePage(image, plan.apiKey, plan.model, timeoutMs, reasoningEffort);
  if (plan.kind === "codex") return codexTranscribePage(image, plan.model, timeoutMs, reasoningEffort);
  if (plan.kind === "claude-code") return claudeCodeTranscribePage(image, plan.model, timeoutMs, reasoningEffort);
  return openAiCompatibleTranscribePage(
    image,
    plan.baseUrl,
    plan.apiKey,
    plan.model,
    timeoutMs,
    reasoningEffort,
  );
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

function callTimeoutMs(startedAt: number, imagesLeft: number, now: () => number = Date.now): number {
  const remaining = OCR_TOTAL_BUDGET_MS - (now() - startedAt);
  if (remaining < OCR_MIN_CALL_MS) return 0;
  const share = Math.floor(remaining / Math.max(1, imagesLeft));
  return Math.max(OCR_MIN_CALL_MS, Math.min(OCR_MAX_CALL_MS, share));
}

/**
 * Render the actual PDF pages in their document order. Unlike raw stream
 * extraction, PDF.js decodes fax/JBIG2 image encodings and never mistakes a
 * decorative image for a page. Rendering is deliberately bounded: only the
 * first `OCR_MAX_PAGES` pages are attempted and over-budget PNGs are reported
 * as an incomplete read instead of being silently treated as complete.
 */
export async function renderPdfPages(
  buf: Uint8Array,
  startedAt = Date.now(),
  pageRange?: OcrOptions["pageRange"],
  now: () => number = Date.now,
): Promise<RenderedPdfPages> {
  const { createIsomorphicCanvasFactory, getDocumentProxy, renderPageAsImage } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    // PDF.js may transfer its input to a worker; retain the caller's bytes for
    // the later render calls and for the captured raw-artifact receipt.
    const canvasImport = () => import("@napi-rs/canvas");
    const CanvasFactory = await createIsomorphicCanvasFactory(canvasImport);
    pdf = await getDocumentProxy(Uint8Array.from(buf), { CanvasFactory });
    const totalPages = pdf.numPages;
    const requestedStart = pageRange?.start ?? 1;
    const requestedEnd = pageRange?.end ?? Math.min(totalPages, OCR_MAX_PAGES);
    if (
      !Number.isInteger(requestedStart) ||
      !Number.isInteger(requestedEnd) ||
      requestedStart < 1 ||
      requestedEnd < requestedStart ||
      requestedEnd > totalPages ||
      requestedEnd - requestedStart + 1 > OCR_MAX_PAGES
    ) {
      return {
        images: [],
        totalPages,
        reason: `Choose an inclusive PDF page range from 1 to ${totalPages}, up to ${OCR_MAX_PAGES} pages.`,
      };
    }
    const images: RenderedPdfPageImage[] = [];
    const omitted: string[] = [];
    for (let page = requestedStart; page <= requestedEnd; page++) {
      if (now() - startedAt >= OCR_TOTAL_BUDGET_MS) {
        omitted.push(`pages ${page}-${requestedEnd} were not attempted (time limit)`);
        break;
      }
      try {
        const rendered = await renderPageAsImage(pdf, page, {
          width: OCR_RENDER_WIDTH,
          canvasImport,
        });
        const bytes = new Uint8Array(rendered);
        if (bytes.byteLength > OCR_MAX_IMAGE_BYTES) {
          omitted.push(`page ${page} exceeded the ${OCR_MAX_IMAGE_BYTES / 1024 / 1024} MiB image limit`);
          continue;
        }
        images.push({ page, bytes, mime: "image/png" });
      } catch {
        omitted.push(`page ${page} could not be rendered`);
      }
    }
    if (!pageRange && totalPages > OCR_MAX_PAGES) {
      omitted.push(`pages ${OCR_MAX_PAGES + 1}-${totalPages} were not attempted (page limit)`);
    }
    return {
      images,
      totalPages,
      reason: omitted.length ? `OCR incomplete: ${omitted.join("; ")}.` : undefined,
    };
  } catch {
    return { images: [], totalPages: 0, reason: "This PDF could not be rendered for OCR." };
  } finally {
    await pdf?.cleanup().catch(() => {
      /* Cleanup must not hide the extraction result. */
    });
  }
}

/**
 * Read a scanned PDF's page images through whichever vision model the desk
 * resolves to. See this module's top doc comment for the four transports
 * and provider-registry.ts for how "the editor's picker choice" is honoured.
 */
export async function transcribeDocumentImage(image: PageImage, opts: OcrOptions = {}): Promise<string> {
  const plan = await resolvePlan(opts);
  if ("needsOcr" in plan) {
    const reason = "unavailable" as const;
    for (const fallback of await resolveVisionFallbackPlans(opts)) {
      await opts.beforeModelCall?.();
      try {
        const text = acceptedOcrText(await transcribePage(fallback, image, 180000, opts.adapters as OcrAdapters | undefined, effortForPlan(fallback, opts.reasoningEffort)));
        if (text) {
          await opts.onProviderSwitch?.({ transport: fallback.kind, model: fallback.model, reason });
          return text;
        }
      } catch (error) {
        if (!isTechnicalOcrFailure(error)) throw error;
      }
    }
    throw new Error(plan.reason);
  }
  await opts.beforeModelCall?.();
  try {
    const first = acceptedOcrText(await transcribePage(plan, image, 180000, opts.adapters as OcrAdapters | undefined, effortForPlan(plan, opts.reasoningEffort)));
    if (first) return first;
    throw new Error("empty model response");
  } catch (error) {
    if (!isTechnicalOcrFailure(error)) throw error;
    const reason = automaticFailoverReason(error instanceof Error ? error.message : String(error))!;
    for (const fallback of await resolveVisionFallbackPlans(opts, plan)) {
      await opts.beforeModelCall?.();
      try {
        const text = acceptedOcrText(await transcribePage(fallback, image, 180000, opts.adapters as OcrAdapters | undefined, effortForPlan(fallback, opts.reasoningEffort)));
        if (text) {
          await opts.onProviderSwitch?.({ transport: fallback.kind, model: fallback.model, reason });
          return text;
        }
      } catch (fallbackError) {
        if (!isTechnicalOcrFailure(fallbackError)) throw fallbackError;
        // Try the next already-verified vision reader for this image only.
      }
    }
    throw error;
  }
}

/** Read only the PDF directory. No page is rendered and no model is called. */
export async function pdfPageCount(buf: Uint8Array): Promise<number> {
  const { getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    pdf = await getDocumentProxy(Uint8Array.from(buf));
    return pdf.numPages;
  } catch {
    return 0;
  } finally {
    await pdf?.cleanup().catch(() => {
      /* Cleanup must not hide the page count. */
    });
  }
}

export const productionOcr: OcrImpl = async (buf, opts = {}) => {
  const now = opts.now ?? Date.now;
  const started = opts.startedAt ?? now();
  const rendered = await renderPdfPages(buf, started, opts.pageRange, now);
  const images = rendered.images;
  if (images.length === 0) {
    return {
      text: "",
      pages: [],
      reason: rendered.reason ?? "This PDF has no renderable pages for OCR.",
    };
  }

  const resolvedPrimary = await resolvePlan(opts);
  let primaryPlan: Plan;
  let fallbackPlans: Plan[] | null = null;
  if ("needsOcr" in resolvedPrimary) {
    // A named reader is preferred, not terminal: technical unavailability may
    // move this unfinished page to the next ready vision transport. Injected
    // test adapters remain a closed universe inside the resolver.
    const ready = await resolveVisionFallbackPlans(opts);
    primaryPlan = ready.shift()!;
    if (!primaryPlan) return { text: "", pages: [], reason: resolvedPrimary.reason };
    fallbackPlans = ready;
    await opts.onProviderSwitch?.({ transport: primaryPlan.kind, model: primaryPlan.model, reason: "unavailable" });
  } else {
    primaryPlan = resolvedPrimary;
  }

  const pages: PdfPage[] = [];
  let pagesRead = 0;
  const unread: string[] = [];
  const providersUsed = new Set<string>();
  let modelCalls = 0;
  const maxModelCalls = Math.max(0, opts.maxModelCalls ?? Number.MAX_SAFE_INTEGER);
  let callBudgetReached = false;
  let timeBudgetReached = false;
  for (let i = 0; i < images.length; i++) {
    const imagesLeft = images.length - i;
    const image = images[i]!;
    let raw = "";
    let usedPlan = primaryPlan;
    if (modelCalls >= maxModelCalls) {
      unread.push(
        ...images.slice(i).map((remaining) => `page ${remaining.page} was not read (model-call limit)`),
      );
      callBudgetReached = true;
      break;
    }
    await opts.beforeModelCall?.();
    const primaryTimeoutMs = callTimeoutMs(started, imagesLeft, now);
    if (primaryTimeoutMs <= 0) {
      unread.push(
        ...images.slice(i).map((remaining) => `page ${remaining.page} was not read (time limit)`),
      );
      break;
    }
    try {
      modelCalls += 1;
      raw = await transcribePage(primaryPlan, image, primaryTimeoutMs, opts.adapters as OcrAdapters | undefined, effortForPlan(primaryPlan, opts.reasoningEffort));
      if (!acceptedOcrText(raw)) throw new Error("empty model response");
    } catch (error) {
      if (!isTechnicalOcrFailure(error)) throw error;
      const reason = automaticFailoverReason(error instanceof Error ? error.message : String(error))!;
      raw = "";
      if (isTechnicalOcrFailure(error)) {
        fallbackPlans ??= await resolveVisionFallbackPlans(opts, primaryPlan);
        for (let fallbackIndex = 0; fallbackIndex < fallbackPlans.length; fallbackIndex++) {
          const fallback = fallbackPlans[fallbackIndex]!;
          if (modelCalls >= maxModelCalls) {
            callBudgetReached = true;
            break;
          }
          await opts.beforeModelCall?.();
          const fallbackTimeoutMs = callTimeoutMs(started, imagesLeft, now);
          if (fallbackTimeoutMs <= 0) {
            timeBudgetReached = true;
            break;
          }
          try {
            modelCalls += 1;
            const candidate = await transcribePage(fallback, image, fallbackTimeoutMs, opts.adapters as OcrAdapters | undefined, effortForPlan(fallback, opts.reasoningEffort));
            if (!acceptedOcrText(candidate)) continue;
            raw = candidate;
            usedPlan = fallback;
            await opts.onProviderSwitch?.({ transport: fallback.kind, model: fallback.model, reason });
            // The switch is real for the rest of this document. Do not burn a
            // call on the known-dead primary again for every later page.
            primaryPlan = fallback;
            fallbackPlans = fallbackPlans.slice(fallbackIndex + 1);
            break;
          } catch (fallbackError) {
            if (!isTechnicalOcrFailure(fallbackError)) throw fallbackError;
            // Keep this page isolated; a failed fallback never re-runs prior pages.
          }
        }
      }
      if (!raw) {
        unread.push(
          callBudgetReached
            ? `page ${image.page} was not read (model-call limit)`
            : timeBudgetReached
              ? `page ${image.page} was not read (time limit)`
            : `page ${image.page} could not be read`,
        );
        if (callBudgetReached || timeBudgetReached) {
          const limit = callBudgetReached ? "model-call limit" : "time limit";
          unread.push(
            ...images.slice(i + 1).map((remaining) => `page ${remaining.page} was not read (${limit})`),
          );
          break;
        }
        continue; // one page failing should not lose the pages already read
      }
    }
    const cleaned = stripNarration(raw);
    if (cleaned) {
      pages.push({ page: image.page, text: cleaned });
      pagesRead++;
      providersUsed.add(planLabel(usedPlan));
    } else {
      unread.push(`page ${image.page} returned no readable text`);
    }
  }

  const text = pages
    .map((p) => p.text)
    .join("\n\n")
    .trim();
  return {
    text,
    pages,
    provider: [...providersUsed].join(" → ") || planLabel(primaryPlan),
    pagesRead,
    // Historical field names retained; rendered OCR now reports the actual PDF page count.
    pagesTotal: rendered.totalPages,
    modelCalls,
    reason:
      rendered.reason || unread.length
        ? [rendered.reason, unread.length ? `OCR incomplete: ${unread.join("; ")}.` : undefined]
            .filter(Boolean)
            .join(" ")
        : undefined,
  };
};
