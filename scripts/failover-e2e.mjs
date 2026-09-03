#!/usr/bin/env node
/**
 * Automatic's one-shot fail-over (0.5.11, src/lib/news/automatic-failover.ts),
 * driven in a real browser.
 *
 * It has unit tests but had never been proven through the desk: an editor
 * files a lead, leaves the model picker on Automatic, clicks Draft with AI --
 * and Claude Code's login lapses mid-run. The desk should notice, move to
 * Codex Terra without asking, and land a draft anyway.
 *
 * Deliberately model-free, same trick as scripts/provider-signin-e2e.mjs:
 *
 *   CLAUDE_CLI_PATH=scripts/fakes/fake-claude-cli.mjs
 *   CODEX_CLI_PATH=scripts/fakes/fake-codex-cli.mjs
 *
 * The fake Claude answers `auth status --json` with loggedIn:true (so
 * Automatic's probe picks it first, same as a real signed-in operator) but
 * answers every `-p` chat call with the real 401 envelope a live token
 * expiring mid-run produced on 2026-09-02 (FAKE_CLAUDE_FAIL_PROMPTS=1). The
 * fake Codex reports itself signed in and answers `exec` with a plausible
 * JSON draft for whichever pass asked (see scripts/fakes/fake-codex-cli.mjs).
 * Nothing here spends money or touches a real credential.
 *
 *   FAILOVER_BASE_URL=http://127.0.0.1:3317 node scripts/failover-e2e.mjs
 *
 * The model PICKER on desk.story.$leadId.tsx never names which provider a
 * landed draft actually ran on -- that only ever showed in the job's
 * transient `stage` text. So this proves the switch through the same
 * channel the desk's own polling uses: the getLead server function's JSON
 * responses, captured over the wire while the page polls every 2s during
 * "waiting". That JSON carries desk_jobs.model_choice, .stage, and (0.6.8)
 * .failover_note verbatim (src/lib/news/jobs.ts's `latestJob` select list),
 * which is exactly the row failOverAndRetry (src/lib/news/desk.ts) writes.
 * failover_note is also the one piece of this the editor DOES see on the
 * page itself once the job is Done -- desk.story.$leadId.tsx renders it as
 * "Model note: ..." -- because unlike `stage`, "Done" never overwrites it.
 */
import { chromium } from "playwright";
import { fromCrossJSON } from "seroval";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/**
 * This walk's own listen port, registered with
 * scripts/integration-ports-are-unique.test.mjs.
 */
const PORT_FAILOVER = 3317;

const base = checkedUrl(process.env.FAILOVER_BASE_URL || `http://127.0.0.1:${PORT_FAILOVER}`).replace(
  /\/$/,
  "",
);

const stamp = Date.now();
const email = `failover-${stamp}@townreporter.test`;
const password = "failover-e2e-pass";
const headline = `Council weighs a fake-CLI fail-over drill ${stamp}`;
const why = "Filed by hand so the draft has no source URLs to fetch.";

let page;
const done = [];
/** Every getLead response body seen while the page was polling. */
const jobSnapshots = [];

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
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
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: message,
        url,
        text,
        completed: done,
        lastJobSnapshots: jobSnapshots.slice(-5),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

async function main() {
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

  console.log(`failover: ${base}`);

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
  step("clicked Draft with AI on Automatic");

  // --- wait for the draft to land, or a hard failure ----------------------
  // Polls the snapshots the response listener above is already collecting,
  // rather than a text locator: the picker's own help text and the failure
  // Notice share overlapping words ("writing model"), so a locator built to
  // catch a failure ends up matching page chrome that is present the whole
  // time and firing instantly.
  const landed = page.getByRole("button", { name: /^Redraft$/ });
  const deadline = Date.now() + Number(process.env.FAILOVER_DEADLINE_MS || 120_000);
  let sawFailed = false;
  while (Date.now() < deadline) {
    if (await landed.count()) break;
    if (jobSnapshots.some((s) => s.job.status === "failed")) {
      sawFailed = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  if (sawFailed) {
    throw new Error(
      `the job reached status "failed" instead of landing: ${JSON.stringify(
        jobSnapshots.filter((s) => s.job.status === "failed").at(-1),
      )}`,
    );
  }
  if (!(await landed.count())) {
    throw new Error("the draft did not land within 120s (no Redraft button, no failed job)");
  }
  step("the draft landed (button reads Redraft)");

  // --- the switch happened: the stage text said so, IF a poll caught it ---
  // `stage` only carries the "Switched to..." text for the brief window
  // between the switch and the job finishing (it gets overwritten by "Done"
  // once the job completes), and the client only learns about it through a
  // 2s poll (desk.story.$leadId.tsx's `refetchInterval`). Audit-lite 0.6.6
  // FINDING-001: asserting this transient stage as a hard requirement races
  // that poll interval against FAKE_CODEX_DELAY_MS with no real margin, so a
  // slow/loaded CI runner can miss the window even when the switch genuinely
  // happened -- flake, not a real failure. This is now informational only;
  // the durable, poll-independent proof is the model_choice and
  // failover_note assertions below, which read the FINISHED job's own
  // snapshot rather than depending on catching a live transient value.
  const sawSwitch = jobSnapshots.some((s) =>
    /Switched to Codex Terra: Claude Opus sign-in lapsed/.test(String(s.job.stage ?? "")),
  );
  step(
    sawSwitch
      ? 'observed the transient stage "Switched to Codex Terra: Claude Opus sign-in lapsed" (informational)'
      : "did not catch the transient switch stage on the wire (informational -- not required, see durable checks below)",
  );

  // --- the job that finished is pinned to Codex Terra, not Claude --------
  const finished = [...jobSnapshots].reverse().find((s) => s.job.status === "completed");
  if (!finished) {
    throw new Error(
      `never observed a completed job over the wire; last statuses: ` +
        JSON.stringify(jobSnapshots.map((s) => s.job.status)),
    );
  }
  if (finished.job.model_choice !== "codex-balanced") {
    throw new Error(
      `the completed job's model_choice is "${finished.job.model_choice}", expected ` +
        `"codex-balanced" (Codex Terra) -- Automatic did not actually fail over`,
    );
  }
  step('the completed job\'s model_choice is "codex-balanced" (Codex Terra)');

  // --- the switch reason survives past "Done" (0.6.8) ---------------------
  // `stage` gets overwritten once the job finishes ("Done" replaces the
  // "Switched to..." text the assertion above caught mid-run) -- this is
  // the strengthening 0.6.8 is about: `failover_note` is the durable twin
  // (src/lib/news/jobs.ts's `setJobFailoverNote`), and it must still read
  // back on the FINISHED job's own getLead snapshot, not just an earlier
  // running one.
  const expectedNote = "This draft moved to Codex Terra because Claude Opus sign-in lapsed";
  if (String(finished.job.failover_note ?? "") !== expectedNote) {
    throw new Error(
      `the completed job's failover_note read ${JSON.stringify(finished.job.failover_note)}, ` +
        `expected ${JSON.stringify(expectedNote)} -- the durable note did not survive to Done`,
    );
  }
  step('the completed job\'s failover_note is durable: "' + expectedNote + '"');

  // --- the landed draft is really there, on the page -----------------------
  const bodyText = await page.getByLabel("Body").inputValue();
  if (bodyText.trim().length < 20) {
    throw new Error(`the draft body looks empty/too short: ${JSON.stringify(bodyText)}`);
  }
  step("the draft body is populated on the page");

  await browser.close();
  if (consoleErrors.length) {
    console.error(JSON.stringify({ ok: false, consoleErrors, completed: done }, null, 2));
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      { ok: true, completed: done, finishedJob: finished.job, email, headline },
      null,
      2,
    ),
  );
}

main().catch(dump);
