/**
 * Two rules that decide what a claim is allowed to be.
 *
 * Both were found by running the same real pack through Opus, Sonnet and Haiku
 * five times each. Neither is a model problem — every model did both — so
 * neither is fixed by choosing a different one.
 */

/**
 * Is this claim about the investigation rather than about the town?
 *
 * Every model, every batch, filed claims like:
 *
 *   OBSERVATION@1.0  "The literal outbound URL of submission 1oimdib remains
 *                     unmapped 20 hops after the HTML page rendered"
 *   OBSERVATION@0.95 "This hop directly invoked the WebFetch tool against two
 *                     distinct hosts"
 *   OBSERVATION@0.9  "SELF-INDICTING METHODOLOGICAL FINDING: twenty-five hops
 *                     searched for the record of a contract"
 *
 * That is the desk narrating its own progress and filing it as evidence. It is
 * a large share of every hop's claims, it crowds out real findings in the
 * brief, and none of it is a fact about Longmont.
 *
 * The frontier is where "we still have not checked X" belongs. A claim is for
 * what was found.
 */
const SELF_REFERENTIAL: RegExp[] = [
  /*
    A hop has to be COUNTED to be self-referential.

    The first version matched "hop" near any of a few common words, which ate
    "Hops are grown in the county" — a real claim about the town, deleted by a
    filter written to protect it. What makes it a note about the search is a
    number: "hop 6", "20 hops", "twenty-five hops".
  */
  /\bhops?\s*#?\d+\b/i,
  /\b\d+\s+hops?\b/i,
  /\b(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?\s+hops?\b/i,
  /\bthis (hop|run|pass|investigation|search)\b/i,
  /\b(remains?|stayed|is still|has never been|have never been|was never|were never)\s+(un)?(examined|mapped|recorded|profiled|fetched|checked|verified|queried|attempted|explored)\b/i,
  /\bnever (been )?(examined|mapped|recorded|profiled|fetched|checked|queried|attempted)\b/i,
  /\b(webfetch|web_fetch|web_search|the fetch tool|the search tool|zero-auth fetch|render(ing|ed)? pipeline)\b/i,
  /\bself[- ]indicting\b|\bmethodological finding\b/i,
  /\b(search|fetch|query|queue)d? (targets?|attempts?) (have been|were) (identified|queued)\b/i,
  /\bthe (investigation|desk|planner|loop|pipeline) (has|had|did) not\b/i,
  /\bunexamined\b|\bunmapped\b|\bunqueried\b/i,
  /*
    Tool-refusal / sandbox-escape narration (Dark Desk F1/F3).

    On its Claude leg the dig used to be handed a live-but-denied tool
    surface (Bash, WebSearch, WebFetch, MCP — see ai-claude-code.server.ts's
    `noTools`). Denied, the model would sometimes narrate the refusal
    straight into whatever field it was writing: "This command requires
    approval", "MCP tool schema blackout", "ToolSearch returned nothing",
    "pre-approval was denied for curl". None of that is a fact about
    Longmont. `--tools ""` (F1) stops it at the source; this is the net
    underneath in case a model still tries.

    These tokens are unambiguous on their own — none of them are civic
    reporting vocabulary, so they gate a claim by themselves.
  */
  /\btoolsearch\b/i,
  /\bwebsearch\b/i,
  /\btool schema\b/i,
  /\ballow-rule\b/i,
  /\bpre-approval\b/i,
  /\bsandbox[- ]?escape\b/i,
  /\bthis command requires approval\b/i,
  /*
    Everything below reads as ordinary English on its own — a council
    "approves" a budget, a "permit application" gets filed, someone throws a
    retirement "bash", a gas "pipeline" runs under a "sandbox" at the park,
    a resident is "denied" a variance, a report is "blocked" by a committee.
    None of those are tool-refusal narration, so none of the words below
    gate alone. They only gate in combination: a tool/CLI word from
    TOOL_WORD co-occurring with an actual refusal/gate word from
    REFUSAL_WORD in the SAME claim. See the false-positive tests in
    claim-hygiene.test.ts (council-approved-budget, permit-application,
    bash-of-the-pipeline, sandbox-at-the-park all survive; "Bash requires
    approval", "MCP permission denied", "curl blocked by sandbox policy" do
    not).
  */
];

const TOOL_WORD = /\b(bash|curl|mcp|sandbox(?:ed|ing)?|the cli|command[- ]line|tool (?:call|use|surface))\b/i;
const REFUSAL_WORD =
  /\b(requires? approval|permission (?:denied|required|needed)|approval (?:required|needed|denied)|not (?:permitted|allowed)|access denied|blackout|refused|blocked|denied)\b/i;

export function isSelfReferential(text: string): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  if (SELF_REFERENTIAL.some((re) => re.test(t))) return true;
  return TOOL_WORD.test(t) && REFUSAL_WORD.test(t);
}

/**
 * A FACT needs a receipt.
 *
 * FACT is the one label the confidence clamp cannot correct, because its
 * ceiling is 1.0. Across ten runs the models labelled 17–29% of claims FACT,
 * and a FACT with nothing pointing at a document is not a fact — it is an
 * inference wearing a better coat.
 *
 * Downgraded rather than dropped. The desk's own non-gating rule says weak
 * evidence keeps being investigated; it just may not be called established.
 */
export type ClaimCitation = {
  source_url?: string | null;
  artifact_version_id?: number | null;
  capture_event_id?: number | null;
};

export function hasCitation(c: ClaimCitation): boolean {
  return Boolean(
    (typeof c.source_url === "string" && /^https?:\/\//i.test(c.source_url.trim())) ||
      (typeof c.artifact_version_id === "number" && c.artifact_version_id > 0) ||
      (typeof c.capture_event_id === "number" && c.capture_event_id > 0),
  );
}

export function labelAfterCitationCheck(kind: string, c: ClaimCitation): string {
  const k = String(kind ?? "UNKNOWN").toUpperCase();
  if (k !== "FACT") return k;
  return hasCitation(c) ? "FACT" : "INFERENCE";
}

/** The prompt half. Code enforces it; this makes the model aim right. */
export const CLAIM_HYGIENE_RULES = `CLAIMS ARE ABOUT THE TOWN, NOT ABOUT THIS INVESTIGATION.
Do not file a claim about your own progress. "X remains unexamined after 20 hops", "this hop fetched two hosts", "the account has never been profiled" — none of those are findings, they are notes about the search. They belong in frontier or questions. A claim records what was FOUND.

A FACT REQUIRES A CITATION. Label a claim FACT only when you can point at the document: a source_url, an artifact_version_id, or a capture_event_id. Without one it is an INFERENCE, however sure you are. FACT is the only label whose confidence is not capped, so it is the one that has to be earned.`;
