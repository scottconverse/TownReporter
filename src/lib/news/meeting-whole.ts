import type { ImpactScore } from "./meeting-impact.ts";

/**
 * The meeting shapes and the code-only checks the desk still reads.
 *
 * WHAT THIS MODULE IS NOW (Job 6, 2026-10-22). It used to be the whole-meeting
 * writer: read the tape in windows, account every item in a ledger, and write
 * the story from it. That writer is gone -- the meeting story is written by
 * Scott's report-local-news skill run as an agent (D200) -- but the ledger it
 * stored is still what the editor's panel reads, so its ROW SHAPES live here,
 * and so do the checks that are decided in code and still run on a draft:
 *
 *   - the predicate that says whether a lead gets the whole-meeting writer at
 *     all (`usesWholeMeetingWriter`), read by the desk and the story page;
 *   - the money, tally and quote checks the civic-reporting path runs against a
 *     draft (`checkDraftClaims` and the helpers it needs).
 *
 * Everything here is pure: no database, no network, no model.
 *
 * Rules carried from the v3 skill and enforced where they can be enforced in
 * code: captions are a map, not minutes; no quote without a check or a flag;
 * never infer a vote or an outcome ("no vote was recorded" is a valid answer);
 * plain verbs and no verdict words.
 */

export type MeetingSegment = {
  index: number;
  seconds: number;
  text: string;
  /** The agenda item this segment was aligned to, when the capture aligned it. */
  item: string;
  itemTitle: string;
};

export type PacketPage = { page: number; text: string };

export type LedgerStatus = "lead" | "roundup" | "excluded" | "unread";

/**
 * One raw line the inventory pass read out of a window. Every inventory entry
 * survives as evidence under its ledger item: the ledger groups the meeting
 * into agenda items and events for the reader, but nothing the run read is
 * thrown away doing so -- the panel can open a group and show every line it was
 * built from, and the writer is handed the same lines as its source.
 */
export type LedgerEvidence = {
  kind: string;
  text: string;
  who: string;
  startSeconds: number | null;
  packetPage: number | null;
  numbers: string;
  sourceExcerpt: string;
  /** The agenda id the inventory pass tagged this line with, when it gave one. */
  agenda?: string;
  /** Immutable civic-reporting action, including unresolved locators and procedural disposition. */
  reportingAction?: import("./civic-reporting.ts").CoverageAction;
};

/**
 * One vote on one ledger item. A single agenda item can hold several decisions
 * -- the Sept. 29 airport presentation holds three unanimous votes -- and each
 * one is a fact of its own, so they are a list rather than one result field.
 */
export type LedgerMotion = {
  /** The words the tape used for the outcome ("carries", "unanimous", "fails"). */
  result: string;
  /** The tally normalized to "N-N", or "" when the tape gave no count. */
  tally: string;
  /** "unanimous" when the tape said so, else "". */
  unanimous: string;
  /** When the result was spoken, so several can be told apart and ordered. */
  seconds: number | null;
  /**
   * "procedural" when the motion the tape was deciding was the meeting's own
   * procedure -- extending the meeting, adjourning, a recess, approving the
   * minutes -- rather than the item it sits under. The Sept. 29 tape's "carries
   * six to one" is a vote to EXTEND THE MEETING, spoken right after the fee
   * motion before it was withdrawn; the old code put that 6-1 on the budget
   * item. A procedural result is never counted for rank, never written as an
   * item's vote, and never triggers the "an item with a vote is reported" rule.
   */
  kind?: "decision" | "procedural";
};

export type LedgerItem = {
  itemNo: number;
  kind: string;
  text: string;
  startSeconds: number | null;
  /** The end of the item's span on the tape, when the item covers a range. */
  endSeconds?: number | null;
  /** Exact transcript segments selected by citations, without intervening tape. */
  evidenceSegmentIndexes?: number[];
  packetPage: number | null;
  status: LedgerStatus;
  reason: string;
  sourceExcerpt: string;
  /** Every raw inventory entry this ledger item groups. */
  evidence?: LedgerEvidence[];
  /**
   * Every result the tape recorded for this item, in the order they were said.
   * Empty when the tape recorded none -- which is a fact to state, not a gap to
   * fill. An item that holds one of these is never excluded by the writer's
   * own rule: the meeting decided it, so the story reports it.
   */
  motions?: LedgerMotion[];
  /**
   * The first recorded result, kept for the ledger panel and the stored row: a
   * convenience view of `motions[0]`, empty when there is none.
   */
  voteResult?: string;
  voteTally?: string;
  /**
   * Two to six plain words naming the item for a reader -- "Airport noise
   * rules", "Library business classes", "Jim Berthold". The old writer's status
   * pass supplied it; the raw agenda line ("2. ROLL CALL AND PLEDGE OF
   * ALLEGIANCE City Council Study Session, September 29,:") is a ledger heading,
   * not a label a roundup paragraph can open with.
   */
  label?: string;
  /**
   * The editor's own measure of this item's news value: civic-scanner's four
   * dimensions (immediacy, local impact, conflict, novelty), each 1-5, 4-20
   * total, with a reason beside each number. This is what ranks the lead -- the
   * votes an item holds, the dollars it names and the minutes it ran do not.
   * Absent (or unreadable) means the item is UNRANKED: it is still in the
   * ledger and still reported, but it sorts after every scored item and is
   * shown as "not scored" rather than as a low-scoring one.
   */
  impact?: ImpactScore;
};

export type ClaimCheck = {
  claim: string;
  sourceKind: "primary" | "secondary";
  sourceRef: string;
  checkStatus: "found" | "flagged";
  note: string;
};

export type RunStats = {
  wallMs: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  /*
    The skill writer's own facts (MS-WIRE W1). The retired whole-meeting writer
    counted model calls and tokens; the skill is one agent run, so what an
    editor can actually check is which instructions and which model wrote the
    story, and where the run's files are.
  */
  writer?: string;
  skillVersion?: string;
  /** The model the run actually used. */
  model?: string;
  /** The picker choice, when the run used a different model than the editor picked. */
  requestedModel?: string;
  workDir?: string;
  /**
   * What the agent did, by tool name and count (TXB-2): `{ Bash: 12 }`. Names
   * and counts only -- never an input or a result.
   */
  toolExecutions?: Record<string, number>;
};

export const COLD_LEAD_CHARS = 40_000;
export const NO_VOTE_SENTENCE =
  /\b(?:no\s+vote\b|vote\s+was\s+not\s+recorded|no\s+outcome\s+was\s+recorded|records?\s+no\s+vote)\b/i;

export function clockFromSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9$%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Currency formatting only, within an already bound documentary section.
 * Budget table rows carry the first dollar sign through the numeric columns.
 * Bare comma-grouped prose counts are deliberately left alone.
 */
export function documentMoneyText(text: string): string {
  return text.split(/\r?\n/).map((line) => {
    const tableRow = /^\s*\$?\s*\d/.test(line) && /(?:Revenues|Expenses|Use of Fund Balance)\s*$/i.test(line);
    const marked = tableRow
      ? line.replace(/(?<![\d,])(?:\$\s*)?\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?)(?![\d,])/g, "$$$1")
      : line;
    return marked.replace(/\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/g, (_whole, amount: string) =>
      "$" + Number(amount.replaceAll(",", "")).toFixed(2));
  }).join("\n");
}

const DOLLAR = /\$\s?\d[\d,]*(?:\.\d+)?/g;
const PERCENT = /\d+(?:\.\d+)?\s?%/g;
const DATE =
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},\s*\d{4}\b/gi;
const QUOTED = /"([^"]{3,})"/g;

function normalizedMoneyAmount(value: string): string {
  const amount = value.replace(/[$,\s]/g, "");
  return amount.includes(".") ? amount.replace(/0+$/, "").replace(/\.$/, "") : amount;
}

function sourceContainsMoneyAmount(source: string, claimAmount: string): boolean {
  const wanted = normalizedMoneyAmount(claimAmount);
  const candidates = /\$\s*(\d[\d,]*(?:\.\d+)?)|\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?)\b|\b(\d+\.\d+)\b/g;
  const financialContext = /\b(?:allocat\w*|budget\w*|fund(?:s|ing)|costs?|dollars?|revenue|expense\w*|appropriat\w*|tax(?:es)?|payment|spend(?:ing)?|grant|balance|amount)\b/i;
  return [...source.matchAll(candidates)].some((match) => {
    const amount = match[1] ?? match[2] ?? match[3] ?? "";
    if (normalizedMoneyAmount(amount) !== wanted) return false;
    if (match[1]) return true;
    const start = source.lastIndexOf("\n", match.index) + 1;
    const lineEnd = source.indexOf("\n", match.index + match[0].length);
    const context = source.slice(start, lineEnd < 0 ? source.length : lineEnd);
    return financialContext.test(context);
  });
}

/** A tally the draft states as a figure: "5 to 2", "5-2", "6–1". */
const TALLY_FIGURE = /\b\d{1,2}\s*(?:to|-|–|—)\s*\d{1,2}\b/gi;
/** The verbs that make a nearby tally a vote rather than a measurement. */
const VOTE_VERB =
  /\b(?:carries|carried|passes|passed|fails|failed|votes?|voted|voting|motion|motions|unanimous(?:ly)?|approved|approves)\b/i;
/** Any four-digit year, the thing a range like "2027-2031" really is. */
const YEAR = /\b(?:19|20)\d{2}\b/;

/**
 * The vote words the draft actually states, in code.
 *
 * A tally is only a vote word when the sentence around it is about a vote: run
 * 4 flagged "20 to 60" (students trained at once), "10 to 2" (hours at a
 * fairgrounds) and "2027-2031" (the years of a capital plan) as votes the
 * record does not hold, and every one of them was a false alarm -- the numbers
 * were true and the writer was not reporting a vote. So a tally counts only
 * with a vote verb within eight words before it or four after, and never when a
 * year sits beside it, because "2027-2031" is a span, not a tally.
 * "unanimously" has no other meaning in a meeting story and always counts.
 */
export function voteWordsIn(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(TALLY_FIGURE)) {
    const at = match.index ?? 0;
    // A vote verb on the other side of a period or a semicolon is another
    // sentence's verb: "from 10 to 2; no vote was recorded" is not a vote on
    // the 10 to 2.
    const sentenceBefore = body.slice(0, at).split(/[.;:!?\n]/).pop() ?? "";
    const sentenceAfter = body.slice(at + match[0].length).split(/[.;:!?\n]/)[0] ?? "";
    const before = sentenceBefore.split(/\s+/).filter(Boolean).slice(-8).join(" ");
    const after = sentenceAfter.split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
    const window = `${before} ${after}`;
    // "no vote was recorded" carries the word "vote" without reporting one, so a
    // tally beside it is a figure in a sentence about the absence of a vote.
    if (NO_VOTE_SENTENCE.test(window)) continue;
    if (!VOTE_VERB.test(window)) continue;
    if (YEAR.test(sentenceBefore) || YEAR.test(sentenceAfter)) continue;
    found.push(match[0]);
  }
  for (const match of body.match(/\bunanimous(?:ly)?\b/gi) ?? []) found.push(match);
  return found;
}

export type ClaimUnit = { text: string; label: string; item: LedgerItem | null };

/** The item's own words: its tagged evidence, its excerpt, its clock and page. */
function itemOwnRecord(item: LedgerItem): { text: string; locator: string } {
  const evidence = item.evidence ?? [];
  const text = [
    item.text,
    item.sourceExcerpt,
    ...evidence.map((entry) => entry.text),
    ...evidence.map((entry) => entry.numbers),
    ...evidence.map((entry) => entry.sourceExcerpt),
  ]
    .filter(Boolean)
    .join("\n");
  const where = item.startSeconds !== null ? clockFromSeconds(item.startSeconds) : "no timestamp";
  const page = item.packetPage !== null ? `, packet p${item.packetPage}` : "";
  return { text, locator: `${where}${page}` };
}

/**
 * Check each written paragraph's claims against the item it was written from.
 *
 * The old check merged the whole transcript and the whole packet into one
 * string and looked for the token anywhere in it, so a dollar figure belonging
 * to another action -- or a procedural tally spoken under a later item -- could
 * "support" a claim about a different item. That is the defect this replaces: a
 * claim is checked against ITS item's own record, and a token found elsewhere in
 * the meeting is not a match, however identical.
 *
 * A figure or date is bound to the item's own evidence, its source excerpt and
 * the item's own span of tape -- never the whole tape or the whole packet. A
 * vote word is bound to the item's own motions and only the NON-procedural ones:
 * a tally that decided the meeting's procedure ("extend the meeting") is not the
 * item's vote, and a bare number in the text proves nothing. A quotation is bound
 * to the item's own packet page; a quote matched only against the auto-captioned
 * tape is flagged, because that caption is not a verified recording.
 *
 * "found" means the item's own record holds the text: a text match, not a
 * substantive confirmation, and the note says so. When the binding is unresolved
 * -- the paragraph has no item, or the claim is absent from that item's record --
 * the claim is flagged, never certified from a match elsewhere.
 */
export function checkDraftClaims(input: {
  /** The written paragraphs, each with the item it was written from. */
  units: ClaimUnit[];
  /** The packet pages, for the item-bound packet lookup. */
  packetPages?: PacketPage[];
  /** The tape segments, for the item's own span. */
  segments?: MeetingSegment[];
}): ClaimCheck[] {
  const packetPages = input.packetPages ?? [];
  const segments = input.segments ?? [];
  const checks: ClaimCheck[] = [];
  const push = (claim: string, sourceRef: string, found: boolean, note: string) => {
    if (!claim.trim()) return;
    checks.push({
      claim: claim.slice(0, 300),
      sourceKind: "primary",
      sourceRef,
      checkStatus: found ? "found" : "flagged",
      note,
    });
  };
  for (const unit of input.units) {
    const item = unit.item;
    const label = unit.label || (item ? item.text : "an unbound paragraph");
    if (!item) {
      // No item to bind to: the paragraph's facts have no owner to check them
      // against, and a token found elsewhere in the meeting would not prove
      // them. Flag each for the editor rather than certifying it.
      for (const match of unit.text.match(DOLLAR) ?? []) {
        push(match, "unbound", false, "No item-bound source: the paragraph could not be tied to a ledger item.");
      }
      for (const match of (unit.text.match(PERCENT) ?? []).filter((value) => value.trim() !== "%")) {
        push(match, "unbound", false, "No item-bound source: the paragraph could not be tied to a ledger item.");
      }
      for (const match of unit.text.match(DATE) ?? []) {
        push(match, "unbound", false, "No item-bound source: the paragraph could not be tied to a ledger item.");
      }
      for (const match of voteWordsIn(unit.text)) {
        push(match, "unbound", false, "No item-bound source: the paragraph could not be tied to a ledger item.");
      }
      for (const match of unit.text.matchAll(QUOTED)) {
        push(match[1] ?? "", "unbound", false, "No item-bound source: the paragraph could not be tied to a ledger item.");
      }
      continue;
    }
    const own = itemOwnRecord(item);
    // The item's own span of tape is part of its record -- but only ITS span.
    // The whole tape is where the wrong-item match lived, so it is never used.
    const ownTape = spanTape(item, segments, COLD_LEAD_CHARS);
    const figureRecord = item.kind === "document-source"
      ? documentMoneyText(`${own.text}\n${ownTape}`)
      : `${own.text}\n${ownTape}`;
    const figureSource = normalizeForMatch(figureRecord);
    const locator = own.locator;
    const page = item.packetPage;
    const packetPageText = page === null
      ? item.kind === "document-source" ? item.sourceExcerpt.split(/\r?\n/).filter((line) => !line.startsWith("Document title: ")).join("\n") : ""
      : packetPages.filter((entry) => entry.page === page).map((entry) => entry.text).join("\n");
    // Vote words: the item's own recorded motions, procedural ones excluded. A
    // procedural tally is the meeting running itself, not the item's vote.
    const motions = (item.motions ?? []).filter((motion) => motion.kind !== "procedural");
    const motionWords = motions
      .flatMap((motion) => [
        motion.tally,
        motion.tally ? motion.tally.replace("-", " to ") : "",
        motion.unanimous,
        motion.unanimous ? `${motion.unanimous}ly` : "",
        motion.result,
      ])
      .filter(Boolean);
    const voteSource = normalizeForMatch([
      ...motionWords,
      ...(item.kind === "reporting" ? [own.text, ownTape] : []),
    ].join(" "));
    const proceduralWords = normalizeForMatch(
      (item.motions ?? [])
        .filter((motion) => motion.kind === "procedural")
        .flatMap((motion) => [
          motion.tally,
          motion.tally ? motion.tally.replace("-", " to ") : "",
          motion.unanimous,
          motion.unanimous ? `${motion.unanimous}ly` : "",
          motion.result,
        ])
        .filter(Boolean)
        .join(" "),
    );
    for (const match of unit.text.match(DOLLAR) ?? []) {
      const found = figureSource.includes(normalizeForMatch(item.kind === "document-source" ? documentMoneyText(match) : match)) ||
        sourceContainsMoneyAmount(figureRecord, match);
      push(
        match,
        `${label} (${locator})`,
        found,
        found
          ? `Dollar figure appears in this item's own record (${locator}); this is a text match, not a substantive confirmation.`
          : "Dollar figure is not in this item's own record; a figure stated for another action does not support it.",
      );
    }
    for (const match of (unit.text.match(PERCENT) ?? []).filter((value) => value.trim() !== "%")) {
      const found = figureSource.includes(normalizeForMatch(match));
      push(
        match,
        `${label} (${locator})`,
        found,
        found
          ? `Percent appears in this item's own record (${locator}); this is a text match, not a substantive confirmation.`
          : "Percent is not in this item's own record; a figure stated for another action does not support it.",
      );
    }
    for (const match of unit.text.match(DATE) ?? []) {
      const found = figureSource.includes(normalizeForMatch(match));
      push(
        match,
        `${label} (${locator})`,
        found,
        found ? `Date appears in this item's own record (${locator}).` : "Date is not in this item's own record.",
      );
    }
    for (const match of voteWordsIn(unit.text)) {
      const found = voteSource.includes(normalizeForMatch(match));
      const onlyProcedural = !found && proceduralWords.includes(normalizeForMatch(match));
      push(
        match,
        found ? `${label}, recorded result` : label,
        found,
        found
          ? `Vote word matches this item's own recorded result (${label}); not inferred from a bare number.`
          : onlyProcedural
            ? "The only tally under this item is the meeting's own procedure; it does not verify this item's vote. Do not infer a vote or outcome."
            : "Vote word not found in this item's record; do not infer a vote or outcome.",
      );
    }
    for (const match of unit.text.matchAll(QUOTED)) {
      const quote = match[1] ?? "";
      const inPacketPage = packetPageText
        ? normalizeForMatch(packetPageText).includes(normalizeForMatch(quote))
        : false;
      const inRetainedTranscript = item.kind === "reporting" &&
        normalizeForMatch(`${own.text}\n${ownTape}`).includes(normalizeForMatch(quote));
      const found = inPacketPage || inRetainedTranscript;
      push(
        quote,
        inPacketPage
          ? page === null ? `${label} (cited document section)` : `${label} (packet p${page})`
          : inRetainedTranscript ? `${label} (retained transcript)` : `${label} (unverified)`,
        found,
        found
          ? page === null ? "Quotation matched this claim's cited document section." : `Quotation matched this item's own packet page (p${page}).`
          : "Quotation unverified: not in this item's packet page. A match against the auto-captioned tape alone is not a verified recording; check the recording, the approved minutes, or attribute the words to the packet.",
      );
    }
  }
  return checks;
}
function spanTape(item: LedgerItem | null, segments: MeetingSegment[], cap: number): string {
  const start = item?.startSeconds ?? null;
  const end = item?.endSeconds ?? null;
  const evidenceIndexes = item?.evidenceSegmentIndexes === undefined ? null : new Set(item.evidenceSegmentIndexes);
  let used = 0;
  const lines: string[] = [];
  for (const segment of segments) {
    if (evidenceIndexes && !evidenceIndexes.has(segment.index)) continue;
    if (start !== null && segment.seconds < start) continue;
    if (end !== null && segment.seconds > end) break;
    const line = `[${clock(segment.seconds)}] ${segment.text}`;
    if (used + line.length > cap) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

export function editorNamesOneAgendaItem(assignment: string | null | undefined): boolean {
  const text = (assignment ?? "").trim();
  if (!text) return false;
  return (
    /\b(?:ordinance|resolution)\s+\d{4}\s*[-–—]\s*\d{1,3}\b/i.test(text) ||
    /\bitem\s+\d+[a-z0-9]*\b/i.test(text)
  );
}

/**
 * The wiring predicate. A transcript-story lead uses the whole-meeting writer
 * unless the editor's notes name one agenda item (then the old one-item path).
 */
export function usesWholeMeetingWriter(input: {
  hasMeetingMaterial: boolean;
  editorialAssignment?: string | null;
}): boolean {
  return input.hasMeetingMaterial && !editorNamesOneAgendaItem(input.editorialAssignment);
}

function clock(seconds: number): string {
  return clockFromSeconds(seconds);
}
