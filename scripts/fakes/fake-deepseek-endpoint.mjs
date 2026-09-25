#!/usr/bin/env node
/**
 * An OpenAI-compatible stand-in for Automatic's rung 1, DeepSeek v4.1 Flash
 * (`deepseek-flash` in src/lib/news/provider-registry.ts), for the browser
 * walks that must not reach a real model.
 *
 * Rung 1 is a plain OpenAI-compatible endpoint, not a CLI, so the desk talks
 * to it over HTTP: `probeOpenAi` (src/lib/news/ai.ts) does `GET {baseUrl}/models`
 * to prove the rung is up AND that it lists the exact model the rung names,
 * and a draft call does `POST {baseUrl}/chat/completions`. This fake serves
 * both, and returns whichever failure the walk under test needs, so the walk
 * can drive the new ladder (unit Y2: rung 1 fails, rung 2 is skipped "not
 * loaded", rung 3 Codex Terra drafts) without a subscription, a network, or
 * a local model actually answering.
 *
 *   FAKE_DEEPSEEK_PORT    port to listen on (default 3318 -- the walk's own
 *                         declared port; `TOWNREPORTER_DEEPSEEK_BASE_URL` must
 *                         name http://127.0.0.1:<this port>/v1)
 *   FAKE_DEEPSEEK_MODEL   the one model id GET /models lists, and the id every
 *                         answer is attributed to (default
 *                         "deepseek-v4.1-flash:cloud", the rung's own model,
 *                         because probeOpenAi matches it by exact id)
 *   FAKE_DEEPSEEK_MODE    ready | probe-5xx | quota | unreadable-json
 *                         (default ready). Applied at boot; a walk changes it
 *                         between drafts with POST /__mode.
 *                           ready          every request answers well
 *                           probe-5xx      503 on every route, so the rung's
 *                                          readiness probe fails
 *                           quota          429 with a provider-shaped usage
 *                                          limit on every chat call
 *                           unreadable-json 200 whose content is prose, not the
 *                                          JSON the desk asked for
 *   FAKE_DEEPSEEK_RESEARCH_MODE
 *                         a mode that overrides FAKE_DEEPSEEK_MODE for the
 *                         research pass only (report.ts's compact memo call,
 *                         told apart by the same "Lead: " marker the fake
 *                         Codex CLI uses). This is how one draft exercises two
 *                         failures at once: the memo pass answers unreadable
 *                         twice while the write pass hits the quota.
 *   FAKE_DEEPSEEK_SCAN_MODE
 *                         the same override for the DAILY SCAN's writing pass
 *                         only (desk-copy.ts's buildScanUserMessage, told apart
 *                         by its `"editor_summary"` JSON skeleton). A scheduled
 *                         scan's writing pass is a different call from a
 *                         draft's write pass: it is asked for `leads` and
 *                         `proposed_sources`, and answers with a scan shape,
 *                         not a draft. A walk that needs the scan's write to
 *                         fail while rung 1's readiness probe still answers
 *                         sets this rather than `FAKE_DEEPSEEK_MODE`.
 *   FAKE_DEEPSEEK_DELAY_MS  delay before each chat answer (default 0)
 *
 * Two control routes, for the walk itself (never called by the product):
 *
 *   POST /__mode  {"mode":"quota","researchMode":"unreadable-json"} -- what the
 *                 next requests should do; omit a key to leave it alone
 *   GET  /__log   {"requests":[{"path","method","class","mode","status"}...]} --
 *                 every request in order, so a walk can prove HOW MANY times a
 *                 pass was asked (the unreadable case is one retry: two calls)
 *                 rather than only what the finished job says
 *
 * Nothing here holds or needs a credential: the desk's rung gateway sends
 * `Authorization: Bearer not-needed` only when an api key is set, and this
 * fake ignores headers entirely.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_DEEPSEEK_PORT || 3318);
const MODEL = process.env.FAKE_DEEPSEEK_MODEL || "deepseek-v4.1-flash:cloud";
const DELAY_MS = Number(process.env.FAKE_DEEPSEEK_DELAY_MS || 0);

const MODES = new Set(["ready", "probe-5xx", "quota", "unreadable-json"]);

let mode = MODES.has(process.env.FAKE_DEEPSEEK_MODE || "")
  ? process.env.FAKE_DEEPSEEK_MODE
  : "ready";
let researchMode = MODES.has(process.env.FAKE_DEEPSEEK_RESEARCH_MODE || "")
  ? process.env.FAKE_DEEPSEEK_RESEARCH_MODE
  : null;
let scanMode = MODES.has(process.env.FAKE_DEEPSEEK_SCAN_MODE || "")
  ? process.env.FAKE_DEEPSEEK_SCAN_MODE
  : null;

/** Every request this server has answered, oldest first. */
const requests = [];

/**
 * The desk makes several calls in one draft -- a document read, a compact
 * research pass, then the write pass -- and tells them apart by what its own
 * prompts contain (same markers fake-codex-cli.mjs reads): the write pass's
 * user text opens with "NEWS ANGLE: ", the research pass's with "Lead: ", and
 * a document read carries the untrusted source text itself.
 *
 * A scheduled daily scan's writing pass is a fourth call and is NOT a draft
 * write: desk-copy.ts's buildScanUserMessage asks by name for
 * `"editor_summary"`, `"leads"` and `"proposed_sources"` -- a JSON skeleton no
 * draft or research prompt contains -- and desk.ts reads the reply with
 * parseScanResult, whose `hasShape` gate accepts only those keys. A scan call
 * classified as "write" would therefore be answered with a draft and rejected
 * as "Writing pass returned no usable JSON." (Unit AA2: that is exactly what
 * happened before this class existed.)
 */
function classify(prompt) {
  if (/UNTRUSTED SOURCE TEXT:/.test(prompt)) return "document";
  if (/["']editor_summary["']\s*:/.test(prompt)) return "scan";
  if (/\bLead:\s/.test(prompt) && !/NEWS ANGLE:/.test(prompt)) return "research";
  return "write";
}

function modeFor(klass) {
  if (klass === "research" && researchMode) return researchMode;
  if (klass === "scan" && scanMode) return scanMode;
  return mode;
}

const READY_RESEARCH = {
  news: "The council approved the item on a fake-endpoint test drive.",
  why_it_matters: "It shows the desk's first rung answering before it fails over.",
  angle: "A readiness answer from rung 1.",
  form: "brief",
  questions: [],
  unknowns: [],
  follow: "",
  fetch_urls: [],
};

const READY_WRITE = {
  headline: "DeepSeek v4.1 Flash drafted this on the new Automatic ladder",
  dek: "Rung 1 answered, so no failover was needed.",
  body:
    "The newsroom's Automatic writing model started this draft on DeepSeek v4.1 Flash " +
    "and it answered, so the desk stayed where it was.\n\n" +
    "This text exists to prove the first rung of the ladder is reachable and can land a draft.",
  topic: "council",
  source_urls: [],
  integrity_notes: "",
  memory_entities: [],
  form: "brief",
  found: [],
  unanswered: [],
  claims: [],
  reporting_trail: [],
};

/**
 * The scan shape desk.ts's writing pass reads: `parseScanResult` accepts a
 * reply only when it carries `leads`, `editor_summary` or `proposed_sources`,
 * and `newsworthiness` is the integer 0-20 it ranks by. `url` is the source
 * the prompt itself named, so the filed lead cites the page the desk actually
 * fetched rather than a URL this fake made up.
 */
function scanAnswer(prompt) {
  const source = prompt.match(/^URL:\s*(\S+)/m)?.[1] ?? "";
  return {
    editor_summary: "Rung 1 read the fetched page and filed one lead for the desk.",
    leads: [
      {
        headline: "DeepSeek v4.1 Flash ran the scheduled scan's writing pass",
        why: "The scan wrote its leads on the rung its run record named, so Automatic resolved to a real endpoint rather than failing over.",
        topic: "council",
        source_urls: source ? [source] : [],
        evidence: "The fetched page said what the lead quotes.",
        newsworthiness: 12,
      },
    ],
    proposed_sources: [],
  };
}

/** Prose with no JSON in it at all -- parseJsonBlock cannot read this. */
const UNREADABLE =
  "The item passed after public discussion, and the council will revisit it next month.";

function payload(klass, prompt = "") {
  const body =
    klass === "research" ? READY_RESEARCH : klass === "scan" ? scanAnswer(prompt) : READY_WRITE;
  return JSON.stringify({
    id: "fake-deepseek-1",
    object: "chat.completion",
    model: MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content:
            klass === "research" || klass === "write" || klass === "scan"
              ? JSON.stringify(body)
              : "ok",
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });
}

function send(res, status, body, { json = true } = {}) {
  const text = json ? JSON.stringify(body) : body;
  res.writeHead(status, {
    "Content-Type": json ? "application/json" : "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data;
}

function log(entry) {
  requests.push({ at: Date.now(), ...entry });
  process.stdout.write(`fake-deepseek: ${JSON.stringify(entry)}\n`);
}

const server = createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];

  if (path === "/__log") {
    log({ path, method: req.method, class: "control", mode, status: 200 });
    return send(res, 200, { mode, researchMode, scanMode, model: MODEL, requests });
  }

  if (path === "/__mode" && req.method === "POST") {
    const raw = await readBody(req);
    let wanted = {};
    try {
      wanted = JSON.parse(raw || "{}");
    } catch {
      return send(res, 400, { error: "POST /__mode wants JSON" });
    }
    if (wanted.mode !== undefined) {
      if (!MODES.has(wanted.mode)) return send(res, 400, { error: `unknown mode ${wanted.mode}` });
      mode = wanted.mode;
    }
    if (wanted.researchMode !== undefined) {
      if (wanted.researchMode !== null && !MODES.has(wanted.researchMode))
        return send(res, 400, { error: `unknown researchMode ${wanted.researchMode}` });
      researchMode = wanted.researchMode;
    }
    if (wanted.scanMode !== undefined) {
      if (wanted.scanMode !== null && !MODES.has(wanted.scanMode))
        return send(res, 400, { error: `unknown scanMode ${wanted.scanMode}` });
      scanMode = wanted.scanMode;
    }
    log({ path, method: req.method, class: "control", mode, status: 200 });
    return send(res, 200, { ok: true, mode, researchMode, scanMode });
  }

  // A readiness probe (GET /models) is never a draft call, so it is answered
  // from the boot mode alone: the research override exists to make ONE pass
  // unreadable, not to make the rung look down.
  if (path.endsWith("/models") && req.method === "GET") {
    if (mode === "probe-5xx") {
      log({ path, method: req.method, class: "probe", mode, status: 503 });
      return send(res, 503, {
        error: { message: "The server is overloaded.", type: "server_error" },
      });
    }
    log({ path, method: req.method, class: "probe", mode, status: 200 });
    return send(res, 200, {
      object: "list",
      data: [{ id: MODEL, object: "model", owned_by: "fake-deepseek" }],
    });
  }

  if (path.endsWith("/chat/completions") && req.method === "POST") {
    const raw = await readBody(req);
    let klass = "write";
    let user = "";
    try {
      const parsed = JSON.parse(raw || "{}");
      user = String((parsed.messages || []).find((m) => m?.role === "user")?.content ?? "");
      klass = classify(user);
    } catch {
      klass = "write";
    }
    const applied = modeFor(klass);
    if (DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    if (applied === "probe-5xx") {
      log({ path, method: req.method, class: klass, mode: applied, status: 503 });
      return send(res, 503, {
        error: { message: "The server is overloaded.", type: "server_error" },
      });
    }
    if (applied === "quota") {
      log({ path, method: req.method, class: klass, mode: applied, status: 429 });
      return send(res, 429, {
        error: {
          message: `Rate limit reached for ${MODEL} on tokens per minute (TPM).`,
          type: "rate_limit_error",
        },
      });
    }
    if (applied === "unreadable-json") {
      log({ path, method: req.method, class: klass, mode: applied, status: 200 });
      return send(res, 200, {
        id: "fake-deepseek-1",
        object: "chat.completion",
        model: MODEL,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: UNREADABLE },
            finish_reason: "stop",
          },
        ],
      });
    }
    log({ path, method: req.method, class: klass, mode: applied, status: 200 });
    return send(res, 200, JSON.parse(payload(klass, user)));
  }

  log({ path, method: req.method, class: "other", mode, status: 404 });
  return send(res, 404, { error: { message: `no route ${req.method} ${path}` } });
});

server.on("error", (error) => {
  const detail = error && error.code === "EADDRINUSE" ? `port ${PORT} is already in use` : String(error);
  process.stderr.write(`fake-deepseek: ${detail}\n`);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  // The BOUND port, not the requested one: a caller that asks for port 0 lets
  // the OS pick a free port and reads it back off this line.
  const bound = server.address()?.port ?? PORT;
  process.stdout.write(
    `fake-deepseek: listening on http://127.0.0.1:${bound}/v1 (model ${MODEL}, mode ${mode}` +
      `${researchMode ? `, research ${researchMode}` : ""}` +
      `${scanMode ? `, scan ${scanMode}` : ""})\n`,
  );
});
