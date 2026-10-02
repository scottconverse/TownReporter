/*
  FLAKE1: the log the delete-corrections walk asks instead of the wire.

  Three properties, and the first is the one the CI flake turned on:
  a reply that landed before anyone started looking is still found.
*/
import assert from "node:assert/strict";
import test from "node:test";

import {
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
  log.noteRequest({ at: 1_100, method: "POST", path: "/_serverFn/decision" });
  log.record({
    at: 1_250,
    method: "POST",
    path: "/_serverFn/decision",
    status: 200,
    body: JSON.stringify({ ok: true }),
  });
  log.noteRequest({ at: 1_300, method: "GET", path: "/_serverFn/review" });
  log.record({
    at: 1_400,
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
  log.noteRequest({ at: 5_010, method: "GET", path: "/_serverFn/lead" });
  log.record({ at: 5_040, method: "GET", path: "/_serverFn/lead", status: 200, body: '{"ok":true}' });
  /* The press goes out and NOTHING comes back -- the row that explains a timeout. */
  log.noteRequest({ at: 5_050, method: "POST", path: "/_serverFn/decision" });
  log.noteRequest({ at: 5_060, method: "GET", path: "/_serverFn/review" });
  log.record({ at: 5_080, method: "GET", path: "/_serverFn/review", status: 200, body: reviewBody("sha256:d") });

  const table = log.table();
  const lines = table.split("\n");
  assert.equal(lines[0], "server function calls since the press (3):");
  assert.match(lines[1], /\+10ms\s+GET\s+\/_serverFn\/lead\s+200 \(30ms\)/);
  assert.match(lines[2], /\+50ms\s+POST\s+\/_serverFn\/decision\s+\(no reply\)/);
  assert.match(lines[3], /\+60ms\s+GET\s+\/_serverFn\/review\s+200 \(20ms\)/);
  assert.match(lines[4], /the newest evidenceToken any reply carried: sha256:d/);
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
