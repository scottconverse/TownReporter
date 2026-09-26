import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  The owner's first real correction (2026-09-25) had two halves, and this file
  holds both against the real write path:

    1. "The correction box starts empty." The desk can now ASK for the wording.
       Two lines the editor types, a button, and a note in the box -- and when
       the model cannot be reached, a sentence saying so instead of a box that
       quietly stayed empty. The call goes through the same provider picker every
       other call site uses (Automatic), which is why the stub below is an HTTP
       endpoint and not an injected function: a test that passes here is evidence
       the suggestion really travelled down the ladder.
    2. "The printed body cannot be changed." It can now, on the editor's say-so
       and only together with the note that says why: the body, the correction
       and the history row are one transaction, so the desk cannot reach a state
       where the text changed without its note, or the note without its change.

  The body edit's own rules (what counts as a change, how a note is read back
  from a model's answer) are pure and live in correction-wording.test.ts.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performAddCorrection: typeof import("./corrections.ts").performAddCorrection;
let performSuggestCorrectionWording: typeof import("./desk.ts").performSuggestCorrectionWording;

const NEWSROOM = 98_615;
const ELSEWHERE = 98_616;
const USER = "correction-editor";
const SLUG = "correction-fix-fixture";
const PRINTED_BODY = "The council approved a $4,200 fee on Tuesday.";
const NOTE = "An earlier version of this story said the fee was $4,200. In fact, it is $2,400.";
const FIXED_BODY = "The council approved a $2,400 fee on Tuesday.";
const RUNG_ONE_MODEL = "deepseek-v4.1-flash:cloud";

let fake: ChildProcess | undefined;
let fakeBaseUrl = "";

/** Start the stub on an OS-chosen port and read the port back off its own line. */
async function startFake(): Promise<string> {
  const child = spawn(
    process.execPath,
    [join(process.cwd(), "scripts/fakes/fake-deepseek-endpoint.mjs")],
    {
      env: {
        ...process.env,
        FAKE_DEEPSEEK_PORT: "0",
        FAKE_DEEPSEEK_MODEL: RUNG_ONE_MODEL,
        FAKE_DEEPSEEK_MODE: "ready",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  fake = child;
  return new Promise<string>((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
      const line = out.split("\n").find((text) => text.includes("listening on"));
      const port = line?.match(/:(\d+)\/v1/)?.[1];
      if (port) resolve(`http://127.0.0.1:${port}/v1`);
    });
    child.stderr.on("data", (chunk) => (out += String(chunk)));
    child.on("exit", (code) =>
      reject(new Error(`the stub exited with ${code} before it listened:\n${out}`)),
    );
    setTimeout(() => reject(new Error(`the stub never reported listening:\n${out}`)), 15_000);
  });
}

/** What the stub has answered, in order. */
async function fakeLog(): Promise<{ requests: { class: string; path: string; mode: string }[] }> {
  const res = await fetch(`${fakeBaseUrl.replace(/\/v1$/, "")}/__log`, {
    signal: AbortSignal.timeout(2_000),
  });
  return (await res.json()) as { requests: { class: string; path: string; mode: string }[] };
}

/** How many chat calls (never a readiness probe) the stub has answered. */
async function chatCalls(): Promise<number> {
  const { requests } = await fakeLog();
  return requests.filter((entry) => entry.path.endsWith("/chat/completions")).length;
}

async function setMode(mode: string): Promise<void> {
  await fetch(`${fakeBaseUrl.replace(/\/v1$/, "")}/__mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

before(async () => {
  fakeBaseUrl = await startFake();
  /*
    Arranged as the ladder the test controls: rung 1 is the stub, Qwen is off
    (a real LM Studio on the machine would otherwise answer), and Codex runs the
    repository's own CLI stub signed OUT -- so when the stub below goes down,
    the ladder really does run out rather than reaching a real model.
  */
  process.env.TOWNREPORTER_DEEPSEEK_BASE_URL = fakeBaseUrl;
  process.env.TOWNREPORTER_DEEPSEEK_MODEL = RUNG_ONE_MODEL;
  delete process.env.TOWNREPORTER_DEEPSEEK;
  delete process.env.LLM_BASE_URL;
  process.env.TOWNREPORTER_QWEN = "0";
  process.env.CODEX_CLI_PATH = join(process.cwd(), "scripts/fakes/fake-codex-cli.mjs");
  process.env.FAKE_CODEX_SIGNED_IN = "0";
  delete process.env.FAKE_CODEX_VALID_DRAFT;

  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performAddCorrection } = await vite.ssrLoadModule("/src/lib/news/corrections.ts"));
  ({ performSuggestCorrectionWording } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
});

after(async () => {
  fake?.kill();
  await vite.close();
});

/** An empty desk and this editor on the masthead. Once per test, not per story. */
async function reset() {
  const sql = await getSql();
  await sql.query("delete from article_body_history where newsroom_id in ($1,$2)", [
    NEWSROOM,
    ELSEWHERE,
  ]);
  await sql.query("delete from corrections where newsroom_id in ($1,$2)", [NEWSROOM, ELSEWHERE]);
  await sql.query("delete from articles where newsroom_id in ($1,$2)", [NEWSROOM, ELSEWHERE]);
  await sql.query("delete from audit_events where newsroom_id in ($1,$2)", [NEWSROOM, ELSEWHERE]);
  await sql.query("delete from newsroom_members where newsroom_id in ($1,$2)", [
    NEWSROOM,
    ELSEWHERE,
  ]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    USER,
    NEWSROOM,
  ]);
}

async function fixture(options: { status?: string; slug?: string } = {}) {
  const sql = await getSql();
  const [article] = await sql.query<{ id: number }>(
    "insert into articles(newsroom_id,user_id,slug,headline,status,topic,body) values($1,$2,$3,'The council approves the fee',$4,'council',$5) returning id",
    [
      NEWSROOM,
      USER,
      options.slug ?? SLUG,
      options.status ?? "published",
      PRINTED_BODY,
    ],
  );
  return { articleId: article.id };
}

async function bodyOf(articleId: number): Promise<string> {
  const sql = await getSql();
  const [row] = await sql.query<{ body: string }>("select body from articles where id=$1", [
    articleId,
  ]);
  return row.body;
}

async function historyFor(articleId: number) {
  const sql = await getSql();
  return sql.query<{
    old_body: string;
    new_body: string;
    changed_by: string;
    correction_id: number | null;
  }>(
    "select old_body, new_body, changed_by, correction_id from article_body_history where article_id=$1 order by id asc",
    [articleId],
  );
}

async function correctionsFor(articleId: number) {
  const sql = await getSql();
  return sql.query<{ id: number; body: string }>(
    "select id, body from corrections where article_id=$1 order by id asc",
    [articleId],
  );
}

it("changes the printed text and publishes the note as one act, and keeps what it replaced", async () => {
  await reset();
  const { articleId } = await fixture();

  const result = await performAddCorrection(
    { userId: USER, newsroomId: NEWSROOM },
    { articleSlug: SLUG, body: NOTE, alsoFixBody: true, storyBody: FIXED_BODY },
  );
  assert.deepEqual(result, { ok: true });

  const sql = await getSql();
  assert.equal(await bodyOf(articleId), FIXED_BODY, "the story now reads the corrected text");

  const [article] = await sql.query<{ slug: string }>("select slug from articles where id=$1", [
    articleId,
  ]);
  assert.equal(article.slug, SLUG, "the slug must not move, or every link to the story breaks");

  const corrections = await correctionsFor(articleId);
  assert.equal(corrections.length, 1, "the note is published with the change");
  assert.equal(corrections[0].body, NOTE);

  const history = await historyFor(articleId);
  assert.equal(history.length, 1, "one fix is one record");
  assert.deepEqual(
    {
      old: history[0].old_body,
      next: history[0].new_body,
      who: history[0].changed_by,
      correction: history[0].correction_id,
    },
    { old: PRINTED_BODY, next: FIXED_BODY, who: USER, correction: corrections[0].id },
    "the record must name the text before, the text after, the account, and the correction that justified it",
  );

  const audits = await sql.query<{ action: string }>(
    "select action from audit_events where user_id=$1 and newsroom_id=$2 order by id asc",
    [USER, NEWSROOM],
  );
  assert.deepEqual(
    audits.map((row) => row.action),
    ["correction", "edit_article_body"],
    "the action log carries both halves",
  );
});

it("leaves the printed text alone when the editor only wants the note", async () => {
  // Today's behaviour, and the default: the desk's post button starts on it.
  await reset();
  const { articleId } = await fixture();

  const result = await performAddCorrection(
    { userId: USER, newsroomId: NEWSROOM },
    { articleSlug: SLUG, body: NOTE },
  );
  assert.deepEqual(result, { ok: true });

  assert.equal(await bodyOf(articleId), PRINTED_BODY, "a note-only correction changes no text");
  assert.equal((await correctionsFor(articleId)).length, 1);
  assert.equal((await historyFor(articleId)).length, 0, "nothing changed, so nothing is recorded");
});

it("refuses a fix it cannot make, without writing either half", async () => {
  await reset();
  const { articleId } = await fixture();
  const other = await fixture({ slug: "correction-fix-draft", status: "draft" });

  // The text in the box is the text on the page: pressing post again is not a
  // second decision, and it must not leave a record saying the story was fixed.
  const unchanged = await performAddCorrection(
    { userId: USER, newsroomId: NEWSROOM },
    { articleSlug: SLUG, body: NOTE, alsoFixBody: true, storyBody: `  ${PRINTED_BODY}  ` },
  );
  assert.equal(unchanged.ok, false);
  assert.match(
    unchanged.ok === false ? unchanged.error : "",
    /same as the story text/i,
    "an unchanged fix is refused in a sentence an editor can act on",
  );

  const blank = await performAddCorrection(
    { userId: USER, newsroomId: NEWSROOM },
    { articleSlug: SLUG, body: NOTE, alsoFixBody: true, storyBody: "   " },
  );
  assert.equal(blank.ok, false);
  assert.match(blank.ok === false ? blank.error : "", /cannot be blank/i);

  const noStory = await performAddCorrection(
    { userId: USER, newsroomId: NEWSROOM },
    { body: NOTE, alsoFixBody: true, storyBody: FIXED_BODY },
  );
  assert.equal(noStory.ok, false, "a note with no story has no printed text to fix");

  const unprinted = await performAddCorrection(
    { userId: USER, newsroomId: NEWSROOM },
    { articleSlug: "correction-fix-draft", body: NOTE, alsoFixBody: true, storyBody: FIXED_BODY },
  );
  assert.equal(unprinted.ok, false, "a story that has not printed is still a draft");

  const foreign = await performAddCorrection(
    { userId: USER, newsroomId: ELSEWHERE },
    { articleSlug: SLUG, body: NOTE, alsoFixBody: true, storyBody: FIXED_BODY },
  );
  assert.equal(foreign.ok, false, "another paper's story is not this editor's to rewrite");

  assert.equal(await bodyOf(articleId), PRINTED_BODY, "a refused press must not write");
  assert.equal(await bodyOf(other.articleId), PRINTED_BODY, "not even the story that was named");
  assert.equal((await correctionsFor(articleId)).length, 0, "a refused press publishes no note");
  assert.equal((await historyFor(articleId)).length, 0, "a refused press records no change");
});

it("fills the box from the editor's two lines when the story is not there, with no model at all", async () => {
  // The owner's plain case, at the server: the box gets a note even when the
  // model path is not the one that answers. Nothing is asked of the stub.
  await reset();
  const before = await chatCalls();

  const result = await performSuggestCorrectionWording(
    { userId: USER, newsroomId: NEWSROOM },
    { articleSlug: "a-story-that-is-not-here", wasWrong: "the fee was $4,200", isRight: "the fee is $2,400" },
  );
  assert.deepEqual(result, {
    ok: true,
    source: "template",
    wording: "An earlier version of this story said the fee was $4,200. In fact, the fee is $2,400.",
  });
  assert.equal(await chatCalls(), before, "the note the desk writes itself costs no model call");
});

it("refuses half the fact before it asks anyone, and says which line is missing", async () => {
  await reset();
  await fixture();
  const before = await chatCalls();

  const missingRight = await performSuggestCorrectionWording(
    { userId: USER, newsroomId: NEWSROOM },
    { articleSlug: SLUG, wasWrong: "the fee was $4,200", isRight: "   " },
  );
  assert.equal(missingRight.ok, false);
  assert.match(missingRight.ok === false ? missingRight.error : "", /what is right/i);

  const nothing = await performSuggestCorrectionWording(
    { userId: USER, newsroomId: NEWSROOM },
    { articleSlug: SLUG, wasWrong: "", isRight: "" },
  );
  assert.equal(nothing.ok, false);
  assert.match(nothing.ok === false ? nothing.error : "", /what was wrong and what is right/i);

  assert.equal(await chatCalls(), before, "a half-filled pair must not spend a model call");
});

it("suggests the wording through the provider picker, and says so plainly when the model is down", async () => {
  await reset();
  await fixture();
  await setMode("ready");
  const before = await chatCalls();

  const suggested = await performSuggestCorrectionWording(
    { userId: USER, newsroomId: NEWSROOM },
    { articleSlug: SLUG, wasWrong: "the fee was $4,200", isRight: "the fee is $2,400" },
  );
  assert.deepEqual(suggested, {
    ok: true,
    source: "model",
    // The stub's own house form, deliberately NOT the sentence the desk writes
    // itself, so `source: "model"` here is a measured fact and not a guess --
    // and it carries the editor's two lines back, which is what proves they
    // travelled to the model rather than being re-worded on the desk.
    wording: "Correction needed: the story said the fee was $4,200. The truth: the fee is $2,400.",
  });
  const { requests } = await fakeLog();
  const chat = requests.filter((entry) => entry.path.endsWith("/chat/completions"));
  assert.equal(chat.length, before + 1, "the suggestion is exactly one call");
  assert.equal(chat[chat.length - 1].class, "correction", "the stub saw the correction writer's ask");

  /*
    The owner's real failure: the rung is up, it answers its readiness probe, and
    it hits its usage limit on the call that matters. Every rung after it is
    unavailable in this file, so the ladder runs out -- which is what the desk
    reports, in a sentence, with nothing changed.
  */
  await setMode("quota");
  const failed = await performSuggestCorrectionWording(
    { userId: USER, newsroomId: NEWSROOM },
    { articleSlug: SLUG, wasWrong: "the fee was $4,200", isRight: "the fee is $2,400" },
  );
  assert.equal(failed.ok, false);
  assert.match(failed.ok === false ? failed.error : "", /could not be reached just now/i);
  assert.match(failed.ok === false ? failed.error : "", /exactly as you left it/i);
  assert.ok(
    !("wording" in failed),
    "a failed suggestion must hand the desk no text to put in the box",
  );
  await setMode("ready");
});
