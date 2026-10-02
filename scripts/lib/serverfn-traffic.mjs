/*
  What the page asked the server, in the order it asked -- for a walk that has
  to say WHY it gave up.

  FLAKE1. `scripts/delete-corrections-e2e.mjs` failed twice in CI with
  `page.waitForResponse: Timeout 45000ms exceeded`, on a step that passes on
  every developer machine, and the failure carried no evidence: a
  `waitForResponse` that never fires tells you nothing about what DID happen,
  and the walk's own dump prints the page as text -- which shows the desk left
  saying "Your evidence decision is still saving." but not one word about the
  requests that produced that state.

  The shape that was lost: `refreshedReviewAfterDecision` was armed AFTER the
  press (and after the lock-wait loop that runs while the press is held), so a
  matching read that completed between the press and the arming -- a reply to
  the earlier draft-save's own invalidation, a focus refetch, or a read the
  held press's own optimistic handling started -- was simply not seen by the
  listener. A listener sees one moment forward; a LOG sees everything back to
  where you armed it.

  So: arm this before the press, feed it every `request` and `response` the
  page makes, and ASK THE LOG -- from the arm time forward -- instead of asking
  the wire from now forward. On a timeout, print the log.

  Pure and browser-free on purpose: `node --test` drives the matching and the
  dump (`serverfn-traffic.test.mjs`), which is the only part of this that a
  test can reach -- the walk itself needs a browser and a database.
*/

/**
 * Every server function call the desk makes carries this header.
 *
 * Written in the spelling Playwright reports (`request.headers()` is
 * lowercased), which is also the spelling `delete-corrections-e2e.mjs` has
 * always matched on.
 */
export const SERVER_FN_HEADER = "x-tsr-serverfn";

/** How long a body signature may be. Long enough to name a row, short enough to hold a column. */
const SIGNATURE_LIMIT = 120;

function oneLine(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * A short, one-line description of a server function's reply.
 *
 * A body is not worth printing whole (the review read is ~40 kB of JSON), but
 * "which reply was this" is: the length, whether the two fields this walk
 * matches on are in it, and the evidence token when the reply carries one --
 * the token is the thing that decides whether the finding review re-reads at
 * all, because the panel's query key is `["finding-evidence-review", leadId,
 * evidenceToken]` (src/components/finding-evidence-review.tsx:665).
 */
export function serverFnSignature(body) {
  const text = String(body ?? "");
  if (text === "") return "(empty)";
  const marks = [];
  for (const marker of ["canonicalDraft", "evidenceToken"]) {
    if (text.includes(marker)) marks.push(marker);
  }
  const token = evidenceTokenIn(text);
  if (token) marks.push(`token=${token}`);
  const head = oneLine(text).slice(0, SIGNATURE_LIMIT);
  return `${text.length}B [${marks.join(" ")}] ${head}`;
}

/**
 * The evidence token a reply carries, if it carries one.
 *
 * Read out of the serialized reply rather than off the screen: the desk never
 * prints the token anywhere, and the token is the whole reason a decision
 * press re-reads the finding review (a new token is a new query key). Both the
 * lead read and the review read carry the field, so the NEWEST one in the log
 * is the token the page is currently working from.
 */
export function evidenceTokenIn(body) {
  const match = /"evidenceToken"\s*:\s*"([^"]+)"/.exec(String(body ?? ""));
  if (!match) return null;
  const token = match[1];
  return token.length > 24 ? `${token.slice(0, 21)}…` : token;
}

/**
 * The server function calls a page made, armed before the press.
 *
 * Two things are recorded per call, and the distinction is the point:
 *
 *   - `request` -- the page sent it. Recorded the moment the browser reports
 *     it, even if no reply ever comes. A call that stays unanswered is the
 *     single most useful row in a timeout dump: it says the request left the
 *     browser and nothing came back. `at` is this moment, and it is what orders
 *     the log.
 *   - `response` -- a reply landed, with its status and a signature of its
 *     body. `respondedAt` is this moment; the gap between the two is how long
 *     the call took.
 *
 * `match` searches the WHOLE log from `arm()` forward, so a reply that landed
 * before anyone started looking is still found. That is the FLAKE1 race: the
 * old code armed its listener after the press, so a matching read that
 * completed in between was invisible, and no later read was required (nothing
 * else invalidates the review query).
 */
export function createServerFnLog() {
  const calls = [];
  let armedAt = null;

  const findPending = (method, path) =>
    calls.find((call) => call.method === method && call.path === path && !call.answered);

  return {
    /**
     * Start the log at this instant -- call it before the press whose traffic
     * you care about. Everything the page asked for before this is not this
     * step's business; everything from here on is.
     */
    arm(at) {
      armedAt = at;
      return at;
    },

    /** Note a request the page made. Unanswered until a response is recorded for it. */
    noteRequest({ at, method, path }) {
      if (armedAt === null) armedAt = at;
      calls.push({
        at,
        method,
        path,
        status: null,
        ok: null,
        answered: false,
        respondedAt: null,
        body: "",
      });
    },

    /** Record a reply. Fills the oldest unanswered call to the same place, or stands alone. */
    record({ at, method, path, status, body }) {
      if (armedAt === null) armedAt = at;
      const pending = findPending(method, path);
      if (pending) {
        pending.status = status;
        pending.ok = status >= 200 && status < 300;
        pending.answered = true;
        pending.respondedAt = at;
        pending.body = String(body ?? "");
        return;
      }
      calls.push({
        at,
        method,
        path,
        status,
        ok: status >= 200 && status < 300,
        answered: true,
        respondedAt: at,
        body: String(body ?? ""),
      });
    },

    /**
     * The first ANSWERED call from the arm time forward that `match` accepts,
     * or null. Scans history: a reply that landed before this was called is
     * found exactly as one that lands after -- which is what makes a poll loop
     * equivalent to, and safer than, a listener armed late.
     */
    match(match) {
      for (const call of calls) {
        if (armedAt !== null && call.at < armedAt) continue;
        if (!call.answered) continue;
        if (match(call)) return call;
      }
      return null;
    },

    /** Every call from the arm time forward, oldest first. */
    since() {
      return calls.filter((call) => armedAt === null || call.at >= armedAt);
    },

    /** The newest evidence token any reply has carried, or null. */
    newestEvidenceToken() {
      let token = null;
      for (const call of this.since()) {
        const found = evidenceTokenIn(call.body);
        if (found) token = found;
      }
      return token;
    },

    /**
     * The log as a table, oldest first, with `+Nms` measured from the arm time
     * -- so a dump says both what happened and WHEN relative to the press.
     * Every call is listed, answered or not; the unanswered ones are the ones
     * that explain a wait that ended in a timeout.
     */
    table() {
      const rows = this.since();
      if (rows.length === 0) {
        return `server function calls since the press: (none)`;
      }
      const lines = rows.map((call, index) => {
        const at = armedAt === null ? "?" : `+${call.at - armedAt}ms`;
        const status = call.answered ? String(call.status) : "(no reply)";
        const took =
          call.answered && armedAt !== null
            ? ` (${call.respondedAt - call.at}ms)`
            : "";
        const body = call.answered ? serverFnSignature(call.body) : "";
        return (
          `  ${index + 1}. ${at.padStart(9)}  ${call.method.padEnd(4)} ` +
          `${call.path}  ${status}${took}${body ? `  ${body}` : ""}`
        );
      });
      const token = this.newestEvidenceToken();
      lines.push(
        `  the newest evidenceToken any reply carried: ${token ?? "(none seen)"}`,
      );
      return [`server function calls since the press (${rows.length}):`, ...lines].join("\n");
    },
  };
}
