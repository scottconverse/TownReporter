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

const list = (v: unknown, max: number, each: number) =>
  Array.isArray(v)
    ? v.map((x) => str(x, each)).filter(Boolean).slice(0, max)
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
    connections: list(o.connections, 6, 240),
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
    supports: list(o.supports, 6, 240),
    benign: str(o.benign, 400),
    kills_it: str(o.kills_it, 300),
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
You are writing the read-me-first block above an investigation file for ONE editor with limited time.

The file below is four dense lists. The editor can read them. What they cannot do quickly is see ACROSS them, and what they most need is an answer to: is there actually something here?

Your job, in order:

1. CONNECTIONS. Name what the lists do not show on their own — the same person in two records, a company in both a claim and an open question, a date that lines up with another date, a name on a contract that is also a name in testimony. This is the most valuable thing you produce. If there are genuinely none, say "No connections established yet" rather than inventing one.

2. THE HYPOTHESIS. From those connections, state what might really be going on. One sentence, concrete, falsifiable. Not "there may be irregularities" — that is not a hypothesis, it is a shrug. "The same three LLCs share a registered agent and all three won bids in the same quarter" is a hypothesis. If the file cannot support any hypothesis yet, say so and set strength to 0.

3. STRENGTH, 0.0 to 1.0. How much this file ACTUALLY supports the hypothesis right now. Be hard about this. A hypothesis you find interesting and a hypothesis the evidence supports are different things, and conflating them is how a desk like this goes wrong.

4. THE BENIGN EXPLANATION. The ordinary, boring thing that would also produce exactly this evidence. Always give one. If you cannot think of a benign explanation, you have not understood the situation yet — say that.

5. WHAT WOULD KILL IT. The single document, record or search that would settle it either way. Specific: a named record from a named body, not "more research".

6. VERDICT: promising | thin | dead | unknown. Be willing to say dead. An editor's hour is the scarcest thing here, and a false "promising" costs more than a false "dead".

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
  artifacts: { title: string; url: string }[];
}): string {
  const cap = (a: string[], n: number) => a.filter(Boolean).slice(0, n);
  return [
    `INVESTIGATION: ${input.title}`,
    `WHAT WE KNOW (facts and observations):\n${cap(input.facts.map((f) => `- ${f.body}${f.evidence ? ` [${f.evidence.slice(0, 160)}]` : ""}`), 30).join("\n") || "(none yet)"}`,
    `BEING TESTED (hypotheses):\n${cap(input.hypotheses.map((h) => `- ${h}`), 20).join("\n") || "(none yet)"}`,
    `ON THE RECORD (recorded signals):\n${cap(input.findings.map((f) => `- ${f}`), 20).join("\n") || "(none yet)"}`,
    `STILL OPEN (questions):\n${cap(input.questions.map((q) => `- ${q}`), 25).join("\n") || "(none yet)"}`,
    `NAMES AND THINGS SEEN:\n${cap(input.entities.map((e) => `- ${e.name} (${e.kind})`), 40).join("\n") || "(none yet)"}`,
    `DOCUMENTS READ:\n${cap(input.artifacts.map((a) => `- ${a.title} — ${a.url}`), 30).join("\n") || "(none yet)"}`,
  ].join("\n\n");
}
