/**
 * What the desk does when a site refuses it, and what it tells the editor.
 *
 * THREE REFUSALS, THREE DIFFERENT MEANINGS, and treating them as one was the
 * bug. A 429 or a 503 is the site saying *come back later* -- it is working,
 * it will talk to us, and the only wrong move is to ask again immediately. A
 * 401 or a 403 (or a challenge page) is the site saying *not like that* -- the
 * page a resident can read in their browser is still public information, so it
 * is emphatically not a reason to stop watching, but it is a reason to come
 * back much more slowly. Everything else is an ordinary failure and belongs to
 * the failure-streak feature, not here.
 *
 * WHY THIS MODULE IS PURE. Every rule below is a claim about time and about
 * the sentence an editor reads, and both are the kind of thing a test must be
 * able to assert exactly rather than approximately. So the clock is a
 * parameter everywhere, nothing here sleeps, and nothing here touches the
 * database or the network. `host-gate.ts` owns the pacing; this owns the
 * meaning.
 */

/** Refusals that mean "we are working, ask again in a while". */
export const COME_BACK_LATER_STATUSES = [429, 503] as const;
/** Refusals that mean "not you, not like that" -- a bot wall or a block. */
export const BLOCKED_STATUSES = [401, 403] as const;

/** How long to wait when a rate-limit refusal arrives with no `Retry-After`.
 *  Deliberately generous: the point of the wait is that the next ask succeeds,
 *  and a too-short wait just spends another refusal. */
export const COME_BACK_DEFAULT_MS = 30 * 60_000;

/**
 * The wait added after the 1st, 2nd and 3rd block in a row: nothing extra the
 * first time -- it has already waited for the per-host gap and the next pass
 * is naturally later -- then 6 hours, then a day. The list is the rule;
 * `blockedBackoffMs` clamps to its last entry rather than extrapolating,
 * because "wait a week" is a decision for a person, not for an arithmetic
 * progression.
 */
export const BLOCKED_BACKOFF_MS: readonly number[] = [0, 6 * 60 * 60_000, 24 * 60 * 60_000];

/** How many times one host may refuse us in one day before the desk stops
 *  trying until tomorrow. Four: enough to ride out a challenge page that
 *  clears, few enough that a site which means "no" is not asked all day. */
export const BLOCKED_TRIES_PER_HOST_PER_DAY = 4;

export type RefusalKind = "come-back-later" | "blocked";

export type FetchRefusal = {
  kind: RefusalKind;
  status: number | null;
  /** For `come-back-later`: when the desk may ask again. */
  retryAtMs: number;
  /** The plain sentence the Sources row prints. */
  note: string;
};

/**
 * A challenge or rate-limit page, when the status did not already say so.
 *
 * Some hosts answer 200 with an interstitial -- Cloudflare's "Just a moment",
 * a "you are sending requests too quickly" splash -- and a status-only rule
 * would read that as a successful fetch of a page with almost no text. The
 * phrases are the ones these interstitials actually use; the list is short on
 * purpose, because a false positive here silently stops the desk reading a
 * source the editor chose.
 */
export function looksLikeRateLimitPage(body: string): boolean {
  return /too many requests|rate limit|rate-limit|slow down|try again later|come back later|unusual traffic|automated quer|checking your browser|just a moment/i.test(
    body,
  );
}

export function looksLikeBotWall(body: string): boolean {
  return /access denied|forbidden|are you a robot|verify you are human|enable javascript and cookies|attention required/i.test(
    body,
  );
}

/**
 * `Retry-After`, in either of the two forms RFC 9110 allows: a number of
 * seconds, or an HTTP-date.
 *
 * The HTTP-date branch is the one worth having. It is the form a proxy in
 * front of a small municipal site is most likely to emit, and a parser that
 * only understood seconds would silently fall back to the 30-minute default --
 * which, for a site that said "come back tomorrow", is not politeness, it is
 * the same impatience with a longer name. A date in the past reads as "now";
 * a nonsense value reads as no answer at all, so the caller uses its default
 * rather than a number nobody meant.
 */
export function parseRetryAfter(value: string | null | undefined, nowMs: number): number | null {
  if (value == null) return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

/** Read `Retry-After` off a response's headers, if it is there and readable. */
export function retryAfterFromHeaders(
  headers: { get(name: string): string | null },
  nowMs: number,
): number | null {
  return parseRetryAfter(headers.get("retry-after"), nowMs);
}

/**
 * Turn one refusal into what the desk should do about it, or `null` when it is
 * an ordinary failure that belongs to the failure-streak feature instead.
 *
 * `note` is written for the editor and is stored on the row, so it is a
 * sentence rather than a code, and it says which of the two things happened
 * rather than only when the next try is.
 */
export function classifyRefusal(input: {
  status?: number | null;
  retryAfterMs?: number | null;
  body?: string | null;
  nowMs: number;
}): FetchRefusal | null {
  const { status, nowMs } = input;
  const retryAfterMs = input.retryAfterMs ?? null;
  const comeBackLater =
    (status != null && (COME_BACK_LATER_STATUSES as readonly number[]).includes(status)) ||
    (input.body ? looksLikeRateLimitPage(input.body) : false);
  if (comeBackLater) {
    const wait = Math.max(retryAfterMs ?? COME_BACK_DEFAULT_MS, 1);
    return {
      kind: "come-back-later",
      status: status ?? null,
      retryAtMs: nowMs + wait,
      note: `Asked us to come back at ${clockSentence(nowMs + wait)}`,
    };
  }
  const blocked =
    (status != null && (BLOCKED_STATUSES as readonly number[]).includes(status)) ||
    (input.body ? looksLikeBotWall(input.body) : false);
  if (blocked) {
    return {
      kind: "blocked",
      status: status ?? null,
      retryAtMs: nowMs,
      note: `Blocked us at ${clockSentence(nowMs)}`,
    };
  }
  return null;
}

/**
 * Is this refusal one the desk must not immediately retry?
 *
 * A 429 that is re-sent 400 ms later is the single rudest thing this codebase
 * did, and it is the one behaviour that gets *worse* the moment more features
 * start knocking on the same host. A 403 is the same argument with a longer
 * fuse: a bot wall is not cleared by asking twice in the same second, and each
 * ask is a fresh entry in the site's log against us.
 *
 * 503 is deliberately NOT in this list. A 503 is usually a server that had a
 * bad moment rather than a rate limiter counting us, and the one retry the
 * scan has always done for it is worth keeping -- the caller still gets a
 * second chance at a host that never asked us to slow down.
 */
export function mustNotRetryImmediately(status: number | null | undefined): boolean {
  return status != null && [429, 401, 403].includes(status);
}

/** How long after a block the desk will try again, given how many times in a
 *  row it has been blocked (`blocked_attempts` on the row): nothing extra the
 *  first time, then 6 hours, then a day, and a day forever after that. */
export function blockedBackoffMs(attempts: number): number {
  const index = Math.max(0, Math.min(Math.max(0, attempts - 1), BLOCKED_BACKOFF_MS.length - 1));
  return BLOCKED_BACKOFF_MS[index]!;
}

/**
 * Is this row parked until later? The scan asks this before it fetches, which
 * is the whole point of storing the wait: a recorded "come back at 3:40" that
 * nothing reads is just a comment.
 */
export function isParked(retryAfterMs: number | null | undefined, nowMs: number): boolean {
  return retryAfterMs != null && retryAfterMs > nowMs;
}

/**
 * "3:40 PM" -- the time an editor at a desk reads off the wall clock.
 *
 * Deliberately the local, 12-hour, no-seconds form: this sentence is a promise
 * to a person about when the desk will try again, and a bare timestamp would
 * make them do the arithmetic. The date is deliberately absent -- every wait
 * the desk sets is inside a day, so a date would be noise, and a wait that is
 * longer than that is not a wait the desk should be setting silently.
 */
export function clockSentence(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ms));
}

/**
 * The Sources row's sentence for a parked row: "Asked us to come back at
 * 3:40 PM -- will retry then".
 *
 * It says the desk WILL come back, in words, because the failure mode this
 * whole feature exists to fix is a source that quietly stops being read and
 * nobody noticing.
 */
export function retryAfterSentence(retryAfterIso: string | Date | number): string {
  const at = toMs(retryAfterIso);
  if (at == null) return "Asked us to come back later — will retry then";
  return `Asked us to come back at ${clockSentence(at)} — will retry then`;
}

/** The Sources row's sentence for a blocked row: "Blocked us at 9:12 AM --
 *  trying again after 3:12 PM". */
export function blockedSentence(
  blockedAtIso: string | Date | number,
  nextTryIso: string | Date | number,
): string {
  const blockedAt = toMs(blockedAtIso);
  const nextTry = toMs(nextTryIso);
  if (blockedAt == null) return "Blocked us — trying again later";
  // A backoff of zero means the very next pass, which is not a time anybody can
  // name; saying "after 9:12 AM" would be false, so the sentence changes shape.
  if (nextTry == null || nextTry <= blockedAt) {
    return `Blocked us at ${clockSentence(blockedAt)} — trying again on the next pass`;
  }
  return `Blocked us at ${clockSentence(blockedAt)} — trying again after ${clockSentence(nextTry)}`;
}

/** Accept a timestamp as a Date, an ISO string, or milliseconds; `null` when it
 *  is none of those, so a caller can tell "unreadable" from "the epoch". */
function toMs(value: string | Date | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const ms = typeof value === "string" ? Date.parse(value) : value.getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * What the editor is told when the desk has stopped trying a host for today.
 * The honest sentence: this is a limit the desk set for itself, not something
 * the site said.
 */
export function dailyCapSentence(): string {
  return `Tried ${BLOCKED_TRIES_PER_HOST_PER_DAY} times today — will try again tomorrow`;
}

/**
 * The columns a `sources` row should carry after one attempt.
 *
 * Written as one value rather than as loose arguments because every field is
 * decided together and the two commit paths of a scan (the manual one that
 * writes inline, and the scheduled one that queues touches and writes them
 * inside the run transaction) must produce byte-identical rows. The scan that
 * forgot one path is the incident `scan-coverage.test.ts` exists to prevent.
 */
export type SourceTouch = {
  /** When the desk may ask again; null means "ask whenever the pass comes". */
  retry_after: Date | null;
  /** The plain sentence the Sources row prints while parked. */
  retry_after_note: string | null;
  /** When this host first refused *us*; null clears a block that has lifted. */
  blocked_at: Date | null;
  /** Run of blocks, which the next backoff is read from. */
  blocked_attempts: number;
  /** What the row's "Could not check" reason becomes. Null on a row the desk
   *  will not be calling a failure -- a site that asked us to wait has not
   *  failed, and writing "Could not check" over it is the exact misreport this
   *  feature exists to stop. */
  last_error: string | null;
  /** Whether this attempt spends one of the host's tries for today. */
  countsAgainstHostCap: boolean;
};

/** A successful read: everything a refusal wrote comes back off the row. */
export function touchAfterSuccess(): SourceTouch {
  return {
    retry_after: null,
    retry_after_note: null,
    blocked_at: null,
    blocked_attempts: 0,
    last_error: null,
    countsAgainstHostCap: false,
  };
}

/**
 * A refusal the desk has an opinion about, turned into the row it leaves
 * behind.
 *
 * The two kinds write deliberately different things:
 *
 *  - *come back later* parks the row (a real `retry_after`, minutes or hours
 *    away) and clears `last_error`, because the site did not fail us and
 *    labelling it "Could not check" would send the editor to fix a source that
 *    is working.
 *  - *blocked* also parks the row, but for the backoff the run of blocks has
 *    earned -- nothing extra the first time, 6 hours, then a day -- and it
 *    keeps a `last_error`, because the editor should see that this one needs
 *    their attention. `blocked_at` records when the block started (not when it
 *    was last confirmed: a block that has lasted a week is more informative
 *    than one confirmed four minutes ago) and `blocked_attempts` is the run of
 *    refusals the backoff is read from.
 */
export function touchAfterFailure(input: {
  refusal: FetchRefusal;
  previousBlockedAt?: string | Date | number | null;
  previousBlockedAttempts?: number | null;
  nowMs: number;
}): SourceTouch {
  const { refusal, nowMs } = input;
  if (refusal.kind === "come-back-later") {
    const at = new Date(refusal.retryAtMs);
    return {
      retry_after: at,
      retry_after_note: retryAfterSentence(at),
      blocked_at: null,
      blocked_attempts: 0,
      last_error: null,
      countsAgainstHostCap: false,
    };
  }
  const attempts = Math.max(0, input.previousBlockedAttempts ?? 0) + 1;
  const blockedAt = toMs(input.previousBlockedAt ?? null);
  const startedAt = blockedAt ?? nowMs;
  const nextTry = nowMs + blockedBackoffMs(attempts);
  return {
    retry_after: new Date(nextTry),
    retry_after_note: blockedSentence(startedAt, nextTry),
    blocked_at: new Date(startedAt),
    blocked_attempts: attempts,
    last_error: blockedSentence(startedAt, nextTry),
    countsAgainstHostCap: true,
  };
}

/**
 * Should this source be left alone this pass?
 *
 * The one question that makes a stored wait mean anything. A parked row is not
 * a failure and not a pause: it is still on watch, still accepted, and will be
 * fetched by whichever pass comes after its time -- which is what "the next
 * scan picks it up" means in practice, because the scan reads every accepted
 * row that is not parked.
 */
export function skipThisPass(input: {
  retryAfter?: string | Date | number | null;
  nowMs: number;
}): boolean {
  const at = toMs(input.retryAfter ?? null);
  if (at == null) return false;
  return at > input.nowMs;
}
