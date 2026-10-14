/*
  THV-3 and THV-1 + THU-8: what the story page says WHILE a draft is running.

  THV-3. A DeepSeek draft showed "Waiting on DeepSeek v4.1 Flash" for the ten
  minutes a real draft takes, with nothing moving, so a run that was working
  looked exactly like one that had died. The wait line now carries the run's
  own elapsed time, read from the job's `started_at` (`waitingSince` on the
  page), and it is recomputed on the page's own 1 s timer -- the same timer the
  slow-wait note already used, not a second polling loop.

  THV-1 + THU-8. When another AI job is already using the same model, the draft
  does nothing and the page never said why. Both the waiting line and the
  failure line now name the model that is busy.

  WHAT IS REAL. The two copy functions the page renders (`draftWaitingWords`,
  `sharedModelWaitWords`) and the queue reason shared by the job card and
  Health (`queuedJobWaitReason`), loaded from the real TypeScript sources.

  THE CLAIM. The elapsed time appears and grows with the run; it never reads
  "0 min" (which looks stuck); and a second live job on the same model adds the
  sentence naming that model -- while every existing wait sentence still reads
  exactly as it did.
*/
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

/** Transpile a real TS module so the test runs the shipped code, not a copy. */
async function loadModule(relativePath, imports = {}) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  let output = ts.transpileModule(source, {
    fileName: relativePath,
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const [name, url] of Object.entries(imports)) {
    output = output.replaceAll(`"${name}"`, `"${url}"`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}
/**
 * A stand-in for a module the copy file imports but this test never calls.
 *
 * The named exports are the ones `desk-copy.ts` actually pulls in: an ESM
 * import of a missing name is a link error, so a bare `export const x` stub
 * would fail before a single assertion ran.
 */
const stub = (names) =>
  `data:text/javascript;base64,${Buffer.from(
    names.map((name) => `export const ${name} = () => "";`).join("\n"),
  ).toString("base64")}`;

const copy = await loadModule("../src/lib/news/desk-copy.ts", {
  "./preflight.ts": stub(["looksLikeProviderAuthFailure", "providerAuthTarget"]),
  "./sentence-stop.ts": stub(["cutAtSentenceEnd"]),
  "./lead-match.ts": stub(["distinguishingOverlap", "explainPairMatch", "sharesTightName"]),
  /*
    `TOPICS` is read at module load, not just imported, so the stub has to be
    shaped like the real list rather than an empty function.
  */
  "../paper.ts": `data:text/javascript;base64,${Buffer.from(
    [
      'export const TOPICS = ["local", "state"];',
      'export const PAPER = { timezone: "America/Denver" };',
      'export const formatClockTime = () => "";',
      'export const formatListDateTime = () => "";',
      'export const parseUrlList = () => [];',
    ].join("\n"),
  ).toString("base64")}`,
  "./adaptive-source-selection.ts": stub([]),
  "./source-inventory.ts": stub([]),
  "./scan-source-coverage.ts": stub([]),
});

test("THV-3: the wait line names the model and the run's own elapsed time", () => {
  assert.equal(copy.draftWaitingWords("DeepSeek v4.1 Flash", 0), "Writing with DeepSeek v4.1 Flash · < 1 min");
  assert.equal(copy.draftWaitingWords("DeepSeek v4.1 Flash", 240_000), "Writing with DeepSeek v4.1 Flash · 4 min");
  assert.equal(copy.draftWaitingWords("DeepSeek v4.1 Flash", 600_000), "Writing with DeepSeek v4.1 Flash · 10 min");
});

test("THV-3: the clock grows with the run and never reads 0 min", () => {
  const labels = [0, 30_000, 59_999, 60_000, 119_000, 600_000].map((ms) =>
    copy.draftWaitingWords("DeepSeek v4.1 Flash", ms),
  );
  assert.equal(labels.some((line) => / 0 min/.test(line)), false, "0 min looks stuck");
  assert.deepEqual(labels, [
    "Writing with DeepSeek v4.1 Flash · < 1 min",
    "Writing with DeepSeek v4.1 Flash · < 1 min",
    "Writing with DeepSeek v4.1 Flash · < 1 min",
    "Writing with DeepSeek v4.1 Flash · 1 min",
    "Writing with DeepSeek v4.1 Flash · 1 min",
    "Writing with DeepSeek v4.1 Flash · 10 min",
  ]);
});

test("THV-1 + THU-8: a second draft on the same model is named in plain words", () => {
  assert.equal(
    copy.sharedModelWaitWords("DeepSeek v4.1 Flash"),
    "Another draft is using DeepSeek v4.1 Flash; this one waits its turn.",
  );
});

/*
  The queue reason lives in jobs.ts, whose imports reach the database. The
  sentence under test is pure, so the module is transpiled with its imports
  stubbed -- the same approach the picker tests use for the registry.
*/
const jobs = await loadModule("../src/lib/news/jobs.ts", {
  "../db.ts": stub(["ensureSchemaOnce", "getSql", "withTransaction"]),
  "./automatic-failover.ts": stub(["appendStoryFailoverNote"]),
  "./model-choice.ts": `data:text/javascript;base64,${Buffer.from(
    /*
      The real label for this pick, so the sentence under test is the sentence
      an editor sees. `modelChoiceLabel` itself is covered by the model tests;
      what is asserted here is that the reason names the model at all.
    */
    'export const modelChoiceLabel = (choice) => (choice === "deepseek-flash" ? "DeepSeek v4.1 Flash" : choice);',
  ).toString("base64")}`,
  "./membership.ts": stub(["DEFAULT_NEWSROOM_ID"]),
});

const jobRow = (over = {}) => ({
  id: 2,
  newsroom_id: 1,
  user_id: "u",
  kind: "draft",
  subject_id: 7,
  model_choice: "deepseek-flash",
  model_choice_source: "editor",
  lane: "draft",
  status: "queued",
  stage: "",
  failover_note: "",
  error: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  started_at: new Date().toISOString(),
  finished_at: null,
  cancel_requested: false,
  ...over,
});

test("THV-1 + THU-8: a live same-model draft is the reason the queued draft waits", () => {
  const queued = jobRow({ id: 2, kind: "draft", model_choice: "deepseek-flash", status: "queued" });
  const running = [jobRow({ id: 1, kind: "draft", model_choice: "deepseek-flash", status: "running" })];
  const reason = jobs.queuedJobWaitReason(queued, running);
  assert.match(reason, /Another draft is using DeepSeek v4\.1 Flash; this one waits its turn\./);
});

test("THV-1 + THU-8: a model held by another KIND of job keeps its existing words", () => {
  const queued = jobRow({ id: 2, kind: "draft", model_choice: "deepseek-flash", status: "queued" });
  const running = [jobRow({ id: 3, kind: "editorial", model_choice: "deepseek-flash", status: "running", lane: "editorial" })];
  const reason = jobs.queuedJobWaitReason(queued, running);
  assert.match(reason, /Waiting for a writing worker, which is busy with the /);
  assert.doesNotMatch(reason, /Another draft is using/);
});

test("THV-1 + THU-8: a stopped same-model job does not hold the model", () => {
  const queued = jobRow({ id: 2, kind: "draft", model_choice: "deepseek-flash", status: "queued" });
  const running = [
    jobRow({ id: 1, kind: "draft", model_choice: "deepseek-flash", status: "running", cancel_requested: true }),
  ];
  assert.equal(jobs.queuedJobWaitReason(queued, running).includes("Another draft is using"), false);
});

test("THV-1 + THU-8: a dead process does not hold the model in the copy", () => {
  const queued = jobRow({ id: 2, kind: "draft", model_choice: "deepseek-flash", status: "queued" });
  const stale = new Date(Date.now() - 3_600_000).toISOString();
  const running = [
    jobRow({ id: 1, kind: "draft", model_choice: "deepseek-flash", status: "running", updated_at: stale }),
  ];
  assert.equal(jobs.queuedJobWaitReason(queued, running).includes("Another draft is using"), false);
});
