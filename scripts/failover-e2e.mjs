#!/usr/bin/env node
/**
 * Automatic's ladder, walked end to end in a real browser (0.6.63 Unit Y2).
 *
 * WHAT THIS PROVED FOR THE OLD LADDER. Codex Terra used to be rung 1 and
 * Claude Sonnet rung 2. An editor filed a lead, left the picker on Automatic,
 * clicked Draft with AI -- and the first provider's login lapsed mid-run. The
 * desk noticed, moved to the next rung without asking, and landed a draft
 * anyway. It was proven through the job row, not the picker: the model PICKER
 * on desk.story.$leadId.tsx never names which provider wrote a landed draft,
 * so the walk read the same channel the desk's own polling uses -- the getLead
 * server function's JSON while the page polls every 2s -- and asserted
 * desk_jobs.model_choice plus (0.6.8) the durable .failover_note, which is the
 * one piece of the switch the editor also sees on the page ("Model note: ...").
 *
 * WHAT IT PROVES NOW. The ladder is DeepSeek v4.1 Flash -> Qwen 3.6 35B (only
 * if it is ALREADY loaded) -> Codex Terra, and this walk drives TWO drafts over
 * it, because the new ladder can fail in two different places:
 *
 *   draft 1 -- rung 1's endpoint is DOWN (503 on every route). Automatic's
 *              preflight walks past it, records that rung 2 was skipped "not
 *              loaded", and pins Codex Terra BEFORE the job is enqueued. No
 *              hop happens mid-run: the receipt on the job row says requested
 *              "auto", actual "codex-balanced", names the skipped rung, and
 *              says nothing was switched at preflight time (preflightFailover
 *              null). The walk also asserts rung 1 was never asked to WRITE --
 *              a 503 on /models is the whole failure.
 *
 *   draft 2 -- rung 1 is UP and pinned by the preflight, then misbehaves in
 *              the two ways the desk now treats as provider failures: its
 *              research answer is prose, not JSON, twice (readableReplyOrRetry
 *              re-asks the same rung exactly once), and its write answer is a
 *              provider-shaped 429. The 429 is what hops: ONE rung forward, to
 *              Codex Terra, with the durable note on the finished job. The
 *              prose answers are asserted from the fake's own request log
 *              (exactly two research calls) rather than from the finished
 *              draft, because an unreadable memo leaves `research` null and
 *              the draft carries on -- there is no rung to fall to there.
 *
 *              This draft's receipt is the OTHER half of what a receipt can
 *              say, and deliberately so: because rung 1 answered the preflight
 *              probe, the ladder passed NOTHING over at enqueue, so
 *              `skippedRungs` is absent -- that key only exists when a rung was
 *              really skipped (model-runtime-receipt.ts:34). The hop itself
 *              rewrites `actualRuntime` to the destination and leaves
 *              `requestedRuntime` at "auto" (jobs.ts's `setJobModelRuntime`,
 *              the phase-less branch), so the finished row names Codex Terra as
 *              what ran while still saying Automatic was asked for. What a
 *              runtime hop does NOT record anywhere is the rung it passed over
 *              on the way (`planAutomaticFailover` returns only
 *              {next,label,reason}, automatic-failover.ts:158-184, and desk.ts's
 *              hop at :1375 writes only the choice, the stage and the note), so
 *              this walk asserts that absence rather than inventing a key the
 *              product does not write. The pinned state IS asserted, from the
 *              poll the page made while rung 1 was still running -- hence the
 *              fake's chat delay below.
 *
 * Deliberately model-free, same trick as scripts/provider-signin-e2e.mjs and
 * its own old form -- but rung 1 is an HTTP endpoint, not a CLI, so this walk
 * starts a fake one (scripts/fakes/fake-deepseek-endpoint.mjs) and points the
 * product at it with TOWNREPORTER_DEEPSEEK_BASE_URL. Rung 2's stand-in
 * (scripts/fakes/fake-lmstudio-endpoint.mjs) listens on 1234, because local
 * discovery only recognises an LM Studio server by that port, and LLM_BASE_URL
 * (the only way to move it) would make Automatic skip its ladder entirely.
 * Rung 3 is scripts/fakes/fake-codex-cli.mjs with FAKE_CODEX_VALID_DRAFT=1.
 * Nothing here spends money, needs a subscription, or touches a credential.
 *
 *   TOWNREPORTER_DEEPSEEK_BASE_URL=http://127.0.0.1:3318/v1 \
 *   CODEX_CLI_PATH=scripts/fakes/fake-codex-cli.mjs \
 *   FAKE_CODEX_SIGNED_IN=1 FAKE_CODEX_VALID_DRAFT=1 FAKE_CODEX_DELAY_MS=1500 \
 *   FAILOVER_BASE_URL=http://127.0.0.1:3317 node scripts/failover-e2e.mjs
 *
 * On a machine that already runs LM Studio on 1234 with the rung's own model
 * loaded, run with TOWNREPORTER_QWEN_MODEL set to a model that server does NOT
 * have (that is what makes rung 2 skip "not loaded" instead of being tried for
 * real); the walk checks this and says so rather than quietly calling it.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { fromCrossJSON } from "seroval";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";
import { LMSTUDIO_BASE, LMSTUDIO_PORT } from "./fakes/lmstudio-address.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * This walk's own listen ports, registered with
 * scripts/integration-ports-are-unique.test.mjs. Rung 2's server is NOT one of
 * them: it is LM Studio's own address, imported so this walk and the other
 * ladder walk cannot each declare it -- see ./fakes/lmstudio-address.mjs.
 */
const PORT_FAILOVER = 3317;
const PORT_FAKE_DEEPSEEK = 3318;

const DEEPSEEK_BASE = `http://127.0.0.1:${PORT_FAKE_DEEPSEEK}/v1`;

// Labels and wording come from src/lib/news/provider-registry.ts and
// src/lib/news/automatic-failover.ts. Asserted verbatim so a rename there
// fails this walk instead of silently changing what it proves.
const DEEPSEEK_LABEL = "DeepSeek v4.1 Flash";
const QWEN_LABEL = "Qwen 3.6 35B";
const TERRA_LABEL = "Codex Terra";
const QWEN_SKIP = `${QWEN_LABEL} skipped: not loaded`;
const RUNG_ONE_QUOTA = `This draft moved to ${TERRA_LABEL} because ${DEEPSEEK_LABEL} reached its usage limit`;
/** The rung's own model: what rung 2's catalog lookup is asked for. */
const QWEN_MODEL = (process.env.TOWNREPORTER_QWEN_MODEL || "halo/qwen3.6-35b-a3b").trim();

/**
 * Rung 1's thinking time, standing in for a real provider's. Draft 2's whole
 * rung-1 phase is three chat calls (two unreadable research answers, then the
 * write that hits the quota), so 1.5s each is ~4.5s -- comfortably longer than
 * the desk page's 2s poll, which is what lets the walk catch the receipt while
 * the job is still pinned to rung 1.
 */
const DEEPSEEK_DELAY_MS = 1_500;

const base = checkedUrl(process.env.FAILOVER_BASE_URL || `http://127.0.0.1:${PORT_FAILOVER}`).replace(
  /\/$/,
  "",
);

const stamp = Date.now();
const email = `failover-${stamp}@townreporter.test`;
const password = "failover-e2e-pass";
const headline = `Council weighs a fake-ladder drill ${stamp}`;
const why = "Filed by hand so the draft has no source URLs to fetch.";

let page;
const done = [];
const fakes = [];
/** Every getLead response body seen while the page was polling. */
const jobSnapshots = [];

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

function stopFakes() {
  for (const child of fakes) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
}

async function dump(err) {
  const message = err instanceof Error ? err.message : String(err);
  let url = "";
  let text = "";
  try {
    url = page?.url() ?? "";
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 1500);
  } catch {
    /* page already gone */
  }
  stopFakes();
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: message,
        url,
        text,
        completed: done,
        fakeLog: await fakeLog().catch(() => null),
        lastJobSnapshots: jobSnapshots.slice(-5),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

/**
 * Start a fake and wait for its own "listening on" line, so the first probe
 * cannot race the server's bind. An EADDRINUSE exit is reported with the
 * fake's stderr, which names the port and why it has to be that one.
 */
function startFake(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, script)], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    fakes.push(child);
    let out = "";
    const ready = () => out.includes("listening on");
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
      const line = out.split("\n").find((text) => text.includes("listening on"));
      if (ready() && line) resolve(line.trim());
    });
    child.stderr.on("data", (chunk) => (out += String(chunk)));
    child.on("exit", (code) =>
      reject(new Error(`${script} exited with ${code} before it listened:\n${out.trim()}`)),
    );
    setTimeout(
      () => reject(new Error(`${script} never reported listening:\n${out.trim()}`)),
      15_000,
    );
  });
}

async function readJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** What the fake rung 1 has answered, in order. */
async function fakeLog() {
  return readJson(`http://127.0.0.1:${PORT_FAKE_DEEPSEEK}/__log`);
}

async function setDeepSeekMode(patch) {
  const res = await fetch(`http://127.0.0.1:${PORT_FAKE_DEEPSEEK}/__mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(
      `fake-deepseek POST /__mode failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }
  return res.json();
}

/**
 * The state this walk cannot arrange for itself, checked loudly: every one of
 * these turns the run into a proof of something else (or of nothing).
 */
function preconditions() {
  const problems = [];
  const declared = (process.env.TOWNREPORTER_DEEPSEEK_BASE_URL || "").replace(/\/$/, "");
  if (declared !== DEEPSEEK_BASE) {
    problems.push(
      `TOWNREPORTER_DEEPSEEK_BASE_URL must be ${DEEPSEEK_BASE} (the fake this walk starts); ` +
        `got ${JSON.stringify(process.env.TOWNREPORTER_DEEPSEEK_BASE_URL ?? null)}. ` +
        `Without it rung 1 is not even enabled, and the ladder is two rungs.`,
    );
  }
  if (process.env.LLM_BASE_URL) {
    problems.push(
      "LLM_BASE_URL is set: a configured gateway makes Automatic pin 'configured' and skip its " +
        "ladder entirely (ai.ts customGateway), so this walk would prove nothing.",
    );
  }
  if (process.env.FAKE_CODEX_VALID_DRAFT !== "1") {
    problems.push(
      "FAKE_CODEX_VALID_DRAFT=1 is required: rung 3's fake CLI has to answer as the CURRENT " +
        "ladder, not the retired Claude-then-Codex one (scripts/fakes/fake-codex-cli.mjs).",
    );
  }
  if (process.env.FAKE_CODEX_SIGNED_IN !== "1") {
    problems.push("FAKE_CODEX_SIGNED_IN=1 is required, or rung 3 is not ready and nothing hops.");
  }
  for (const off of ["TOWNREPORTER_DEEPSEEK", "TOWNREPORTER_QWEN", "TOWNREPORTER_CODEX"]) {
    if (process.env[off] === "0") problems.push(`${off}=0 switches that rung off.`);
  }
  if (process.env.TOWNREPORTER_LOCAL_DISCOVERY === "0") {
    problems.push(
      "TOWNREPORTER_LOCAL_DISCOVERY=0: rung 2's server is never probed, so its skip reads " +
        '"its server did not answer" instead of "not loaded".',
    );
  }
  if (problems.length) throw new Error(`preconditions:\n  ${problems.join("\n  ")}`);
}

/**
 * Rung 2's server. In CI there is none, so the fake is started. On a machine
 * that already runs LM Studio, that fake cannot bind 1234 and must not: the
 * walk uses the real server's own catalog, and only requires that it does not
 * offer the rung's model -- otherwise the skip would be a real 35B call.
 */
async function ensureRungTwoServer() {
  const live = await readJson(`${LMSTUDIO_BASE}/models`);
  if (live) {
    const ids = (live.data ?? [])
      .map((entry) => entry?.id)
      .filter((id) => typeof id === "string");
    if (ids.includes(QWEN_MODEL)) {
      throw new Error(
        `a server is already on ${LMSTUDIO_BASE} and lists ${QWEN_MODEL}, so rung 2 would be ` +
          `tried for real. Run this walk with TOWNREPORTER_QWEN_MODEL=<a model that server does ` +
          `not have>. (CI has no local server and starts ` +
          `scripts/fakes/fake-lmstudio-endpoint.mjs on ${LMSTUDIO_PORT} instead.)`,
      );
    }
    return `kept the server already on ${LMSTUDIO_BASE}; it does not list ${QWEN_MODEL} (no fake started)`;
  }
  const line = await startFake("scripts/fakes/fake-lmstudio-endpoint.mjs", {
    FAKE_LMSTUDIO_PORT: String(LMSTUDIO_PORT),
  });
  return `${line} -- started because nothing answered on ${LMSTUDIO_BASE}`;
}

async function main() {
  preconditions();
  console.log(`failover: ${base}`);

  // Rung 1 boots DOWN, which is draft 1's whole failure: the readiness probe
  // gets a 503 and the ladder moves past it before the job exists.
  console.log(`  fake  ${await startFake("scripts/fakes/fake-deepseek-endpoint.mjs", {
    FAKE_DEEPSEEK_PORT: String(PORT_FAKE_DEEPSEEK),
    FAKE_DEEPSEEK_MODE: "probe-5xx",
    FAKE_DEEPSEEK_DELAY_MS: String(DEEPSEEK_DELAY_MS),
  })}`);
  console.log(`  fake  ${await ensureRungTwoServer()}`);

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(45_000);

  const consoleErrors = [];
  const note = (text) =>
    consoleErrors.push(`[after: ${done[done.length - 1] ?? "start"} | ${page.url()}] ${text}`);
  page.on("pageerror", (e) => note(String(e.message ?? e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") note(m.text().slice(0, 200));
  });

  // Capture every getLead response as the page polls -- this is how the
  // desk itself learns the stage text and the provider a running/finished
  // draft is on, so it is also how this walk proves it.
  //
  // TanStack Start server functions do not answer with plain JSON: the body
  // is a seroval "cross-JSON" tree (the same format the app's own RPC client
  // decodes with `fromCrossJSON`, see
  // node_modules/@tanstack/start-client-core/dist/esm/client-rpc/serverFnFetcher.js).
  //
  // Which export a `/_serverFn/<token>` URL calls is NOT reliably readable
  // from the URL: the dev server's token is base64(JSON({file, export})),
  // but a built (production) TanStack Start server names the same route
  // with an opaque per-build hash instead (confirmed 2026-09-03 against a
  // real `npm run build` + `npm start` -- e.g.
  // `/_serverFn/3ae2ced499ba...dcdaa?payload=...`, no base64 JSON anywhere
  // in it), so decoding the token never yielded "getLead" there and every
  // response was skipped (this walk saw `stages: []` on the built server).
  // Identify getLead responses by decoded SHAPE instead, which is stable
  // across dev and prod: a desk_jobs row always carries both `stage` and
  // `model_choice` as strings (src/lib/news/jobs.ts's `latestJob` select
  // list), a pair no other server function's response happens to share.
  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (!url.includes("_serverFn")) return;
      const ct = res.headers()["content-type"] || "";
      if (!ct.includes("application/json")) return;
      const raw = await res.json().catch(() => null);
      if (!raw) return;
      const decoded = fromCrossJSON(raw, {});
      const job = decoded?.result?.job;
      if (
        job &&
        typeof job === "object" &&
        typeof job.stage === "string" &&
        typeof job.model_choice === "string"
      ) {
        jobSnapshots.push({ at: Date.now(), job });
      }
    } catch {
      /* response body already consumed, or not decodable; not fatal */
    }
  });

  // --- create the desk's first (and only) editor -----------------------
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("Failover Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk");

  // --- file a lead by hand, with no source URL ---------------------------
  // No URL means reportAndDraft's `take()` has nothing to fetch over the
  // network, so this walk never depends on a real page being reachable.
  await page.getByRole("link", { name: "Queue", exact: true }).click();
  await page.getByText("File a lead yourself").click();
  await page.getByLabel("Headline").fill(headline);
  await page.getByLabel("Why now").fill(why);
  await page.getByRole("button", { name: "File lead" }).click();
  await page.getByLabel("Body").waitFor({ timeout: 30_000 });
  step("filed a lead by hand and landed on its story page");

  // --- leave the picker on Automatic, click Draft with AI ----------------
  // Not touching ModelPicker at all: its state defaults to "auto"
  // (Automatic), which is the whole point of this walk.
  await page.getByRole("button", { name: /^Draft with AI$/ }).click();
  await page.getByRole("button", { name: /^Drafting…$/ }).waitFor({ timeout: 15_000 });
  step("clicked Draft with AI on Automatic, with rung 1 answering 503");

  const first = await waitForDraft("the first draft", () => true);
  const firstReceipt = JSON.parse(first.job.result_json || "{}");
  assertReceipt(firstReceipt, {
    who: "draft 1 (rung 1 down at preflight)",
    actualRuntime: "codex-balanced",
    skippedRungs: [QWEN_SKIP],
  });
  if (first.job.model_choice !== "codex-balanced") {
    throw new Error(
      `draft 1 finished on model_choice ${JSON.stringify(first.job.model_choice)}, expected ` +
        `"codex-balanced": the ladder had to walk past a dead rung 1 and a skipped rung 2.`,
    );
  }
  if (first.job.failover_note) {
    throw new Error(
      `draft 1 carries a failover note (${JSON.stringify(first.job.failover_note)}) -- but nothing ` +
        `ran before it to fail over FROM. Rung 1 was down before the job existed, so this had to be ` +
        `resolved at preflight, with no note.`,
    );
  }
  step(
    'draft 1 is pinned to "codex-balanced" with no failover note (the ladder was walked at preflight)',
  );

  // --- the fake's own log: rung 1 was asked to prove itself, never to write
  const afterFirst = await fakeLog();
  const firstChats = afterFirst.requests.filter(
    (entry) => entry.class === "research" || entry.class === "write" || entry.class === "document",
  );
  if (!afterFirst.requests.some((entry) => entry.class === "probe" && entry.status === 503)) {
    throw new Error(
      `rung 1 never answered a 503 on GET /models: ${JSON.stringify(afterFirst.requests)}`,
    );
  }
  if (firstChats.length) {
    throw new Error(
      `draft 1 sent ${firstChats.length} chat call(s) to rung 1, whose endpoint was down: ` +
        `${JSON.stringify(firstChats)} -- a 503 probe is the whole failure this draft proves.`,
    );
  }
  step("rung 1 answered the readiness probe with 503 and was never asked to write");

  const sawPreflightStage = jobSnapshots.some((entry) =>
    /Switched to .+: .+/.test(String(entry.job.stage ?? "")),
  );
  step(
    sawPreflightStage
      ? "a transient switch stage was seen on the wire (informational)"
      : "no transient switch stage on the wire (informational -- preflight switches have none to catch)",
  );

  // --- draft 2: rung 1 is ready, misreads twice, then hits its quota -----
  await setDeepSeekMode({ mode: "quota", researchMode: "unreadable-json" });
  await page.getByRole("button", { name: /^Redraft$/ }).click();
  const second = await waitForDraft("the second draft", (entry) => entry.job.id !== first.job.id);
  step("clicked Redraft; rung 1 now misreads its research answer twice and 429s on the write");

  const secondReceipt = JSON.parse(second.job.result_json || "{}");
  assertReceipt(secondReceipt, {
    who: "draft 2 (rung 1 pinned, then failed mid-run)",
    actualRuntime: "codex-balanced",
    skippedRungs: null,
  });
  // ...and before the hop the SAME job's receipt named rung 1, because that is
  // what the desk had actually pinned and what it was really running on
  // (jobs.ts's `setJobModelRuntime` rewrites `actualRuntime` only when the hop
  // happens, leaving `requestedRuntime` at "auto" -- which is why the finished
  // receipt still says Automatic was asked for). Caught from the page's own
  // polling, so the fake's chat delay has to keep this state visible for longer
  // than the 2s poll.
  const pinned = jobSnapshots.find(
    (entry) =>
      entry.job.id === second.job.id &&
      JSON.parse(entry.job.result_json || "{}").actualRuntime === "deepseek-flash",
  );
  if (!pinned) {
    throw new Error(
      `draft 2's receipt never named rung 1 while the job was on it; observed ` +
        JSON.stringify(
          jobSnapshots
            .filter((entry) => entry.job.id === second.job.id)
            .map((entry) => [
              entry.job.status,
              entry.job.model_choice,
              JSON.parse(entry.job.result_json || "{}").actualRuntime,
            ]),
        ),
    );
  }
  if (second.job.model_choice !== "codex-balanced") {
    throw new Error(
      `draft 2 finished on model_choice ${JSON.stringify(second.job.model_choice)}, expected ` +
        `"codex-balanced" after rung 1's 429 hopped one rung forward.`,
    );
  }
  step(`draft 2's receipt named "deepseek-flash" while it ran, then the hop rewrote it to "codex-balanced"`);
  if (String(second.job.failover_note ?? "") !== RUNG_ONE_QUOTA) {
    throw new Error(
      `draft 2's failover_note read ${JSON.stringify(second.job.failover_note)}, expected ` +
        `${JSON.stringify(RUNG_ONE_QUOTA)} -- the durable note did not survive to Done.`,
    );
  }
  step(`draft 2 hopped to Codex Terra with the durable note: "${RUNG_ONE_QUOTA}"`);

  // The unreadable case is asserted from the fake's own log, not from the
  // draft: report.ts's research pass explicitly does NOT end the run on an
  // unreadable reply -- it leaves `research` null and the draft continues --
  // so the only place two attempts at ONE memo are visible is the wire.
  const afterSecond = await fakeLog();
  const research = afterSecond.requests.filter((entry) => entry.class === "research");
  const quota = afterSecond.requests.filter(
    (entry) => entry.class === "write" && entry.status === 429,
  );
  if (research.length !== 2 || research.some((entry) => entry.mode !== "unreadable-json")) {
    throw new Error(
      `expected exactly 2 unreadable research answers (the same rung re-asked once by ` +
        `readableReplyOrRetry); got ${JSON.stringify(research)}`,
    );
  }
  if (!quota.length) {
    throw new Error(
      `rung 1 never returned a 429 to the write pass: ${JSON.stringify(afterSecond.requests)}`,
    );
  }
  step(
    `rung 1 answered the research pass twice with unreadable JSON (${research.length} calls) and the write pass with ${quota.length} quota failure(s)`,
  );

  // --- the landed draft is really there, on the page -----------------------
  const bodyText = await page.getByLabel("Body").inputValue();
  if (bodyText.trim().length < 20) {
    throw new Error(`the draft body looks empty/too short: ${JSON.stringify(bodyText)}`);
  }
  if (!/first rung of the ladder/.test(bodyText)) {
    throw new Error(
      `the landed body does not carry the fake Codex CLI's ladder text, so something other than ` +
        `rung 3 wrote it: ${JSON.stringify(bodyText.slice(0, 300))}`,
    );
  }
  step("the draft body on the page is Codex Terra's ladder text");

  await browser.close();
  stopFakes();
  if (consoleErrors.length) {
    console.error(JSON.stringify({ ok: false, consoleErrors, completed: done }, null, 2));
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        completed: done,
        draftOne: { jobId: first.job.id, receipt: firstReceipt, modelChoice: first.job.model_choice },
        draftTwo: { jobId: second.job.id, receipt: secondReceipt, modelChoice: second.job.model_choice, failoverNote: second.job.failover_note },
        rungOneTraffic: afterSecond.requests,
        email,
        headline,
      },
      null,
      2,
    ),
  );
}

/**
 * The receipt every draft of this walk must carry: Automatic was asked for, the
 * model that actually ran is named, and nothing was switched at commit time
 * (this walk's two failures are either worked out before the job exists, or
 * mid-run).
 *
 * `skippedRungs` is asserted with the same precision as the product writes it:
 * pass the expected list when a rung really was passed over, or null when
 * nothing was -- `model-runtime-receipt.ts:34` omits the key entirely in that
 * case, so a receipt that carries an empty list, or a stray key, is a difference
 * this walk should catch rather than wave through.
 */
function assertReceipt(receipt, { who, actualRuntime, skippedRungs }) {
  if (receipt.requestedRuntime !== "auto") {
    throw new Error(`${who}: receipt requestedRuntime ${JSON.stringify(receipt.requestedRuntime)}`);
  }
  if (receipt.actualRuntime !== actualRuntime) {
    throw new Error(
      `${who}: receipt actualRuntime ${JSON.stringify(receipt.actualRuntime)}, expected ` +
        `${JSON.stringify(actualRuntime)}`,
    );
  }
  const skipped = receipt.skippedRungs ?? null;
  if (skippedRungs === null) {
    if (skipped !== null) {
      throw new Error(
        `${who}: receipt skippedRungs ${JSON.stringify(skipped)}, expected the key to be ABSENT -- ` +
          `this draft's ladder answered on rung 1 at enqueue, so no rung was passed over and ` +
          `model-runtime-receipt.ts:34 writes nothing.`,
      );
    }
  } else if (JSON.stringify(skipped) !== JSON.stringify(skippedRungs)) {
    throw new Error(
      `${who}: receipt skippedRungs ${JSON.stringify(skipped)}, expected ` +
        `${JSON.stringify(skippedRungs)} -- the receipt is where a job that asked for Automatic ` +
        `records WHY it did not run on rung 2.`,
    );
  }
  if (receipt.preflightFailover !== null) {
    throw new Error(
      `${who}: receipt preflightFailover ${JSON.stringify(receipt.preflightFailover)}, expected null`,
    );
  }
}

/** Wait for a draft to land, or fail with what the desk last said. */
async function waitForDraft(label, matches) {
  const deadline = Date.now() + Number(process.env.FAILOVER_DEADLINE_MS || 150_000);
  while (Date.now() < deadline) {
    const failed = jobSnapshots.findLast(
      (entry) => entry.job.status === "failed" && matches(entry),
    );
    if (failed) {
      throw new Error(
        `${label} reached status "failed": ${JSON.stringify(failed.job.error ?? failed.job)}`,
      );
    }
    const finished = jobSnapshots.findLast(
      (entry) => entry.job.status === "completed" && matches(entry),
    );
    if (finished && (await page.getByRole("button", { name: /^Redraft$/ }).count())) {
      return finished;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `${label} did not land within the deadline; observed statuses: ` +
      JSON.stringify(jobSnapshots.map((entry) => [entry.job.id, entry.job.status, entry.job.stage])),
  );
}

main().catch(dump);
