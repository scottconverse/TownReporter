/**
 * "Come back later" and "blocked", pinned (unit SH-B items 2 and 3).
 *
 * WHAT THESE TESTS ARE FOR. The rule the owner asked for is not "record that
 * we were refused" -- it is "honour it, and actually do it". So the assertions
 * are about a clock: a source parked at 3:40 is not fetched at 3:39 and is
 * fetched at 3:41, and a host blocked twice waits 6 hours the second time
 * rather than the same 400 ms as the first. Every one of those is asserted
 * against an injected `nowMs` rather than by sleeping, because a politeness
 * rule that can only be tested by waiting is a politeness rule nobody tests.
 *
 * The sentences are pinned too, and deliberately: the editor reads them, and
 * "Asked us to come back at 3:40 PM -- will retry then" is a promise the desk
 * has to keep. A test that only checked a timestamp would let the wording rot
 * into jargon nobody at a desk can act on.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  BLOCKED_BACKOFF_MS,
  BLOCKED_TRIES_PER_HOST_PER_DAY,
  blockedBackoffMs,
  blockedSentence,
  classifyRefusal,
  clockSentence,
  COME_BACK_DEFAULT_MS,
  dailyCapSentence,
  isParked,
  looksLikeRateLimitPage,
  parseRetryAfter,
  RETRY_AFTER_MAX_MS,
  retryAfterFromHeaders,
  retryAfterSentence,
  skipThisPass,
  touchAfterError,
  touchAfterFailure,
  touchAfterSkip,
  touchAfterSuccess,
} from "./fetch-politeness.ts";

const NOW = Date.parse("2026-10-01T21:12:00.000Z");

test("Retry-After is read as seconds and as an HTTP-date", () => {
  assert.equal(parseRetryAfter("120", NOW), 120_000);
  assert.equal(parseRetryAfter("  45 ", NOW), 45_000);
  assert.equal(parseRetryAfter("Thu, 01 Oct 2026 21:42:00 GMT", NOW), 30 * 60_000);
  // A date already past reads as "now", never as a negative wait.
  assert.equal(parseRetryAfter("Thu, 01 Oct 2026 20:00:00 GMT", NOW), 0);
  // Nonsense is no answer, so the caller falls back to its own default.
  assert.equal(parseRetryAfter("soon", NOW), null);
  assert.equal(parseRetryAfter("", NOW), null);
  assert.equal(parseRetryAfter(null, NOW), null);
});

test("Retry-After is read off response headers", () => {
  const headers = new Headers({ "retry-after": "90" });
  assert.equal(retryAfterFromHeaders(headers, NOW), 90_000);
  assert.equal(retryAfterFromHeaders(new Headers(), NOW), null);
});

/*
  LOW-1 (A-B8). Every branch of the parser must produce a wait the desk can
  actually keep. A header nobody can act on used to become `new Date(huge)` --
  an Invalid Date, which threw on the way into the database INSIDE the scan's
  per-source catch, failing the whole pass -- or, for a date in the year 9999,
  a source parked for centuries with the Check press as the only way back.
*/
test("an unreadable or absurd Retry-After becomes a wait the desk can keep", () => {
  // The cap: a day, which is as long as any other backoff in this module.
  assert.equal(parseRetryAfter("99999999999999", NOW), RETRY_AFTER_MAX_MS);
  assert.equal(
    parseRetryAfter("Fri, 01 Oct 9999 21:12:00 GMT", NOW),
    RETRY_AFTER_MAX_MS,
    "a date centuries away is a site saying 'not today', not a park until 9999",
  );
  assert.equal(parseRetryAfter("86400", NOW), RETRY_AFTER_MAX_MS, "exactly a day is allowed");
  assert.ok(parseRetryAfter("86401", NOW)! <= RETRY_AFTER_MAX_MS);
  // A negative number says nothing -- RFC 9110's delay-seconds is a
  // non-negative integer -- so it is no answer, and the caller's default stands.
  assert.equal(parseRetryAfter("-5", NOW), null);
  assert.equal(parseRetryAfter("-1.5", NOW), null, "and it cannot be mistaken for a date");
  assert.equal(parseRetryAfter("soon", NOW), null);
  // Nothing that is readable may be an Invalid Date when it becomes one.
  for (const value of ["0", "1", "99999999999999", "Fri, 01 Oct 9999 21:12:00 GMT", "abc"]) {
    const wait = parseRetryAfter(value, NOW);
    if (wait == null) continue;
    assert.ok(
      Number.isFinite(new Date(NOW + wait).getTime()),
      `${value} must not produce an Invalid Date`,
    );
  }
});

test("classifyRefusal clamps a wait it was handed directly", () => {
  // The header is not the only door into the desk's arithmetic.
  const refusal = classifyRefusal({ status: 429, retryAfterMs: 9.99e16, nowMs: NOW });
  assert.equal(refusal?.retryAtMs, NOW + RETRY_AFTER_MAX_MS);
  assert.ok(Number.isFinite(new Date(refusal!.retryAtMs).getTime()));
});

test("a 429 with Retry-After parks the source until then, and says so", () => {
  const refusal = classifyRefusal({ status: 429, retryAfterMs: 600_000, nowMs: NOW });
  assert.equal(refusal?.kind, "come-back-later");
  assert.equal(refusal?.retryAtMs, NOW + 600_000);
  assert.match(refusal!.note, /^Asked us to come back at /);
});

test("a 503 with no Retry-After still parks the source, for the default wait", () => {
  const refusal = classifyRefusal({ status: 503, nowMs: NOW });
  assert.equal(refusal?.kind, "come-back-later");
  assert.equal(refusal?.retryAtMs, NOW + COME_BACK_DEFAULT_MS);
});

/*
  MEDIUM-4 (A-B8). "Asked us to come back at 3:40 PM" is a claim about what the
  SITE said. A bare 429 or 503 said nothing of the kind -- the desk picked the
  half hour -- and the row that printed it was putting words in a server's
  mouth. When the header IS there, the old sentence is exactly right and stays.
*/
test("only a site that sent a time is said to have asked us to come back", () => {
  const asked = classifyRefusal({ status: 429, retryAfterMs: 600_000, nowMs: NOW });
  assert.match(asked!.note, /^Asked us to come back at /);

  const busy = classifyRefusal({ status: 503, retryAfterMs: null, nowMs: NOW });
  assert.equal(
    busy!.note,
    `Was busy at ${clockSentence(NOW)} — trying again after ${clockSentence(NOW + COME_BACK_DEFAULT_MS)}`,
    "the desk's own default names both ends: when it knocked, and when it tries again",
  );
  assert.doesNotMatch(busy!.note, /Asked us/, "nobody asked");
  for (const sentence of [asked!.note, busy!.note]) {
    assert.doesNotMatch(sentence, /429|503|HTTP|Retry-After|status/i, sentence);
  }
});

test("a rate-limit page served with a 200 is still a come-back-later", () => {
  const body = "<html><body>Too many requests. Please slow down and try again later.</body></html>";
  assert.equal(looksLikeRateLimitPage(body), true);
  const refusal = classifyRefusal({ status: 200, body, nowMs: NOW });
  assert.equal(refusal?.kind, "come-back-later");
});

test("a 403 and a 401 are a block, not a wait", () => {
  for (const status of [401, 403]) {
    const refusal = classifyRefusal({ status, nowMs: NOW });
    assert.equal(refusal?.kind, "blocked", `status ${status}`);
    assert.match(refusal!.note, /^Blocked us at /);
  }
});

test("a bot wall served with a 200 is still a block", () => {
  const refusal = classifyRefusal({
    status: 200,
    body: "<title>Attention Required! | Cloudflare</title>Verify you are human",
    nowMs: NOW,
  });
  assert.equal(refusal?.kind, "blocked");
});

test("an ordinary failure is none of the desk's politeness business", () => {
  assert.equal(classifyRefusal({ status: 404, nowMs: NOW }), null);
  assert.equal(classifyRefusal({ status: 500, nowMs: NOW }), null);
  assert.equal(classifyRefusal({ status: 200, body: "<p>hello</p>", nowMs: NOW }), null);
});

test("the backoff sequence is next pass, then 6 hours, then a day", () => {
  assert.equal(blockedBackoffMs(0), 0);
  assert.equal(blockedBackoffMs(1), 0);
  assert.equal(blockedBackoffMs(2), 6 * 60 * 60_000);
  assert.equal(blockedBackoffMs(3), 24 * 60 * 60_000);
  // It clamps rather than extrapolating: a week is a person's decision.
  assert.equal(blockedBackoffMs(9), BLOCKED_BACKOFF_MS[BLOCKED_BACKOFF_MS.length - 1]);
});

test("a parked source is skipped before its time and fetched after it", () => {
  const retryAt = NOW + COME_BACK_DEFAULT_MS;
  assert.equal(isParked(retryAt, NOW), true, "a moment after the refusal");
  assert.equal(isParked(retryAt, retryAt - 1), true, "one millisecond early");
  assert.equal(isParked(retryAt, retryAt), false, "the moment it arrives");
  assert.equal(isParked(retryAt, retryAt + 1), false, "after it");
  assert.equal(isParked(null, NOW), false, "a row that was never parked");
});

test("the editor's sentences are plain, and name both times", () => {
  const blockedAt = Date.parse("2026-10-01T15:12:00.000Z");
  const nextTry = blockedAt + 6 * 60 * 60_000;
  assert.match(blockedSentence(blockedAt, nextTry), /^Blocked us at .+ — trying again after .+$/);
  assert.match(blockedSentence(blockedAt, blockedAt), /next pass$/);
  assert.match(retryAfterSentence(new Date(blockedAt).toISOString()), /will retry then$/);
  assert.match(dailyCapSentence(), new RegExp(`^Tried ${BLOCKED_TRIES_PER_HOST_PER_DAY} times today`));
  // No jargon and no codes in anything the editor reads.
  for (const sentence of [
    blockedSentence(blockedAt, nextTry),
    retryAfterSentence(new Date(blockedAt).toISOString()),
    dailyCapSentence(),
  ]) {
    assert.doesNotMatch(sentence, /429|403|HTTP|Retry-After|status/i, sentence);
  }
});

test("the clock sentence is a wall-clock time an editor can read", () => {
  assert.match(clockSentence(NOW), /^\d{1,2}:\d{2} (AM|PM)$/);
});

/*
  The row a refusal leaves behind, and the question the next pass asks of it.

  These two are the difference between "recorded" and "honoured". The scan asks
  `skipThisPass` before it fetches, and the answer comes from the `retry_after`
  that `touchAfterFailure` wrote -- so the pair is tested together, with the
  clock moved by hand, because a wait nothing reads is just a comment.
*/
test("a come-back-later parks the row and stops calling it a failure", () => {
  const refusal = classifyRefusal({ status: 429, retryAfterMs: 600_000, nowMs: NOW })!;
  const touch = touchAfterFailure({ refusal, nowMs: NOW });
  assert.equal(touch.retry_after?.getTime(), NOW + 600_000);
  assert.match(touch.retry_after_note!, /will retry then$/);
  assert.equal(touch.last_error, null, "a site that asked us to wait has not failed us");
  assert.equal(touch.blocked_attempts, 0);
  assert.equal(touch.countsAgainstHostCap, false);
});

test("a block backs off further each time it is confirmed", () => {
  const first = touchAfterFailure({
    refusal: classifyRefusal({ status: 403, nowMs: NOW })!,
    nowMs: NOW,
  });
  assert.equal(first.blocked_attempts, 1);
  assert.equal(first.retry_after?.getTime(), NOW, "first block: the next pass is soon enough");
  assert.equal(first.countsAgainstHostCap, true);
  assert.ok(first.last_error, "the editor is told, it is not hidden");

  const second = touchAfterFailure({
    refusal: classifyRefusal({ status: 403, nowMs: NOW })!,
    previousBlockedAt: first.blocked_at,
    previousBlockedAttempts: first.blocked_attempts,
    nowMs: NOW,
  });
  assert.equal(second.blocked_attempts, 2);
  assert.equal(second.retry_after?.getTime(), NOW + 6 * 60 * 60_000);
  // The sentence keeps the ORIGINAL block time: a block that has lasted six
  // hours is more informative than one confirmed a moment ago.
  assert.equal(second.blocked_at?.getTime(), NOW);
  assert.match(second.retry_after_note!, /^Blocked us at /);

  const third = touchAfterFailure({
    refusal: classifyRefusal({ status: 403, nowMs: NOW })!,
    previousBlockedAt: second.blocked_at,
    previousBlockedAttempts: second.blocked_attempts,
    nowMs: NOW,
  });
  assert.equal(third.blocked_attempts, 3);
  assert.equal(third.retry_after?.getTime(), NOW + 24 * 60 * 60_000);
});

test("a successful read clears the wait, the block and the run of them", () => {
  const touch = touchAfterSuccess();
  assert.equal(touch.outcome, "read");
  assert.equal(touch.retry_after, null);
  assert.equal(touch.retry_after_note, null);
  assert.equal(touch.blocked_at, null);
  assert.equal(touch.blocked_attempts, 0);
  assert.equal(touch.last_error, null);
});

/*
  HIGH-1 (A-B8). The outcome is the word the row's write branches on, so every
  kind of attempt has to carry the right one -- including the ordinary failure
  and the deliberate skip, which used to be assembled at the call site out of
  whatever columns happened to be to hand.
*/
test("every kind of attempt says which kind it is", () => {
  assert.equal(touchAfterSuccess().outcome, "read");
  assert.equal(
    touchAfterFailure({
      refusal: classifyRefusal({ status: 429, nowMs: NOW })!,
      nowMs: NOW,
    }).outcome,
    "wait",
  );
  assert.equal(
    touchAfterFailure({
      refusal: classifyRefusal({ status: 403, nowMs: NOW })!,
      nowMs: NOW,
    }).outcome,
    "blocked",
  );
  const failed = touchAfterError("Fetch failed (404)");
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.last_error, "Fetch failed (404)");
  assert.equal(failed.retry_after, null, "an ordinary failure is not a wait");

  const skipped = touchAfterSkip({ retryAfter: new Date(NOW + 1000), note: "Tried 4 times today" });
  assert.equal(skipped.outcome, "skipped");
  assert.equal(skipped.retry_after_note, "Tried 4 times today");
  assert.equal(skipped.last_error, null, "a fetch that never happened has no reason to report");
});

test("a wait stored on the row is the sentence classifyRefusal chose", () => {
  // One sentence, decided once, where the header is still in hand -- the row
  // must not be able to say "Asked us" for a site that said nothing.
  const asked = touchAfterFailure({
    refusal: classifyRefusal({ status: 429, retryAfterMs: 600_000, nowMs: NOW })!,
    nowMs: NOW,
  });
  assert.equal(asked.retry_after_note, classifyRefusal({ status: 429, retryAfterMs: 600_000, nowMs: NOW })!.note);
  const busy = touchAfterFailure({
    refusal: classifyRefusal({ status: 503, nowMs: NOW })!,
    nowMs: NOW,
  });
  assert.match(busy.retry_after_note!, /^Was busy at /);
});

test("a parked source is skipped by the pass before its time and fetched after", () => {
  const refusal = classifyRefusal({ status: 429, retryAfterMs: 600_000, nowMs: NOW })!;
  const { retry_after } = touchAfterFailure({ refusal, nowMs: NOW });
  assert.equal(skipThisPass({ retryAfter: retry_after, nowMs: NOW }), true);
  assert.equal(skipThisPass({ retryAfter: retry_after, nowMs: NOW + 599_999 }), true);
  assert.equal(skipThisPass({ retryAfter: retry_after, nowMs: NOW + 600_000 }), false);
  assert.equal(skipThisPass({ retryAfter: retry_after, nowMs: NOW + 86_400_000 }), false);
  assert.equal(skipThisPass({ retryAfter: null, nowMs: NOW }), false, "never parked");
});
