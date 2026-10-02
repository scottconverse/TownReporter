/*
  FLAKE1: the log the delete-corrections walk asks instead of the wire.

  Four properties, and the first is the one the CI flake turned on: a reply
  that landed before anyone started looking is still found. The other three are
  what a reply is filed against, which token is the newest, and when a wait
  that gets an answer should stop instead of blaming silence.
*/
import assert from "node:assert/strict";
import test from "node:test";

import {
  awaitServerFnCall,
  createServerFnLog,
  evidenceTokenIn,
  serverFnSignature,
} from "./serverfn-traffic.mjs";

const TITLE = "TEST FIXTURE — Library recreation center update 12345";
const reviewBody = (token) =>
  JSON.stringify({ ok: true, review: { evidenceToken: token, canonicalDraft: { headline: TITLE } } });

const reviewRefresh = (call) =>
  call.method === "GET" &&
  call.ok &&
  call.body.includes("canonicalDraft") &&
  call.body.includes("evidenceToken") &&
  call.body.includes(TITLE);

test("a reply that landed before the first look is still matched", () => {
  const log = createServerFnLog();
  log.arm(1_000);
  /*
    The press, its reply, and the review read it triggered -- all done by
    +2s, all recorded before anyone asks. This is the shape the walk lost:
    `page.waitForResponse` armed after the press cannot see any of it.
  */
  const press = { id: "press" };
  const read = { id: "read" };
  log.noteRequest({ at: 1_100, key: press, method: "POST", path: "/_serverFn/decision" });
  log.record({
    at: 1_250,
    key: press,
    method: "POST",
    path: "/_serverFn/decision",
    status: 200,
    body: JSON.stringify({ ok: true }),
  });
  log.noteRequest({ at: 1_300, key: read, method: "GET", path: "/_serverFn/review" });
  log.record({
    at: 1_400,
    key: read,
    method: "GET",
    path: "/_serverFn/review",
    status: 200,
    body: reviewBody("sha256:aaaa"),
  });

  /* Nobody looks until here -- well after the reply landed. */
  const found = log.match(reviewRefresh);
  assert.ok(found, "the read that landed before the search began must be found");
  assert.equal(found.path, "/_serverFn/review");
  assert.equal(found.respondedAt, 1_400);
  assert.equal(found.at, 1_300, "the row keeps the request time, so the log stays in arrival order");
});

test("non-matching calls are ignored", () => {
  const log = createServerFnLog();
  log.arm(1_000);
  /* A POST, a refused read, a read of something else, and one without the title. */
  log.record({ at: 1_100, method: "POST", path: "/_serverFn/decision", status: 200, body: reviewBody("sha256:post") });
  log.record({ at: 1_200, method: "GET", path: "/_serverFn/review", status: 503, body: "fixture reload failure" });
  log.record({ at: 1_300, method: "GET", path: "/_serverFn/lead", status: 200, body: '{"ok":true}' });
  log.record({
    at: 1_400,
    method: "GET",
    path: "/_serverFn/review",
    status: 200,
    body: JSON.stringify({ ok: true, review: { evidenceToken: "sha256:b", canonicalDraft: { headline: "another story" } } }),
  });
  assert.equal(log.match(reviewRefresh), null, "nothing that fails the matcher may be returned");

  log.record({ at: 1_500, method: "GET", path: "/_serverFn/review", status: 200, body: reviewBody("sha256:c") });
  const found = log.match(reviewRefresh);
  assert.equal(found.respondedAt, 1_500, "the first call that DOES match is the one returned");

  /* Calls before the arm time belong to another step and are not searched. */
  log.record({ at: 900, method: "GET", path: "/_serverFn/review", status: 200, body: reviewBody("sha256:old") });
  assert.equal(log.match(reviewRefresh).respondedAt, 1_500);
});

test("the dump lists every call in order, including the ones that never got a reply", () => {
  const log = createServerFnLog();
  log.arm(5_000);
  const lead = { id: "lead" };
  const press = { id: "press" };
  const read = { id: "read" };
  log.noteRequest({ at: 5_010, key: lead, method: "GET", path: "/_serverFn/lead" });
  log.record({
    at: 5_040,
    key: lead,
    method: "GET",
    path: "/_serverFn/lead",
    status: 200,
    body: '{"ok":true}',
  });
  /* The press goes out and NOTHING comes back -- the row that explains a timeout. */
  log.noteRequest({ at: 5_050, key: press, method: "POST", path: "/_serverFn/decision" });
  log.noteRequest({ at: 5_060, key: read, method: "GET", path: "/_serverFn/review" });
  log.record({
    at: 5_080,
    key: read,
    method: "GET",
    path: "/_serverFn/review",
    status: 200,
    body: reviewBody("sha256:d"),
  });

  const table = log.table();
  const lines = table.split("\n");
  assert.equal(lines[0], "server function calls since the press (3):");
  assert.match(lines[1], /\+10ms\s+GET\s+\/_serverFn\/lead\s+200 \(30ms\)/);
  assert.match(lines[2], /\+50ms\s+POST\s+\/_serverFn\/decision\s+\(no reply\)/);
  assert.match(lines[3], /\+60ms\s+GET\s+\/_serverFn\/review\s+200 \(20ms\)/);
  assert.match(lines[4], /the token carried by the most recent reply: sha256:d/);
  assert.equal(lines.length, 5, "one line per call, plus the header and the token line");
  /* The order is the arrival order, not the reply order. */
  assert.ok(table.indexOf("/_serverFn/decision") < table.indexOf("/_serverFn/review"));
});

test("an empty log says so rather than printing a lone header", () => {
  const log = createServerFnLog();
  log.arm(1_000);
  assert.equal(log.table(), "server function calls since the press: (none)");
  assert.equal(log.newestEvidenceToken(), null);
});

test("the signature names the two fields this walk matches on and carries the token", () => {
  const signature = serverFnSignature(reviewBody("sha256:0123456789abcdef0123456789abcdef"));
  assert.match(signature, /canonicalDraft/);
  assert.match(signature, /evidenceToken/);
  assert.match(signature, /token=sha256:0123456789abc/);
  assert.equal(serverFnSignature(""), "(empty)");
  assert.equal(evidenceTokenIn('{"ok":true}'), null);
});

/*
  FINDING 1 -- a reply belongs to its own request.

  Two calls to ONE path are in flight at once (a held press plus the refetch
  beside it; two invalidations landing together) and the SECOND one is answered
  first. Filing a reply against "the oldest unanswered call to this method and
  path" hands the second call's answer to the first, swaps their statuses,
  timings and body signatures, and leaves the request that actually completed
  reading `(no reply)` -- in the dump written for exactly this shape.
*/
test("two overlapping calls to one path each keep their OWN reply", () => {
  const log = createServerFnLog();
  log.arm(1_000);
  const firstRequest = { id: "first" };
  const secondRequest = { id: "second" };
  log.noteRequest({ at: 1_100, key: firstRequest, method: "GET", path: "/_serverFn/review" });
  log.noteRequest({ at: 1_150, key: secondRequest, method: "GET", path: "/_serverFn/review" });

  /* The SECOND request is answered first; the FIRST is answered last. */
  log.record({
    at: 1_200,
    key: secondRequest,
    method: "GET",
    path: "/_serverFn/review",
    status: 200,
    body: reviewBody("sha256:second"),
  });
  log.record({
    at: 1_300,
    key: firstRequest,
    method: "GET",
    path: "/_serverFn/review",
    status: 503,
    body: "the first request's own refusal",
  });

  const rows = log.since();
  assert.equal(rows.length, 2, "a reply fills its own call's row; it never adds one");
  assert.equal(rows[0].at, 1_100);
  assert.equal(rows[0].status, 503, "the FIRST call keeps the reply that answered IT");
  assert.equal(rows[0].respondedAt, 1_300);
  assert.match(rows[0].body, /the first request's own refusal/);
  assert.equal(rows[1].status, 200, "the SECOND call keeps its own reply");
  assert.equal(rows[1].respondedAt, 1_200, "even though it replied first");
  assert.match(rows[1].body, /sha256:second/);
  assert.ok(
    rows.every((call) => call.answered),
    "no call may be left '(no reply)' when every call was answered",
  );
  assert.ok(!log.table().includes("(no reply)"), "and the dump says so");

  /* The reply that landed LAST is still the first call's, by identity. */
  const newestReply = log.match((call) => call.body.includes("the first request's own refusal"));
  assert.equal(newestReply.at, 1_100);
  assert.equal(newestReply.respondedAt, 1_300);
});

/*
  FINDING 2 -- the newest token is the one from the newest REPLY.

  `since()` is in request order. With a lead read and a review read in flight,
  an earlier request can be answered after a later one, so taking the last
  token seen in request order names an OLDER token as the newest in the very
  dump that exists to say which token the page was working from.
*/
test("the newest evidence token is the one carried by the most recent reply", () => {
  const log = createServerFnLog();
  log.arm(1_000);
  const leadRequest = { id: "lead" };
  const reviewRequest = { id: "review" };
  log.noteRequest({ at: 1_100, key: leadRequest, method: "GET", path: "/_serverFn/lead" });
  log.noteRequest({ at: 1_150, key: reviewRequest, method: "GET", path: "/_serverFn/review" });

  /* The LATER request is answered first, with t2; the earlier one, after it, with t1. */
  log.record({
    at: 1_200,
    key: reviewRequest,
    method: "GET",
    path: "/_serverFn/review",
    status: 200,
    body: reviewBody("sha256:t2"),
  });
  log.record({
    at: 1_400,
    key: leadRequest,
    method: "GET",
    path: "/_serverFn/lead",
    status: 200,
    body: reviewBody("sha256:t1"),
  });

  assert.equal(
    log.newestEvidenceToken(),
    "sha256:t1",
    "the last reply to LAND carries the token the page is working from",
  );
  assert.match(
    log.table(),
    /the token carried by the most recent reply: sha256:t1/,
    "and the dump says the token came from the most recent reply, not the last request",
  );
});

/*
  FINDING 3 -- an HTTP error reply is a reply.

  A non-2xx answer to the decision POST leaves the desk stuck exactly as a
  stalled request does. A wait that only accepts a 2xx cannot tell the two
  apart: it burns the whole 45s ceiling and then reports that the reply "did
  not arrive", when the status that explains the stall is already in the log.
*/
test("an answered non-2xx reply ends the wait at once and the error names the status", async () => {
  const log = createServerFnLog();
  log.arm(1_000);
  const press = { id: "press" };
  log.noteRequest({ at: 1_100, key: press, method: "POST", path: "/_serverFn/decision" });
  log.record({
    at: 1_180,
    key: press,
    method: "POST",
    path: "/_serverFn/decision",
    status: 500,
    body: "internal error",
  });

  let slept = 0;
  let clock = 1_200;
  await assert.rejects(
    awaitServerFnCall(log, (call) => call.method === "POST" && call.ok, {
      what: "the keep/remove decision POST",
      reject: (call) => call.method === "POST" && !call.ok,
      deadline: 46_000,
      ceilingMs: 45_000,
      now: () => clock,
      sleep: async (ms) => {
        slept += ms;
        clock += ms;
      },
    }),
    (error) => {
      assert.match(error.message, /the keep\/remove decision POST was answered with HTTP 500/);
      assert.match(error.message, /server function calls since the press \(1\)/);
      assert.match(error.message, /500/);
      return true;
    },
  );
  assert.equal(slept, 0, "a reply that says no is not waited out: zero polls, zero sleeping");
});

test("a 2xx reply is returned as soon as the log holds it, and silence still times out with the dump", async () => {
  const log = createServerFnLog();
  log.arm(1_000);
  const press = { id: "press" };
  log.noteRequest({ at: 1_050, key: press, method: "POST", path: "/_serverFn/decision" });
  log.record({
    at: 1_090,
    key: press,
    method: "POST",
    path: "/_serverFn/decision",
    status: 200,
    body: '{"ok":true}',
  });

  const found = await awaitServerFnCall(log, (call) => call.method === "POST" && call.ok, {
    what: "the keep/remove decision POST",
    reject: (call) => call.method === "POST" && !call.ok,
    deadline: 2_000,
    now: () => 1_100,
    sleep: async () => {
      throw new Error("the wait must not poll when the reply is already in the log");
    },
  });
  assert.equal(found.status, 200);

  /* Silence is still a timeout, and it still prints the calls that explain it. */
  const stalled = createServerFnLog();
  stalled.arm(1_000);
  stalled.noteRequest({ at: 1_010, key: "never-answered", method: "POST", path: "/_serverFn/decision" });
  let polls = 0;
  await assert.rejects(
    awaitServerFnCall(stalled, (call) => call.method === "POST" && call.ok, {
      what: "the keep/remove decision POST",
      reject: (call) => call.method === "POST" && !call.ok,
      deadline: 2_000,
      ceilingMs: 45_000,
      now: () => {
        polls += 1;
        return polls > 1 ? 3_000 : 1_020;
      },
      sleep: async () => {},
    }),
    (error) => {
      assert.match(error.message, /did not arrive within 45s/);
      assert.match(error.message, /POST\s+\/_serverFn\/decision\s+\(no reply\)/);
      return true;
    },
  );
  assert.ok(polls > 1, "a stalled call is polled until its deadline");
});
