/**
 * What the dark desk is looking for, named.
 *
 * The five original postures cover the shape of an investigation — absence,
 * repetition, money, coordination, connection. What they do not cover is the
 * shape of *municipal* concealment, which has its own vocabulary: a board that
 * quietly stops meeting, a utility easement at a city edge that precedes an
 * annexation nobody has proposed, a pilot that was never going to end.
 *
 * These types come from the operator's own signal-desk specs. They are a
 * checklist for attention, never a closed set — a signal may carry several, or
 * a name that is not here.
 *
 * The nerve gates are low on purpose. An earlier version locked the sharpest
 * lenses — manufactured chorus, pre-agenda lock-in — behind nerve 6, which
 * confused a lens with an accusation. Looking for astroturf is not alleging it;
 * RULE 1 and RULE 3 are what stop the desk asserting it, and they never move.
 */
export type SignalType = {
  id: string;
  name: string;
  /** What it looks like in the wild. */
  looksLike: string;
  /** The nerve at which this type is worth actively hunting. */
  minNerve: number;
};

export const SIGNAL_TYPES: SignalType[] = [
  {
    id: "whisper",
    name: "Whisper",
    looksLike:
      "The same complaint from unconnected people in a short window. Individually trivial, together a pattern.",
    minNerve: 1,
  },
  {
    id: "administrative-retrenchment",
    name: "Administrative retrenchment",
    looksLike:
      "Meetings shorten or are cancelled. Boards consolidate. Agendas thin. Staff reports stop naming who prepared them.",
    minNerve: 1,
  },
  {
    id: "boundary-prep",
    name: "Annexation and boundary prep",
    looksLike:
      "Zoning alignment, utility easements, or service agreements at a city edge, before anyone has proposed annexing anything.",
    minNerve: 1,
  },
  {
    id: "shadow-infrastructure",
    name: "Shadow infrastructure",
    looksLike:
      "Crews, trenching, staging yards or equipment where no permit, notice or project page explains them.",
    minNerve: 1,
  },
  {
    id: "fiscal-stress",
    name: "Fiscal stress",
    looksLike:
      "Reserve draws, emergency procurement, re-baselined revenue, fees introduced where a tax would need a vote.",
    minNerve: 1,
  },
  {
    id: "governance-drift",
    name: "Governance drift",
    looksLike:
      "Rule changes, quorum or board-size shifts, public comment moved, shortened or restricted. Process changes that outlast the reason given.",
    minNerve: 1,
  },
  {
    id: "regulatory-void",
    name: "Regulatory void",
    looksLike:
      "A state pre-emption or a lapsed rule leaves nobody in charge, and the local response is silence.",
    minNerve: 1,
  },
  {
    id: "service-degradation",
    name: "Service degradation",
    looksLike:
      "Failures that are individually mundane and collectively systemic: response times, outages, potholes, missed collections.",
    minNerve: 1,
  },
  {
    id: "land-use-stealth",
    name: "Land use stealth",
    looksLike:
      "Minor site plan amendments, administrative variances, 1041 reviews — the routes that avoid a hearing.",
    minNerve: 1,
  },
  {
    id: "spillover",
    name: "Cross-jurisdictional spillover",
    looksLike:
      "A decision in Erie, Firestone, Mead or a county that lands on Longmont residents without Longmont being a party to it.",
    minNerve: 1,
  },
  {
    id: "delayed-record",
    name: "Delayed or suppressed record",
    looksLike:
      "The action happened; the document did not follow. Minutes, packets, awards or reports posted late, thinly, or not at all.",
    minNerve: 1,
  },
  {
    id: "third-party-execution",
    name: "Third-party execution",
    looksLike:
      "Public power exercised through a vendor, contractor or authority, where the accountable body never voted on the thing being done.",
    minNerve: 1,
  },
  {
    id: "vendor-momentum",
    name: "Vendor-driven momentum",
    looksLike:
      "A supplier's roadmap becomes the city's plan. Pilots that presume renewal. Specifications that only one bidder meets.",
    minNerve: 1,
  },
  {
    id: "pre-agenda-lock-in",
    name: "Pre-agenda lock-in",
    looksLike:
      "By the time it reaches an agenda the decision is already made — the vote ratifies work that is visibly complete.",
    minNerve: 3,
  },
  {
    id: "silence-anomaly",
    name: "Silence anomaly",
    looksLike:
      "A body, beat or topic that was regular goes quiet. Anchored to what the cadence used to be, not to a feeling.",
    minNerve: 1,
  },
  {
    id: "astroturf",
    name: "Manufactured chorus",
    looksLike:
      "Testimony or comment that rhymes too closely: shared phrasing, synchronised arrival, undisclosed sponsorship. Organisation alone is not this.",
    minNerve: 3,
  },
];

export function signalTypesFor(nerve: number): SignalType[] {
  return SIGNAL_TYPES.filter((t) => t.minNerve <= nerve);
}

/**
 * Routine language as camouflage.
 *
 * Not a claim that these words are lies — most of the time they are exactly
 * what they say. The instruction is to read the word and then go and check what
 * happened on the ground, because the euphemism is where a service cut goes to
 * be uninteresting.
 */
export const EUPHEMISMS: { phrase: string; check: string }[] = [
  { phrase: "code modernization", check: "which rules changed, and who is affected differently now" },
  { phrase: "cleanup", check: "what was removed, and whether anyone lost a service" },
  { phrase: "pilot", check: "whether it has an end date, and what happens if nobody stops it" },
  { phrase: "efficiency", check: "which positions, hours or services no longer exist" },
  { phrase: "realignment", check: "who reports to whom now, and what stopped being reported" },
  { phrase: "streamlining", check: "which review step was removed, and what it used to catch" },
  { phrase: "housekeeping", check: "the substance of the item beneath the label" },
  { phrase: "administrative approval", check: "what would have needed a hearing under the old route" },
  { phrase: "consent agenda", check: "what was moved onto it, and when it was moved" },
  { phrase: "sunset", check: "whether the thing actually ends or is quietly renewed" },
  { phrase: "temporary", check: "how many times it has been extended" },
  { phrase: "right-sizing", check: "the headcount and the service level before and after" },
];

/**
 * What "silence" has to be measured against before it counts.
 *
 * A body being quiet is only a signal if it was previously loud on a known
 * rhythm. Without the expected cadence, "they have gone quiet" is a feeling.
 */
export const CADENCE_ANCHORS = [
  "Council: agendas posted before each regular session; minutes approved at the following one.",
  "Boards and commissions: a published meeting calendar, and packets before each meeting.",
  "Procurement: solicitations posted, then awards; an award with no solicitation is the anomaly.",
  "Budget: quarterly financial reports and an annual audit, on a stated schedule.",
  "Planning: applications, referrals, staff reports and hearing notices, in that order.",
  "Utilities: rate studies before rate changes; outage and water-quality notices as required.",
];

/** The taxonomy as a prompt block, filtered to the nerve in force. */
export function taxonomyPrompt(nerve: number): string {
  const types = signalTypesFor(nerve);
  const lines = types.map((t) => `- ${t.name}: ${t.looksLike}`).join("\n");
  const euph = EUPHEMISMS.map((e) => `- "${e.phrase}" → check ${e.check}`).join("\n");
  return `SIGNAL TYPES IN FORCE (open set — combine them, or name a new one)
${lines}

ROUTINE IS A CLOAK
Ordinary administrative language is where an uninteresting-sounding change goes to avoid attention. Record the phrase, then go and check the effect on the ground:
${euph}

SILENCE MUST BE ANCHORED
Absence only counts against a cadence that existed. Name the expected rhythm before calling something quiet:
${CADENCE_ANCHORS.map((c) => `- ${c}`).join("\n")}
If you cannot state the cadence, say so and treat the silence as a question, not a finding.`;
}
