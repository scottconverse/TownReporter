/**
 * The read-me-first block for an investigation.
 *
 * A dark desk file is four dense lists — what is on the record, what is being
 * tested, what is still open, what is known — and nothing that says which of
 * them matters. An editor opening a file has to read several hundred lines
 * before learning whether it was worth opening at all, and the one thing a
 * machine is genuinely better at here is exactly the thing missing: noticing
 * that the name in a claim is the name in a frontier item is the name on a
 * contract three artifacts away.
 *
 * So the brief has to do two jobs the lists cannot. Give a verdict — is this
 * worth an hour — and name the connections between the pieces.
 */

export type BriefVerdict = "promising" | "thin" | "dead" | "unknown";

export type InvestigationBrief = {
  /** One line. What this file is actually about, in the editor's language. */
  headline: string;
  /** Three or four sentences. The state of play. */
  tldr: string;
  /** Is it worth an hour, and why. */
  verdict: BriefVerdict;
  why_verdict: string;
  /**
   * What might really be going on. The point of the whole desk.
   *
   * Stated as a hypothesis, not a finding: the desk's job is to dig up the
   * hard-to-find thing, notice the connection nobody else made, and then help
   * work out whether there is actually something there. A brief that only
   * summarises the lists does the first two and abandons the third.
   */
  hypothesis: string;
  /** 0-1. How much the file actually supports it right now. */
  strength: number;
  /** The evidence and connections that point at it. */
  supports: string[];
  /** The ordinary explanation that would also fit. Always at least one. */
  benign: string;
  /** The single thing that would settle it either way. */
  kills_it: string;
  /** The single most promising next move. */
  next: string;
  /** Links the lists do not show: this name appears in that contract. */
  connections: string[];
  /** One line above each of the four dense sections. */
  sections: {
    record: string;
    tested: string;
    open: string;
    known: string;
  };
  generated_at: string;
};

export const VERDICTS: BriefVerdict[] = ["promising", "thin", "dead", "unknown"];

export function asVerdict(raw: unknown): BriefVerdict {
  const v = String(raw ?? "").trim().toLowerCase();
  return (VERDICTS as string[]).includes(v) ? (v as BriefVerdict) : "unknown";
}

export const VERDICT_COPY: Record<BriefVerdict, string> = {
  promising: "Worth your time",
  thin: "Thin — needs one more thread",
  dead: "Nothing here yet",
  unknown: "Not enough read yet to say",
};

const str = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const visiblyBoundedStr = (v: unknown, max: number) => {
  const value = String(v ?? "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  const marker = " … [truncated]";
  return `${value.slice(0, max - marker.length).trimEnd()}${marker}`;
};

const list = (v: unknown, max: number, each: number, preserveTail = false) =>
  Array.isArray(v)
    ? v
        .map((x) => (preserveTail ? visiblyBoundedStr(x, each) : str(x, each)))
        .filter(Boolean)
        .slice(0, max)
    : [];

/**
 * Parse whatever the model returned into a brief that will render.
 *
 * Never throws and never returns half an object: a summary panel that breaks
 * the page is worse than no summary panel, and this runs above four sections
 * an editor still needs to read.
 */
export function parseBrief(raw: unknown, now = new Date()): InvestigationBrief {
  const o = (raw ?? {}) as Record<string, unknown>;
  const s = (o.sections ?? {}) as Record<string, unknown>;
  return {
    headline: str(o.headline, 180),
    tldr: str(o.tldr, 900),
    verdict: asVerdict(o.verdict),
    why_verdict: str(o.why_verdict, 400),
    next: str(o.next, 300),
    connections: list(o.connections, 6, 2_000, true),
    hypothesis: str(o.hypothesis, 400),
    /*
      Clamped, and 0 when absent.

      An unscored hypothesis renders as a confident one, and the difference
      between "the evidence supports this" and "I find this interesting" is the
      whole value of the number.
    */
    strength: (() => {
      const n = Number(o.strength);
      return Number.isFinite(n) ? Math.min(1, Math.max(0, Number(n.toFixed(2)))) : 0;
    })(),
    supports: list(o.supports, 6, 2_000, true),
    benign: str(o.benign, 400),
    // This can be a multi-clause named-record instruction. Preserve normal
    // answers whole; if hostile/accidental output reaches the defensive 10k
    // boundary, tell the editor that the stored brief is incomplete.
    kills_it: visiblyBoundedStr(o.kills_it, 10_000),
    sections: {
      record: str(s.record, 220),
      tested: str(s.tested, 220),
      open: str(s.open, 220),
      known: str(s.known, 220),
    },
    generated_at: now.toISOString(),
  };
}

/** Did the model actually say anything, or is this an empty shell? */
export function briefIsUseful(b: InvestigationBrief | null | undefined): boolean {
  if (!b) return false;
  return Boolean(b.tldr.trim() || b.headline.trim());
}

export const BRIEF_SYSTEM = `TOWNREPORTER — DARK DESK HYPOTHESIS BRIEF.
YOU HAVE NO TOOLS IN THIS CALL. Do NOT attempt Bash, WebSearch, WebFetch, or any MCP tool — they will be refused and are not part of your job. This is a synthesis pass over the file already assembled below; you do not fetch or search anything yourself. Return ONLY the JSON described below.

You are writing the read-me-first block above an investigation file for ONE editor with limited time.

The file below is four dense lists. The editor can read them. What they cannot do quickly is see ACROSS them, and what they most need is an answer to: is there actually something here?

TABLES AND LISTS: A captured excerpt can contain adjacent records or split one record across locators. Attribute an applicant, owner, dollar figure, acreage, or other field only when the same record explicitly pairs that value with the subject. A name merely before or after the subject is not a connection. A continuation must repeat the subject or carry an unambiguous same-record label; otherwise say the attribute is unknown and name the record to check.

NUMERIC COMPARISONS: Before asserting ahead/behind, more/less, a rank, a difference, or a contradiction, compare the actual numeric values paired with each subject. Row order is not rank. Compare the same measure, period, and geographic scope; do not mix a subtotal with a combined total. Do not call sources contradictory when they agree. An alleged discrepancy needs the two incompatible source statements, not an inference from their layout. Check comparisons across every JSON field against the numbers in DOCUMENTS READ and against one another. If a comparison cannot be established, omit that comparison and state what remains unknown; do not invent an inconsistency to make a connection interesting.

Your job, in order:

1. CONNECTIONS. Name what the lists do not show on their own — the same person in two records, a company in both a claim and an open question, a date that lines up with another date, a name on a contract that is also a name in testimony. This is the most valuable thing you produce. If there are genuinely none, say "No connections established yet" rather than inventing one.

2. THE HYPOTHESIS. From those connections, state what might really be going on. One sentence, concrete, falsifiable. Not "there may be irregularities" — that is not a hypothesis, it is a shrug. "The same three LLCs share a registered agent and all three won bids in the same quarter" is a hypothesis. If the file cannot support any hypothesis yet, say so and set strength to 0.

3. STRENGTH, 0.0 to 1.0. How much this file ACTUALLY supports the hypothesis right now. Be hard about this. A hypothesis you find interesting and a hypothesis the evidence supports are different things, and conflating them is how a desk like this goes wrong.

4. THE BENIGN EXPLANATION. The ordinary, boring thing that would also produce exactly this evidence. Always give one. If you cannot think of a benign explanation, you have not understood the situation yet — say that.

5. WHAT WOULD KILL IT. The single document, record or search that would settle it either way. Specific: a named record from a named body, not "more research".

6. VERDICT: promising | thin | dead | unknown. Use unknown when decisive records have not been read, captures failed, or the supplied file cannot resolve the premise. Absence from the supplied file is not evidence of absence in the world. Use thin for a real but weak evidentiary thread and promising for a concrete supported connection worth following. Be willing to say dead when affirmative evidence contradicts the premise or resolves the suspected connection without a remaining evidentiary thread; explain that evidence. Do not turn a failed search or an unread record into a negative finding. Name the next missing record instead.

7. One line above each of the four sections, saying what is in it.

DO NOT:
- Repeat the lists back. A summary as long as what it summarises has failed.
- Upgrade the file's own labels. A HYPOTHESIS stays a hypothesis; an ALLEGATION stays an allegation.
- Assert that anyone did anything wrong. You are proposing what to check, never concluding.
- Use "delve", "landscape", "tapestry", "underscores", "raises questions".

Return ONLY JSON:
{
  "headline": "one line, what this file is about",
  "tldr": "3-4 sentences on the state of play",
  "connections": ["X appears in both A and B", "..."],
  "hypothesis": "one concrete falsifiable sentence, or 'Nothing supports a hypothesis yet'",
  "strength": 0.0,
  "supports": ["the evidence that points at it"],
  "benign": "the ordinary explanation that also fits",
  "kills_it": "the one record that settles it",
  "verdict": "promising|thin|dead|unknown",
  "why_verdict": "one or two sentences",
  "next": "the single best next document or search",
  "sections": {
    "record": "one line about what is on the record",
    "tested": "one line about the hypotheses",
    "open": "one line about the open questions",
    "known": "one line about the established facts"
  }
}`;

/**
 * The file, packed for the brief writer.
 *
 * Ordered with the strongest evidence first, because the model reads top-down
 * and the brief should be anchored in what is established rather than in the
 * longest list.
 */
export function briefPack(input: {
  title: string;
  facts: { body: string; evidence?: string }[];
  hypotheses: string[];
  questions: string[];
  findings: string[];
  entities: { name: string; kind: string }[];
  artifacts: { title: string; url: string; evidence?: string }[];
}): string {
  const cap = (a: string[], n: number) => a.filter(Boolean).slice(0, n);
  const marker = "\n[section budget reached]";
  const clip = (text: string, n: number) => {
    if (text.length <= n) return text;
    if (n <= marker.length) return text.slice(0, n);
    return `${text.slice(0, n - marker.length)}${marker}`;
  };
  const evidenceEntries: string[] = [];
  let evidenceUsed = 0;
  for (const artifact of cap(input.artifacts.map((a) => a.evidence || `- ${a.title} — ${a.url}`), 8)) {
    const separator = evidenceEntries.length ? 2 : 0;
    if (evidenceUsed + separator + artifact.length > 10_000) continue;
    evidenceEntries.push(artifact);
    evidenceUsed += separator + artifact.length;
  }
  // The shared evidence selector already fits entries to its own 10k budget.
  // Keep a selected entry whole here so a fact near its end is not silently
  // replaced by the beginning of the same capture.
  const evidence = evidenceEntries.join("\n\n") || "(none yet)";
  const sections = [
    `INVESTIGATION: ${clip(input.title, 600)}`,
    `DOCUMENTS READ:\n${evidence}`,
    `WHAT WE KNOW (facts and observations):\n${cap(input.facts.map((f) => `- ${clip(f.body, 600)}${f.evidence ? ` [${f.evidence.slice(0, 160)}]` : ""}`), 30).join("\n") || "(none yet)"}`,
    `BEING TESTED (hypotheses):\n${cap(input.hypotheses.map((h) => `- ${clip(h, 600)}`), 20).join("\n") || "(none yet)"}`,
    `ON THE RECORD (recorded signals):\n${cap(input.findings.map((f) => `- ${clip(f, 600)}`), 20).join("\n") || "(none yet)"}`,
    `STILL OPEN (questions):\n${cap(input.questions.map((q) => `- ${clip(q, 600)}`), 25).join("\n") || "(none yet)"}`,
    `NAMES AND THINGS SEEN:\n${cap(input.entities.map((e) => `- ${clip(e.name, 240)} (${clip(e.kind, 100)})`), 40).join("\n") || "(none yet)"}`,
  ];
  const budget = 22_000;
  let used = 0;
  const bounded: string[] = [];
  for (const section of sections) {
    const separator = bounded.length ? 2 : 0;
    const remaining = budget - used - separator;
    if (remaining <= 0) break;
    const clipped = clip(section, remaining);
    bounded.push(clipped);
    used += clipped.length + separator;
    if (clipped.length < section.length) break;
  }
  return bounded.join("\n\n");
}
