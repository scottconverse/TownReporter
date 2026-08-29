/**
 * How hard the dark desk digs, and how far it is willing to lean.
 *
 * The desk already knew how to investigate; what it had no way to express was
 * *how much*. It ran exactly one hop per press, at one fixed level of nerve, in
 * one city — so the same machinery that could chase an LLC through a parcel
 * record into an adjacent county behaved identically to one that reads a page
 * and stops.
 *
 * Two dials, because they are genuinely independent. A desk can chase a trail
 * for twelve hops and still refuse to say anything it cannot document; another
 * can leap to a theory from one anecdote and never leave the first page. Depth
 * and nerve are different questions and deserve different controls.
 *
 * Pure on purpose. Everything here is a decision about what a number means, and
 * that is exactly the kind of thing that is easy to get quietly wrong.
 */

export type DarkScope = "city" | "county" | "region" | "adjacent";

export type DarkDials = {
  /** 1–10. How far it chases: hops, searches, fetches, how far off the list. */
  dig: number;
  /** 1–10. How far it leans: what may be filed, and in what language. */
  nerve: number;
  /** How wide the map is. Independent of depth. */
  scope: DarkScope;
};

export const DEFAULT_DIALS: DarkDials = { dig: 4, nerve: 5, scope: "city" };

/** Keeps a hand-edited or stale stored value from producing nonsense. */
export function clampDials(raw: Partial<DarkDials> | null | undefined): DarkDials {
  const n = (v: unknown, fallback: number) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) ? Math.min(10, Math.max(1, x)) : fallback;
  };
  const scopes: DarkScope[] = ["city", "county", "region", "adjacent"];
  const scope = scopes.includes(raw?.scope as DarkScope)
    ? (raw!.scope as DarkScope)
    : DEFAULT_DIALS.scope;
  return {
    dig: n(raw?.dig, DEFAULT_DIALS.dig),
    nerve: n(raw?.nerve, DEFAULT_DIALS.nerve),
    scope,
  };
}

export type DarkBudget = {
  hops: number;
  searchesPerHop: number;
  fetchesPerHop: number;
  /** May it fetch a public URL that is not on the watch list? */
  followOffWatchlist: boolean;
  /** May it go to archives and caches for a page that changed or vanished? */
  useArchives: boolean;
  /** How many entity hops: person → company → agent → parcel → contract. */
  entityHops: number;
};

/**
 * Depth, as concrete numbers.
 *
 * Deliberately not linear at the top. Going from 9 to 10 doubles the hops
 * because the last notch is the one an editor reaches for when a trail is
 * genuinely live and they want it followed to the end — the difference between
 * "dig properly" and "do not come back until it is dry".
 */
export function budgetFor(dials: DarkDials): DarkBudget {
  const d = clampDials(dials).dig;
  const hops = [1, 2, 3, 5, 7, 9, 12, 16, 20, 25][d - 1]!;
  return {
    hops,
    searchesPerHop: Math.min(20, 3 + Math.ceil(d * 1.6)),
    fetchesPerHop: Math.min(16, 2 + Math.ceil(d * 1.3)),
    followOffWatchlist: d >= 2,
    useArchives: d >= 3,
    entityHops: Math.max(1, Math.ceil(d / 2)),
  };
}

export type DarkStance = {
  /** Below this, a signal is not worth filing at all. */
  minConfidence: number;
  /** May a single uncorroborated account open a file? */
  singleSourceOpensFile: boolean;
  /** May rumour, chatter and social posts seed a hypothesis? */
  rumorSeeds: boolean;
  /** May it write a provisional narrative, or only questions? */
  provisionalNarrative: boolean;
  /** What happens to a thin item: dropped, or held for a pattern. */
  thinHandoff: "DISCARD" | "HOLD FOR PATTERN";
  /** Named for the editor, and printed on every card the run produces. */
  label: string;
};

/**
 * Nerve, as concrete permissions.
 *
 * The confidence floor moves the opposite way to intuition: MORE nerve means a
 * LOWER floor, because the point of a speculative desk is that a one-in-ten
 * hunch is allowed to exist and be labelled as one. A high floor is what a
 * careful desk uses to refuse to write anything down.
 */
export function stanceFor(dials: DarkDials): DarkStance {
  const n = clampDials(dials).nerve;
  /*
    A dark desk is pre-verification by definition, so even its strictest setting
    is not a newsroom's.

    The model scores its own certainty 0–1 on each signal; this is the point
    below which it will not write one down. 0.50 at nerve 1 is the coin flip —
    the strictest thing that still makes sense on a desk whose entire job is the
    thread before the story. From 8 upward there is NO floor: the hunch gets
    written down and labelled a hunch, which is what this desk is for.

    Three versions of this were wrong before it settled, all in the same
    direction. 0.55→0.06, invented and shown as decimals beside a 1–10 slider.
    Then a "0.10 anchor" that was HIGHER than the 0.06 it replaced — maximum
    nerve made more cautious and described as an improvement. Then a ramp that
    was tighter than the original at nine notches out of ten. The operator
    caught each one: "you always go conservative and this is NOT the place."

    He is right. The safety that matters lives in RULE 1–3 and in the fact that
    nothing here publishes — not in a confidence floor quietly deleting the
    weird thing before anyone sees it.
  */
  const minConfidence = n >= 8 ? 0 : Number((0.5 - (n - 1) * 0.0715).toFixed(2));
  return {
    minConfidence,
    singleSourceOpensFile: n >= 3,
    rumorSeeds: n >= 2,
    provisionalNarrative: n >= 4,
    thinHandoff: n >= 2 ? "HOLD FOR PATTERN" : "DISCARD",
    label:
      n <= 2 ? "Documented only" : n <= 4 ? "Careful" : n <= 7 ? "Standard" : n <= 9 ? "Black Desk" : "Black Sky",
  };
}

export const SCOPE_LABEL: Record<DarkScope, string> = {
  city: "Longmont only",
  county: "Longmont and Boulder County",
  region: "Longmont, Boulder, Weld and Larimer counties",
  adjacent: "The whole neighbourhood — counties plus Erie, Firestone, Mead, Frederick, Niwot, Lyons",
};

/** The jurisdictions a run may follow a trail into. */
export function jurisdictionsFor(scope: DarkScope): string[] {
  const city = ["City of Longmont"];
  const county = [...city, "Boulder County"];
  const region = [...county, "Weld County", "Larimer County", "State of Colorado agencies"];
  const adjacent = [
    ...region,
    "Erie",
    "Firestone",
    "Mead",
    "Frederick",
    "Niwot",
    "Lyons",
    "Special districts serving Longmont residents",
  ];
  return { city, county, region, adjacent }[scope];
}

export const PRESETS: { id: string; name: string; blurb: string; dials: DarkDials }[] = [
  {
    id: "careful",
    name: "Careful",
    blurb: "Tight and shallow. For checking one specific thing without wandering.",
    dials: { dig: 2, nerve: 1, scope: "city" },
  },
  {
    id: "standard",
    name: "Standard",
    blurb: "Follows names and companies across the county. Says what it suspects.",
    dials: { dig: 5, nerve: 5, scope: "county" },
  },
  {
    id: "black-desk",
    name: "Black Desk",
    blurb: "Chases hard, no confidence floor. One anecdote opens a file, clearly labelled.",
    dials: { dig: 8, nerve: 8, scope: "region" },
  },
  {
    id: "black-sky",
    name: "Black Sky",
    blurb: "Follows a trail until it dies, anywhere in the region. Says what it suspects.",
    dials: { dig: 10, nerve: 10, scope: "adjacent" },
  },
];

/**
 * The dials in a sentence, for the editor.
 *
 * Written out rather than shown as two numbers, because "dig 7, nerve 8" tells
 * nobody what is about to happen to their evening.
 */
export function describeDials(dials: DarkDials): string {
  const d = clampDials(dials);
  const b = budgetFor(d);
  const s = stanceFor(d);
  const depth =
    b.hops <= 1
      ? "One hop, then it stops."
      : `Up to ${b.hops} hops${b.followOffWatchlist ? ", following any public record it finds" : ", staying on the watch list"}${b.useArchives ? ", including archived copies" : ""}.`;
  const sure =
    s.minConfidence <= 0
      ? "No confidence floor at all — it writes the hunch down and labels it a hunch."
      : `Writes a signal down only when it is at least ${Math.round(s.minConfidence * 100)}% sure.`;
  const lean = s.singleSourceOpensFile
    ? `One account is enough to open a file. ${sure}`
    : s.rumorSeeds
      ? `Chatter can point it somewhere, but a file needs corroboration. ${sure}`
      : `It files nothing it cannot document. ${sure}`;
  const voice = s.provisionalNarrative
    ? "It will say what it thinks is happening, marked unverified, with what would kill the theory."
    : "It asks questions rather than proposing answers.";
  return `${depth} ${lean} ${voice} Looking at: ${SCOPE_LABEL[d.scope]}.`;
}

/**
 * Roughly how long a round takes, so the number on the slider means something
 * in minutes. Each hop is a model call plus its searches and fetches.
 */
export function estimateMinutes(dials: DarkDials): number {
  const b = budgetFor(dials);
  return Math.max(1, Math.round((b.hops * (35 + b.searchesPerHop * 6 + b.fetchesPerHop * 8)) / 60));
}
