/**
 * U28 (2026-09-30): the desk's one short question about the pairs the word
 * rules cannot settle.
 *
 * The owner's ask: "double check. worth it." The matcher (./lead-match.ts) and
 * the printed chip (./desk-copy.ts's nearDuplicate) decide most pairs on
 * words, and the owner's own Queue shows where words run out --
 *
 *   "U.S. Supreme Court to Hear Boulder County Climate Suit Oct. 5" chipped as
 *   "Boulder County Proclaims Hispanic and Latinx Heritage Month, Listing
 *   Longmont's Oct. 24 Day of the Dead Celebration".
 *
 * U26 closed the specific hole that produced that pair (see
 * properNounStoplist's doc comment), but the class of miss stays open: two
 * headlines that share a region, a section and a month are indistinguishable
 * to a bag-of-words rule, and the alternatives -- merging them, or hiding one
 * -- are both worse than asking. So for the pairs the words only rate
 * "borderline" -- the matcher's "possible" tier, and a `nearDuplicate` chip
 * candidate -- the desk asks its model, once per scan, batched:
 *
 *   "Are these the same news story? Answer yes or no and one sentence why."
 *
 * WHAT THIS MODULE DECIDES, AND WHAT IT DOES NOT. It decides whether the desk
 * SHOWS a chip: the "Looks already printed" chip and the "Possible duplicate ·
 * compare" link. It never merges two leads, never kills one, never edits a
 * headline and never files anything by itself. A "no" removes a chip; a "yes"
 * keeps a chip that the word rule had already earned and adds its reason. That
 * asymmetry is deliberate -- the failure the desk cannot recover from is
 * silently swallowing a second story, and a chip an editor can ignore is not
 * that.
 *
 * ONE CALL PER SCAN, AND A CEILING. Every borderline pair in one scan goes
 * into one request (a JSON list in, a list of `{id, same, why}` out), so the
 * cost is one model call per scan, not one per pair. Past
 * `DUP_CHECK_MAX_PAIRS` the desk stops asking and the word rule stands
 * unamended (`skipped` says how many), because the alternative -- an
 * unbounded prompt growing with a busy news day -- would turn the cheapest job
 * in the desk into the most expensive one.
 *
 * FAILURE IS NOT A DECISION. A call that fails, times out or answers with
 * something this module cannot read leaves every pair on the word rule: no
 * verdict is recorded, so nothing is cleared and nothing is claimed. The desk
 * behaves exactly as it did before this unit existed, which is what "fall back
 * to the rule" has to mean -- a check that cannot run must not be able to
 * change an answer.
 *
 * WHY THIS FILE HAS NO `@/` IMPORTS: `fileScanLeads` (./lead-filing.ts) applies
 * its verdicts and runs under plain `node --test` against a scratch database;
 * the batch is built and parsed here so both halves can be tested with a fake
 * model and no database at all, the same split `lead-filing.ts` and
 * `queue-rows.ts` already use.
 */
import { storableText } from "./storable-text.ts";
import { nearDuplicate } from "./desk-copy.ts";
import {
  findMatchingLead,
  matchStrength,
  type MatchCandidateLead,
  type NewsroomPlace,
} from "./lead-match.ts";

/**
 * How many pairs one scan may ask about. Past this, the word rule stands --
 * see the header. Forty small headlines and their one-line whys is a prompt of
 * roughly eight kilobytes, which is a cheap request on every rung of the
 * Automatic ladder and small enough that a model can answer about all of them
 * in one reply.
 */
export const DUP_CHECK_MAX_PAIRS = 40;

/**
 * The ceiling on the check's own model call, and the reason it is a ceiling
 * rather than a budget: a check that has not answered by now is about to be
 * overrun by the next scan, and the fallback (the word rule) is a perfectly
 * good answer. Sized generously for a CLI rung, which reloads its own preamble
 * per call, but never unbounded -- a scan must not wait on this.
 */
export const DUP_CHECK_TIMEOUT_MS = 90_000;

/** Enough for forty one-sentence verdicts and the JSON around them. */
export const DUP_CHECK_MAX_TOKENS = 2000;

/** The one-line reason is shown under a chip, not in a story: a sentence. */
const VERDICT_REASON_MAX = 200;

/** Which surface a borderline pair belongs to: the link to an existing lead,
 * or the chip against a published story. */
export type DupCheckKind = "lead" | "printed";

/**
 * One borderline pair, as it was asked about and as the answer comes back.
 *
 * `key` is the desk's own identity for the pair (see `leadPairKey` /
 * `printedPairKey`) -- stable across the request, the reply and the filing
 * loop, and the reason a verdict can be applied to the row it is about and to
 * no other. `id` is the small 1-based number the model is given, because a
 * long opaque key in a JSON list is one more thing for a cheap model to
 * mistype.
 */
export type DupCheckPair = {
  key: string;
  id: number;
  /** Index of this candidate in the scan's own lead list (`ScanAiLead[]`). */
  candidate: number;
  kind: DupCheckKind;
  /** The candidate's headline and its one-line why. */
  headline: string;
  why: string;
  /** The other side: an existing lead's headline, or a published headline. */
  otherHeadline: string;
  otherWhy: string;
  /** A lead pair's target is that lead's headline; a printed pair's is its slug. */
  target: string;
};

/** What the model said about one pair. */
export type DupCheckVerdict = { same: boolean; why: string };

/** Everything the desk learned about one scan candidate's borderline pairs. */
export type CandidateDupCheck = {
  /** The verdict on the link to an existing lead, when the matcher found one. */
  lead?: { headline: string; verdict: DupCheckVerdict };
  /** The verdict on the "looks already printed" chip. */
  printed?: { slug: string; verdict: DupCheckVerdict };
};

/** The result of one scan's check, whether or not the model answered. */
export type DupCheckOutcome = {
  /** Keyed by candidate index. Empty when the check did not happen. */
  decisions: ReadonlyMap<number, CandidateDupCheck>;
  /** The model that answered, as the transport reported it, for the row's
   * record. Null when nothing answered. */
  model: string | null;
  /** One sentence for the log when the check did not run or came back
   * unusable; null on the ordinary path. */
  failure: string | null;
  /** How many pairs were actually put to the model. */
  asked: number;
  /** Pairs the word rule flagged that the cap left out -- they keep the rule. */
  skipped: number;
};

/**
 * The model call, as this module needs it: a system prompt, a user prompt, a
 * token ceiling, and text back. Deliberately narrower than `grokChat`, so the
 * caller binds the provider choice and the timeout ONCE (see the wiring in
 * desk.ts) and every test here can answer with a closure.
 */
export type DupCheckChat = (
  system: string,
  user: string,
  maxTokens: number,
) => Promise<{ ok: true; text: string; model?: string | null } | { ok: false; error: string }>;

/** A published story, as `nearDuplicate` reads it plus the dek the model is
 * shown. The dek is the published side's `why`: a headline alone does not say
 * what the story is, and "both say Boulder County and October" is exactly the
 * pair this check exists to settle. */
export type DupCheckPrinted = {
  slug: string;
  headline: string;
  dek?: string | null;
  topic?: string | null;
  published_at: string;
};

/** The desk's identity for "candidate N against the lead with this headline".
 * A lead's headline is what the matcher's own `possible` verdict was reached
 * on and what `fileScanLeads` has in hand at the moment it decides the link,
 * so the two sides cannot disagree about which pair a verdict belongs to. */
export function leadPairKey(candidate: number, targetHeadline: string): string {
  return `${candidate}|lead|${targetHeadline}`;
}

/** The same for "candidate N against the published story with this slug". */
export function printedPairKey(candidate: number, slug: string): string {
  return `${candidate}|printed|${slug}`;
}

/** One AI-returned candidate, as `collectDupPairs` reads it. */
export type DupCheckCandidate = {
  headline?: string;
  why?: string;
  topic?: string;
  source_urls?: string[];
};

/**
 * Build the borderline pairs for one scan.
 *
 * For every AI-returned candidate, in the order the scan returned them:
 *
 *   - against the leads already in the desk. `findMatchingLead` says whether
 *     the pair is a match at all and `matchStrength` splits the tier: a
 *     "strong" match is folded into the existing row or stamped and never
 *     becomes a link, so there is no chip to check. Only "possible" -- the tier
 *     `fileScanLeads` files as its own lead with `possible_duplicate_of` and
 *     the Queue draws as "Possible duplicate · compare" -- is borderline.
 *   - against the published stories, through the same `nearDuplicate` the
 *     chip itself uses. A lead with no such match has no chip, so there is
 *     nothing to ask about.
 *
 * A candidate can be both (a possible duplicate of one lead AND a chip
 * candidate against one article); both pairs are asked in the same call. Pairs
 * are taken in candidate order up to `DUP_CHECK_MAX_PAIRS`; everything after
 * that is counted in `skipped` and keeps the word rule.
 *
 * Deliberately NOT included: a candidate against another candidate filed by
 * the SAME scan run. `fileScanLeads` merges same-run pairs by
 * `sameStoryForMerge` before matching, and that decision happens inside the
 * commit -- after this runs, on a row that does not exist yet. Those pairs
 * keep today's rule, which is the honest thing to do with a pair this step
 * cannot see.
 */
export function collectDupPairs(input: {
  candidates: readonly DupCheckCandidate[];
  existing: readonly MatchCandidateLead[];
  printed: readonly DupCheckPrinted[];
  place?: NewsroomPlace | null;
}): { pairs: DupCheckPair[]; skipped: number } {
  const pairs: DupCheckPair[] = [];
  let skipped = 0;
  const take = (pair: Omit<DupCheckPair, "id">) => {
    if (pairs.length >= DUP_CHECK_MAX_PAIRS) {
      skipped += 1;
      return;
    }
    pairs.push({ ...pair, id: pairs.length + 1 });
  };
  /* `findMatchingLead` reads and never writes its candidate list, but its
   * parameter is a mutable array and a caller's `readonly` is not. Copied once
   * here rather than once per candidate, and the copy is the SAME rows -- the
   * pairs below are matched against exactly what the caller handed in. */
  const existing = [...input.existing];

  input.candidates.forEach((candidate, candidateIndex) => {
    const headline = String(candidate.headline ?? "").trim();
    if (!headline) return;
    const why = String(candidate.why ?? "").trim();
    const urls = candidate.source_urls ?? [];

    const matchId = findMatchingLead({ headline, source_urls: urls, topic: candidate.topic }, existing, input.place);
    if (matchId != null) {
      const matched = existing.find((lead) => lead.id === matchId);
      if (
        matched &&
        matchStrength(
          { headline, source_urls: urls, topic: candidate.topic },
          { headline: matched.headline, source_urls: matched.source_urls ?? [], topic: matched.topic },
          input.place,
        ) === "possible"
      ) {
        take({
          key: leadPairKey(candidateIndex, matched.headline),
          candidate: candidateIndex,
          kind: "lead",
          headline,
          why,
          otherHeadline: matched.headline,
          otherWhy: String(matched.why ?? "").trim(),
          target: matched.headline,
        });
      }
    }

    const printed = nearDuplicate(
      { headline, topic: candidate.topic },
      input.printed,
      input.place,
    );
    if (printed) {
      const row = input.printed.find((p) => p.slug === printed.slug);
      take({
        key: printedPairKey(candidateIndex, printed.slug),
        candidate: candidateIndex,
        kind: "printed",
        headline,
        why,
        otherHeadline: printed.headline,
        otherWhy: String(row?.dek ?? "").trim(),
        target: printed.slug,
      });
    }
  });

  return { pairs, skipped };
}

/**
 * The question, in the desk's own words.
 *
 * The instruction that matters is the one that keeps the answer useful: "same
 * news story" is not "same beat, same place, same meeting, same topic". A
 * checker that answers yes to two unrelated county stories because both are
 * county stories would re-create the owner's false chip instead of removing
 * it, and the bar the desk wants is the reader's -- would somebody who read
 * one have learned anything from the other.
 *
 * `why` is asked for as one short sentence naming the fact that decides it,
 * because the sentence is shown on the chip verbatim ("AI: same council vote,
 * same date."), not filed away.
 */
export const DUP_CHECK_SYSTEM = [
  "You are the copy desk's duplicate checker for a local news site.",
  "For each pair of news items, decide whether the two are the SAME news story.",
  "Same story means a reader who had read one would learn nothing new from the other.",
  "It is NOT enough that they share a topic, a place, a section, a meeting or a date:",
  "two different stories about one county, one council or one month are NOT the same story.",
  "Answer every pair you are given, in the order you are given them.",
  "For each pair write one short sentence naming the fact that decides it.",
  'Reply with JSON only, and nothing outside it: [{"id": <the id given>, "same": true or false, "why": "<one short sentence>"}]',
].join(" ");

/** The user half: the pairs, as a JSON list small enough for a cheap model to
 * answer in one reply. `id` is the desk's own numbering (the pair's 1-based
 * position), and it is the only handle the model is asked to echo. */
export function dupCheckPromptUser(pairs: readonly DupCheckPair[]): string {
  return JSON.stringify(
    pairs.map((pair) => ({
      id: pair.id,
      a: { headline: pair.headline, why: pair.why },
      b: { headline: pair.otherHeadline, why: pair.otherWhy },
    })),
  );
}

/** The first JSON array in a reply, or null. Written here rather than reusing
 * `parseJsonBlock` (./ai.ts) so this module stays loadable by a plain
 * `node --test` process without the provider registry behind it: the reply
 * shape is a list this module itself asked for, and a fence or a sentence of
 * preamble around it is the only thing to tolerate. */
function jsonArrayIn(text: string): unknown[] | null {
  const trimmed = text.trim();
  const attempts: string[] = [trimmed];
  const open = trimmed.indexOf("[");
  const close = trimmed.lastIndexOf("]");
  if (open >= 0 && close > open) attempts.push(trimmed.slice(open, close + 1));
  const brace = trimmed.indexOf("{");
  const braceClose = trimmed.lastIndexOf("}");
  if (brace >= 0 && braceClose > brace) attempts.push(trimmed.slice(brace, braceClose + 1));
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") {
        for (const key of ["pairs", "verdicts", "results", "answers"]) {
          const value = (parsed as Record<string, unknown>)[key];
          if (Array.isArray(value)) return value;
        }
      }
    } catch {
      // Try the next shape.
    }
  }
  return null;
}

/** A model's yes/no, in the shapes a cheap model actually writes it. Anything
 * else is not a verdict: an unreadable answer must not be read as "no", which
 * would silently drop a chip the word rule had earned. */
function readSame(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const word = value.trim().toLowerCase();
    if (["true", "yes", "y", "same", "1"].includes(word)) return true;
    if (["false", "no", "n", "different", "0"].includes(word)) return false;
  }
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  return null;
}

/** One clean line to show under a chip, or "". */
function readReason(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  // storableText first, for the reason every other model-written string in
  // this desk gets it (see storable-text.ts): a NUL in the sentence would
  // fail the whole INSERT that records it. Then folded to one line -- the
  // sentence is shown under a chip, so a model that answered with a
  // paragraph or a stray newline must not push the row apart.
  const line = storableText(raw).replace(/\s+/g, " ").trim();
  return line.slice(0, VERDICT_REASON_MAX);
}

/**
 * Read the model's reply into verdicts, keyed by pair.
 *
 * Tolerant on the wrapper and strict on the answer. The wrapper may be a bare
 * array, a fenced array, or an object with the array under a name; an entry
 * may name its pair by `id` or simply sit in the pair's position (the "a list
 * in, a list out" contract the prompt states); the yes/no may arrive as a
 * boolean or as the word.
 *
 * Two things are NOT tolerated, and both are about never answering a question
 * nobody asked. An entry with no readable yes/no is dropped rather than
 * guessed at -- reading a missing answer as "no" would silently clear a chip
 * the words had earned. And an entry that NAMES an id which is no pair that was
 * sent is dropped too, rather than falling back to its position in the array:
 * a model that numbered its answers wrongly is a model this module cannot
 * trust to have answered about the right pair, and applying its verdict to
 * whichever pair happened to sit at that index is exactly the kind of quiet
 * mismatch the `key` exists to prevent. The positional fallback is only for a
 * reply with NO ids at all.
 */
export function parseDupCheckReply(
  text: string,
  pairs: readonly DupCheckPair[],
): Map<string, DupCheckVerdict> {
  const out = new Map<string, DupCheckVerdict>();
  const entries = jsonArrayIn(text);
  if (!entries) return out;
  const byId = new Map<number, DupCheckPair>();
  for (const pair of pairs) byId.set(pair.id, pair);

  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const row = entry as Record<string, unknown>;
    const rawId = row.id ?? row.pair ?? row.pairId;
    const numericId =
      typeof rawId === "number"
        ? rawId
        : typeof rawId === "string" && /^\d+$/.test(rawId.trim())
          ? Number(rawId.trim())
          : null;
    const pair = numericId != null ? byId.get(numericId) : pairs[index];
    if (!pair) return;
    const same = readSame(row.same ?? row.match ?? row.duplicate);
    if (same == null) return;
    const why = readReason(row.why ?? row.reason ?? row.answer);
    // A yes with no sentence still decides the chip; the desk shows the plain
    // line rather than inventing a reason the model did not give.
    out.set(pair.key, { same, why: same ? why : why || "not the same story" });
  });

  return out;
}

/**
 * Ask the model about one scan's borderline pairs. Never throws.
 *
 * An empty pair list makes no call at all -- the ordinary case for a scan that
 * found nothing borderline, and the reason the cost of this feature is "one
 * call per scan that needs one" rather than "one call per scan".
 */
export async function runDupCheck(input: {
  pairs: readonly DupCheckPair[];
  /** Pairs the cap left out, carried through to the outcome (see
   * `collectDupPairs`). */
  skipped?: number;
  chat: DupCheckChat;
  /** Overrides `DUP_CHECK_MAX_PAIRS`; a seam for the tests, never a dial the
   * desk shows. */
  maxPairs?: number;
}): Promise<DupCheckOutcome> {
  const cap = input.maxPairs ?? DUP_CHECK_MAX_PAIRS;
  const pairs = input.pairs.slice(0, cap);
  const skipped = (input.skipped ?? 0) + Math.max(0, input.pairs.length - pairs.length);
  /* `asked` is how many pairs went into the prompt, whether or not the model
   * answered it -- a call that failed was still a call, and a receipt that
   * said "we asked nothing" would be the wrong story. `failure` is what says
   * the answer never came. */
  const asked = pairs.length;
  const empty = (failure: string | null, model: string | null = null): DupCheckOutcome => ({
    decisions: new Map(),
    model,
    failure,
    asked,
    skipped,
  });
  if (pairs.length === 0) return empty(null);

  let reply: Awaited<ReturnType<DupCheckChat>>;
  try {
    reply = await input.chat(DUP_CHECK_SYSTEM, dupCheckPromptUser(pairs), DUP_CHECK_MAX_TOKENS);
  } catch (error) {
    return empty(`duplicate check could not reach a model: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!reply.ok) return empty(`duplicate check failed: ${reply.error}`);

  const verdicts = parseDupCheckReply(reply.text, pairs);
  if (verdicts.size === 0) {
    return empty("duplicate check reply carried no verdict the desk could read");
  }

  const decisions = new Map<number, CandidateDupCheck>();
  for (const pair of pairs) {
    const verdict = verdicts.get(pair.key);
    if (!verdict) continue;
    const entry = decisions.get(pair.candidate) ?? {};
    if (pair.kind === "lead") entry.lead = { headline: pair.target, verdict };
    else entry.printed = { slug: pair.target, verdict };
    decisions.set(pair.candidate, entry);
  }
  return { decisions, model: reply.model ?? null, failure: null, asked, skipped };
}

